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
    Unsupported,
}

fn capability_for(owner: &str, field: &str) -> Cap {
    match (owner, field) {
        ("Core", "log") => Cap::Log,
        ("Core", "warn") => Cap::Warn,
        _ => Cap::Unsupported,
    }
}

/// Everything a dispatcher needs, reachable from a `fn` pointer that cannot close over anything.
struct HostState {
    exports: v8::Global<v8::Object>,
    /// `caps[signature][slot]`, the same shape the wasmtime host uses.
    caps: Vec<Vec<Cap>>,
    /// Which capability names went unanswered, so the report names them rather than trapping.
    unsupported: Vec<String>,
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

    HOST.with(|h| {
        *h.borrow_mut() = Some(HostState {
            exports: v8::Global::new(scope, exports),
            caps,
            unsupported: unsupported.clone(),
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
    if main_sig.params.len() != 1 || main_sig.params[0] != "Core" {
        eprintln!(
            "wacv8: main({}) needs a capability this host does not build yet — Core only, for now",
            main_sig.params.join(", ")
        );
        return 1;
    }

    let main_fn = match get_export(scope, exports, "main") {
        Some(f) => f,
        None => {
            eprintln!("wacv8: main is not callable");
            return 1;
        }
    };
    let r = match main_fn.call(scope, exports.into(), &[core]) {
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
        Cap::Unsupported => {
            let msg = v8::String::new(scope, "this host does not answer that capability yet").unwrap();
            let e = v8::Exception::error(scope, msg);
            scope.throw_exception(e);
        }
    }
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
