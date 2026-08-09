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
mod streams;
mod tickets;

use manifest::{Manifest, SUPPORTED_VERSION};
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use streams::{Exit, Stream};
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
    Socket,
    Child,
    Read,
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
    /// `Core.askInterrupt` — nothing here owns a keyboard, so it is always "no". See below.
    Interrupted,
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
    Connect,
    Listen,
    Accept,
    Recv,
    Send,
    CloseSocket,
    Spawn,
    SpawnSelf,
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

/// The three queues and the status of one spawned child, as the *parent* holds them.
///
/// Clonable because a child is named by two handles — its output and its error stream — and every
/// field is an `Arc`, so the clone is the same child rather than a copy of one.
#[derive(Clone)]
struct ChildProc {
    /// What the parent sends becomes the child's standard input.
    stdin: Arc<Stream>,
    stdout: Arc<Stream>,
    stderr: Arc<Stream>,
    exit: Arc<Exit>,
}

/// A socket, as this runtime holds it.
///
/// `Arc<TcpStream>` rather than a mutex: `&TcpStream` implements both `Read` and `Write`, so a
/// `recv` parked on one thread and a `send` on another are the kernel's problem rather than this
/// runtime's — which is what `example/writeread.wac` exists to ask about.
#[derive(Clone)]
enum Sock {
    Listening(Arc<std::net::TcpListener>),
    Open(Arc<std::net::TcpStream>),
}

/// What a handle names.
///
/// A child has two — one for each of its output streams — because a program has two streams and
/// merging them is a bug `platform.wac` names by example.
enum Handle {
    /// The child's ordinary handle: `send` feeds it, `recv` reads its standard output.
    Main(ChildProc),
    /// The `errHandle`: `recv` reads its error stream, and nothing is sent to it.
    Err(ChildProc),
    /// A socket. `send` writes it, `recv` reads it, `accept` takes from a listening one.
    Net(Sock),
}

/// Everything a handle can name, shared with the threads that make them.
///
/// **Behind an `Arc<Mutex<…>>` because `accept` and `connect` finish on a thread**, and a socket they
/// produced has to be namable by a handle the guest is given. Nothing else about a `Store` crosses a
/// thread — a `Val` is not `Send` — and this is the one table that must.
///
/// A closed slot becomes `None` and is **never reused**: a handle held past a close names nothing
/// rather than naming somebody else's connection, which `deno.ts` says of its own table in the same
/// words and for the same reason.
#[derive(Default)]
struct Handles {
    slots: Vec<Option<Handle>>,
}

impl Handles {
    fn push(&mut self, what: Handle) -> i32 {
        self.slots.push(Some(what));
        (self.slots.len() - 1) as i32
    }

    fn get(&self, h: i32) -> Option<&Handle> {
        if h < 0 {
            return None;
        }
        self.slots.get(h as usize)?.as_ref()
    }

    fn close(&mut self, h: i32) {
        if h >= 0 {
            if let Some(slot) = self.slots.get_mut(h as usize) {
                *slot = None;
            }
        }
    }
}

/// The streams a program has when it *is* a child, rather than the process's own.
struct AsChild {
    stdin: Arc<Stream>,
    stdout: Arc<Stream>,
    stderr: Arc<Stream>,
    /// Whether this child was told to read the *process's* input rather than what its parent sends.
    ///
    /// **Without this the queue below shadowed the real thing.** A child spawned with `inheritInput`
    /// gets its `stdin` queue `finish`ed at once — nothing will arrive on it and a reader must not
    /// wait — and `readChunk` then read that finished queue, saw empty, and answered *end of input*
    /// before it could reach the process's own stdin. So every filter run by a shell that spawns —
    /// `cat`, `wc`, `head`, `sort`, `grep` — produced nothing under this runtime while working
    /// everywhere else, and the comment beside the `finish` said the opposite was happening.
    inherits: bool,
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
    /// Children this program spawned, and the handles that name their streams.
    handles: Arc<std::sync::Mutex<Handles>>,
    /// Where this program's relative paths resolve from, when its parent said. Empty means the
    /// process's own directory.
    ///
    /// **Not a `Frame`**, which is what the first version used and which was wrong in a way that took
    /// a while to see: a frame also *captures output*, so a child given a directory had everything it
    /// printed collected into a buffer nobody would ever pop. It ran, exited 0, and said nothing.
    cwd: Vec<u8>,
    /// Set when this program is itself a spawned child: its output goes to its parent's queues and
    /// its input comes from one, rather than from the process's own streams.
    as_child: Option<AsChild>,
    /// Everything a child thread needs to make another instance of this same module.
    world: Option<Arc<World>>,
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
            handles: Arc::new(std::sync::Mutex::new(Handles::default())),
            as_child: None,
            cwd: Vec::new(),
            world: None,
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
    let m: Arc<Manifest> = serde_json::from_str::<Manifest>(&text).map(Arc::new)
        .map_err(|e| wasmtime::Error::msg(format!("{}: {e}", argv[1])))?;
    if m.version != SUPPORTED_VERSION {
        return Err(wasmtime::Error::msg(format!(
            "{}: manifest version {} — this runtime speaks {}",
            argv[1], m.version, SUPPORTED_VERSION
        )));
    }
    let wasm_path = manifest_path.parent().unwrap_or(Path::new(".")).join(&m.wasm);
    let program_args: Vec<Vec<u8>> = argv[2..].iter().map(|a| a.as_bytes().to_vec()).collect();

