//! wacland: a host for wac programs with no JavaScript in it.
//!
//! design/0001 step 2a, wac-mono 0087. The peer of `packages/platform/host/{deno,node,browser}.ts`, in
//! the role Deno plays but Wasm-native. It is the only host that tests the portability claim at all —
//! the other three are JavaScript and share the transport, the worker model and the event loop.
//!
//! ## What it turned out to be
//!
//! Much less than the JavaScript host, and the reason is worth stating because it was not obvious
//! before the ABI was read: **a compiled wac program has no imports of its own.** It asks for
//! `wac.cb0`…`wac.cbN` — one dispatcher per funcref *signature* — and everything else the host does is
//! calling exports. There is no bundle to make, no generated glue, and nothing to keep in step except
//! the manifest.
//!
//! The `SharedArrayBuffer`, the `Atomics.wait`, the ring of slots and the responder have no counterpart
//! here, exactly as 0087 predicted: they exist to park a *worker* while an asynchronous host runs, and
//! native code blocks the calling thread.
//!
//! ## What is here, and what is not
//!
//! Here: loading a module, the callback dispatch table, the string marshalling, and building the `Core`
//! and `Cli` a program is called with — from the manifest's field order rather than from a copy of it.
//!
//! Not here, and it says so rather than answering plausibly: **every capability that returns a
//! `Pending<T>` traps**, because a ticket table is the next piece and half of one would be worse than
//! none. `core.log` and `core.warn` return nothing and work. Run a program that needs more and it stops
//! with the name of what it wanted, which is the only honest answer a runtime can give.

mod manifest;

use manifest::{Manifest, SUPPORTED_VERSION};
use std::path::Path;
use wasmtime::{Caller, Config, Engine, Extern, ExternType, Linker, Module, Store, Val};

/// What a registered funcref does when the guest calls it.
///
/// A plain enum rather than a boxed closure: the dispatcher is one function that matches, so a
/// capability that is not implemented is a *variant* rather than a closure that happens to trap, and
/// the exhaustiveness check names every one that is missing when a new capability is added.
#[derive(Clone, Debug)]
enum Cap {
    Log,
    Warn,
    /// Registered, callable, and refuses — carrying the wac name so the message says what was wanted.
    NotImplemented(String),
}

struct Host {
    /// `caps[signature][slot]`, matching the module's per-signature funcref tables.
    caps: Vec<Vec<Cap>>,
    /// argv as bytes, since a program's arguments are bytes (wac-mono 0065).
    args: Vec<Vec<u8>>,
    exit: i32,
}

impl Host {
    fn new(signatures: usize, args: Vec<Vec<u8>>) -> Self {
        Host { caps: vec![Vec::new(); signatures], args, exit: 0 }
    }

    /// Register `cap` under signature `sig` and answer its slot.
    fn register(&mut self, sig: usize, cap: Cap, limit: u32) -> Result<u32, String> {
        let slot = self.caps[sig].len();
        if slot as u32 >= limit {
            return Err(format!("at most {limit} distinct functions of signature {sig} can be passed"));
        }
        self.caps[sig].push(cap);
        Ok(slot as u32)
    }
}

/// Read a wac string reference into bytes, through the module's own staging buffer.
///
/// Every marshalled value crosses at offset 0 of `$bind$mem`, grown by `$bind$mem_ensure`. Growing
/// detaches nothing here — unlike JavaScript, where the `ArrayBuffer` has to be re-read — but the
/// order still matters: ensure, then copy, then read.
fn read_string(caller: &mut Caller<'_, Host>, s: &Val) -> Result<Vec<u8>, wasmtime::Error> {
    let str_len = export_func(caller, "$bind$str_len")?;
    let str_to_mem = export_func(caller, "$bind$str_to_mem")?;
    let mem_ensure = export_func(caller, "$bind$mem_ensure")?;
    let mem = match caller.get_export("$bind$mem") {
        Some(Extern::Memory(m)) => m,
        _ => return Err(wasmtime::Error::msg("the module has no $bind$mem")),
    };

    let out = call_dyn(caller, &str_len, std::slice::from_ref(s))?;
    let n = match out.first() {
        Some(Val::I32(n)) => *n as usize,
        _ => return Err(wasmtime::Error::msg("$bind$str_len did not answer an i32")),
    };
    call_dyn(caller, &mem_ensure, &[Val::I32(n as i32)])?;
    call_dyn(caller, &str_to_mem, std::slice::from_ref(s))?;

    let mut bytes = vec![0u8; n];
    mem.read(&mut *caller, 0, &mut bytes)?;
    Ok(bytes)
}

