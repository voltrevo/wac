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

use std::cell::RefCell;
use std::collections::HashMap;
use std::io::Write;

use serde::Deserialize;

// ---------------------------------------------------------------------------------------------
// The manifest, which is the compiler's description of the module beside it. `packages/platform/
// native.ts` writes it; the field order in a struct is the *construction* order and is the reason
// this file does not hardcode what `Core` contains.

#[derive(Deserialize)]
struct Manifest {
    entry: String,
    wasm: String,
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
    /// `Pending<T>.resolve` — the guest asking for the answer it was promised.
    ResolveI32,
    ResolveBytes,
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
        ("Cli", "argCount") => Cap::ArgCount,
        ("Cli", "arg") => Cap::Arg,
        ("Cli", "write") => Cap::Write,
        ("Cli", "writeErr") => Cap::WriteErr,
        _ => Cap::Unsupported,
    }
}

/// What a finished request produced. Every request here finishes before its ticket is handed over.
#[derive(Clone)]
enum Answer {
    I32(i32),
    Bytes(Vec<u8>),
}

/// Everything a dispatcher needs, reachable from a `fn` pointer that cannot close over anything.
struct HostState {
    exports: v8::Global<v8::Object>,
    /// `caps[signature][slot]`, the same shape the wasmtime host uses.
    caps: Vec<Vec<Cap>>,
    /// Which capability names went unanswered, so the report names them rather than trapping.
    unsupported: Vec<String>,
    /// The program's own arguments, which is all this slice's `Cli` is about.
    argv: Vec<Vec<u8>>,
    /// **The ticket table, such as it is.** `native/src/tickets.rs` is 222 lines because a real
    /// capability finishes on another thread and `waitAny` has to park until one of a list does.
    /// Nothing here is asynchronous — `argCount` and `arg` are answered from memory the host already
    /// holds — so a ticket is a row that is already full by the time the guest is given its id.
    /// That is the honest version of this slice, not a simplification of the next one: when the
    /// first capability that genuinely waits arrives, this becomes the real table.
    answers: HashMap<i32, Answer>,
    next_ticket: i32,
    pending: HashMap<String, PendingGlobals>,
}

thread_local! {
    static HOST: RefCell<Option<HostState>> = const { RefCell::new(None) };
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
    let mut unsupported: Vec<String> = Vec::new();

    let core = match build_struct(scope, exports, m, "Core", &mut caps, &mut unsupported) {
        Ok(v) => v,
        Err(e) => {
            eprintln!("wacv8: {e}");
            return 1;
        }
    };
    // `Cli` is built whether or not `main` takes it: a program that asks for one capability from it
    // and never touches the rest should run, and the ones this host cannot answer are named on exit.
    let cli = match build_struct(scope, exports, m, "Cli", &mut caps, &mut unsupported) {
        Ok(v) => Some(v),
        Err(_) => None,
    };

    // **The resolver trio, registered before the program runs.** A `Pending<T>` carries three
    // funcrefs and the host has to have slots for them before it can hand one over — and their
    // signatures are per-`T`, so `fn[i32(i32)]` and `fn[u8[](i32)]` are different dispatchers.
    let mut pending: HashMap<String, PendingHooks> = HashMap::new();
    for (ty, resolve) in [("i32", Cap::ResolveI32), ("u8[]", Cap::ResolveBytes)] {
        match pending_hooks(scope, exports, m, ty, resolve, &mut caps) {
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
            unsupported: unsupported.clone(),
            argv: std::env::args().skip(2).map(|a| a.into_bytes()).collect(),
            answers: HashMap::new(),
            next_ticket: 1,
            pending: pending
                .into_iter()
                .map(|(k, v)| (k, PendingGlobals::new(scope, v)))
                .collect(),
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
    let missed = HOST.with(|h| h.borrow().as_ref().map(|s| s.unsupported.clone()).unwrap_or_default());
    if !missed.is_empty() {
        eprintln!("wacv8: unanswered capabilities: {}", missed.join(", "));
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
        let id = st.next_ticket;
        st.next_ticket += 1;
        st.answers.insert(id, answer);
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
            let n = HOST.with(|h| h.borrow().as_ref().map(|s| s.argv.len()).unwrap_or(0)) as i32;
            match ticket_for(scope, "i32", Answer::I32(n)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<i32> to answer argCount with"),
            }
        }
        Cap::Arg => {
            let i = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let bytes = HOST.with(|h| {
                h.borrow()
                    .as_ref()
                    .and_then(|s| usize::try_from(i).ok().and_then(|i| s.argv.get(i).cloned()))
                    .unwrap_or_default()
            });
            match ticket_for(scope, "u8[]", Answer::Bytes(bytes)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<u8[]> to answer arg with"),
            }
        }
        Cap::Write | Cap::WriteErr => {
            let bytes = read_bytes(scope, args.get(1));
            let out: Box<dyn std::io::Write> = if cap == Cap::Write {
                Box::new(std::io::stdout())
            } else {
                Box::new(std::io::stderr())
            };
            let mut out = out;
            let ok = out.write_all(&bytes).and_then(|_| out.flush()).is_ok();
            rv.set_bool(ok);
        }
        Cap::ResolveI32 | Cap::ResolveBytes => {
            // **Spent when taken**, which is what `Pending`'s own comment says happens on the host
            // side of the resolver: a second `wait()` on one ticket is a bug in the program, and it
            // should look like one rather than answering twice.
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let answer = HOST.with(|h| h.borrow_mut().as_mut().and_then(|s| s.answers.remove(&id)));
            match answer {
                Some(Answer::I32(n)) => {
                    let v = v8::Integer::new(scope, n);
                    rv.set(v.into());
                }
                Some(Answer::Bytes(b)) => match write_bytes(scope, &b) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a u8[] for the answer"),
                },
                None => throw(scope, "that ticket has already been taken, or was never issued"),
            }
        }
        Cap::Settled => {
            // Every answer here is in the table before its ticket is handed over.
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let known = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.answers.contains_key(&id)));
            rv.set_bool(known);
        }
        Cap::Drop => {
            let id = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            HOST.with(|h| {
                if let Some(s) = h.borrow_mut().as_mut() {
                    s.answers.remove(&id);
                }
            });
            rv.set_undefined();
        }
        Cap::Unsupported => {
            throw(scope, "this host does not answer that capability yet");
        }
    }
}

fn throw(scope: &mut v8::PinScope, what: &str) {
    let msg = v8::String::new(scope, what).unwrap();
    let e = v8::Exception::error(scope, msg);
    scope.throw_exception(e);
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
