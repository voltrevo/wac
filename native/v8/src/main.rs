// A wac host on V8, driven from Rust.
//
//   wacv8 <stem>            # runs <stem>.wasm against <stem>.json
//
// `native/` is the same idea against wasmtime, and is shelved: wasmtime's GC costs 2–6× on the
// workloads wac programs actually run (`issues/system/0138`), while V8 from Rust matches V8 from
// Deno exactly (`native/spike-v8`). design/lang/0003 records the decision — **rusty_v8 is the
// primary platform** — and this is the beginning of the host that decision needs.
//
// **What runs here, and what does not.** This slice builds `Core` and answers `log` and `warn`,
// which is the whole capability path end to end: an import object made in Rust, a dispatcher that
// reads a wac string out of the module's own memory, a capability struct built through the module's
// `$bind$` exports, and `main` called with it. `Cli` — files, sockets, children, and the ticket
// table that makes `.wait()` work — is the next slice and is declined by name rather than silently.
//
// The one line of JavaScript is `new WebAssembly.Instance`, because that is a JS constructor and V8
// exposes no C++ equivalent. Nothing of the program runs in it.

mod tickets;

use std::cell::RefCell;
use std::sync::Arc;
use std::collections::HashMap;
use std::io::{Read as _, Write};

use serde::Deserialize;

// ---------------------------------------------------------------------------------------------
// The manifest, which is the compiler's description of the module beside it. `packages/platform/
// native.ts` writes it; the field order in a struct is the *construction* order and is the reason
// this file does not hardcode what `Core` contains.

#[derive(Deserialize, Clone, Copy, Default)]
struct Grants {
    #[serde(default)]
    read: bool,
    #[serde(default)]
    write: bool,
    #[serde(default)]
    env: bool,
    #[serde(default)]
    net: bool,
}

#[derive(Deserialize)]
struct Manifest {
    entry: String,
    wasm: String,
    #[serde(default)]
    grants: Grants,
    callbacks: Vec<Callback>,
    structs: Vec<Struct>,
    exports: Vec<ExportSig>,
}

#[derive(Deserialize)]
struct Callback {
    field: String,
    helper: String,
    #[serde(rename = "type")]
    ty: String,
}

#[derive(Deserialize)]
struct Struct {
    name: String,
    fields: Vec<Field>,
    methods: Vec<Method>,
    #[serde(default)]
    variants: Vec<Variant>,
}

/// One variant of an enum, and the export that builds it.
#[derive(Deserialize)]
struct Variant {
    name: String,
    #[serde(rename = "make")]
    make: String,
}

#[derive(Deserialize)]
struct Field {
    name: String,
    #[serde(rename = "type")]
    ty: String,
}

#[derive(Deserialize)]
struct Method {
    name: String,
    #[serde(rename = "export")]
    export_name: String,
}

#[derive(Deserialize)]
struct ExportSig {
    name: String,
    params: Vec<String>,
}

impl Manifest {
    fn find_struct(&self, name: &str) -> Option<&Struct> {
        self.structs.iter().find(|s| s.name == name)
    }

    /// The export that builds `<enum>.<variant>` — what a host would otherwise spell itself.
    fn variant_ctor(&self, enum_name: &str, variant: &str) -> Option<&str> {
        self.find_struct(enum_name)?
            .variants
            .iter()
            .find(|v| v.name == variant)
            .map(|v| v.make.as_str())
    }

    /// The index of the callback signature spelled `ty` — how a field names its dispatcher.
    fn callback_index(&self, ty: &str) -> Option<usize> {
        self.callbacks.iter().position(|c| c.ty == ty)
    }
}

// ---------------------------------------------------------------------------------------------
// What a slot means.
//
// A funcref reaches the guest as a slot number in a per-signature registry: the module calls
// `wac.cb<j>(slot, …)` and the host decides what that slot *is*. The mapping from a capability
// struct's field to a behaviour is here, in one place, rather than spread across the dispatcher.

#[derive(Clone, Copy, PartialEq, Debug)]
enum Cap {
    Log,
    Warn,
    ArgCount,
    Arg,
    Write,
    WriteErr,
    ReadFile,
    NowMillis,
    MonotonicNanos,
    RandomBytes,
    WaitAny,
    SleepMillis,
    Env,
    Cwd,
    OpenInput,
    ReadChunk,
    OpenOutput,
    OutputError,
    WriteFile,
    Stat,
    LinkStat,
    ReadDir,
    ReadStdin,
    PushChild,
    PopChild,
    Connect,
    Listen,
    Accept,
    Recv,
    Send,
    CloseSocket,
    Rename,
    Remove,
    Mkdir,
    SetExecutable,
    /// `Pending<T>.resolve` — the guest asking for the answer it was promised.
    ResolveI32,
    ResolveI64,
    ResolveText,
    ResolveBytes,
    ResolveFile,
    ResolveChange,
    ResolveStat,
    ResolveNames,
    ResolveSocket,
    ResolveRead,
    ResolveBool,
    ResolveCaptured,
    /// `Pending<T>.settled` and `.drop`. Every answer here is ready before the ticket is handed
    /// over, so `settled` is always true and `drop` has nothing to release.
    Settled,
    Drop,
    Unsupported,
}

fn capability_for(owner: &str, field: &str) -> Cap {
    match (owner, field) {
        ("Core", "log") => Cap::Log,
        ("Core", "warn") => Cap::Warn,
        ("Core", "nowMillis") => Cap::NowMillis,
        ("Core", "monotonicNanos") => Cap::MonotonicNanos,
        ("Core", "randomBytes") => Cap::RandomBytes,
        ("Core", "waitAny") => Cap::WaitAny,
        ("Core", "sleepMillis") => Cap::SleepMillis,
        ("Cli", "argCount") => Cap::ArgCount,
        ("Cli", "arg") => Cap::Arg,
        ("Cli", "write") => Cap::Write,
        ("Cli", "writeErr") => Cap::WriteErr,
        ("Cli", "readFile") => Cap::ReadFile,
        ("Cli", "env") => Cap::Env,
        ("Cli", "cwd") => Cap::Cwd,
        ("Cli", "openInput") => Cap::OpenInput,
        ("Cli", "openOutput") => Cap::OpenOutput,
        ("Cli", "outputError") => Cap::OutputError,
        ("Cli", "readChunk") => Cap::ReadChunk,

        ("Cli", "writeFile") => Cap::WriteFile,
        ("Cli", "stat") => Cap::Stat,
        ("Cli", "linkStat") => Cap::LinkStat,
        ("Cli", "readDir") => Cap::ReadDir,
        ("Cli", "readStdin") => Cap::ReadStdin,
        ("Cli", "pushChild") => Cap::PushChild,
        ("Cli", "popChild") => Cap::PopChild,
        ("Cli", "connect") => Cap::Connect,
        ("Cli", "listen") => Cap::Listen,
        ("Cli", "accept") => Cap::Accept,
        ("Cli", "recv") => Cap::Recv,
        ("Cli", "send") => Cap::Send,
        ("Cli", "closeSocket") => Cap::CloseSocket,
        ("Cli", "rename") => Cap::Rename,
        ("Cli", "remove") => Cap::Remove,
        ("Cli", "mkdir") => Cap::Mkdir,
        ("Cli", "setExecutable") => Cap::SetExecutable,
        _ => Cap::Unsupported,
    }
}

use tickets::{Answer, ReadAnswer, StatAnswer, Tickets};

const FAULT_NONE: i32 = 0;
const FAULT_NOT_FOUND: i32 = 1;
const FAULT_DENIED: i32 = 2;
const FAULT_EXISTS: i32 = 3;
const FAULT_NOT_EMPTY: i32 = 4;
const FAULT_OTHER: i32 = 5;
/// **Not the operating system's `FAULT_DENIED`.** This build was not granted the capability, which a
/// caller can and does tell apart from a file that will not open — `platform.wac` keeps them
/// separate for exactly that reason.
const FAULT_NOT_GRANTED: i32 = 7;

fn fault_of(e: &std::io::Error) -> i32 {
    match e.kind() {
        std::io::ErrorKind::NotFound => FAULT_NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => FAULT_DENIED,
        std::io::ErrorKind::AlreadyExists => FAULT_EXISTS,
        std::io::ErrorKind::DirectoryNotEmpty => FAULT_NOT_EMPTY,
        _ => FAULT_OTHER,
    }
}