/// Call an export whose arity is read from its own type rather than assumed.
///
/// The first version of this passed a fixed results buffer and failed on `$bind$str_to_mem`, which the
/// JavaScript bindgen calls for its side effect and which does in fact return a value. Asking the
/// function how many results it has is both shorter and the only version that cannot be wrong.
fn call_dyn(
    caller: &mut Caller<'_, Host>,
    f: &wasmtime::Func,
    args: &[Val],
) -> Result<Vec<Val>, wasmtime::Error> {
    let n = f.ty(&mut *caller).results().len();
    let mut results = vec![Val::I32(0); n];
    f.call(&mut *caller, args, &mut results)?;
    Ok(results)
}

fn export_func(caller: &mut Caller<'_, Host>, name: &str) -> Result<wasmtime::Func, wasmtime::Error> {
    match caller.get_export(name) {
        Some(Extern::Func(f)) => Ok(f),
        _ => Err(wasmtime::Error::msg(format!("the module has no {name}"))),
    }
}

fn main() -> Result<(), wasmtime::Error> {
    let argv: Vec<String> = std::env::args().collect();
    if argv.len() < 2 {
        eprintln!("usage: wacland <program.json> [args...]");
        eprintln!("  the manifest written by `deno task app:native`, beside its .wasm");
        std::process::exit(2);
    }
    let manifest_path = Path::new(&argv[1]);
    let text = std::fs::read_to_string(manifest_path)
        .map_err(|e| wasmtime::Error::msg(format!("{}: {e}", argv[1])))?;
    let m: Manifest = serde_json::from_str(&text)
        .map_err(|e| wasmtime::Error::msg(format!("{}: {e}", argv[1])))?;
    if m.version != SUPPORTED_VERSION {
        return Err(wasmtime::Error::msg(format!(
            "{}: manifest version {} — this runtime speaks {}",
            argv[1], m.version, SUPPORTED_VERSION
        )));
    }
    let wasm_path = manifest_path.parent().unwrap_or(Path::new(".")).join(&m.wasm);
    let program_args: Vec<Vec<u8>> =
        argv[2..].iter().map(|a| a.as_bytes().to_vec()).collect();

    let code = run(&m, &wasm_path, program_args)?;
    std::process::exit(code);
}

fn run(m: &Manifest, wasm_path: &Path, args: Vec<Vec<u8>>) -> Result<i32, wasmtime::Error> {
    let mut config = Config::new();
    // The ABI is made of references — a wac string, a struct and a funcref all cross as one — so the
    // proposals that carry them are not optional here.
    config.wasm_function_references(true);
    config.wasm_gc(true);
    let engine = Engine::new(&config)?;
    let module = Module::from_file(&engine, wasm_path)?;
    let mut store = Store::new(&engine, Host::new(m.callbacks.len(), args));

    // One dispatcher per signature, with the signature taken from the module rather than rebuilt from
    // the manifest: the module is the thing that has to be satisfied, and a type assembled from the
    // manifest would be a second opinion about it.
    let mut linker = Linker::new(&engine);
    for imp in module.imports() {
        if imp.module() != "wac" {
            return Err(wasmtime::Error::msg(format!(
                "{}: imports {}::{}, and this runtime supplies only `wac`",
                m.entry,
                imp.module(),
                imp.name()
            )));
        }
        let ExternType::Func(ty) = imp.ty() else {
            return Err(wasmtime::Error::msg(format!("wac::{} is not a function", imp.name())));
        };
        let sig = m
            .callbacks
            .iter()
            .position(|c| c.field == imp.name())
            .ok_or_else(|| wasmtime::Error::msg(format!("wac::{} is in no manifest", imp.name())))?;
        linker.func_new("wac", imp.name(), ty, move |mut caller, params, results| {
            dispatch(&mut caller, sig, params, results)
        })?;
    }

    let instance = linker.instantiate(&mut store, &module)?;

    let core = build(&mut store, &instance, m, "Core")?;
    let cli = build(&mut store, &instance, m, "Cli")?;

    let main = instance
        .get_func(&mut store, "main")
        .ok_or_else(|| wasmtime::Error::msg(format!("{}: no exported `main`", m.entry)))?;
    let mut out = [Val::I32(0)];
    main.call(&mut store, &[core, cli], &mut out)?;
    let status = match out[0] {
        Val::I32(n) => n,
        _ => 0,
    };
    let host_exit = store.data().exit;
    Ok(if status != 0 { status } else { host_exit })
}