    let code = run(m, &wasm_path, program_args)?;
    std::process::exit(code);
}

/// Everything a second instance of this same program needs.
///
/// Held behind an `Arc` because a spawned child builds its own `Store` **on its own thread**, and the
/// engine, the module and the manifest are the only things that cross. Nothing from the parent's store
/// does: a `Val` is not `Send` and must not be, which is the language enforcing what `spawn` is for.
struct World {
    engine: Engine,
    module: Module,
    manifest: Arc<Manifest>,
}

fn run(m: Arc<Manifest>, wasm_path: &Path, args: Vec<Vec<u8>>) -> Result<i32, wasmtime::Error> {
    let mut config = Config::new();
    // The ABI is made of references — a wac string, a struct and a funcref all cross as one — so the
    // proposals that carry them are not optional here.
    config.wasm_function_references(true);
    config.wasm_gc(true);
    let engine = Engine::new(&config)?;
    let module = Module::from_file(&engine, wasm_path)?;
    let world = Arc::new(World { engine: engine.clone(), module: module.clone(), manifest: m.clone() });
    let mut host = Host::new(m.callbacks.len(), args, m.grants.clone());
    host.world = Some(world);
    let mut store = Store::new(&engine, host);

    let linker = wire(&engine, &module, &m)?;

    enter(&mut store, &module, &linker, &m)
}

/// Instantiate, build the capability structs, and call `main`. The half a child repeats.
fn enter(
    store: &mut Store<Host>,
    module: &Module,
    linker: &Linker<Host>,
    m: &Manifest,
) -> Result<i32, wasmtime::Error> {
    let instance = linker.instantiate(&mut *store, module)?;

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
        (Kind::Socket, "Pending<Socket>"),
        (Kind::Child, "Pending<Child>"),
        (Kind::Read, "Pending<Read>"),
    ] {
        if let Some(hooks) = pending_hooks(&mut *store, &instance, m, kind, wac_name)? {
            store.data_mut().pendings.insert(kind, hooks);
        }
    }

    let core = build(&mut *store, &instance, m, "Core")?;
    let cli = build(&mut *store, &instance, m, "Cli")?;

    let main = instance
        .get_func(&mut *store, "main")
        .ok_or_else(|| wasmtime::Error::msg(format!("{}: no exported `main`", m.entry)))?;
    let mut out = [Val::I32(0)];
    main.call(&mut *store, &[core, cli], &mut out)?;
    let status = match out[0] {
        Val::I32(n) => n,
        _ => 0,
    };
    let host_exit = store.data().exit;
    Ok(if status != 0 { status } else { host_exit })
}

/// Every dispatcher import the module asks for, wired to `dispatch`.
///
/// One per funcref *signature*, with the signature taken from the module rather than rebuilt from the
/// manifest: the module is the thing that has to be satisfied, and a type assembled from the manifest
/// would be a second opinion about it.
fn wire(engine: &Engine, module: &Module, m: &Manifest) -> Result<Linker<Host>, wasmtime::Error> {
    let mut linker = Linker::new(engine);
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
    Ok(linker)
}