/// Everything a dispatcher needs, reachable from a `fn` pointer that cannot close over anything.
struct HostState {
    exports: v8::Global<v8::Object>,
    /// `caps[signature][slot]`, the same shape the wasmtime host uses.
    caps: Vec<Vec<Cap>>,
    /// The same table, spelled — so a capability this host cannot answer says *which* it was
    /// instead of "that capability yet". `wc` reaching an unserved `Cli.stat` looked identical to
    /// `wc` reaching an unserved `Cli.spawn`, and the whole point of the list on exit is that the
    /// next slice knows what to build.
    cap_names: Vec<Vec<String>>,
    /// Which capability names went unanswered, so the report names them rather than trapping.
    unsupported: Vec<String>,
    /// The program's own arguments.
    argv: Vec<Vec<u8>>,
    grants: Grants,
    /// **The ticket table**, shared with whatever threads are doing the work. `Arc` rather than
    /// owned because a worker holds one too; nothing in it touches V8, which is what lets it cross
    /// a thread at all.
    tickets: Arc<Tickets>,
    pending: HashMap<String, PendingGlobals>,
    /// `FileResult`'s constructor export, looked up once from the manifest.
    file_result_of: Option<String>,
    /// `Change`'s, the same way.
    change_of: Option<String>,
    /// `Stat`'s.
    stat_of: Option<String>,
    /// `Read`'s variant constructors, by variant name, straight from the manifest.
    read_variants: HashMap<String, String>,
    /// `Socket`'s constructor.
    socket_of: Option<String>,
    /// `Captured`'s.
    captured_of: Option<String>,
    /// **The frame stack.** `pushChild` runs an applet *in this program* rather than in a child
    /// process: box's dispatcher re-enters itself, reads the frame's argv, and its output is
    /// collected here instead of reaching a terminal. While a frame is live it is what `argCount`,
    /// `arg`, `cwd`, `write`, `writeErr` and `readChunk` are about.
    frames: Vec<Frame>,
    /// **The open sockets**, by the handle the guest holds. Behind a mutex because `accept` and
    /// `recv` run on worker threads and each needs the listener or stream it was given.
    sockets: Arc<std::sync::Mutex<HashMap<i32, Sock>>>,
    next_handle: i32,
    /// **This program's standard input**, once `openInput` has redirected it to a file. `None` means
    /// the process's own stdin, which is what a program that never redirects reads.
    input: Option<std::fs::File>,
    /// And where `write` goes, once `openOutput` has redirected it.
    output: Option<std::fs::File>,
}

thread_local! {
    static HOST: RefCell<Option<HostState>> = const { RefCell::new(None) };
    /// When this host started, which is what `monotonicNanos` counts from.
    static START: std::time::Instant = std::time::Instant::now();
}

// ---------------------------------------------------------------------------------------------

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 2 {
        eprintln!("usage: wacv8 <stem>   # runs <stem>.wasm against <stem>.json");
        std::process::exit(2);
    }
    let stem = &args[1];
    let manifest_text = match std::fs::read_to_string(format!("{stem}.json")) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("wacv8: cannot read {stem}.json — {e}");
            std::process::exit(1);
        }
    };
    let manifest: Manifest = match serde_json::from_str(&manifest_text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wacv8: {stem}.json is not a manifest — {e}");
            std::process::exit(1);
        }
    };
    // The manifest names the module beside it, so a renamed pair says so instead of running the
    // wrong program.
    let dir = std::path::Path::new(stem).parent().unwrap_or(std::path::Path::new("."));
    let wasm_path = dir.join(&manifest.wasm);
    let wasm = match std::fs::read(&wasm_path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wacv8: cannot read {} — {e}", wasm_path.display());
            std::process::exit(1);
        }
    };

    let platform = v8::new_default_platform(0, false).make_shared();
    v8::V8::initialize_platform(platform);
    v8::V8::initialize();

    let code = run(&manifest, &wasm);
    std::process::exit(code);
}

fn run(m: &Manifest, wasm: &[u8]) -> i32 {
    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    let module = match v8::WasmModuleObject::compile(scope, wasm) {
        Some(mo) => mo,
        None => {
            eprintln!("wacv8: {} did not compile", m.entry);
            return 1;
        }
    };

    // **The import object, made here rather than in JavaScript.** One dispatcher per callback
    // signature, each carrying its own index as external data — a V8 callback is a bare `fn`
    // pointer and cannot close over anything, so the index travels beside it.
    let wac_ns = v8::Object::new(scope);
    for (j, cb) in m.callbacks.iter().enumerate() {
        let index = v8::Integer::new(scope, j as i32);
        let f = v8::Function::builder(dispatch)
            .data(index.into())
            .build(scope)
            .expect("dispatcher");
        let key = v8::String::new(scope, &cb.field).unwrap();
        wac_ns.set(scope, key.into(), f.into()).unwrap();
    }
    let imports = v8::Object::new(scope);
    let wac_key = v8::String::new(scope, "wac").unwrap();
    imports.set(scope, wac_key.into(), wac_ns.into()).unwrap();

    let global = context.global(scope);
    let mod_key = v8::String::new(scope, "__mod").unwrap();
    global.set(scope, mod_key.into(), module.into()).unwrap();
    let imp_key = v8::String::new(scope, "__imports").unwrap();
    global.set(scope, imp_key.into(), imports.into()).unwrap();
    // The one line of JavaScript: `WebAssembly.Instance` is a JS constructor and V8 exposes no C++
    // equivalent. Nothing of the program runs in it.
    let src = v8::String::new(scope, "new WebAssembly.Instance(__mod, __imports).exports").unwrap();
    let script = match v8::Script::compile(scope, src, None) {
        Some(s) => s,
        None => {
            eprintln!("wacv8: could not compile the instantiation");
            return 1;
        }
    };
    let exports = match script.run(scope).and_then(|v| v.to_object(scope)) {
        Some(o) => o,
        None => {
            eprintln!("wacv8: {} did not instantiate — an import it wants is missing", m.entry);
            return 1;
        }
    };

    // The slot table, filled as capabilities are handed out, so a dispatcher can answer "which
    // function is slot 3 of signature 7" without asking the module.
    let mut caps: Vec<Vec<Cap>> = vec![Vec::new(); m.callbacks.len()];
    let mut names: Vec<Vec<String>> = vec![Vec::new(); m.callbacks.len()];
    let mut unsupported: Vec<String> = Vec::new();

    let core = match build_struct(scope, exports, m, "Core", &mut caps, &mut names, &mut unsupported) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("wacv8: {e}");
            return 1;
        }
    };
    // `Cli` is built whether or not `main` takes it: a program that asks for one capability from it
    // and never touches the rest should run, and the ones this host cannot answer are named on exit.
    let cli = match build_struct(scope, exports, m, "Cli", &mut caps, &mut names, &mut unsupported) {
        Ok(v) => Some(v),
        Err(_) => None,
    };

    // **The resolver trio, registered before the program runs.** A `Pending<T>` carries three
    // funcrefs and the host has to have slots for them before it can hand one over — and their
    // signatures are per-`T`, so `fn[i32(i32)]` and `fn[u8[](i32)]` are different dispatchers.
    let mut pending: HashMap<String, PendingHooks> = HashMap::new();
    for (ty, resolve) in [
        ("i32", Cap::ResolveI32),
        ("i64", Cap::ResolveI64),
        ("string", Cap::ResolveText),
        ("u8[]", Cap::ResolveBytes),
        ("FileResult", Cap::ResolveFile),
        ("Change", Cap::ResolveChange),
        ("Stat", Cap::ResolveStat),
        ("string[]", Cap::ResolveNames),
        ("Socket", Cap::ResolveSocket),
        ("Read", Cap::ResolveRead),
        ("bool", Cap::ResolveBool),
        ("Captured", Cap::ResolveCaptured),
    ] {
        match pending_hooks(scope, exports, m, ty, resolve, &mut caps, &mut names) {
            Ok(h) => {
                pending.insert(ty.to_string(), h);
            }
            // A program that never asks for a `Pending<i32>` has no `Pending<i32>` in its manifest,
            // and that is not an error until something asks for one.
            Err(_) => {}
        }
    }

    HOST.with(|h| {
        *h.borrow_mut() = Some(HostState {
            exports: v8::Global::new(scope, exports),
            caps,
            cap_names: names,
            unsupported: unsupported.clone(),
            argv: std::env::args().skip(2).map(|a| a.into_bytes()).collect(),
            grants: m.grants,
            tickets: Arc::new(Tickets::default()),
            pending: pending
                .into_iter()
                .map(|(k, v)| (k, PendingGlobals::new(scope, v)))
                .collect(),
            file_result_of: m
                .find_struct("FileResult")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            change_of: m
                .find_struct("Change")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            stat_of: m
                .find_struct("Stat")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            captured_of: m
                .find_struct("Captured")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            frames: Vec::new(),
            socket_of: m
                .find_struct("Socket")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            sockets: Arc::new(std::sync::Mutex::new(HashMap::new())),
            next_handle: 1,
            read_variants: ["Data", "End", "Failed"]
                .into_iter()
                .filter_map(|v| m.variant_ctor("Read", v).map(|c| (v.to_string(), c.to_string())))
                .collect(),
            input: None,
            output: None,
        })
    });

    let main_sig = match m.exports.iter().find(|e| e.name == "main") {
        Some(e) => e,
        None => {
            eprintln!("wacv8: {} exports no main", m.entry);
            return 1;
        }
    };
    // **Named, not guessed.** `main(Core, Cli)` is the ordinary shape and this slice cannot serve
    // `Cli` — saying which capability is missing beats trapping inside the program.
    let args: Vec<v8::Local<v8::Value>> = match main_sig.params.as_slice() {
        [a] if a == "Core" => vec![core],
        [a, b] if a == "Core" && b == "Cli" => match cli {
            Some(c) => vec![core, c],
            None => {
                eprintln!("wacv8: main wants a Cli and the manifest describes none");
                return 1;
            }
        },
        other => {
            eprintln!(
                "wacv8: main({}) names a capability this host does not build",
                other.join(", ")
            );
            return 1;
        }
    };

    let main_fn = match get_export(scope, exports, "main") {
        Some(f) => f,
        None => {
            eprintln!("wacv8: main is not callable");
            return 1;
        }
    };
    let r = match main_fn.call(scope, exports.into(), &args) {
        Some(v) => v,
        None => {
            eprintln!("wacv8: {} trapped", m.entry);
            return 1;
        }
    };
    let code = r.to_int32(scope).map(|i| i.value()).unwrap_or(0);

    // A capability the program never reached is not an error; one it *did* reach would have trapped
    // above. Either way the reader is told what this host could not answer.
    // **Behind a switch, because it is a note to whoever builds the next slice rather than to the
    // person running the program.** A finished `wc` printing thirty capability names it never
    // reached is noise, and worse, it is noise on stderr — where a program's own diagnostics are,
    // and where a test comparing two hosts would find it.
    if std::env::var_os("WACV8_CAPS").is_some() {
        let missed =
            HOST.with(|h| h.borrow().as_ref().map(|s| s.unsupported.clone()).unwrap_or_default());
        if !missed.is_empty() {
            eprintln!("wacv8: unanswered capabilities: {}", missed.join(", "));
        }
    }
    code
}