/// Build one capability struct — `Core` or `Cli` — from the manifest's field order.
fn build(
    store: &mut Store<Host>,
    instance: &wasmtime::Instance,
    m: &Manifest,
    name: &str,
) -> Result<Val, wasmtime::Error> {
    let spec = m
        .find_struct(name)
        .ok_or_else(|| wasmtime::Error::msg(format!("{}: no struct {name} in the manifest", m.entry)))?;
    let ctor_name = spec
        .constructor()
        .ok_or_else(|| wasmtime::Error::msg(format!("{name} has no `of`")))?
        .export_name
        .clone();

    let mut caps: Vec<Val> = Vec::with_capacity(spec.fields.len());
    for field in &spec.fields {
        let sig = m.callback_index(&field.ty).ok_or_else(|| {
            wasmtime::Error::msg(format!("{name}.{}: no callback signature for {}", field.name, field.ty))
        })?;
        let cap = capability_for(name, &field.name);
        let limit = m.callbacks[sig].slots;
        let slot = store
            .data_mut()
            .register(sig, cap, limit)
            .map_err(wasmtime::Error::msg)?;
        let helper = instance
            .get_func(&mut *store, &m.callbacks[sig].helper)
            .ok_or_else(|| wasmtime::Error::msg(format!("no {}", m.callbacks[sig].helper)))?;
        let mut fr = [Val::I32(0)];
        helper.call(&mut *store, &[Val::I32(slot as i32)], &mut fr)?;
        caps.push(fr[0].clone());
    }

    let ctor = instance
        .get_func(&mut *store, &ctor_name)
        .ok_or_else(|| wasmtime::Error::msg(format!("no {ctor_name}")))?;
    let mut built = [Val::I32(0)];
    ctor.call(&mut *store, &caps, &mut built)?;
    Ok(built[0].clone())
}

/// Which capability a named field of `Core` or `Cli` is.
///
/// By name rather than by position, so a capability inserted in the middle of `platform.wac` moves a
/// row here instead of silently shifting every one after it.
fn capability_for(owner: &str, field: &str) -> Cap {
    match (owner, field) {
        ("Core", "log") => Cap::Log,
        ("Core", "warn") => Cap::Warn,
        _ => Cap::NotImplemented(format!("{owner}.{field}")),
    }
}

fn dispatch(
    caller: &mut Caller<'_, Host>,
    sig: usize,
    params: &[Val],
    _results: &mut [Val],
) -> Result<(), wasmtime::Error> {
    let slot = match params.first() {
        Some(Val::I32(n)) => *n as usize,
        _ => return Err(wasmtime::Error::msg("a dispatcher was called without a slot")),
    };
    let cap = caller
        .data()
        .caps
        .get(sig)
        .and_then(|s| s.get(slot))
        .cloned()
        .ok_or_else(|| wasmtime::Error::msg(format!("no function in slot {slot} of signature {sig}")))?;

    match cap {
        Cap::Log => {
            let bytes = read_string(caller, &params[1])?;
            print_bytes(&bytes, false);
            Ok(())
        }
        Cap::Warn => {
            let bytes = read_string(caller, &params[1])?;
            print_bytes(&bytes, true);
            Ok(())
        }
        // The whole of D6 in one arm: a runtime that answered zero here would make every program
        // that used the capability wrong in a way nothing could see.
        Cap::NotImplemented(name) => Err(wasmtime::Error::msg(format!(
            "{name} is not implemented in the native runtime yet"
        ))),
    }
}

/// A line, with the newline `log` and `warn` add. Bytes rather than a `String`: a wac string is bytes,
/// and re-encoding it through UTF-8 validation would change what a program printed.
fn print_bytes(bytes: &[u8], to_stderr: bool) {
    use std::io::Write;
    let mut line = bytes.to_vec();
    line.push(b'\n');
    if to_stderr {
        let _ = std::io::stderr().write_all(&line);
    } else {
        let _ = std::io::stdout().write_all(&line);
    }
}
