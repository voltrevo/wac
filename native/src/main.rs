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
//! native code blocks the calling thread. See `tickets.rs`, which is what replaced them.
//!
//! ## What is here, and what is not
//!
//! Here: loading, dispatch, marshalling, the capability structs built from the manifest's field order,
//! the ticket table, and the capabilities that need no operating system beyond a clock and a thread —
//! `argCount`, `arg`, `write`, `writeErr`, `nowMillis`, `monotonicNanos`, `sleepMillis`, `randomBytes`,
//! `exitCode` and `waitAny`.
//!
//! Not here, and it says so rather than answering plausibly: **the filesystem, the network and
//! `spawn`**. Every one of those is a registered, callable funcref whose arm refuses by name. A
//! runtime that answered an empty file or a closed socket would make every program that used it wrong
//! in a way nothing could see, which is design/0001 D6.

mod manifest;
mod tickets;

use manifest::{Manifest, SUPPORTED_VERSION};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tickets::{Outcome, Tickets};
use wasmtime::{Caller, Config, Engine, Extern, ExternType, Linker, Module, Store, Val};

/// Which `Pending<T>` a capability answers with.
///
/// One per shape the runtime can complete. A capability whose kind is not here cannot be implemented
/// without adding one, which is the point: the compiler names the gap.
#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
enum Kind {
    I32,
    I64,
    Bytes,
}

/// The three shared functions and the constructor that make one `Pending<T>`.
///
/// Created once per kind, never per call. The JavaScript host has the same rule for a harder reason —
/// bindgen registers each distinct function identity in a fixed table and never frees a slot — and the
/// rule is worth keeping here anyway: a ticket carries an id, and the functions that read it are the
/// same three every time.
#[derive(Clone)]
struct PendingHooks {
    ctor: String,
    resolve: Val,
    settled: Val,
    drop: Val,
}

/// What a registered funcref does when the guest calls it.
///
/// A plain enum rather than a boxed closure: the dispatcher is one function that matches, so a
/// capability that is not implemented is a *variant* rather than a closure that happens to trap, and
/// the exhaustiveness check names every one that is missing when a capability is added.
#[derive(Clone, Debug)]
enum Cap {
    Log,
    Warn,
    Write,
    WriteErr,
    ArgCount,
    Arg,
    NowMillis,
    MonotonicNanos,
    SleepMillis,
    RandomBytes,
    ExitCode,
    WaitAny,
    /// `Pending<T>.resolve`: collect the outcome, once.
    Resolve(Kind),
    /// `Pending<T>.settled`, shared by every kind because the question does not depend on `T`.
    Settled,
    /// `Pending<T>.drop` and `cancel`, likewise.
    Discard,
    /// Registered, callable, and refuses — carrying the wac name so the message says what was wanted.
    NotImplemented(String),
}

struct Host {
    /// `caps[signature][slot]`, matching the module's per-signature funcref tables.
    caps: Vec<Vec<Cap>>,
    /// argv as bytes, since a program's arguments are bytes (wac-mono 0065).
    args: Vec<Vec<u8>>,
    tickets: Arc<Tickets>,
    pendings: HashMap<Kind, PendingHooks>,
    /// Monotonic zero, so `monotonicNanos` measures from this program's start rather than the epoch.
    started: std::time::Instant,
    exit: i32,
}