/// Build one capability struct from the manifest's field order, through the module's own exports.
fn build_struct<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    name: &str,
    caps: &mut [Vec<Cap>],
    names: &mut [Vec<String>],
    unsupported: &mut Vec<String>,
) -> Result<v8::Local<'s, v8::Value>, String> {
    let spec = m.find_struct(name).ok_or_else(|| format!("no struct {name} in the manifest"))?;
    let ctor = spec
        .methods
        .iter()
        .find(|mm| mm.name == "of")
        .ok_or_else(|| format!("{name} has no `of`"))?;

    let mut args: Vec<v8::Local<v8::Value>> = Vec::with_capacity(spec.fields.len());
    for field in &spec.fields {
        let sig = m
            .callback_index(&field.ty)
            .ok_or_else(|| format!("{name}.{} names {}, which no dispatcher serves", field.name, field.ty))?;
        let cap = capability_for(name, &field.name);
        if cap == Cap::Unsupported {
            unsupported.push(format!("{name}.{}", field.name));
        }
        let slot = caps[sig].len();
        caps[sig].push(cap);
        names[sig].push(format!("{name}.{}", field.name));

        // `$bind$fnref_<j>(slot)` is the module turning a slot number into a funcref of that
        // signature — the one operation a host cannot do for itself.
        let helper = get_export(scope, exports, &m.callbacks[sig].helper)
            .ok_or_else(|| format!("no {}", m.callbacks[sig].helper))?;
        let slot_v = v8::Integer::new(scope, slot as i32);
        let fr = helper
            .call(scope, exports.into(), &[slot_v.into()])
            .ok_or_else(|| format!("{} refused slot {slot}", m.callbacks[sig].helper))?;
        args.push(fr);
    }

    let ctor_fn = get_export(scope, exports, &ctor.export_name)
        .ok_or_else(|| format!("no {}", ctor.export_name))?;
    ctor_fn
        .call(scope, exports.into(), &args)
        .ok_or_else(|| format!("{} trapped while building {name}", ctor.export_name))
}

fn get_export<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    exports: v8::Local<v8::Object>,
    name: &str,
) -> Option<v8::Local<'s, v8::Function>> {
    let key = v8::String::new(scope, name)?;
    let v = exports.get(scope, key.into())?;
    v.try_into().ok()
}

/// The three funcrefs a `Pending<T>` carries, and the export that builds one.
struct PendingHooks<'s> {
    ctor: v8::Local<'s, v8::Function>,
    resolve: v8::Local<'s, v8::Value>,
    settled: v8::Local<'s, v8::Value>,
    drop: v8::Local<'s, v8::Value>,
}

/// The same, held across the call into the program.
struct PendingGlobals {
    ctor: v8::Global<v8::Function>,
    resolve: v8::Global<v8::Value>,
    settled: v8::Global<v8::Value>,
    drop: v8::Global<v8::Value>,
}

impl PendingGlobals {
    fn new(scope: &mut v8::PinScope, h: PendingHooks) -> Self {
        Self {
            ctor: v8::Global::new(scope, h.ctor),
            resolve: v8::Global::new(scope, h.resolve),
            settled: v8::Global::new(scope, h.settled),
            drop: v8::Global::new(scope, h.drop),
        }
    }
}

/// Find `Pending<T>`'s constructor and register a slot for each of its three funcrefs.
fn pending_hooks<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    ty: &str,
    resolve_cap: Cap,
    caps: &mut [Vec<Cap>],
    names: &mut [Vec<String>],
) -> Result<PendingHooks<'s>, String> {
    let name = format!("Pending<{ty}>");
    let spec = m.find_struct(&name).ok_or_else(|| format!("no {name}"))?;
    let ctor_name = spec
        .methods
        .iter()
        .find(|mm| mm.name == "of")
        .ok_or_else(|| format!("{name} has no `of`"))?
        .export_name
        .clone();
    let ctor = get_export(scope, exports, &ctor_name).ok_or_else(|| format!("no {ctor_name}"))?;

    let mut fr = |field: &str, cap: Cap| -> Result<v8::Local<'s, v8::Value>, String> {
        let f = spec
            .fields
            .iter()
            .find(|f| f.name == field)
            .ok_or_else(|| format!("{name} has no {field}"))?;
        let sig = m
            .callback_index(&f.ty)
            .ok_or_else(|| format!("{name}.{field} names {}, which no dispatcher serves", f.ty))?;
        let slot = caps[sig].len();
        caps[sig].push(cap);
        names[sig].push(format!("{name}.{field}"));
        let helper = get_export(scope, exports, &m.callbacks[sig].helper)
            .ok_or_else(|| format!("no {}", m.callbacks[sig].helper))?;
        let slot_v = v8::Integer::new(scope, slot as i32);
        helper
            .call(scope, exports.into(), &[slot_v.into()])
            .ok_or_else(|| format!("{} refused slot {slot}", m.callbacks[sig].helper))
    };

    let resolve = fr("resolve", resolve_cap)?;
    let settled = fr("settled", Cap::Settled)?;
    let drop = fr("drop", Cap::Drop)?;
    Ok(PendingHooks { ctor, resolve, settled, drop })
}

/// Record an answer and hand back the `Pending<T>` that will produce it.
fn ticket_for<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    ty: &str,
    answer: Answer,
) -> Option<v8::Local<'s, v8::Value>> {
    let (id, hooks) = HOST.with(|h| {
        let mut b = h.borrow_mut();
        let st = b.as_mut()?;
        let id = st.tickets.settled_now(answer);
        let p = st.pending.get(ty)?;
        Some((
            id,
            (p.ctor.clone(), p.resolve.clone(), p.settled.clone(), p.drop.clone()),
        ))
    })?;
    let ctor = v8::Local::new(scope, hooks.0);
    let resolve = v8::Local::new(scope, hooks.1);
    let settled = v8::Local::new(scope, hooks.2);
    let dropf = v8::Local::new(scope, hooks.3);
    let id_v = v8::Integer::new(scope, id);
    let recv = v8::undefined(scope);
    ctor.call(scope, recv.into(), &[id_v.into(), resolve, settled, dropf])
}

/// Hand back a `Pending<T>` for work that has **not** finished — the id is live, and whichever
/// thread is doing the work will complete it.
fn ticket_pending<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    ty: &str,
    id: i32,
) -> Option<v8::Local<'s, v8::Value>> {
    let hooks = HOST.with(|h| {
        let b = h.borrow();
        let p = b.as_ref()?.pending.get(ty)?;
        Some((p.ctor.clone(), p.resolve.clone(), p.settled.clone(), p.drop.clone()))
    })?;
    let ctor = v8::Local::new(scope, hooks.0);
    let resolve = v8::Local::new(scope, hooks.1);
    let settled = v8::Local::new(scope, hooks.2);
    let dropf = v8::Local::new(scope, hooks.3);
    let id_v = v8::Integer::new(scope, id);
    let recv = v8::undefined(scope);
    ctor.call(scope, recv.into(), &[id_v.into(), resolve, settled, dropf])
}