/// Run a spawned child to completion on this thread, and answer its status.
///
/// **The confinement is the runtime's here, not only the language's.** `children.ts` is careful to say
/// that in the JavaScript hosts "the isolation is the language's, not the runtime's": a Deno worker
/// inherits the process's permissions, so a wac child is confined only because wac has no ambient
/// anything. Here the child gets a `Host` built with the grants its parent chose and a fresh `Store`,
/// and there is no route from one store to another — a `Val` is not `Send`, which is the type system
/// saying the same thing. wac-mono 0015.
fn run_child(world: Arc<World>, argv: Vec<Vec<u8>>, grants: manifest::Grants, cwd: Vec<u8>, streams: AsChild) -> i32 {
    let m = world.manifest.clone();
    let mut host = Host::new(m.callbacks.len(), argv, grants);
    host.world = Some(world.clone());
    let stdout = streams.stdout.clone();
    let stderr = streams.stderr.clone();
    host.as_child = Some(streams);
    // A child's relative paths resolve from where its parent said, which is the same rule `pushChild`
    // keeps for an in-process one — and the thing `spawn` got wrong in the JavaScript hosts, where a
    // spawned program inherited the *host's* directory instead of the shell's.
    host.cwd = cwd;
    let mut store = Store::new(&world.engine, host);
    let code = match wire(&world.engine, &world.module, &m)
        .and_then(|linker| enter(&mut store, &world.module, &linker, &m))
    {
        Ok(code) => code,
        Err(e) => {
            // The child's own error stream, so a parent that reads it sees what went wrong rather
            // than a status with no sentence attached.
            let _ = stderr.write(format!("{e}\n").as_bytes());
            1
        }
    };
    stdout.finish();
    stderr.finish();
    code
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
        ("Cli", "connect") => Cap::Connect,
        ("Cli", "listen") => Cap::Listen,
        ("Cli", "accept") => Cap::Accept,
        ("Cli", "recv") => Cap::Recv,
        ("Cli", "send") => Cap::Send,
        ("Core", "askInterrupt") => Cap::Interrupted,
        ("Cli", "closeSocket") => Cap::CloseSocket,
        ("Cli", "spawn") => Cap::Spawn,
        ("Cli", "spawnSelf") => Cap::SpawnSelf,
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
            // Two meanings on one capability, and the handle says which: a child's handle asks for
            // *its* status, anything else sets this program's own. `platform.wac` gives them one
            // name, so the runtime has to tell them apart by what it was handed.
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => 0,
            };
            if let Some(c) = child_of(caller, h) {
                let exit = c.exit.clone();
                let id = caller.data().tickets.submit();
                let table = caller.data().tickets.clone();
                std::thread::spawn(move || table.complete(id, Outcome::I32(exit.wait())));
                return pending_for(caller, Kind::I32, id, results);
            }
            caller.data_mut().exit = h;
            return settle_now(caller, Kind::I32, Outcome::I32(h), results);
        }
        Cap::Cwd => {
            // The *process's* directory, which is the one thing here that is a fact about the host
            // rather than a capability over it. A sealed session immediately replaces it with its own.
            let dir = match caller.data().frames.last() {
                Some(f) if !f.cwd.is_empty() => f.cwd.clone(),
                _ if !caller.data().cwd.is_empty() => caller.data().cwd.clone(),
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
            // The same ranking as `readChunk`: a file this program redirected its input to beats the
            // queue its parent feeds.
            if caller.data().input.is_some() {
                use std::io::Read;
                let mut all = Vec::new();
                let _ = caller.data_mut().input.as_mut().unwrap().read_to_end(&mut all);
                return settle_now(caller, Kind::Bytes, Outcome::Bytes(all), results);
            }
            // A spawned child: everything its parent sends, until the feed ends — unless it was told
            // to inherit, in which case the queue is empty by construction and the process's own
            // input is the answer. See `AsChild::inherits`.
            if let Some(streams) = caller.data().as_child.as_ref().filter(|c| !c.inherits) {
                let stdin = streams.stdin.clone();
                let id = caller.data().tickets.submit();
                let table = caller.data().tickets.clone();
                std::thread::spawn(move || {
                    let mut all = Vec::new();
                    loop {
                        let chunk = stdin.read();
                        if chunk.is_empty() {
                            break;
                        }
                        all.extend_from_slice(&chunk);
                    }
                    table.complete(id, Outcome::Bytes(all));
                });
                return pending_for(caller, Kind::Bytes, id, results);
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
            // **An explicit `openInput` wins over the parent's queue**, and the order is the whole
            // of the bug it fixes: `openInput` *redirects this process's standard input to a file*,
            // so a spawned `cat f` that had opened the file went on reading the queue its parent had
            // already finished, and printed nothing. It ran, exited 0, and said nothing — which is
            // the shape this runtime keeps producing when two sources of input are ranked wrongly.
            if caller.data().input.is_some() {
                let mut buf = [0u8; 65536];
                let n = {
                    use std::io::Read;
                    caller.data_mut().input.as_mut().unwrap().read(&mut buf)
                };
                results[0] = match n {
                    Ok(0) => make_read_end(caller)?,
                    Ok(n) => make_read_data(caller, &buf[..n])?,
                    Err(e) => make_read_failed(caller, &e.to_string())?,
                };
                return Ok(());
            }
            // A spawned child reads what its parent sends — unless it inherits, when the queue is
            // finished at spawn and the process's own input is what it meant. See `AsChild::inherits`.
            if let Some(streams) = caller.data().as_child.as_ref().filter(|c| !c.inherits) {
                let stdin = streams.stdin.clone();
                let bytes = stdin.read();
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
        // ── The network and `spawn`: not implemented, and *said in the type* ─────
        //
        // These do not trap, and the difference from every other gap in this runtime is the point.
        // `Child.handle == -2` **means "this world has no `spawn` at all"** — `platform.wac` says so
        // in those words, and says why: without it "a world that cannot spawn made every spawnable
        // name *fail* rather than fall through", which hid `packages/box`'s own `wc` behind a
        // `WACPATH` lookup that could never work. A missing capability is not a broken program.
        //
        // So where the interface has a value for "not here", answering it is more honest than a trap,
        // not less: the trap is what a caller cannot act on. `Socket` has the same shape with a
        // negative handle and a reason, and a shell falls back to its in-process applets on both.
        Cap::SpawnSelf => {
            // `spawnSelf(argv, grants, cwd, inheritInput)` — another instance of *this* module, which
            // is how `packages/box` runs an applet as a real program: `main` dispatches on argv[0].
            let argv = read_bytes_array(caller, &params[1])?;
            let want = match arg(2) {
                Val::I32(n) => n,
                _ => 0,
            };
            let cwd = read_string(caller, &params[3])?;
            let inherit = matches!(arg(4), Val::I32(n) if n != 0);
            return spawn_instance(caller, argv, want, cwd, inherit, results);
        }
        Cap::Spawn => {
            // `spawn(source, …)` hands over a *program's source*, which in the JavaScript hosts is a
            // worker bundle. There is no such thing here — a second instance comes from this module —
            // so this is -1 with a reason rather than -2: **this world can spawn**, and a caller that
            // reads -2 would give up on `spawnSelf` too, which works.
            return settle_now(
                caller,
                Kind::Child,
                Outcome::Child(-1, -1, "spawning a program from its source is not implemented in the native runtime; spawnSelf works".into()),
                results,
            );
        }
        // ── The network ──────────────────────────────────────────────────────
        //
        // **The grant check comes first**, and the order is not cosmetic. A program built without
        // `--allow-net` would be refused on *every* host; telling it something about this runtime
        // instead is both irrelevant and misleading, and `example/probe.wac` reads the difference —
        // it looks for the words "not granted" and reports `denied` rather than `failed`. The Deno
        // host says "network access not granted to this application", so this says the same thing.
        Cap::Connect => {
            if !caller.data().grants.net {
                return settle_now(caller, Kind::Socket, denied_net(), results);
            }
            let port = match arg(2) {
                Val::I32(n) => n,
                _ => 0,
            };
            let host = String::from_utf8_lossy(&read_string(caller, &params[1])?).into_owned();
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            let table_handles = caller.data().handles.clone();
            std::thread::spawn(move || {
                let outcome = match std::net::TcpStream::connect((host.as_str(), port as u16)) {
                    Ok(s) => {
                        // The port this dialled *from*, which is what `Socket.port` is for on a
                        // connected socket — `platform.wac` distinguishes it from the peer's.
                        let local = s.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let slot = table_handles.lock().unwrap().push(Handle::Net(Sock::Open(Arc::new(s))));
                        Outcome::Socket(slot, String::new(), String::new(), local)
                    }
                    Err(e) => Outcome::Socket(-1, e.to_string(), String::new(), 0),
                };
                table.complete(id, outcome);
            });
            return pending_for(caller, Kind::Socket, id, results);
        }
        Cap::Listen => {
            if !caller.data().grants.net {
                return settle_now(caller, Kind::Socket, denied_net(), results);
            }
            let port = match arg(2) {
                Val::I32(n) => n,
                _ => 0,
            };
            let addr = String::from_utf8_lossy(&read_string(caller, &params[1])?).into_owned();
            // The empty string is **every interface**, which is what `platform.wac` says and what a
            // daemon nobody can reach is not. `0.0.0.0` spells the same thing explicitly.
            let bind = if addr.is_empty() { "0.0.0.0".to_string() } else { addr };
            let outcome = match std::net::TcpListener::bind((bind.as_str(), port as u16)) {
                Ok(l) => {
                    // The port the kernel actually chose, which is the whole reason `listen` answers
                    // one: a server that asked for 0 could otherwise never learn where it is.
                    let bound = l.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                    let handle = keep(caller, Handle::Net(Sock::Listening(Arc::new(l))));
                    Outcome::Socket(handle, String::new(), String::new(), bound)
                }
                Err(e) => Outcome::Socket(-1, e.to_string(), String::new(), 0),
            };
            return settle_now(caller, Kind::Socket, outcome, results);
        }
        Cap::Accept => {
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => -1,
            };
            let Some(Sock::Listening(listener)) = socket_at(caller, h) else {
                if !caller.data().grants.net {
                    return settle_now(caller, Kind::Socket, denied_net(), results);
                }
                return settle_now(
                    caller,
                    Kind::Socket,
                    Outcome::Socket(-1, "not a listening socket".into(), String::new(), 0),
                    results,
                );
            };
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            let table_handles = caller.data().handles.clone();
            std::thread::spawn(move || {
                let outcome = match listener.accept() {
                    Ok((s, peer)) => {
                        // The address only, without the port: `platform.wac` says the port a client
                        // dialled *from* is of no use to anyone and would invite string parsing at
                        // every call site.
                        let who = peer.ip().to_string();
                        let local = s.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let slot = table_handles.lock().unwrap().push(Handle::Net(Sock::Open(Arc::new(s))));
                        Outcome::Socket(slot, String::new(), who, local)
                    }
                    Err(e) => Outcome::Socket(-1, e.to_string(), String::new(), 0),
                };
                table.complete(id, outcome);
            });
            return pending_for(caller, Kind::Socket, id, results);
        }
        Cap::Recv => {
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => -1,
            };
            // On a thread either way: a child or a peer that has not written yet must not stop this
            // program from reading another, which is exactly what a pipeline and a relay both do.
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            // Which of the child's two streams is decided *before* anything starts: the first
            // version started a reader on standard output and then started a second on the error
            // stream when it noticed the handle was the wrong one, leaving a thread parked on a
            // stream nobody would collect.
            if let Some(stream) = child_stream(caller, h) {
                std::thread::spawn(move || table.complete(id, Outcome::Bytes(stream.read())));
                return pending_for(caller, Kind::Read, id, results);
            }
            if let Some(Sock::Open(s)) = socket_at(caller, h) {
                std::thread::spawn(move || {
                    use std::io::Read;
                    let mut buf = [0u8; 65536];
                    let outcome = match (&*s).read(&mut buf) {
                        Ok(n) => Outcome::Bytes(buf[..n].to_vec()),
                        Err(e) => Outcome::Str(e.to_string().into_bytes()),
                    };
                    table.complete(id, outcome);
                });
                return pending_for(caller, Kind::Read, id, results);
            }
            caller.data().tickets.discard(id);
            // Neither, so there is nothing at the other end. `Read.Failed` rather than `Read.End`,
            // which would tell a reader the peer had finished rather than that there was never one.
            let why: &[u8] = if caller.data().grants.net {
                b"no such handle"
            } else {
                b"network access not granted to this application"
            };
            return settle_now(caller, Kind::Read, Outcome::Str(why.to_vec()), results);
        }
        Cap::Send => {
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => -1,
            };
            let bytes = read_u8_array(caller, &params[2])?;
            // Only a child's *main* handle takes bytes: there is nothing to write to its error
            // stream, and answering false for that is truer than pretending.
            let to_child = matches!(caller.data().handles.lock().unwrap().get(h), Some(Handle::Main(_)));
            let landed = if to_child {
                match child_of(caller, h) {
                    Some(c) => c.stdin.write(&bytes),
                    None => false,
                }
            } else if let Some(Sock::Open(s)) = socket_at(caller, h) {
                use std::io::Write;
                (&*s).write_all(&bytes).is_ok()
            } else {
                // False is "it did not land", which is what a caller checks.
                false
            };
            return settle_now(caller, Kind::Bool, Outcome::Bool(landed), results);
        }
        Cap::CloseSocket => {
            // **Stops the child outright**, which is what `closeSocket` means and what `closeFeed`
            // deliberately does not: `head -1` ending `seq` is the ordinary case. Every queue is
            // finished, so the child's next write answers false and it is written to notice.
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => -1,
            };
            if let Some(c) = child_of(caller, h) {
                c.stdin.finish();
                c.stdout.finish();
                c.stderr.finish();
            }
            if let Some(Sock::Open(s)) = socket_at(caller, h) {
                // Both directions, which is what closing a socket means: a peer blocked on a read
                // must find out rather than wait for a process that has finished with it.
                let _ = s.shutdown(std::net::Shutdown::Both);
            }
            caller.data().handles.lock().unwrap().close(h);
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
            let here = resolve(caller, &path);
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            std::thread::spawn(move || {
                let outcome = match std::fs::read(here) {
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
            let here = resolve(caller, &path);
            let id = caller.data().tickets.submit();
            let table = caller.data().tickets.clone();
            std::thread::spawn(move || {
                let outcome = match std::fs::write(here, &data) {
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
            let here = resolve(caller, &path);
            let follow = matches!(cap, Cap::Stat);
            let md = if follow {
                std::fs::metadata(&here)
            } else {
                std::fs::symlink_metadata(&here)
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
                Err(e) => Outcome::Stat(false, false, false, 0, 0, false, stat_fault(&e)),
            };
            return settle_now(caller, Kind::Stat, outcome, results);
        }
        Cap::ReadDir => {
            let path = read_string(caller, &params[1])?;
            if !caller.data().grants.read {
                return settle_now(caller, Kind::Names, Outcome::Names(None), results);
            }
            let here = resolve(caller, &path);
            let outcome = match std::fs::read_dir(here) {
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
            let here = resolve(caller, &path);
            let made = if parents {
                std::fs::create_dir_all(&here)
            } else {
                std::fs::create_dir(&here)
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
            let p = resolve(caller, &path);
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
            let from_p = resolve(caller, &from);
            let to_p = resolve(caller, &to);
            let outcome = match std::fs::rename(from_p, to_p) {
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
            let here = resolve(caller, &path);
            let change = match std::fs::File::create(here) {
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
            // Ends a child's input **without stopping it**: a program that reads to the end before
            // answering — `wc` is the obvious one — needs the end while it is still running.
            let h = match arg(1) {
                Val::I32(n) => n,
                _ => -1,
            };
            if let Some(c) = child_of(caller, h) {
                c.stdin.finish();
            }
        }
        Cap::Interrupted => {
            // **Nobody can ask this host to interrupt, so the answer is no** — and that is the answer
            // rather than a stub. `Core.askInterrupt` is answered by whoever owns the keyboard; here
            // the terminal belongs to whatever started the program, and over ssh to `sshd`, which is a
            // wac program on the far side of an encrypted socket. Only a page can say yes, because
            // there the keydown listener and the code servicing this bridge are the same thread.
            // Direct, not a ticket: `askInterrupt` is `fn[i32()]` in `platform.wac`, the same shape as
            // `waitAny` below. Settling a ticket here would answer a `Pending<i32>` the caller never
            // asked for.
            results[0] = Val::I32(0);
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
                (Kind::Socket, Outcome::Socket(h, e, peer, port)) => {
                    make_socket(caller, h, &e, &peer, port)?
                }
                (Kind::Child, Outcome::Child(h, eh, e)) => make_child(caller, h, eh, &e)?,
                // A `Read` has three cases and the outcome says which: bytes are `Data`, no bytes are
                // `End`, and a string is `Failed`. Empty-is-the-end is the queue's own rule — see
                // `streams.rs` — and collapsing it into `Data([])` would tell a reader there was
                // nothing *this time* rather than that there will never be more.
                (Kind::Read, Outcome::Bytes(bytes)) => {
                    if bytes.is_empty() {
                        make_read_end(caller)?
                    } else {
                        make_read_data(caller, &bytes)?
                    }
                }
                (Kind::Read, Outcome::Str(why)) => {
                    make_read_failed(caller, &String::from_utf8_lossy(&why))?
                }
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
    // A spawned child writes to its parent's queues, never to the terminal. **Before** the redirected
    // output below, because a child that was told to write to a file was told so by its own
    // `openOutput` and this is about where its streams go when it was not.
    if let Some(streams) = caller.data().as_child.as_ref() {
        let to = if to_stderr { streams.stderr.clone() } else { streams.stdout.clone() };
        return to.write(bytes);
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

/// The network, refused because the build did not ask for it.
fn denied_net() -> Outcome {
    Outcome::Socket(-1, "network access not granted to this application".into(), String::new(), 0)
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
/// A directory where a file was wanted.
const FAULT_IS_DIR: i32 = 8;
/// A file where a directory was wanted — `a/b/c` with `b` a file.
const FAULT_NOT_A_DIR: i32 = 10;
/// The filesystem will not take a write at all — `EROFS`.
const FAULT_READ_ONLY: i32 = 11;

/// A path as the operating system takes it. Bytes, because a name is bytes (wac-mono 0065).
fn os_path(bytes: &[u8]) -> std::path::PathBuf {
    use std::os::unix::ffi::OsStrExt;
    std::path::PathBuf::from(std::ffi::OsStr::from_bytes(bytes))
}

/// A path, resolved against the innermost `pushChild` frame's directory.
///
/// **This is the frame's whole second job** and it is easy to miss: `platform.wac` says of `pushChild`
/// that between it and `popChild` "every path is taken relative to `cwd`", and answering the frame's
/// directory from `cli.cwd()` alone is not that — it tells a program where it is and then resolves its
/// paths somewhere else.
///
/// The failure it caused is worth recording because it was invisible in the obvious tests. `cat f`
/// worked and `cd sub; cat f` said "No such file or directory", because the shell hands a *relative*
/// path down and expects the capability to resolve it — so every applet reading a named file broke the
/// moment a script changed directory, and every test that did not `cd` passed. It was found by running
/// the shell over the real filesystem against GNU coreutils, which is the only thing that looks at
/// this surface at all.
///
/// An absolute path is left alone: `join` already does that, and saying so here is cheaper than
/// remembering it.
fn resolve(caller: &mut Caller<'_, Host>, path: &[u8]) -> std::path::PathBuf {
    let p = os_path(path);
    if p.is_absolute() {
        return p;
    }
    match caller.data().frames.last() {
        Some(f) if !f.cwd.is_empty() => os_path(&f.cwd).join(p),
        _ if !caller.data().cwd.is_empty() => os_path(&caller.data().cwd).join(p),
        _ => p,
    }
}

/// Which `FAULT_*` an operating-system error is — `host/faults.ts`'s `faultOf`, in Rust.
///
/// **Three kinds, out of the seven the vocabulary has**, until this was written: everything but
/// `NotFound` and `PermissionDenied` arrived as `FAULT_OTHER`, so the program printed whatever
/// `std::io::Error` says instead of the category's words. That is the arrival test failing quietly —
/// design/0001 wants one image to answer the same in two substantially different hosts, and this host
/// said `File exists (os error 17)` where the JavaScript one said `File exists`, for `mkdir` on a
/// directory that is already there. The wac program is identical; only the classification differed.
///
/// The kinds below are all stable in this toolchain. Anything genuinely unrecognised still gets
/// `FAULT_OTHER`, which is what that category is for: the message is then the only information.
fn fault_of(e: &std::io::Error) -> i32 {
    match e.kind() {
        std::io::ErrorKind::NotFound => FAULT_NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => FAULT_DENIED,
        std::io::ErrorKind::AlreadyExists => FAULT_EXISTS,
        std::io::ErrorKind::DirectoryNotEmpty => FAULT_NOT_EMPTY,
        std::io::ErrorKind::IsADirectory => FAULT_IS_DIR,
        std::io::ErrorKind::NotADirectory => FAULT_NOT_A_DIR,
        std::io::ErrorKind::ReadOnlyFilesystem => FAULT_READ_ONLY,
        _ => FAULT_OTHER,
    }
}

/// The fault a failed `stat` should carry — `host/faults.ts`'s `statFault`, in Rust.
///
/// A `stat` that found nothing was *answered*, so absence is `FAULT_NONE` and only the cases where the
/// answer is genuinely unknowable are faults. This host passed `fault_of` straight through, so every
/// failure that was not `NotFound` made `Stat::answered` false — and `test -e f/g` where `f` is a file
/// exited 2 with a diagnostic here while the JavaScript host said plain false, as bash does.
///
/// `FAULT_NOT_A_DIR` rides along without making the `Stat` unanswerable; `platform.wac`'s `Stat.answered`
/// is the half that makes that safe, and `packages/platform/test/faults_agree.test.ts` holds the two
/// hosts' rules side by side.
fn stat_fault(e: &std::io::Error) -> i32 {
    match fault_of(e) {
        FAULT_DENIED => FAULT_DENIED,
        FAULT_NOT_A_DIR => FAULT_NOT_A_DIR,
        _ => FAULT_NONE,
    }
}

/// Open a file for reading, or the `Change` that says why not.
fn open_for_read(caller: &mut Caller<'_, Host>, path: &[u8]) -> Result<std::fs::File, Outcome> {
    if !caller.data().grants.read {
        return Err(Outcome::Change(FAULT_NOT_GRANTED, "this program was not granted reading".into()));
    }
    let here = resolve(caller, path);
    std::fs::File::open(here).map_err(|e| Outcome::Change(fault_of(&e), e.to_string()))
}

// ── Children ──────────────────────────────────────────────────────────────────

/// The child a handle belongs to, or None if it names something else.
fn child_of(caller: &Caller<'_, Host>, handle: i32) -> Option<ChildProc> {
    let table = caller.data().handles.lock().unwrap();
    match table.get(handle)? {
        Handle::Main(c) | Handle::Err(c) => Some(c.clone()),
        Handle::Net(_) => None,
    }
}

/// The stream `recv` reads for this handle: a child's standard output, or its error stream.
fn child_stream(caller: &Caller<'_, Host>, handle: i32) -> Option<Arc<Stream>> {
    let table = caller.data().handles.lock().unwrap();
    match table.get(handle)? {
        Handle::Main(c) => Some(c.stdout.clone()),
        Handle::Err(c) => Some(c.stderr.clone()),
        Handle::Net(_) => None,
    }
}

/// The socket a handle names.
fn socket_at(caller: &Caller<'_, Host>, handle: i32) -> Option<Sock> {
    let table = caller.data().handles.lock().unwrap();
    match table.get(handle)? {
        Handle::Net(s) => Some(s.clone()),
        _ => None,
    }
}

/// Put something in the handle table and answer its handle.
fn keep(caller: &Caller<'_, Host>, what: Handle) -> i32 {
    caller.data().handles.lock().unwrap().push(what)
}

/// Start another instance of this module on its own thread.
fn spawn_instance(
    caller: &mut Caller<'_, Host>,
    argv: Vec<Vec<u8>>,
    want: i32,
    cwd: Vec<u8>,
    inherit_input: bool,
    results: &mut [Val],
) -> Result<(), wasmtime::Error> {
    let Some(world) = caller.data().world.clone() else {
        return settle_now(
            caller,
            Kind::Child,
            Outcome::Child(-2, -2, String::new()),
            results,
        );
    };

    // **A ceiling of the parent's own, intersected here rather than trusted.** `platform.wac`: "a
    // parent built without `--allow-net` cannot hand `GRANT_NET` to anyone; asking is not an error,
    // and the child simply finds the capability denied."
    let mine = &caller.data().grants;
    let grants = manifest::Grants {
        read: mine.read && (want & GRANT_READ) != 0,
        write: mine.write && (want & GRANT_WRITE) != 0,
        env: mine.env && (want & GRANT_ENV) != 0,
        net: mine.net && (want & GRANT_NET) != 0,
    };

    let stdin = Arc::new(Stream::default());
    let stdout = Arc::new(Stream::default());
    let stderr = Arc::new(Stream::default());
    let exit = Arc::new(Exit::default());
    if inherit_input {
        // The child reads the *process's* input rather than what its parent sends, so nothing will
        // arrive on this queue and a reader must not wait for it. Ending it here is what stops a
        // `readChunk` in the child from blocking for ever — the same shape as wac-mono 0110.
        stdin.finish();
    }

    let child = ChildProc {
        stdin: stdin.clone(),
        stdout: stdout.clone(),
        stderr: stderr.clone(),
        exit: exit.clone(),
    };
    let handle = keep(caller, Handle::Main(child.clone()));
    let err_handle = keep(caller, Handle::Err(child));

    let streams = AsChild { stdin, stdout, stderr, inherits: inherit_input };
    std::thread::spawn(move || {
        let code = run_child(world, argv, grants, cwd, streams);
        exit.set(code);
    });

    settle_now(caller, Kind::Child, Outcome::Child(handle, err_handle, String::new()), results)
}

/// `GRANT_*`, matching `platform.wac`.
const GRANT_READ: i32 = 1;
const GRANT_WRITE: i32 = 2;
const GRANT_NET: i32 = 4;
const GRANT_ENV: i32 = 8;

/// A `u8[][]` as a list of byte strings, element by element.
fn read_bytes_array(caller: &mut Caller<'_, Host>, a: &Val) -> Result<Vec<Vec<u8>>, wasmtime::Error> {
    let len_fn = export_func(caller, "$bind$arr_u8Arr_len")?;
    let get = export_func(caller, "$bind$arr_u8Arr_get")?;
    let out = call_dyn(caller, &len_fn, std::slice::from_ref(a))?;
    let n = match out.first() {
        Some(Val::I32(n)) => *n,
        _ => return Err(wasmtime::Error::msg("$bind$arr_u8Arr_len did not answer an i32")),
    };
    let mut items = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let got = call_dyn(caller, &get, &[a.clone(), Val::I32(i)])?;
        let inner = got.into_iter().next().unwrap_or(Val::I32(0));
        items.push(read_u8_array(caller, &inner)?);
    }
    Ok(items)
}

fn make_socket(
    caller: &mut Caller<'_, Host>,
    handle: i32,
    error: &str,
    peer: &str,
    port: i32,
) -> Result<Val, wasmtime::Error> {
    let e = make_string(caller, error.as_bytes())?;
    let p = make_string(caller, peer.as_bytes())?;
    let f = export_func(caller, "$bind$sm_Socket_of")?;
    let built = call_dyn(caller, &f, &[Val::I32(handle), e, p, Val::I32(port)])?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Socket.of answered nothing"))
}

fn make_child(
    caller: &mut Caller<'_, Host>,
    handle: i32,
    err_handle: i32,
    error: &str,
) -> Result<Val, wasmtime::Error> {
    let e = make_string(caller, error.as_bytes())?;
    let f = export_func(caller, "$bind$sm_Child_of")?;
    let built = call_dyn(caller, &f, &[Val::I32(handle), Val::I32(err_handle), e])?;
    built.into_iter().next().ok_or_else(|| wasmtime::Error::msg("Child.of answered nothing"))
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