impl Host {
    fn new(signatures: usize, args: Vec<Vec<u8>>) -> Self {
        Host {
            caps: vec![Vec::new(); signatures],
            args,
            tickets: Arc::new(Tickets::default()),
            pendings: HashMap::new(),
            started: std::time::Instant::now(),
            exit: 0,
        }
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

// ── Marshalling ───────────────────────────────────────────────────────────────
//
// Every value crosses at offset 0 of `$bind$mem`, a staging buffer grown by `$bind$mem_ensure`. That
// is the whole layout contract: four helpers for strings, four more for arrays, and no knowledge here
// of how a wac value is actually laid out.

fn export_func(caller: &mut Caller<'_, Host>, name: &str) -> Result<wasmtime::Func, wasmtime::Error> {
    match caller.get_export(name) {
        Some(Extern::Func(f)) => Ok(f),
        _ => Err(wasmtime::Error::msg(format!("the module has no {name}"))),
    }
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

fn staging(caller: &mut Caller<'_, Host>) -> Result<wasmtime::Memory, wasmtime::Error> {
    match caller.get_export("$bind$mem") {
        Some(Extern::Memory(m)) => Ok(m),
        _ => Err(wasmtime::Error::msg("the module has no $bind$mem")),
    }
}

/// Copy `bytes` into the staging buffer, growing it first.
fn to_staging(caller: &mut Caller<'_, Host>, bytes: &[u8]) -> Result<(), wasmtime::Error> {
    let ensure = export_func(caller, "$bind$mem_ensure")?;
    let have = call_dyn(caller, &ensure, &[Val::I32(bytes.len() as i32)])?;
    if let Some(Val::I32(n)) = have.first() {
        if (*n as usize) < bytes.len() {
            return Err(wasmtime::Error::msg(format!(
                "could not grow the transfer buffer to {} bytes",
                bytes.len()
            )));
        }
    }
    let mem = staging(caller)?;
    mem.write(&mut *caller, 0, bytes)?;
    Ok(())
}

/// Read a reference the module can copy into the staging buffer: a string, a `u8[]` or an `i32[]`.
fn from_staging(
    caller: &mut Caller<'_, Host>,
    value: &Val,
    len_export: &str,
    to_mem_export: &str,
    width: usize,
) -> Result<Vec<u8>, wasmtime::Error> {
    let len_fn = export_func(caller, len_export)?;
    let to_mem = export_func(caller, to_mem_export)?;
    let out = call_dyn(caller, &len_fn, std::slice::from_ref(value))?;
    let n = match out.first() {
        Some(Val::I32(n)) => (*n as usize) * width,
        _ => return Err(wasmtime::Error::msg(format!("{len_export} did not answer an i32"))),
    };
    let ensure = export_func(caller, "$bind$mem_ensure")?;
    call_dyn(caller, &ensure, &[Val::I32(n as i32)])?;
    call_dyn(caller, &to_mem, std::slice::from_ref(value))?;
    let mem = staging(caller)?;
    let mut bytes = vec![0u8; n];
    mem.read(&mut *caller, 0, &mut bytes)?;
    Ok(bytes)
}

fn read_string(caller: &mut Caller<'_, Host>, s: &Val) -> Result<Vec<u8>, wasmtime::Error> {
    from_staging(caller, s, "$bind$str_len", "$bind$str_to_mem", 1)
}

fn read_u8_array(caller: &mut Caller<'_, Host>, a: &Val) -> Result<Vec<u8>, wasmtime::Error> {
    from_staging(caller, a, "$bind$arr_u8_len", "$bind$arr_u8_to_mem", 1)
}

/// An `i32[]` as numbers. The staging buffer is bytes, and wasm is little-endian everywhere.
fn read_i32_array(caller: &mut Caller<'_, Host>, a: &Val) -> Result<Vec<i32>, wasmtime::Error> {
    let bytes = from_staging(caller, a, "$bind$arr_i32_len", "$bind$arr_i32_to_mem", 4)?;
    Ok(bytes
        .chunks_exact(4)
        .map(|c| i32::from_le_bytes([c[0], c[1], c[2], c[3]]))
        .collect())
}

fn make_u8_array(caller: &mut Caller<'_, Host>, bytes: &[u8]) -> Result<Val, wasmtime::Error> {
    to_staging(caller, bytes)?;
    let from_mem = export_func(caller, "$bind$arr_u8_from_mem")?;
    let out = call_dyn(caller, &from_mem, &[Val::I32(bytes.len() as i32)])?;
    out.into_iter().next().ok_or_else(|| wasmtime::Error::msg("$bind$arr_u8_from_mem answered nothing"))
}

// ── Running ───────────────────────────────────────────────────────────────────

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
    let program_args: Vec<Vec<u8>> = argv[2..].iter().map(|a| a.as_bytes().to_vec()).collect();

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

    // The `Pending<T>` hooks first: a capability cannot answer one until the three shared functions
    // exist, and they are registered once for the whole run.
    for (kind, wac_name) in [
        (Kind::I32, "Pending<i32>"),
        (Kind::I64, "Pending<i64>"),
        (Kind::Bytes, "Pending<u8[]>"),
    ] {
        if let Some(hooks) = pending_hooks(&mut store, &instance, m, kind, wac_name)? {
            store.data_mut().pendings.insert(kind, hooks);
        }
    }

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

/// Register `resolve`, `settled` and `drop` for one `Pending<T>`, or None if the program has no such
/// `Pending` — which is ordinary: a program that never reads a file has no `Pending<FileResult>`.
fn pending_hooks(
    store: &mut Store<Host>,
    instance: &wasmtime::Instance,
    m: &Manifest,
    kind: Kind,
    wac_name: &str,
) -> Result<Option<PendingHooks>, wasmtime::Error> {
    let Some(spec) = m.find_struct(wac_name) else { return Ok(None) };
    let Some(ctor) = spec.constructor() else { return Ok(None) };
    let mut hooks = [Val::I32(0), Val::I32(0), Val::I32(0)];
    for (i, (field, cap)) in [
        ("resolve", Cap::Resolve(kind)),
        ("settled", Cap::Settled),
        ("drop", Cap::Discard),
    ]
    .into_iter()
    .enumerate()
    {
        let f = spec
            .fields
            .iter()
            .find(|f| f.name == field)
            .ok_or_else(|| wasmtime::Error::msg(format!("{wac_name} has no {field}")))?;
        hooks[i] = funcref_for(store, instance, m, &f.ty, cap)?;
    }
    Ok(Some(PendingHooks {
        ctor: ctor.export_name.clone(),
        resolve: hooks[0].clone(),
        settled: hooks[1].clone(),
        drop: hooks[2].clone(),
    }))
}

/// Register `cap` under the signature spelled `ty` and answer the funcref to pass into wasm.
fn funcref_for(
    store: &mut Store<Host>,
    instance: &wasmtime::Instance,
    m: &Manifest,
    ty: &str,
    cap: Cap,
) -> Result<Val, wasmtime::Error> {
    let sig = m
        .callback_index(ty)
        .ok_or_else(|| wasmtime::Error::msg(format!("no callback signature for {ty}")))?;
    let limit = m.callbacks[sig].slots;
    let slot = store.data_mut().register(sig, cap, limit).map_err(wasmtime::Error::msg)?;
    let helper = instance
        .get_func(&mut *store, &m.callbacks[sig].helper)
        .ok_or_else(|| wasmtime::Error::msg(format!("no {}", m.callbacks[sig].helper)))?;
    let mut fr = [Val::I32(0)];
    helper.call(&mut *store, &[Val::I32(slot as i32)], &mut fr)?;
    Ok(fr[0].clone())
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
        let cap = capability_for(name, &field.name);
        caps.push(funcref_for(store, instance, m, &field.ty, cap)?);
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
        ("Core", "nowMillis") => Cap::NowMillis,
        ("Core", "monotonicNanos") => Cap::MonotonicNanos,
        ("Core", "sleepMillis") => Cap::SleepMillis,
        ("Core", "randomBytes") => Cap::RandomBytes,
        ("Core", "waitAny") => Cap::WaitAny,
        ("Cli", "argCount") => Cap::ArgCount,
        ("Cli", "arg") => Cap::Arg,
        ("Cli", "write") => Cap::Write,
        ("Cli", "writeErr") => Cap::WriteErr,
        ("Cli", "exitCode") => Cap::ExitCode,
        _ => Cap::NotImplemented(format!("{owner}.{field}")),
    }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────

fn dispatch(
    caller: &mut Caller<'_, Host>,
    sig: usize,
    params: &[Val],
    results: &mut [Val],
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
    let arg = |i: usize| -> Val { params.get(i).cloned().unwrap_or(Val::I32(0)) };

    match cap {
        Cap::Log => {
            let bytes = read_string(caller, &params[1])?;
            print_bytes(&bytes, false);
        }
        Cap::Warn => {
            let bytes = read_string(caller, &params[1])?;
            print_bytes(&bytes, true);
        }
        Cap::Write | Cap::WriteErr => {
            let bytes = read_u8_array(caller, &params[1])?;
            let to_stderr = matches!(cap, Cap::WriteErr);
            // The answer is whether the write landed, which is what the wac side reads to notice a
            // closed pipe. `write_all` failing is the only way it can be false here.
            let ok = write_raw(&bytes, to_stderr);
            results[0] = Val::I32(if ok { 1 } else { 0 });
        }
        Cap::ArgCount => {
            let n = caller.data().args.len() as i32;
            return settle_now(caller, Kind::I32, Outcome::I32(n), results);
        }
        Cap::Arg => {
            let i = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            let bytes = caller.data().args.get(i as usize).cloned().unwrap_or_default();
            return settle_now(caller, Kind::Bytes, Outcome::Bytes(bytes), results);
        }
        Cap::NowMillis => {
            let ms = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as i64)
                .unwrap_or(0);
            return settle_now(caller, Kind::I64, Outcome::I64(ms), results);
        }
        Cap::MonotonicNanos => {
            let ns = caller.data().started.elapsed().as_nanos() as i64;
            return settle_now(caller, Kind::I64, Outcome::I64(ns), results);
        }
        Cap::SleepMillis => {
            // **The first capability that genuinely takes time**, and the reason 0087's first
            // criterion is testable: two sleeps of different lengths complete out of the order they
            // were asked for, on the runtime's own threads, with nothing waiting in between.
            let ms = match arg(1) {
                Val::I32(n) => n.max(0) as u64,
                _ => 0,
            };
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            // **It resolves to the monotonic nanoseconds at which it settled, not to the millis asked
            // for** — `platform.wac`: "so `.wait()` is a sleep that tells you how far it overshot".
            // Answering the argument back looked right in isolation and disagreed with the Deno host
            // by three orders of magnitude, which is what running one program on both is for.
            let origin = caller.data().started;
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(ms));
                table.complete(id, Outcome::I64(origin.elapsed().as_nanos() as i64));
            });
            return pending_for(caller, Kind::I64, id, results);
        }
        Cap::RandomBytes => {
            let n = match arg(1) {
                Val::I32(n) => n.max(0) as usize,
                _ => 0,
            };
            return settle_now(caller, Kind::Bytes, Outcome::Bytes(random_bytes(n)?), results);
        }
        Cap::ExitCode => {
            let code = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            caller.data_mut().exit = code;
            return settle_now(caller, Kind::I32, Outcome::I32(code), results);
        }
        Cap::WaitAny => {
            let ids = read_i32_array(caller, &params[1])?;
            let millis = match arg(2) {
                Val::I32(n) => n,
                _ => -1,
            };
            let table = caller.data().tickets.clone();
            results[0] = Val::I32(table.wait_any(&ids, millis));
        }
        Cap::Resolve(kind) => {
            let id = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            let outcome = caller.data().tickets.take(id).ok_or_else(|| {
                // A ticket resolves once. Asking twice, or asking for one that was cancelled, is a
                // program error rather than a value this can invent.
                wasmtime::Error::msg(format!("ticket {id} has no outcome to collect"))
            })?;
            results[0] = match (kind, outcome) {
                (Kind::I32, Outcome::I32(v)) => Val::I32(v),
                (Kind::I64, Outcome::I64(v)) => Val::I64(v),
                (Kind::Bytes, Outcome::Bytes(v)) => make_u8_array(caller, &v)?,
                (k, o) => {
                    return Err(wasmtime::Error::msg(format!(
                        "ticket {id} settled as {o:?}, which is not a {k:?}"
                    )))
                }
            };
        }
        Cap::Settled => {
            let id = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            let done = caller.data().tickets.is_done(id);
            results[0] = Val::I32(if done { 1 } else { 0 });
        }
        Cap::Discard => {
            let id = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            caller.data().tickets.discard(id);
        }
        // The whole of D6 in one arm: a runtime that answered zero here would make every program
        // that used the capability wrong in a way nothing could see.
        Cap::NotImplemented(name) => {
            return Err(wasmtime::Error::msg(format!(
                "{name} is not implemented in the native runtime yet"
            )))
        }
    }
    Ok(())
}