/// The table, for a capability that is about to start work on a thread.
fn table() -> Option<Arc<Tickets>> {
    HOST.with(|h| h.borrow().as_ref().map(|s| s.tickets.clone()))
}

/// A funcref the guest called: `wac.cb<j>(slot, …)`.
fn dispatch(
    scope: &mut v8::PinScope,
    args: v8::FunctionCallbackArguments,
    mut rv: v8::ReturnValue<v8::Value>,
) {
    let sig = args.data().to_int32(scope).map(|i| i.value()).unwrap_or(-1) as usize;
    let slot = args.get(0).to_int32(scope).map(|i| i.value()).unwrap_or(-1) as usize;
    let cap = HOST.with(|h| {
        h.borrow().as_ref().and_then(|s| s.caps.get(sig).and_then(|v| v.get(slot)).copied())
    });
    let Some(cap) = cap else {
        let msg = v8::String::new(scope, "no function in that slot").unwrap();
        let e = v8::Exception::error(scope, msg);
        scope.throw_exception(e);
        return;
    };

    match cap {
        Cap::Log | Cap::Warn => {
            let text = read_string(scope, args.get(1));
            // The newline `log` adds, added here for the same reason the wasmtime host does it here:
            // a captured frame should not carry one and a terminal line should.
            if cap == Cap::Log {
                println!("{text}");
            } else {
                eprintln!("{text}");
            }
            rv.set_undefined();
        }
        Cap::ArgCount => {
            let n = HOST.with(|h| {
                let b = h.borrow();
                let Some(s) = b.as_ref() else { return 0 };
                s.frames.last().map(|f| f.argv.len()).unwrap_or(s.argv.len())
            }) as i32;
            if std::env::var_os("WACV8_TRACE").is_some() {
                eprintln!("[trace] argCount -> {n}");
            }
            match ticket_for(scope, "i32", Answer::I32(n)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<i32> to answer argCount with"),
            }
        }
        Cap::Arg => {
            let i = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let bytes = HOST.with(|h| {
                let b = h.borrow();
                let Some(s) = b.as_ref() else { return Vec::new() };
                let from = s.frames.last().map(|f| &f.argv).unwrap_or(&s.argv);
                usize::try_from(i).ok().and_then(|i| from.get(i).cloned()).unwrap_or_default()
            });
            if std::env::var_os("WACV8_TRACE").is_some() {
                eprintln!("[trace] arg({i}) -> {:?}", String::from_utf8_lossy(&bytes));
            }
            match ticket_for(scope, "u8[]", Answer::Bytes(Some(bytes))) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<u8[]> to answer arg with"),
            }
        }
        Cap::Write | Cap::WriteErr => {
            let bytes = read_bytes(scope, args.get(1));
            // **Wherever output currently goes.** `openOutput` may have pointed it at a file, and a
            // program that redirected its own output and then wrote to the terminal anyway would be
            // a `cp` that printed the file it was copying.
            // **A frame collects what it writes**, which is the whole of what "captured" means: the
            // applet cannot tell, and the shell that pushed the frame gets the bytes.
            let captured = HOST.with(|h| {
                let mut b = h.borrow_mut();
                let Some(s) = b.as_mut() else { return false };
                match s.frames.last_mut() {
                    Some(f) => {
                        if cap == Cap::Write { f.out.extend_from_slice(&bytes) } else { f.err.extend_from_slice(&bytes) }
                        true
                    }
                    None => false,
                }
            });
            if captured {
                rv.set_bool(true);
                return;
            }
            let ok = if cap == Cap::Write {
                HOST.with(|h| {
                    let mut b = h.borrow_mut();
                    match b.as_mut().and_then(|s| s.output.as_mut()) {
                        Some(f) => f.write_all(&bytes).and_then(|_| f.flush()).is_ok(),
                        None => {
                            let mut out = std::io::stdout();
                            out.write_all(&bytes).and_then(|_| out.flush()).is_ok()
                        }
                    }
                })
            } else {
                let mut err = std::io::stderr();
                err.write_all(&bytes).and_then(|_| err.flush()).is_ok()
            };
            rv.set_bool(ok);
        }
        Cap::ReadFile => {
            let path = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.read));
            // **Denied, not absent.** A program built without `--allow-read` learns that reading is
            // refused *to it*, with a fault kept separate from the operating system's own, so a
            // caller can tell "this build cannot" from "this file will not". Answered at once,
            // because refusing needs no disk.
            if !granted {
                let a = Answer::File(
                    false,
                    Vec::new(),
                    "Not granted to this application".into(),
                    FAULT_NOT_GRANTED,
                );
                match ticket_for(scope, "FileResult", a) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<FileResult> for readFile"),
                }
                return;
            }
            // **On a thread**, which is the whole reason this returns a ticket rather than a value:
            // a slow disk must not stop the program from doing what else it had in flight.
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let a = match std::fs::read(&path) {
                    Ok(bytes) => Answer::File(true, bytes, String::new(), FAULT_NONE),
                    Err(e) => Answer::File(false, Vec::new(), e.to_string(), fault_of(&e)),
                };
                worker.complete(id, a);
            });
            match ticket_pending(scope, "FileResult", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<FileResult> to answer readFile with"),
            }
        }
        Cap::Env => {
            // **Absent, not refused.** Without the grant this answers "this world's environment does
            // not say", which is what the JavaScript hosts do by handing the provider no reader at
            // all — a program cannot tell an unset variable from an ungranted one, and should not.
            let name = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.env));
            let value = if granted {
                std::env::var(&name).ok().map(String::into_bytes)
            } else {
                None
            };
            match ticket_for(scope, "u8[]", Answer::Bytes(value)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<u8[]> to answer env with"),
            }
        }
        Cap::ReadStdin => {
            // **All of it, to the end** — the unbounded read, as against `readChunk`'s bounded one.
            // A frame's input answers here too, because an applet that reads all of stdin should get
            // what its caller handed it rather than the terminal behind them both.
            let redirected = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.input.is_some()));
            let framed = if redirected { None } else { HOST.with(|h| {
                let mut b = h.borrow_mut();
                let st = b.as_mut()?;
                match st.frames.last_mut() {
                    Some(f) if !f.inherit_input => {
                        let rest = f.stdin[f.stdin_at.min(f.stdin.len())..].to_vec();
                        f.stdin_at = f.stdin.len();
                        Some(rest)
                    }
                    _ => None,
                }
            })};
            if let Some(bytes) = framed {
                match ticket_for(scope, "u8[]", Answer::Bytes(Some(bytes))) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<u8[]> for readStdin"),
                }
                return;
            }
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let mut buf = Vec::new();
                let a = match std::io::stdin().read_to_end(&mut buf) {
                    Ok(_) => Answer::Bytes(Some(buf)),
                    Err(_) => Answer::Bytes(Some(Vec::new())),
                };
                worker.complete(id, a);
            });
            match ticket_pending(scope, "u8[]", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<u8[]> to answer readStdin with"),
            }
        }
        Cap::PushChild => {
            // **An applet inside this program**, not a child process: box's dispatcher re-enters
            // itself with the frame's argv, and what it writes is collected rather than printed.
            let argv = read_string_array_bytes(scope, args.get(1));
            let stdin = read_bytes(scope, args.get(2));
            let cwd = read_string(scope, args.get(3));
            let inherit_input = args.get(4).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
            if std::env::var_os("WACV8_TRACE").is_some() {
                let shown: Vec<String> =
                    argv.iter().map(|a| String::from_utf8_lossy(a).into_owned()).collect();
                eprintln!("[trace] pushChild argv={shown:?} stdin={} inherit={inherit_input}", stdin.len());
            }
            HOST.with(|h| {
                if let Some(st) = h.borrow_mut().as_mut() {
                    st.frames.push(Frame {
                        argv,
                        stdin,
                        stdin_at: 0,
                        cwd,
                        inherit_input,
                        ..Default::default()
                    });
                }
            });
            match ticket_for(scope, "bool", Answer::Bool(true)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<bool> for pushChild"),
            }
        }
        Cap::PopChild => {
            // A pop with nothing pushed answers two empty arrays rather than failing — the caller
            // has nothing to clean up either way, and `platform.wac` says so.
            let (out, err) = HOST.with(|h| {
                let mut b = h.borrow_mut();
                let Some(s) = b.as_mut() else { return (Vec::new(), Vec::new()) };
                let popped = s.frames.pop().map(|f| (f.out, f.err)).unwrap_or_default();
                // **A redirection ends with the frame that made it.** Otherwise the next applet in
                // a pipeline reads the file the previous one opened — the same wrong-answer shape
                // as above, one command later.
                s.input = None;
                s.output = None;
                popped
            });
            // **Never truncated here.** The JavaScript hosts cap a frame's output at 8 MiB and
            // answer `false` from `write` at the cap, which a producer like `box yes` stops on.
            // This one simply grows, so the same applet answers in full; `Captured.truncated` is
            // the field that lets a caller tell the two apart, and on this host it is always false.
            match ticket_for(scope, "Captured", Answer::Captured(out, err, false)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Captured> for popChild"),
            }
        }
        Cap::Listen | Cap::Connect => {
            // **One grant for both ends.** Dialling out and accepting in are the same authority —
            // the ability to speak to something that is not this process — and `platform.wac` gives
            // them one flag.
            let address = read_string(scope, args.get(1));
            let port = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.net));
            let answer = if !granted {
                Answer::Socket(-1, "Not granted to this application".into(), String::new(), 0)
            } else if cap == Cap::Listen {
                // An empty address means every interface, which is what `greet ""` asks for.
                let host = if address.is_empty() { "0.0.0.0" } else { address.as_str() };
                match std::net::TcpListener::bind((host, port as u16)) {
                    Ok(l) => {
                        // **The port the kernel actually chose.** `listen(addr, 0)` is how a server
                        // avoids a clash it cannot predict, and it is useless unless the program can
                        // learn which port it got.
                        let bound = l.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let handle = keep_socket(Sock::Listener(l));
                        Answer::Socket(handle, String::new(), String::new(), bound)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0),
                }
            } else {
                match std::net::TcpStream::connect((address.as_str(), port as u16)) {
                    Ok(sk) => {
                        let mine = sk.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let handle = keep_socket(Sock::Stream(sk));
                        Answer::Socket(handle, String::new(), String::new(), mine)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0),
                }
            };
            match ticket_for(scope, "Socket", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Socket> for that"),
            }
        }
        Cap::Accept => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            // **On a thread, and this is the one that proves the table.** A server sits in `accept`
            // until somebody dials it, which may be never — a host that did this inline would stop
            // the program dead, and the ticket exists precisely so it does not.
            let listener = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Listener(l)) => l.try_clone().ok(),
                    _ => None,
                }
            });
            let Some(listener) = listener else {
                let a = Answer::Socket(-1, "no such listener".into(), String::new(), 0);
                match ticket_for(scope, "Socket", a) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Socket> for accept"),
                }
                return;
            };
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            let sockets = HOST.with(|h| h.borrow().as_ref().map(|s| s.sockets.clone()));
            std::thread::spawn(move || {
                let a = match listener.accept() {
                    Ok((stream, who)) => {
                        // The address only, without the port it dialled from — `platform.wac` says
                        // why: the client's own port helps nobody and invites parsing.
                        let peer = who.ip().to_string();
                        let port = stream.local_addr().map(|x| x.port() as i32).unwrap_or(0);
                        // A handle is taken here rather than on the isolate's thread, so the number
                        // is chosen under the same lock the table is.
                        let handle = match sockets {
                            Some(ref m) => {
                                let mut g = m.lock().unwrap();
                                // Handles from workers start high enough not to race the main
                                // thread's counter, which only ever hands out small numbers.
                                let h = 100_000 + g.len() as i32;
                                g.insert(h, Sock::Stream(stream));
                                h
                            }
                            None => -1,
                        };
                        Answer::Socket(handle, String::new(), peer, port)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0),
                };
                worker.complete(id, a);
            });
            match ticket_pending(scope, "Socket", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Socket> to answer accept with"),
            }
        }
        Cap::Recv => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let stream = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Stream(sk)) => sk.try_clone().ok(),
                    _ => None,
                }
            });
            let Some(mut stream) = stream else {
                return throw(scope, "recv on something that is not a connected socket");
            };
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 65536];
                let a = match stream.read(&mut buf) {
                    Ok(0) => Answer::Read(ReadAnswer::End),
                    Ok(n) => Answer::Read(ReadAnswer::Data(buf[..n].to_vec())),
                    Err(e) => Answer::Read(ReadAnswer::Failed(e.to_string())),
                };
                worker.complete(id, a);
            });
            match ticket_pending(scope, "Read", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Read> to answer recv with"),
            }
        }
        Cap::Send => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let bytes = read_bytes(scope, args.get(2));
            let sent = HOST.with(|h| {
                let b = h.borrow();
                let Some(st) = b.as_ref() else { return false };
                let mut socks = st.sockets.lock().unwrap();
                match socks.get_mut(&handle) {
                    Some(Sock::Stream(sk)) => sk.write_all(&bytes).and_then(|_| sk.flush()).is_ok(),
                    _ => false,
                }
            });
            match ticket_for(scope, "bool", Answer::Bool(sent)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<bool> to answer send with"),
            }
        }
        Cap::CloseSocket => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            HOST.with(|h| {
                if let Some(st) = h.borrow().as_ref() {
                    st.sockets.lock().unwrap().remove(&handle);
                }
            });
            rv.set_undefined();
        }
        Cap::ReadDir => {
            let path = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.read));
            if !granted {
                // **Absent, not refused**, matching `readFile`'s neighbour only in shape: a
                // directory this build may not read is one it cannot see, and `string[]?` has a
                // spelling for that.
                match ticket_for(scope, "string[]", Answer::Names(None)) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<string[]> for readDir"),
                }
                return;
            }
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let a = match std::fs::read_dir(&path) {
                    Ok(entries) => {
                        let mut names: Vec<String> = entries
                            .filter_map(|e| e.ok())
                            .map(|e| e.file_name().to_string_lossy().into_owned())
                            .collect();
                        // **Sorted**, because a directory's order is the filesystem's and a program
                        // that prints it would print something different on another machine.
                        names.sort();
                        Answer::Names(Some(names))
                    }
                    Err(_) => Answer::Names(None),
                };
                worker.complete(id, a);
            });
            match ticket_pending(scope, "string[]", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<string[]> to answer readDir with"),
            }
        }
        Cap::Rename | Cap::Remove | Cap::Mkdir | Cap::SetExecutable => {
            // Four mutations behind one grant, because they are one authority: the ability to change
            // what is on disk. Each answers a `Change`, and a refusal is `FAULT_NOT_GRANTED` rather
            // than the operating system's `FAULT_DENIED` — this build cannot, as against this file
            // will not.
            let a = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                let r = match cap {
                    Cap::Rename => {
                        let to = read_string(scope, args.get(2));
                        std::fs::rename(&a, &to)
                    }
                    Cap::Remove => {
                        // `recursive` is the second argument, and a directory is not removed without
                        // it — the difference between `rm` and `rm -r`, which the caller chose.
                        let recursive = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
                        let is_dir = std::fs::metadata(&a).map(|m| m.is_dir()).unwrap_or(false);
                        match (is_dir, recursive) {
                            (true, true) => std::fs::remove_dir_all(&a),
                            (true, false) => std::fs::remove_dir(&a),
                            _ => std::fs::remove_file(&a),
                        }
                    }
                    Cap::Mkdir => {
                        let parents = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
                        if parents { std::fs::create_dir_all(&a) } else { std::fs::create_dir(&a) }
                    }
                    _ => {
                        use std::os::unix::fs::PermissionsExt;
                        let on = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
                        std::fs::metadata(&a).and_then(|md| {
                            let mut perm = md.permissions();
                            let mode = perm.mode();
                            // **The owner-execute bit and nothing else**, which is what
                            // `setExecutable` is: git's 100644 against its 100755.
                            perm.set_mode(if on { mode | 0o100 } else { mode & !0o100 });
                            std::fs::set_permissions(&a, perm)
                        })
                    }
                };
                match r {
                    Ok(()) => Answer::Change(FAULT_NONE, String::new()),
                    Err(e) => Answer::Change(fault_of(&e), e.to_string()),
                }
            };
            match ticket_for(scope, "Change", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Change> for that"),
            }
        }
        Cap::WriteFile => {
            let path = read_string(scope, args.get(1));
            let data = read_bytes(scope, args.get(2));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                match std::fs::write(&path, &data) {
                    Ok(()) => Answer::Change(FAULT_NONE, String::new()),
                    Err(e) => Answer::Change(fault_of(&e), e.to_string()),
                }
            };
            match ticket_for(scope, "Change", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Change> to answer writeFile with"),
            }
        }
        Cap::Stat | Cap::LinkStat => {
            // **`stat` follows a link and `linkStat` does not**, which is the whole difference
            // between "what does this name lead to" and "what is this name" — `find` wants the
            // first and `tar` the second.
            let path = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.read));
            let answer = if !granted {
                Answer::Stat(Box::new(StatAnswer { fault: FAULT_NOT_GRANTED, ..Default::default() }))
            } else {
                let md = if cap == Cap::Stat {
                    std::fs::metadata(&path)
                } else {
                    std::fs::symlink_metadata(&path)
                };
                Answer::Stat(Box::new(match md {
                    Ok(md) => StatAnswer {
                        exists: true,
                        is_file: md.is_file(),
                        is_dir: md.is_dir(),
                        size: md.len() as i64,
                        modified_millis: md
                            .modified()
                            .ok()
                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0),
                        is_symlink: md.file_type().is_symlink(),
                        // One bit rather than a mode, which is what `platform.wac` says this is for:
                        // it is the difference between git's 100644 and its 100755.
                        is_executable: {
                            use std::os::unix::fs::PermissionsExt;
                            md.permissions().mode() & 0o100 != 0
                        },
                        fault: FAULT_NONE,
                    },
                    // **Not an error.** A path that is not there is a fact about the world, and
                    // `exists: false` with `FAULT_NONE` is how this world says it.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => StatAnswer::default(),
                    Err(e) => StatAnswer { fault: fault_of(&e), ..Default::default() },
                }))
            };
            match ticket_for(scope, "Stat", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Stat> to answer stat with"),
            }
        }
        Cap::OpenInput => {
            // **Redirect this program's standard input to a file.** It outranks anything else the
            // program might read from, which is the order `native/src` had to fix: a `cat f` that
            // had opened the file went on reading the queue it was spawned with, printed nothing,
            // and exited 0.
            let path = read_string(scope, args.get(1));
            // **`openInput("")` is standard input**, which is what `packages/box` means by `-` and by
            // an absent operand — `grep h` with nothing to read from a file says it this way. Taken
            // as a path it is a file that does not exist, and `grep: : No such file or directory` is
            // what a pipeline looked like before this line: an empty name, because there was none.
            if path.is_empty() {
                HOST.with(|h| {
                    if let Some(st) = h.borrow_mut().as_mut() {
                        st.input = None;
                    }
                });
                match ticket_for(scope, "Change", Answer::Change(FAULT_NONE, String::new())) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Change> for openInput"),
                }
                return;
            }
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.read));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                match std::fs::File::open(&path) {
                    Ok(f) => {
                        HOST.with(|h| {
                            if let Some(st) = h.borrow_mut().as_mut() {
                                st.input = Some(f);
                            }
                        });
                        Answer::Change(FAULT_NONE, String::new())
                    }
                    Err(e) => Answer::Change(fault_of(&e), e.to_string()),
                }
            };
            match ticket_for(scope, "Change", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Change> to answer openInput with"),
            }
        }
        Cap::ReadChunk => {
            // **Not a ticket.** `fn[Read()]` is the *bounded* read: it answers with whatever is
            // there, or that the input has ended, and a program loops on it.
            // **An explicit `openInput` wins over the frame's queue, and the order is the whole of
            // the bug.** `openInput` redirects *this* program's input to a file, so an applet that
            // opened one and then read the frame's queue instead read what its caller had already
            // finished: `sha256sum README.md` inside the shell hashed nothing and printed the hash
            // of the empty string, which is a wrong answer that looks like a right one.
            // `native/src/main.rs` carries the same warning about `cat f`; I ordered these the other
            // way round and walked into it.
            let redirected = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.input.is_some()));
            // Inside a frame: the bytes it was given, then the end. One chunk rather than a
            // trickle, because the frame has all of them already and splitting would invent a
            // boundary the caller then has to reassemble.
            let framed = if redirected { None } else { HOST.with(|h| {
                let mut b = h.borrow_mut();
                let st = b.as_mut()?;
                match st.frames.last_mut() {
                    Some(f) if !f.inherit_input => {
                        let rest = f.stdin[f.stdin_at.min(f.stdin.len())..].to_vec();
                        f.stdin_at = f.stdin.len();
                        Some(rest)
                    }
                    _ => None,
                }
            })};
            if let Some(bytes) = framed {
                let built =
                    if bytes.is_empty() { build_read_end(scope) } else { build_read_data(scope, &bytes) };
                match built {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a Read for the frame's input"),
                }
                return;
            }
            let mut buf = [0u8; 65536];
            let n = HOST.with(|h| {
                let mut b = h.borrow_mut();
                let st = b.as_mut()?;
                Some(match st.input.as_mut() {
                    Some(f) => f.read(&mut buf),
                    None => std::io::stdin().read(&mut buf),
                })
            });
            let built = match n {
                Some(Ok(0)) | None => build_read_end(scope),
                Some(Ok(n)) => build_read_data(scope, &buf[..n]),
                Some(Err(e)) => build_read_failed(scope, &e.to_string()),
            };
            match built {
                Some(v) => rv.set(v),
                // Most often an old manifest: `variants` arrived in 0141, and one written before
                // that names no constructor for `Read.Data`. Saying so beats "could not build".
                None => throw(
                    scope,
                    "could not build a Read — does this manifest carry Read's variants? \
                     (rebuild it with packages/platform/native.ts)",
                ),
            }
        }
        Cap::OpenOutput => {
            // **Redirect this program's standard output to a file**, which is what `Cli.write` then
            // reaches. An empty path means "back to the real one", the same as `native/src`.
            let path = read_string(scope, args.get(1));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if path.is_empty() {
                HOST.with(|h| {
                    if let Some(st) = h.borrow_mut().as_mut() {
                        st.output = None;
                    }
                });
                Answer::Change(FAULT_NONE, String::new())
            } else if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                match std::fs::File::create(&path) {
                    Ok(f) => {
                        HOST.with(|h| {
                            if let Some(st) = h.borrow_mut().as_mut() {
                                st.output = Some(f);
                            }
                        });
                        Answer::Change(FAULT_NONE, String::new())
                    }
                    Err(e) => Answer::Change(fault_of(&e), e.to_string()),
                }
            };
            match ticket_for(scope, "Change", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Change> to answer openOutput with"),
            }
        }
        Cap::OutputError => {
            // Whether the redirected output has gone wrong — nothing here writes lazily, so a write
            // that returned true has already reached the file.
            match ticket_for(scope, "string", Answer::Text(String::new())) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<string> for outputError"),
            }
        }
        Cap::Cwd => {
            // **Where the program thinks it is**, which is where every relative path it hands back
            // will be resolved from. Not behind the read grant: knowing the name of the directory
            // is not reading anything in it, and `box` asks for it to print paths.
            let framed = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.frames.last().map(|f| f.cwd.clone()))
            });
            let here = match framed {
                Some(d) if !d.is_empty() => d,
                _ => std::env::current_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            };
            match ticket_for(scope, "string", Answer::Text(here)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<string> to answer cwd with"),
            }
        }
        Cap::WaitAny => {
            // The ids come over as a wac `i32[]`, and the answer is an index into *that* list —
            // first ready in the caller's own order, never first to finish. `tickets.rs` says why.
            let ids = read_i32_array(scope, args.get(1));
            let millis = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let which = table().map(|t| t.wait_any(&ids, millis)).unwrap_or(-1);
            let v = v8::Integer::new(scope, which);
            rv.set(v.into());
        }
        Cap::SleepMillis => {
            let millis = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(0).max(0);
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(millis as u64));
                worker.complete(id, Answer::I64(millis as i64));
            });
            match ticket_pending(scope, "i64", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<i64> to answer sleepMillis with"),
            }
        }
        Cap::RandomBytes => {
            // **From the operating system**, not from a generator this host seeds: `box` uses these
            // for temporary names, and a program that gets predictable ones has a race with anything
            // else running. `/dev/urandom` is the whole of it — no crate, no state, no reseeding.
            let n = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(0).max(0) as usize;
            let bytes = match std::fs::File::open("/dev/urandom") {
                Ok(mut f) => {
                    let mut buf = vec![0u8; n];
                    match f.read_exact(&mut buf) {
                        Ok(()) => Some(buf),
                        Err(_) => None,
                    }
                }
                Err(_) => None,
            };
            match bytes {
                Some(b) => match ticket_for(scope, "u8[]", Answer::Bytes(Some(b))) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<u8[]> for randomBytes"),
                },
                // **Not an empty array.** A program handed zero bytes where it asked for sixteen
                // would build a name out of nothing and think it had one.
                None => throw(scope, "this host could not read /dev/urandom"),
            }
        }
        Cap::NowMillis | Cap::MonotonicNanos => {
            // The wall clock and a monotonic one. `monotonicNanos` is measured from the first call
            // rather than from an epoch, which is all a program may assume of it — differences are
            // the only thing it is for.
            let n = if cap == Cap::NowMillis {
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            } else {
                START.with(|s| s.elapsed().as_nanos() as i64)
            };
            match ticket_for(scope, "i64", Answer::I64(n)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<i64> to answer the clock with"),
            }
        }
        Cap::ResolveI32
        | Cap::ResolveI64
        | Cap::ResolveText
        | Cap::ResolveBytes
        | Cap::ResolveFile
        | Cap::ResolveChange
        | Cap::ResolveStat
        | Cap::ResolveNames
        | Cap::ResolveSocket
        | Cap::ResolveRead
        | Cap::ResolveBool
        | Cap::ResolveCaptured => {
            // **Spent when taken**, which is what `Pending`'s own comment says happens on the host
            // side of the resolver: a second `wait()` on one ticket is a bug in the program, and it
            // should look like one rather than answering twice.
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            // **This blocks**, which is what `wait()` means: the guest asked for the answer and
            // there is nothing else for this thread to do until the work that produces it lands.
            let answer = table().and_then(|t| t.take(id));
            match answer {
                Some(Answer::I32(n)) => {
                    let v = v8::Integer::new(scope, n);
                    rv.set(v.into());
                }
                // **A wasm `i64` is a JavaScript `BigInt`**, and V8 is the one holding that rule —
                // handing back a Number here is a type error at the boundary, not a rounding one.
                Some(Answer::I64(n)) => {
                    let v = v8::BigInt::new_from_i64(scope, n);
                    rv.set(v.into());
                }
                Some(Answer::Text(t)) => match write_string(scope, &t) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a string for the answer"),
                },
                Some(Answer::Bytes(None)) => rv.set_null(),
                Some(Answer::Bytes(Some(b))) => match write_bytes(scope, &b) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a u8[] for the answer"),
                },
                Some(Answer::Bool(b)) => rv.set_bool(b),
                Some(Answer::Captured(out, err, truncated)) => {
                    match build_captured(scope, &out, &err, truncated) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Captured for the answer"),
                    }
                }
                Some(Answer::Socket(handle, error, peer, port)) => {
                    match build_socket(scope, handle, &error, &peer, port) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Socket for the answer"),
                    }
                }
                Some(Answer::Read(r)) => {
                    let built = match r {
                        ReadAnswer::Data(b) => build_read_data(scope, &b),
                        ReadAnswer::End => build_read_end(scope),
                        ReadAnswer::Failed(why) => build_read_failed(scope, &why),
                    };
                    match built {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Read for the answer"),
                    }
                }
                Some(Answer::Names(None)) => rv.set_null(),
                Some(Answer::Names(Some(names))) => match build_names(scope, &names) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a string[] for the answer"),
                },
                Some(Answer::Stat(st)) => match build_stat(scope, &st) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a Stat for the answer"),
                },
                Some(Answer::Change(fault, message)) => {
                    match build_change(scope, fault, &message) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Change for the answer"),
                    }
                }
                Some(Answer::File(ok, bytes, error, fault)) => {
                    match build_file_result(scope, ok, &bytes, &error, fault) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a FileResult for the answer"),
                    }
                }
                None => throw(scope, "that ticket has already been taken, or was never issued"),
            }
        }
        Cap::Settled => {
            // Every answer here is in the table before its ticket is handed over.
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let known = table().is_some_and(|t| t.is_settled(id));
            rv.set_bool(known);
        }
        Cap::Drop => {
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            if let Some(t) = table() {
                t.drop_ticket(id);
            }
            rv.set_undefined();
        }
        Cap::Unsupported => {
            let who = HOST.with(|h| {
                h.borrow()
                    .as_ref()
                    .and_then(|s| s.cap_names.get(sig).and_then(|v| v.get(slot)).cloned())
                    .unwrap_or_else(|| format!("signature {sig} slot {slot}"))
            });
            throw(scope, &format!("{who} is not answered by this host yet"));
        }
    }
}

