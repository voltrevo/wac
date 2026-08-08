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
    Str,
    BytesOpt,
    Bool,
    Captured,
    Change,
    FileResult,
    Stat,
    Names,
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
    Cwd,
    ReadStdin,
    ReadChunk,
    Env,
    PushChild,
    PopChild,
    ReadFile,
    WriteFile,
    Stat,
    LinkStat,
    ReadDir,
    Mkdir,
    Remove,
    Rename,
    OpenInput,
    OpenOutput,
    OutputError,
    CloseFeed,
    /// `Pending<T>.resolve`: collect the outcome, once.
    Resolve(Kind),
    /// `Pending<T>.settled`, shared by every kind because the question does not depend on `T`.
    Settled,
    /// `Pending<T>.drop` and `cancel`, likewise.
    Discard,
    /// Registered, callable, and refuses — carrying the wac name so the message says what was wanted.
    NotImplemented(String),
}

/// One `pushChild` frame: the world a program run *inside* this one sees.
///
/// Not isolation and it does not pretend to be — `platform.wac` says so, and it is the same wasm
/// instance with the same authority. What the frame changes is four things: what `argCount`/`arg`
/// answer, where `readChunk` and `readStdin` read from, where `log`/`warn`/`write`/`writeErr` go, and
/// what `cwd` reports.
struct Frame {
    argv: Vec<Vec<u8>>,
    stdin: Vec<u8>,
    stdin_at: usize,
    cwd: Vec<u8>,
    /// The child reads the *process's* real input rather than the bytes handed over.
    ///
    /// Without this a shell that runs a command in process has to read its own input to the end to
    /// have bytes to give it, and at a terminal that end never comes — wac-mono 0110, which is a hang
    /// rather than a wrong answer. The output is still captured, which is what the frame is for.
    inherit_input: bool,
    out: Vec<u8>,
    err: Vec<u8>,
}

struct Host {
    /// `caps[signature][slot]`, matching the module's per-signature funcref tables.
    caps: Vec<Vec<Cap>>,
    /// argv as bytes, since a program's arguments are bytes (wac-mono 0065).
    args: Vec<Vec<u8>>,
    tickets: Arc<Tickets>,
    /// What the manifest says this program may reach. A capability outside them is not silently
    /// weaker: it answers what "you may not" *means* for that capability, which differs by capability.
    grants: manifest::Grants,
    pendings: HashMap<Kind, PendingHooks>,
    /// Where `readChunk` reads when `openInput` has named a file. None is the process's own input,
    /// which is what `openInput("")` means and what a program that never asked gets.
    input: Option<std::fs::File>,
    /// Where `write` goes when `openOutput` has named a file, and the reason it could not be opened.
    output: Option<std::fs::File>,
    output_error: String,
    /// `pushChild` frames, innermost last. A stack, so a program that runs a program that runs a
    /// program is fine.
    frames: Vec<Frame>,
    /// Monotonic zero, so `monotonicNanos` measures from this program's start rather than the epoch.
    started: std::time::Instant,
    exit: i32,
}