/// A `Pending<T>` for a ticket that is already settled.
///
/// Work a host does instantly still gets a ticket, because the *shape* is what the program sees: a
/// caller may hold it, ask `isDone`, put it in a `waitAny` list, or never collect it at all. Answering
/// the value directly would be a different type.
fn settle_now(
    caller: &mut Caller<'_, Host>,
    kind: Kind,
    outcome: Outcome,
    results: &mut [Val],
) -> Result<(), wasmtime::Error> {
    let id = caller.data().tickets.submit();
    caller.data().tickets.complete(id, outcome);
    pending_for(caller, kind, id, results)
}

/// Build the `Pending<T>` that names ticket `id`.
fn pending_for(
    caller: &mut Caller<'_, Host>,
    kind: Kind,
    id: i32,
    results: &mut [Val],
) -> Result<(), wasmtime::Error> {
    let hooks = caller.data().pendings.get(&kind).cloned().ok_or_else(|| {
        wasmtime::Error::msg(format!("this program has no Pending<{kind:?}> to answer with"))
    })?;
    let ctor = export_func(caller, &hooks.ctor)?;
    let built = call_dyn(
        caller,
        &ctor,
        &[Val::I32(id), hooks.resolve.clone(), hooks.settled.clone(), hooks.drop.clone()],
    )?;
    results[0] = built.into_iter().next().unwrap_or(Val::I32(0));
    Ok(())
}