fn throw(scope: &mut v8::PinScope, what: &str) {
    let msg = v8::String::new(scope, what).unwrap();
    let e = v8::Exception::error(scope, msg);
    scope.throw_exception(e);
}

/// A wac `string[]` out of the module's memory, as bytes — `pushChild`'s argv.
fn read_string_array_bytes(scope: &mut v8::PinScope, v: v8::Local<v8::Value>) -> Vec<Vec<u8>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
    let Some(exports) = exports else { return Vec::new() };
    let exports = v8::Local::new(scope, exports);
    let Some(len_fn) = get_export(scope, exports, "$bind$arr_string_len") else { return Vec::new() };
    let Some(n) = len_fn.call(scope, exports.into(), &[v]).and_then(|r| r.to_int32(scope)) else {
        return Vec::new();
    };
    let n = n.value();
    let Some(get) = get_export(scope, exports, "$bind$arr_string_get") else { return Vec::new() };
    let mut out = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let idx = v8::Integer::new(scope, i);
        let Some(item) = get.call(scope, exports.into(), &[v, idx.into()]) else { continue };
        out.push(read_string(scope, item).into_bytes());
    }
    out
}

/// A wac `i32[]` out of the module's memory — how `waitAny` is handed its list of tickets.
fn read_i32_array(scope: &mut v8::PinScope, v: v8::Local<v8::Value>) -> Vec<i32> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
    let Some(exports) = exports else { return Vec::new() };
    let exports = v8::Local::new(scope, exports);
    let Some(len_fn) = get_export(scope, exports, "$bind$arr_i32_len") else { return Vec::new() };
    let Some(n) = len_fn.call(scope, exports.into(), &[v]).and_then(|r| r.to_int32(scope)) else {
        return Vec::new();
    };
    let n = n.value();
    let Some(get) = get_export(scope, exports, "$bind$arr_i32_get") else { return Vec::new() };
    let mut out = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let idx = v8::Integer::new(scope, i);
        let got = get
            .call(scope, exports.into(), &[v, idx.into()])
            .and_then(|r| r.to_int32(scope))
            .map(|r| r.value())
            .unwrap_or(0);
        out.push(got);
    }
    out
}