impl Host {
    fn new(signatures: usize, args: Vec<Vec<u8>>, grants: manifest::Grants) -> Self {
        Host {
            caps: vec![Vec::new(); signatures],
            args,
            tickets: Arc::new(Tickets::default()),
            grants,
            pendings: HashMap::new(),
            input: None,
            output: None,
            output_error: String::new(),
            frames: Vec::new(),
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

fn make_string(caller: &mut Caller<'_, Host>, bytes: &[u8]) -> Result<Val, wasmtime::Error> {
    to_staging(caller, bytes)?;
    let from_mem = export_func(caller, "$bind$str_from_mem")?;
    let out = call_dyn(caller, &from_mem, &[Val::I32(bytes.len() as i32)])?;
    out.into_iter().next().ok_or_else(|| wasmtime::Error::msg("$bind$str_from_mem answered nothing"))
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
    let mut store = Store::new(&engine, Host::new(m.callbacks.len(), args, m.grants.clone()));

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
        (Kind::Str, "Pending<string>"),
        (Kind::BytesOpt, "Pending<u8[]?>"),
        (Kind::Bool, "Pending<bool>"),
        (Kind::Captured, "Pending<Captured>"),
        (Kind::Change, "Pending<Change>"),
        (Kind::FileResult, "Pending<FileResult>"),
        (Kind::Stat, "Pending<Stat>"),
        (Kind::Names, "Pending<string[]?>"),
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
        ("Cli", "cwd") => Cap::Cwd,
        ("Cli", "readStdin") => Cap::ReadStdin,
        ("Cli", "readChunk") => Cap::ReadChunk,
        ("Cli", "env") => Cap::Env,
        ("Cli", "pushChild") => Cap::PushChild,
        ("Cli", "popChild") => Cap::PopChild,
        ("Cli", "readFile") => Cap::ReadFile,
        ("Cli", "writeFile") => Cap::WriteFile,
        ("Cli", "stat") => Cap::Stat,
        ("Cli", "linkStat") => Cap::LinkStat,
        ("Cli", "readDir") => Cap::ReadDir,
        ("Cli", "mkdir") => Cap::Mkdir,
        ("Cli", "remove") => Cap::Remove,
        ("Cli", "rename") => Cap::Rename,
        ("Cli", "openInput") => Cap::OpenInput,
        ("Cli", "openOutput") => Cap::OpenOutput,
        ("Cli", "outputError") => Cap::OutputError,
        ("Cli", "closeFeed") => Cap::CloseFeed,
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
            let mut bytes = read_string(caller, &params[1])?;
            // The newline `log` adds. Added here rather than at the terminal so that a captured frame
            // gets it too: `log` is where thirty of `packages/box`'s applets send their output, and a
            // capture that dropped their line endings would join every line of `ls` into one.
            bytes.push(b'\n');
            emit(caller, &bytes, false);
        }
        Cap::Warn => {
            let mut bytes = read_string(caller, &params[1])?;
            bytes.push(b'\n');
            emit(caller, &bytes, true);
        }
        Cap::Write | Cap::WriteErr => {
            let bytes = read_u8_array(caller, &params[1])?;
            let to_stderr = matches!(cap, Cap::WriteErr);
            // The answer is whether the write landed, which is what the wac side reads to notice a
            // closed pipe. Into a frame it always lands.
            let ok = emit(caller, &bytes, to_stderr);
            results[0] = Val::I32(if ok { 1 } else { 0 });
        }
        Cap::ArgCount => {
            let h = caller.data();
            let n = h.frames.last().map(|f| f.argv.len()).unwrap_or(h.args.len()) as i32;
            return settle_now(caller, Kind::I32, Outcome::I32(n), results);
        }
        Cap::Arg => {
            let i = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            let h = caller.data();
            let from = h.frames.last().map(|f| &f.argv).unwrap_or(&h.args);
            let bytes = from.get(i as usize).cloned().unwrap_or_default();
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
        Cap::Cwd => {
            // The *process's* directory, which is the one thing here that is a fact about the host
            // rather than a capability over it. A sealed session immediately replaces it with its own.
            let dir = match caller.data().frames.last() {
                Some(f) if !f.cwd.is_empty() => f.cwd.clone(),
                _ => std::env::current_dir()
                    .map(|p| p.as_os_str().as_encoded_bytes().to_vec())
                    .unwrap_or_else(|_| b"/".to_vec()),
            };
            return settle_now(caller, Kind::Str, Outcome::Str(dir), results);
        }
        Cap::ReadStdin => {
            // Inside a frame that was handed bytes, this is those bytes and nothing blocks.
            if let Some(f) = caller.data_mut().frames.last_mut() {
                if !f.inherit_input {
                    let rest = f.stdin[f.stdin_at.min(f.stdin.len())..].to_vec();
                    f.stdin_at = f.stdin.len();
                    return settle_now(caller, Kind::Bytes, Outcome::Bytes(rest), results);
                }
            }
            // Everything, which is what this capability means — `readChunk` is the bounded one. On a
            // thread, because a pipe with nothing in it yet must not stop the program from doing
            // anything else it had in flight.
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            std::thread::spawn(move || {
                use std::io::Read;
                let mut buf = Vec::new();
                let _ = std::io::stdin().read_to_end(&mut buf);
                table.complete(id, Outcome::Bytes(buf));
            });
            return pending_for(caller, Kind::Bytes, id, results);
        }
        Cap::ReadChunk => {
            // Inside a frame: the bytes it was given, then end of input. One chunk rather than a
            // trickle, because the frame has all of them already and splitting would only invent a
            // boundary the caller then has to reassemble.
            let framed = {
                let h = caller.data_mut();
                match h.frames.last_mut() {
                    Some(f) if !f.inherit_input => {
                        let rest = f.stdin[f.stdin_at.min(f.stdin.len())..].to_vec();
                        f.stdin_at = f.stdin.len();
                        Some(rest)
                    }
                    _ => None,
                }
            };
            if let Some(bytes) = framed {
                results[0] = if bytes.is_empty() {
                    make_read_end(caller)?
                } else {
                    make_read_data(caller, &bytes)?
                };
                return Ok(());
            }
            // `fn[Read()]` — synchronous and not a ticket, because it is the *bounded* read: it
            // answers with whatever is there, or that the input has ended.
            let mut buf = [0u8; 65536];
            let n = {
                use std::io::Read;
                match caller.data_mut().input.as_mut() {
                    Some(f) => f.read(&mut buf),
                    None => std::io::stdin().read(&mut buf),
                }
            };
            results[0] = match n {
                Ok(0) => make_read_end(caller)?,
                Ok(n) => make_read_data(caller, &buf[..n])?,
                Err(e) => make_read_failed(caller, &e.to_string())?,
            };
        }
        Cap::Env => {
            // **A grant, and the only capability here that has one so far.** Without `env` in the
            // manifest this answers *absent* rather than reading the real environment — which is not
            // a refusal but the honest answer to "what does this world's environment say", and it is
            // what the Deno host does by handing the provider no reader at all.
            let name = read_string(caller, &params[1])?;
            let value = if caller.data().grants.env {
                String::from_utf8(name.clone())
                    .ok()
                    .and_then(|n| std::env::var_os(n))
                    .map(|v| v.as_encoded_bytes().to_vec())
            } else {
                None
            };
            return settle_now(caller, Kind::BytesOpt, Outcome::BytesOpt(value), results);
        }
        Cap::PushChild => {
            let argv = read_string_array(caller, &params[1])?;
            let stdin = read_u8_array(caller, &params[2])?;
            let cwd = read_string(caller, &params[3])?;
            let inherit_input = matches!(arg(4), Val::I32(n) if n != 0);
            caller.data_mut().frames.push(Frame {
                argv,
                stdin,
                stdin_at: 0,
                cwd,
                inherit_input,
                out: Vec::new(),
                err: Vec::new(),
            });
            return settle_now(caller, Kind::Bool, Outcome::Bool(true), results);
        }
        Cap::PopChild => {
            // A pop with nothing pushed answers two empty arrays rather than failing: `platform.wac`
            // says so, and the reason is that the caller has nothing to clean up either way.
            let (out, err) = match caller.data_mut().frames.pop() {
                Some(f) => (f.out, f.err),
                None => (Vec::new(), Vec::new()),
            };
            return settle_now(caller, Kind::Captured, Outcome::Captured(out, err), results);
        }
        // ── The filesystem ───────────────────────────────────────────────────
        //
        // Every one of these is `std::fs` behind a grant check, and the grant check is the whole
        // difference between a capability and an ambient authority: a program built without
        // `--allow-read` finds reading *denied*, not merely absent, and the fault says which
        // (`FAULT_NOT_GRANTED`, which `platform.wac` keeps separate from the operating system's own
        // `FAULT_DENIED` precisely so a caller can tell "this build cannot" from "this file will not").
        //
        // On threads, because a slow disk must not stop a program from doing what else it had in
        // flight — which is the entire reason these return a ticket rather than a value.
        Cap::ReadFile => {
            let path = read_string(caller, &params[1])?;
            if !caller.data().grants.read {
                return settle_now(caller, Kind::FileResult, denied_read(), results);
            }
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            std::thread::spawn(move || {
                let outcome = match std::fs::read(os_path(&path)) {
                    Ok(bytes) => Outcome::FileResult(true, bytes, String::new(), FAULT_NONE),
                    Err(e) => Outcome::FileResult(false, Vec::new(), e.to_string(), fault_of(&e)),
                };
                table.complete(id, outcome);
            });
            return pending_for(caller, Kind::FileResult, id, results);
        }
        Cap::WriteFile => {
            let path = read_string(caller, &params[1])?;
            let data = read_u8_array(caller, &params[2])?;
            if !caller.data().grants.write {
                return settle_now(caller, Kind::Change, denied_write_change(), results);
            }
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            std::thread::spawn(move || {
                let outcome = match std::fs::write(os_path(&path), &data) {
                    Ok(()) => Outcome::Change(FAULT_NONE, String::new()),
                    Err(e) => Outcome::Change(fault_of(&e), e.to_string()),
                };
                table.complete(id, outcome);
            });
            return pending_for(caller, Kind::Change, id, results);
        }
        Cap::Stat | Cap::LinkStat => {
            let path = read_string(caller, &params[1])?;
            if !caller.data().grants.read {
                return settle_now(
                    caller,
                    Kind::Stat,
                    Outcome::Stat(false, false, false, 0, 0, false, FAULT_NOT_GRANTED),
                    results,
                );
            }
            // `linkStat` does not follow a symbolic link, which is the whole difference between the
            // two and the reason `Stat` carries `isSymlink` at all.
            let follow = matches!(cap, Cap::Stat);
            let md = if follow {
                std::fs::metadata(os_path(&path))
            } else {
                std::fs::symlink_metadata(os_path(&path))
            };
            let outcome = match md {
                Ok(m) => {
                    let millis = m
                        .modified()
                        .ok()
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as i64)
                        .unwrap_or(0);
                    Outcome::Stat(
                        true,
                        m.is_file(),
                        m.is_dir(),
                        m.len() as i64,
                        millis,
                        m.file_type().is_symlink(),
                        FAULT_NONE,
                    )
                }
                // **Absent is not a failure.** `exists: false` with no fault is what "there is nothing
                // here" means; a fault would make every caller that merely asked treat it as an error.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    Outcome::Stat(false, false, false, 0, 0, false, FAULT_NONE)
                }
                Err(e) => Outcome::Stat(false, false, false, 0, 0, false, fault_of(&e)),
            };
            return settle_now(caller, Kind::Stat, outcome, results);
        }
        Cap::ReadDir => {
            let path = read_string(caller, &params[1])?;
            if !caller.data().grants.read {
                return settle_now(caller, Kind::Names, Outcome::Names(None), results);
            }
            let outcome = match std::fs::read_dir(os_path(&path)) {
                Ok(entries) => {
                    let mut names: Vec<Vec<u8>> = entries
                        .filter_map(|e| e.ok())
                        .map(|e| e.file_name().as_encoded_bytes().to_vec())
                        .collect();
                    // By bytes, which is what `LC_ALL=C` means and what `packages/fs`'s `sortNames`
                    // does: a listing whose order came from the filesystem would differ between two
                    // hosts for a reason that has nothing to do with either.
                    names.sort();
                    Outcome::Names(Some(names))
                }
                Err(_) => Outcome::Names(None),
            };
            return settle_now(caller, Kind::Names, outcome, results);
        }
        Cap::Mkdir => {
            let path = read_string(caller, &params[1])?;
            let parents = matches!(arg(2), Val::I32(n) if n != 0);
            if !caller.data().grants.write {
                return settle_now(caller, Kind::Change, denied_write_change(), results);
            }
            let made = if parents {
                std::fs::create_dir_all(os_path(&path))
            } else {
                std::fs::create_dir(os_path(&path))
            };
            let outcome = match made {
                Ok(()) => Outcome::Change(FAULT_NONE, String::new()),
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                    Outcome::Change(FAULT_EXISTS, e.to_string())
                }
                Err(e) => Outcome::Change(fault_of(&e), e.to_string()),
            };
            return settle_now(caller, Kind::Change, outcome, results);
        }
        Cap::Remove => {
            let path = read_string(caller, &params[1])?;
            let recursive = matches!(arg(2), Val::I32(n) if n != 0);
            if !caller.data().grants.write {
                return settle_now(caller, Kind::Change, denied_write_change(), results);
            }
            let p = os_path(&path);
            let is_dir = std::fs::symlink_metadata(&p).map(|m| m.is_dir()).unwrap_or(false);
            let gone = if is_dir {
                if recursive { std::fs::remove_dir_all(&p) } else { std::fs::remove_dir(&p) }
            } else {
                std::fs::remove_file(&p)
            };
            let outcome = match gone {
                Ok(()) => Outcome::Change(FAULT_NONE, String::new()),
                // A non-empty directory without `recursive` is its own category, because `rm` and
                // `rmdir` say different things about it and both need to tell it from a denial.
                Err(e) if e.raw_os_error() == Some(39) => Outcome::Change(FAULT_NOT_EMPTY, e.to_string()),
                Err(e) => Outcome::Change(fault_of(&e), e.to_string()),
            };
            return settle_now(caller, Kind::Change, outcome, results);
        }
        Cap::Rename => {
            let from = read_string(caller, &params[1])?;
            let to = read_string(caller, &params[2])?;
            if !caller.data().grants.write {
                return settle_now(caller, Kind::Change, denied_write_change(), results);
            }
            let outcome = match std::fs::rename(os_path(&from), os_path(&to)) {
                Ok(()) => Outcome::Change(FAULT_NONE, String::new()),
                Err(e) => Outcome::Change(fault_of(&e), e.to_string()),
            };
            return settle_now(caller, Kind::Change, outcome, results);
        }
        Cap::OpenInput => {
            // `openInput("")` is standard input, which is what `packages/box` means by `-` and by an
            // absent operand. It is a *redirect of this process's* input, so the state is here.
            let path = read_string(caller, &params[1])?;
            if path.is_empty() {
                caller.data_mut().input = None;
                return settle_now(caller, Kind::Change, Outcome::Change(FAULT_NONE, String::new()), results);
            }
            let change = match open_for_read(caller, &path) {
                Ok(f) => {
                    caller.data_mut().input = Some(f);
                    Outcome::Change(FAULT_NONE, String::new())
                }
                Err(c) => c,
            };
            return settle_now(caller, Kind::Change, change, results);
        }
        Cap::OpenOutput => {
            let path = read_string(caller, &params[1])?;
            if path.is_empty() {
                caller.data_mut().output = None;
                return settle_now(caller, Kind::Change, Outcome::Change(FAULT_NONE, String::new()), results);
            }
            if !caller.data().grants.write {
                return settle_now(
                    caller,
                    Kind::Change,
                    Outcome::Change(FAULT_NOT_GRANTED, "this program was not granted writing".into()),
                    results,
                );
            }
            let change = match std::fs::File::create(os_path(&path)) {
                Ok(f) => {
                    caller.data_mut().output = Some(f);
                    Outcome::Change(FAULT_NONE, String::new())
                }
                Err(e) => Outcome::Change(fault_of(&e), e.to_string()),
            };
            return settle_now(caller, Kind::Change, change, results);
        }
        Cap::OutputError => {
            // Empty means the output is fine, which is what a caller checks for. It is a separate
            // capability rather than `write`'s answer because a buffered write fails *later* than the
            // call that made it.
            let why = caller.data().output_error.clone();
            return settle_now(caller, Kind::Str, Outcome::Str(why.into_bytes()), results);
        }
        Cap::CloseFeed => {
            // Ends a *spawned worker's* input, and nothing here spawns yet. A no-op rather than a
            // refusal because the shape it belongs to does not exist: refusing would report a fault
            // about a child that was never made.
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
                (Kind::Str, Outcome::Str(v)) => make_string(caller, &v)?,
                (Kind::BytesOpt, Outcome::BytesOpt(None)) => Val::AnyRef(None),
                (Kind::BytesOpt, Outcome::BytesOpt(Some(v))) => make_u8_array(caller, &v)?,
                (Kind::Bool, Outcome::Bool(b)) => Val::I32(if b { 1 } else { 0 }),
                (Kind::Captured, Outcome::Captured(out, err)) => make_captured(caller, &out, &err)?,
                (Kind::Change, Outcome::Change(fault, msg)) => make_change(caller, fault, &msg)?,
                (Kind::FileResult, Outcome::FileResult(ok, bytes, err, fault)) => {
                    make_file_result(caller, ok, &bytes, &err, fault)?
                }
                (Kind::Stat, Outcome::Stat(e, f, d, size, m, link, fault)) => {
                    make_stat(caller, e, f, d, size, m, link, fault)?
                }
                (Kind::Names, Outcome::Names(None)) => Val::AnyRef(None),
                (Kind::Names, Outcome::Names(Some(names))) => make_string_array(caller, &names)?,
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

// ── The `Read` enum ───────────────────────────────────────────────────────────
//
// `readChunk` answers `Read`, which is `Data(u8[]) | End | Failed(string)`. An enum crosses through
// `$bind$e_<Enum>_<Case>_new`, so the three cases are three exports and there is nothing to encode.
//
// The three are separate on purpose and this runtime keeps them separate: "no bytes right now",
// "there will never be any more", and "the read failed" are three different things, and a host that
// collapsed the third into the second would make every reader treat a broken pipe as a clean end.

fn make_read_data(caller: &mut Caller<'_, Host>, bytes: &[u8]) -> Result<Val, wasmtime::Error> {
    let arr = make_u8_array(caller, bytes)?;
    let f = export_func(caller, "$bind$e_Read_Data_new")?;
    let out = call_dyn(caller, &f, &[arr])?;
    out.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Read.Data answered nothing"))
}

fn make_read_end(caller: &mut Caller<'_, Host>) -> Result<Val, wasmtime::Error> {
    let f = export_func(caller, "$bind$e_Read_End_new")?;
    let out = call_dyn(caller, &f, &[])?;
    out.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Read.End answered nothing"))
}

fn make_read_failed(caller: &mut Caller<'_, Host>, why: &str) -> Result<Val, wasmtime::Error> {
    let s = make_string(caller, why.as_bytes())?;
    let f = export_func(caller, "$bind$e_Read_Failed_new")?;
    let out = call_dyn(caller, &f, &[s])?;
    out.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Read.Failed answered nothing"))
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

/// Where output goes: into the innermost frame if there is one, or to the terminal.
///
/// One place rather than four, because the routing rule is the same for `log`, `warn`, `write` and
/// `writeErr` and the first version of `pushChild` in the JavaScript host captured only `write` — which
/// lost most of `packages/box`'s applets silently, since thirty of them use `log`.
fn emit(caller: &mut Caller<'_, Host>, bytes: &[u8], to_stderr: bool) -> bool {
    if let Some(f) = caller.data_mut().frames.last_mut() {
        if to_stderr { f.err.extend_from_slice(bytes) } else { f.out.extend_from_slice(bytes) }
        return true;
    }
    if !to_stderr {
        // A redirected output is only standard output's: the error stream is where a program says
        // what went wrong, and sending that to the file being written would hide it.
        let h = caller.data_mut();
        if let Some(f) = h.output.as_mut() {
            use std::io::Write;
            return match f.write_all(bytes) {
                Ok(()) => true,
                Err(e) => {
                    h.output_error = e.to_string();
                    false
                }
            };
        }
    }
    write_raw(bytes, to_stderr)
}

/// What a read answers when the program was built without the grant.
///
/// A `FileResult` rather than a trap, because "you may not" is an answer a program can act on and a
/// trap is not — and `FAULT_NOT_GRANTED` rather than `FAULT_DENIED`, because the two are different
/// facts: one is about this build, the other about this file.
fn denied_read() -> Outcome {
    Outcome::FileResult(false, Vec::new(), "this program was not granted reading".into(), FAULT_NOT_GRANTED)
}

fn denied_write_change() -> Outcome {
    Outcome::Change(FAULT_NOT_GRANTED, "this program was not granted writing".into())
}

fn make_file_result(
    caller: &mut Caller<'_, Host>,
    ok: bool,
    bytes: &[u8],
    error: &str,
    fault: i32,
) -> Result<Val, wasmtime::Error> {
    // The array before the string: both use the staging buffer, and building one while holding the
    // other would overwrite it.
    let b = make_u8_array(caller, bytes)?;
    let e = make_string(caller, error.as_bytes())?;
    let f = export_func(caller, "$bind$sm_FileResult_of")?;
    let built = call_dyn(caller, &f, &[Val::I32(if ok { 1 } else { 0 }), b, e, Val::I32(fault)])?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("FileResult.of answered nothing"))
}

#[allow(clippy::too_many_arguments)]
fn make_stat(
    caller: &mut Caller<'_, Host>,
    exists: bool,
    is_file: bool,
    is_dir: bool,
    size: i64,
    modified: i64,
    is_symlink: bool,
    fault: i32,
) -> Result<Val, wasmtime::Error> {
    let f = export_func(caller, "$bind$sm_Stat_of")?;
    let built = call_dyn(
        caller,
        &f,
        &[
            Val::I32(exists as i32),
            Val::I32(is_file as i32),
            Val::I32(is_dir as i32),
            Val::I64(size),
            Val::I64(modified),
            Val::I32(is_symlink as i32),
            Val::I32(fault),
        ],
    )?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Stat.of answered nothing"))
}

/// A `string[]`, built one element at a time.
///
/// `$bind$arr_string_new(n, fill)` wants a value to fill with, so an empty string is made first and
/// handed in — the alternative, `new0`, exists for the empty array and cannot size one.
fn make_string_array(caller: &mut Caller<'_, Host>, items: &[Vec<u8>]) -> Result<Val, wasmtime::Error> {
    let empty = make_string(caller, b"")?;
    let new = export_func(caller, "$bind$arr_string_new")?;
    let made = call_dyn(caller, &new, &[Val::I32(items.len() as i32), empty])?;
    let arr = made.into_iter().next().ok_or_else(|| wasmtime::Error::msg("arr_string_new answered nothing"))?;
    let set = export_func(caller, "$bind$arr_string_set")?;
    for (i, item) in items.iter().enumerate() {
        let s = make_string(caller, item)?;
        call_dyn(caller, &set, &[arr.clone(), Val::I32(i as i32), s])?;
    }
    Ok(arr)
}

/// Faults, matching `FAULT_*` in `platform.wac` and `host/faults.ts`.
const FAULT_NONE: i32 = 0;
const FAULT_NOT_FOUND: i32 = 1;
const FAULT_DENIED: i32 = 2;
const FAULT_EXISTS: i32 = 3;
const FAULT_NOT_EMPTY: i32 = 4;
const FAULT_OTHER: i32 = 5;
/// Not an operating-system failure at all: the program was built without the capability.
const FAULT_NOT_GRANTED: i32 = 7;

/// A path as the operating system takes it. Bytes, because a name is bytes (wac-mono 0065).
fn os_path(bytes: &[u8]) -> std::path::PathBuf {
    use std::os::unix::ffi::OsStrExt;
    std::path::PathBuf::from(std::ffi::OsStr::from_bytes(bytes))
}

fn fault_of(e: &std::io::Error) -> i32 {
    match e.kind() {
        std::io::ErrorKind::NotFound => FAULT_NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => FAULT_DENIED,
        _ => FAULT_OTHER,
    }
}

/// Open a file for reading, or the `Change` that says why not.
fn open_for_read(caller: &mut Caller<'_, Host>, path: &[u8]) -> Result<std::fs::File, Outcome> {
    if !caller.data().grants.read {
        return Err(Outcome::Change(FAULT_NOT_GRANTED, "this program was not granted reading".into()));
    }
    std::fs::File::open(os_path(path)).map_err(|e| Outcome::Change(fault_of(&e), e.to_string()))
}

fn make_change(caller: &mut Caller<'_, Host>, fault: i32, message: &str) -> Result<Val, wasmtime::Error> {
    let m = make_string(caller, message.as_bytes())?;
    let f = export_func(caller, "$bind$sm_Change_of")?;
    let built = call_dyn(caller, &f, &[Val::I32(fault), m])?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Change.of answered nothing"))
}

/// A `string[]` as a list of byte strings.
///
/// Element by element through `$bind$arr_string_get`, because a string array is references and the
/// staging buffer carries bytes: there is no `arr_string_to_mem` and there could not be a useful one.
fn read_string_array(caller: &mut Caller<'_, Host>, a: &Val) -> Result<Vec<Vec<u8>>, wasmtime::Error> {
    let len_fn = export_func(caller, "$bind$arr_string_len")?;
    let get = export_func(caller, "$bind$arr_string_get")?;
    let out = call_dyn(caller, &len_fn, std::slice::from_ref(a))?;
    let n = match out.first() {
        Some(Val::I32(n)) => *n,
        _ => return Err(wasmtime::Error::msg("$bind$arr_string_len did not answer an i32")),
    };
    let mut items = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let got = call_dyn(caller, &get, &[a.clone(), Val::I32(i)])?;
        let s = got.into_iter().next().unwrap_or(Val::I32(0));
        items.push(read_string(caller, &s)?);
    }
    Ok(items)
}

fn make_captured(caller: &mut Caller<'_, Host>, out: &[u8], err: &[u8]) -> Result<Val, wasmtime::Error> {
    // Both arrays before the constructor: each one uses the staging buffer, so building one while
    // holding the other would overwrite it.
    let o = make_u8_array(caller, out)?;
    let e = make_u8_array(caller, err)?;
    let f = export_func(caller, "$bind$sm_Captured_of")?;
    let built = call_dyn(caller, &f, &[o, e])?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Captured.of answered nothing"))
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