/// Bytes from the operating system's own generator.
///
/// `/dev/urandom` rather than a crate: it is the kernel's CSPRNG on the platform this targets, and a
/// runtime that seeded its own would be inventing entropy. A read that fails is an error rather than
/// a shorter answer — the failure a caller must not be able to miss is silently weak randomness.
fn random_bytes(n: usize) -> Result<Vec<u8>, wasmtime::Error> {
    use std::io::Read;
    let mut out = vec![0u8; n];
    if n > 0 {
        let mut f = std::fs::File::open("/dev/urandom")
            .map_err(|e| wasmtime::Error::msg(format!("randomBytes: /dev/urandom: {e}")))?;
        f.read_exact(&mut out)
            .map_err(|e| wasmtime::Error::msg(format!("randomBytes: /dev/urandom: {e}")))?;
    }
    Ok(out)
}

/// A line, with the newline `log` and `warn` add. Bytes rather than a `String`: a wac string is bytes,
/// and re-encoding it through UTF-8 validation would change what a program printed.
fn print_bytes(bytes: &[u8], to_stderr: bool) {
    let mut line = bytes.to_vec();
    line.push(b'\n');
    write_raw(&line, to_stderr);
}

/// Exactly the bytes given, which is what `write` means. Answers whether they landed.
fn write_raw(bytes: &[u8], to_stderr: bool) -> bool {
    use std::io::Write;
    let ok = if to_stderr {
        std::io::stderr().write_all(bytes).is_ok()
    } else {
        std::io::stdout().write_all(bytes).is_ok()
    };
    // Unbuffered as far as the program is concerned: a shell that writes a prompt and then waits must
    // not have the prompt sitting in this process's buffer.
    let _ = if to_stderr { std::io::stderr().flush() } else { std::io::stdout().flush() };
    ok
}