/// A wac `u8[]` out of the module's memory, the same three steps a string takes.
fn read_bytes(scope: &mut v8::PinScope, v: v8::Local<v8::Value>) -> Vec<u8> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
    let Some(exports) = exports else { return Vec::new() };
    let exports = v8::Local::new(scope, exports);
    let Some(len_fn) = get_export(scope, exports, "$bind$arr_u8_len") else { return Vec::new() };
    let Some(n) = len_fn.call(scope, exports.into(), &[v]).and_then(|r| r.to_int32(scope)) else {
        return Vec::new();
    };
    let n = n.value() as usize;
    if let Some(ensure) = get_export(scope, exports, "$bind$mem_ensure") {
        let want = v8::Integer::new(scope, n as i32);
        ensure.call(scope, exports.into(), &[want.into()]);
    }
    let Some(to_mem) = get_export(scope, exports, "$bind$arr_u8_to_mem") else { return Vec::new() };
    if to_mem.call(scope, exports.into(), &[v]).is_none() {
        return Vec::new();
    }
    memory_slice(scope, exports, n).map(|s| s.to_vec()).unwrap_or_default()
}

/// The reverse: bytes into the staging buffer, then the module builds the array.
fn write_bytes<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    bytes: &[u8],
) -> Option<v8::Local<'s, v8::Value>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let ensure = get_export(scope, exports, "$bind$mem_ensure")?;
    let want = v8::Integer::new(scope, bytes.len() as i32);
    ensure.call(scope, exports.into(), &[want.into()])?;
    {
        let key = v8::String::new(scope, "$bind$mem")?;
        let mem = exports.get(scope, key.into())?;
        let mem: v8::Local<v8::WasmMemoryObject> = mem.try_into().ok()?;
        let buf = mem.buffer();
        let store = buf.get_backing_store().data()?;
        // Safety: the staging buffer was just grown to hold this many bytes, and nothing else runs
        // between here and the call below — V8 is single-threaded and this is not a callback.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), store.as_ptr() as *mut u8, bytes.len());
        }
    }
    let from_mem = get_export(scope, exports, "$bind$arr_u8_from_mem")?;
    let n = v8::Integer::new(scope, bytes.len() as i32);
    from_mem.call(scope, exports.into(), &[n.into()])
}

/// `FileResult.of(ok, bytes, error, fault)` — the module building its own struct, from its own
/// manifest-declared constructor, so the field order is never a copy this host keeps.
fn build_file_result<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    ok: bool,
    bytes: &[u8],
    error: &str,
    fault: i32,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| {
        h.borrow().as_ref().and_then(|s| s.file_result_of.clone())
    })?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    // **Bytes first, then the string.** Both stage through the same buffer, so building one after
    // the other is the only order that does not overwrite the first with the second.
    let bytes_v = write_bytes(scope, bytes)?;
    let error_v = write_string(scope, error)?;
    let ok_v = v8::Integer::new(scope, i32::from(ok));
    let fault_v = v8::Integer::new(scope, fault);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[ok_v.into(), bytes_v, error_v, fault_v.into()])
}

/// `Change.of(fault, message)`.
fn build_change<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    fault: i32,
    message: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.change_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let msg = write_string(scope, message)?;
    let fault_v = v8::Integer::new(scope, fault);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[fault_v.into(), msg])
}

// **The enum constructors come from the manifest**, like every other export this host calls. They
// used to be spelled here — `$bind$e_Read_Data_new` and its two neighbours — which is the one thing
// `StructSpec` exists to prevent, and `native/src/main.rs` still does it. `issues/system/0141`.

fn build_read_data<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    bytes: &[u8],
) -> Option<v8::Local<'s, v8::Value>> {
    let arr = write_bytes(scope, bytes)?;
    call_variant(scope, "Data", &[arr])
}

fn build_read_end<'s>(scope: &mut v8::PinScope<'s, '_>) -> Option<v8::Local<'s, v8::Value>> {
    call_variant(scope, "End", &[])
}

fn build_read_failed<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    why: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let msg = write_string(scope, why)?;
    call_variant(scope, "Failed", &[msg])
}

/// Build one `Read` variant through the export the manifest named for it.
fn call_variant<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    variant: &str,
    args: &[v8::Local<v8::Value>],
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor = HOST.with(|h| {
        h.borrow().as_ref().and_then(|s| s.read_variants.get(variant).cloned())
    })?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let f = get_export(scope, exports, &ctor)?;
    f.call(scope, exports.into(), args)
}

/// `Stat.of(…)`, in the manifest's field order.
fn build_stat<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    st: &StatAnswer,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.stat_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    // Every value first, then the call — a closure that borrows the scope cannot be alive while
    // anything else wants it mutably, which is Rust saying what the V8 API means.
    let exists = v8::Integer::new(scope, i32::from(st.exists));
    let is_file = v8::Integer::new(scope, i32::from(st.is_file));
    let is_dir = v8::Integer::new(scope, i32::from(st.is_dir));
    let size = v8::BigInt::new_from_i64(scope, st.size);
    let modified = v8::BigInt::new_from_i64(scope, st.modified_millis);
    let is_symlink = v8::Integer::new(scope, i32::from(st.is_symlink));
    let is_executable = v8::Integer::new(scope, i32::from(st.is_executable));
    let fault = v8::Integer::new(scope, st.fault);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(
        scope,
        exports.into(),
        &[
            exists.into(),
            is_file.into(),
            is_dir.into(),
            size.into(),
            modified.into(),
            is_symlink.into(),
            is_executable.into(),
            fault.into(),
        ],
    )
}

/// One pushed frame: an applet running inside this program.
#[derive(Default)]
struct Frame {
    argv: Vec<Vec<u8>>,
    stdin: Vec<u8>,
    stdin_at: usize,
    cwd: String,
    inherit_input: bool,
    out: Vec<u8>,
    err: Vec<u8>,
}

/// `Captured.of(out, err, truncated)`.
fn build_captured<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    out: &[u8],
    err: &[u8],
    truncated: bool,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.captured_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let o = write_bytes(scope, out)?;
    let e = write_bytes(scope, err)?;
    let t = v8::Integer::new(scope, i32::from(truncated));
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[o, e, t.into()])
}

/// One open socket: a listener waiting for connections, or a stream carrying them.
enum Sock {
    Listener(std::net::TcpListener),
    Stream(std::net::TcpStream),
}

/// `Socket.of(handle, error, peer, port)` — declared in `platform.wac` rather than left to bindgen
/// precisely so a host can build one without reaching for a generated name.
fn build_socket<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    handle: i32,
    error: &str,
    peer: &str,
    port: i32,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.socket_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let err = write_string(scope, error)?;
    let who = write_string(scope, peer)?;
    let h = v8::Integer::new(scope, handle);
    let p = v8::Integer::new(scope, port);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[h.into(), err, who, p.into()])
}

/// Take the next handle and record what it names.
fn keep_socket(sock: Sock) -> i32 {
    HOST.with(|h| {
        let mut b = h.borrow_mut();
        let Some(st) = b.as_mut() else { return -1 };
        let handle = st.next_handle;
        st.next_handle += 1;
        st.sockets.lock().unwrap().insert(handle, sock);
        handle
    })
}

/// A wac `string[]` from Rust.
///
/// `_new` takes a fill value because a string reference has no default — the array is made full of
/// one string and then each slot is set. `_new0` is the empty case, which has no first element to
/// fill with.
fn build_names<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    names: &[String],
) -> Option<v8::Local<'s, v8::Value>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    if names.is_empty() {
        let new0 = get_export(scope, exports, "$bind$arr_string_new0")?;
        return new0.call(scope, exports.into(), &[]);
    }
    let first = write_string(scope, &names[0])?;
    let new = get_export(scope, exports, "$bind$arr_string_new")?;
    let n = v8::Integer::new(scope, names.len() as i32);
    let arr = new.call(scope, exports.into(), &[n.into(), first])?;
    let set = get_export(scope, exports, "$bind$arr_string_set")?;
    for (i, name) in names.iter().enumerate().skip(1) {
        let s = write_string(scope, name)?;
        let idx = v8::Integer::new(scope, i as i32);
        set.call(scope, exports.into(), &[arr, idx.into(), s])?;
    }
    Some(arr)
}

/// A wac `string` from Rust, through the staging buffer.
fn write_string<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    text: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let bytes = text.as_bytes();
    let ensure = get_export(scope, exports, "$bind$mem_ensure")?;
    let want = v8::Integer::new(scope, bytes.len() as i32);
    ensure.call(scope, exports.into(), &[want.into()])?;
    {
        let key = v8::String::new(scope, "$bind$mem")?;
        let mem = exports.get(scope, key.into())?;
        let mem: v8::Local<v8::WasmMemoryObject> = mem.try_into().ok()?;
        let buf = mem.buffer();
        let store = buf.get_backing_store().data()?;
        // Safety: the buffer was just grown to hold these bytes and nothing runs in between.
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), store.as_ptr() as *mut u8, bytes.len());
        }
    }
    let from_mem = get_export(scope, exports, "$bind$str_from_mem")?;
    let n = v8::Integer::new(scope, bytes.len() as i32);
    from_mem.call(scope, exports.into(), &[n.into()])
}

/// The first `n` bytes of the module's memory — where every `_to_mem` writes.
fn memory_slice<'a>(
    scope: &mut v8::PinScope,
    exports: v8::Local<v8::Object>,
    n: usize,
) -> Option<&'a [u8]> {
    let key = v8::String::new(scope, "$bind$mem")?;
    let mem = exports.get(scope, key.into())?;
    let mem: v8::Local<v8::WasmMemoryObject> = mem.try_into().ok()?;
    let buf = mem.buffer();
    let store = buf.get_backing_store().data()?;
    // Safety: as above — the buffer is at least `n` long by the time this is reached.
    Some(unsafe { std::slice::from_raw_parts(store.as_ptr() as *const u8, n) })
}

/// A wac `string` out of the module's own memory, through the `$bind$str_*` family.
///
/// Ask the length, make room, *then* copy — `_to_mem` writes into the staging buffer and does not
/// grow it, so calling it first is a short copy or a trap, depending on the length.
fn read_string(scope: &mut v8::PinScope, s: v8::Local<v8::Value>) -> String {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
    let Some(exports) = exports else { return String::new() };
    let exports = v8::Local::new(scope, exports);

    let Some(len_fn) = get_export(scope, exports, "$bind$str_len") else { return String::new() };
    let Some(n) = len_fn.call(scope, exports.into(), &[s]).and_then(|v| v.to_int32(scope)) else {
        return String::new();
    };
    let n = n.value() as usize;

    if let Some(ensure) = get_export(scope, exports, "$bind$mem_ensure") {
        let want = v8::Integer::new(scope, n as i32);
        ensure.call(scope, exports.into(), &[want.into()]);
    }
    let Some(to_mem) = get_export(scope, exports, "$bind$str_to_mem") else { return String::new() };
    if to_mem.call(scope, exports.into(), &[s]).is_none() {
        return String::new();
    }

    let key = v8::String::new(scope, "$bind$mem").unwrap();
    let Some(mem) = exports.get(scope, key.into()) else { return String::new() };
    let Ok(mem): Result<v8::Local<v8::WasmMemoryObject>, _> = mem.try_into() else {
        return String::new();
    };
    let buf = mem.buffer();
    let Some(store) = buf.get_backing_store().data() else { return String::new() };
    let bytes = unsafe { std::slice::from_raw_parts(store.as_ptr() as *const u8, n) };
    String::from_utf8_lossy(bytes).into_owned()
}

/// Unused today, kept because the next slice needs it and the shape is the interesting part.
#[allow(dead_code)]
fn slots_of(_m: &Manifest) -> HashMap<String, usize> {
    HashMap::new()
}
