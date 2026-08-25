// A wac host on V8, driven from Rust.
//
//   wac <stem>            # runs <stem>.wasm against <stem>.json
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

mod streams;
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
    /// Running a host program — `Cli.exec`. Separate from `spawn`'s authority on purpose: a host
    /// that will start a confined wasm module must be able to refuse a host binary without
    /// refusing both. `issues/system/0165`.
    #[serde(default)]
    run: bool,
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
#[derive(Clone)]
struct ExportSig {
    name: String,
    params: Vec<String>,
    /// What it answers. Read by `wac test`, which only calls an export that returns a `string`.
    #[serde(default)]
    ret: String,
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
    AskInterrupt,
    Spawn,
    SpawnOther,
    ExitCode,
    CloseFeed,
    PushChild,
    PopChild,
    Connect,
    Listen,
    Accept,
    Recv,
    Send,
    CloseSocket,
    CloseSend,
    BindDatagram,
    ReceiveFrom,
    SendTo,
    Rename,
    Remove,
    Mkdir,
    SetExecutable,
    /// `Cli.exec` — a host program, run to completion.
    Exec,
    /// `Cli.load`, `Cli.call`, `Cli.unload` — a module in this isolate. `issues/system/0240c`.
    Load,
    Call,
    Unload,
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
    /// `Pending<Datagram>`, for `receiveFrom`. Registered like any other, and its absence was not an
    /// error until a program asked for one — which is exactly how it went missing.
    ResolveDatagram,
    ResolveRead,
    ResolveBool,
    ResolveCaptured,
    /// `Pending<Exec>` — `Cli.exec`'s answer.
    ResolveExec,
    ResolveChild,
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
        ("Core", "askInterrupt") => Cap::AskInterrupt,
        ("Cli", "spawn") => Cap::SpawnOther,
        ("Cli", "spawnSelf") => Cap::Spawn,
        ("Cli", "exitCode") => Cap::ExitCode,
        ("Cli", "closeFeed") => Cap::CloseFeed,
        ("Cli", "pushChild") => Cap::PushChild,
        ("Cli", "popChild") => Cap::PopChild,
        ("Cli", "connect") => Cap::Connect,
        ("Cli", "listen") => Cap::Listen,
        ("Cli", "accept") => Cap::Accept,
        ("Cli", "recv") => Cap::Recv,
        ("Cli", "send") => Cap::Send,
        ("Cli", "closeSocket") => Cap::CloseSocket,
        ("Cli", "closeSend") => Cap::CloseSend,
        ("Cli", "bindDatagram") => Cap::BindDatagram,
        ("Cli", "receiveFrom") => Cap::ReceiveFrom,
        ("Cli", "sendTo") => Cap::SendTo,
        ("Cli", "rename") => Cap::Rename,
        ("Cli", "remove") => Cap::Remove,
        ("Cli", "mkdir") => Cap::Mkdir,
        ("Cli", "setExecutable") => Cap::SetExecutable,
        ("Cli", "execWith") => Cap::Exec,
        // **Answered, and the answer is "not here".** `issues/system/0240c` gave the JavaScript hosts
        // `load`/`call` in `provider.ts`, where a module can be driven in the caller's own realm
        // against the caller's own bridge. This host builds its world in Rust around one program's
        // thread-local state, so a second module in the same isolate is a real piece of work rather
        // than a wiring change — and until it is done, a program asking gets -2 and can fall through.
        //
        // Mapped rather than left to `Cap::Unsupported`, which *throws*: a capability a host does not
        // have must be a value the caller reads, or `LoadedModule.unavailable()` can never be observed and
        // every portable program dies on the ask instead of taking its other route.
        ("Cli", "load") => Cap::Load,
        ("Cli", "call") => Cap::Call,
        ("Cli", "unload") => Cap::Unload,
        _ => Cap::Unsupported,
    }
}

use streams::Stream;
use tickets::{Answer, ReadAnswer, StatAnswer, Tickets};

/// The `GRANT_*` flags a wac program passes to `spawn`/`spawnSelf`, from `platform.wac`.
///
/// **By name, because the literals were wrong here.** These two sites read `env` from bit 4 and
/// `net` from bit 8, and `platform.wac`, `packages/platform/host/ops.ts`, `packages/wacc/src/
/// manifest.wac` and `native/src/main.rs` all say the opposite — so a child asked for `GRANT_NET`
/// was given `env` instead, and one asked for `GRANT_ENV` got `net`. Bounded by the parent's own
/// grants either way, so it could not exceed them; it was the wrong authority, not more of it.
///
/// It survived because the only test that drives these — `wacland`'s stage 6 — asks with
/// `GRANT_READ`, which is bit 1, and every encoding agrees about bit 1. `issues/system/0168`.
const GRANT_READ: i32 = 1;
const GRANT_WRITE: i32 = 2;
const GRANT_NET: i32 = 4;
const GRANT_ENV: i32 = 8;

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
/// A directory where a file was wanted.
const FAULT_IS_DIR: i32 = 8;
/// A file where a directory was wanted — `a/b/c` with `b` a file.
const FAULT_NOT_A_DIR: i32 = 10;
/// The filesystem will not take a write at all — `EROFS`.
const FAULT_READ_ONLY: i32 = 11;
/// `ENAMETOOLONG`, `ELOOP` and `ENOSPC` — see their `FAULT_*` in platform.wac.
///
/// Matched by **raw errno** rather than by `ErrorKind`, for the reason the wasmtime host gives at the
/// same constants: `InvalidFilename`, `FilesystemLoop` and `StorageFull` are behind an unstable
/// feature. The numbers are Linux's; a platform with different ones falls to `FAULT_OTHER`.
const FAULT_NAME_TOO_LONG: i32 = 12;
const FAULT_LOOP: i32 = 13;
const FAULT_NO_SPACE: i32 = 14;
/// The three a socket needs. Every code above is about a filesystem, and so was `fault_of` —
/// a refused connection, an unreachable host and one that never answered all fell to `FAULT_OTHER`,
/// which is one category for three things a caller acts on differently. `issues/system/0255c`.
const FAULT_REFUSED: i32 = 15;
const FAULT_UNREACHABLE: i32 = 16;
const FAULT_TIMED_OUT: i32 = 17;
const ENAMETOOLONG: i32 = 36;
const ELOOP: i32 = 40;
const ENOSPC: i32 = 28;

/// The `FAULT_*` an `io::Error` carries.
///
/// **This had four arms and the wasmtime host had ten**, so reading a directory on the primary
/// platform answered `FAULT_OTHER` where the second host answered `FAULT_IS_DIR` — a category a
/// caller acts on, arriving as "something went wrong" with the message as the only information. It
/// went unnoticed because the differential that would have shown it,
/// `packages/fs/test/wac/host_test.wac`, ran on the Deno host only until 2026-08-17; the first run
/// of the wac port failed on exactly this line. `issues/system/0132` is the conformance table this
/// belongs in.
/// What the host says went wrong, **without the errno**.
///
/// `std::io::Error`'s own `Display` ends with ` (os error 21)`, and Deno's does not — so the same wac
/// program, built once, said `cat: adir: Is a directory` under one host and
/// `cat: adir: Is a directory (os error 21)` under the other. The applets were changed to stop printing
/// the host's sentence at all (`FAULT_IS_DIR` and its neighbours are the categories that replaced it),
/// and this is the other half: where a message does still reach a program, the two hosts hand over the
/// same one.
///
/// Found by `packages/box/test/wac/operand_errors_test.wac`, which replays 29 invocations in process
/// under the native host against expectations captured from GNU. Fourteen of them differed by exactly
/// this suffix. Nothing had compared the two hosts' *message text* before, because the Deno test that
/// covered these ran the artefact under Deno.
fn message_of(e: &std::io::Error) -> String {
    let text = e.to_string();
    match text.rfind(" (os error ") {
        Some(at) if text.ends_with(')') => text[..at].to_string(),
        _ => text,
    }
}

fn fault_of(e: &std::io::Error) -> i32 {
    match e.kind() {
        std::io::ErrorKind::NotFound => FAULT_NOT_FOUND,
        std::io::ErrorKind::PermissionDenied => FAULT_DENIED,
        std::io::ErrorKind::AlreadyExists => FAULT_EXISTS,
        std::io::ErrorKind::DirectoryNotEmpty => FAULT_NOT_EMPTY,
        std::io::ErrorKind::IsADirectory => FAULT_IS_DIR,
        std::io::ErrorKind::NotADirectory => FAULT_NOT_A_DIR,
        std::io::ErrorKind::ReadOnlyFilesystem => FAULT_READ_ONLY,
        // **The network ones**, which this had none of until 2026-08-25: every socket failure that
        // was not a refused *grant* arrived as `FAULT_OTHER`, so `Socket.fault` could not tell a
        // refusal from a dead route from a silence. `HostUnreachable` and `NetworkUnreachable` are
        // one category here on purpose — "there is nothing at that address" is what a caller does
        // something about, and which layer noticed is not.
        std::io::ErrorKind::ConnectionRefused => FAULT_REFUSED,
        std::io::ErrorKind::HostUnreachable => FAULT_UNREACHABLE,
        std::io::ErrorKind::NetworkUnreachable => FAULT_UNREACHABLE,
        std::io::ErrorKind::TimedOut => FAULT_TIMED_OUT,
        _ => match e.raw_os_error() {
            Some(ENAMETOOLONG) => FAULT_NAME_TOO_LONG,
            Some(ELOOP) => FAULT_LOOP,
            Some(ENOSPC) => FAULT_NO_SPACE,
            _ => FAULT_OTHER,
        },
    }
}

/// One instantiated module: what a dispatcher needs to answer *that module's* capability calls.
///
/// **The reason this is a type at all** — `issues/system/0240c`. A dispatcher is a bare `fn` pointer
/// and finds its context through the `HOST` thread-local, so until `Cli.load` existed there was
/// exactly one module per thread and these three fields could live directly on `HostState`. A loaded
/// module is a second one in the same thread, and its capability calls have to resolve against *its*
/// exports — `write_string` copies into the module's own memory, and the wrong memory is silent
/// corruption rather than an error. So `call` swaps this in and out around the call it makes.
///
/// A child spawned with `Cli.spawn` needs none of this: it gets a thread, and the thread-local with it.
struct ModuleCtx {
    exports: v8::Global<v8::Object>,
    /// `caps[signature][slot]`, the same shape the wasmtime host uses.
    caps: Vec<Vec<Cap>>,
    /// The same table, spelled, for a message that names the capability it could not answer.
    cap_names: Vec<Vec<String>>,
    /// **What this module may do**, swapped with the rest — `issues/system/0242c`.
    ///
    /// Every filesystem, network, environment and `exec` handler already asks `HOST.grants` before it
    /// does anything, so swapping this in for the duration of a call is the whole of narrowing a
    /// loaded module: nothing else had to learn about it. Without it a loaded module ran with the
    /// loader's grants — `wac test --allow-read` handed a test the command's write capability, and a
    /// test wrote a file the run had not granted.
    grants: Grants,
}

/// A module `Cli.load` instantiated, and what is needed to call into it.
struct HeldModule {
    ctx: ModuleCtx,
    /// Its own manifest's export list, so `call` dispatches on the signature the *module* declares
    /// rather than on anything the caller says about it.
    exports: Vec<ExportSig>,
    /// `Core` and `Cli` built for it, in `main`'s order — kept because funcref slots are finite and a
    /// world rebuilt per call fails on the seventeenth. `entry.ts` learnt the same thing about `main`.
    world: Vec<v8::Global<v8::Value>>,
    /// `LoadedModule.of` and `CallResult.of` as *this* module spells them, which is not the loader's spelling:
    /// a monomorphisation binds under a mangled name and only the module is the authority on it.
    loaded_of: Option<String>,
    called_of: Option<String>,
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
    /// A child's two output queues, when this program is one.
    child_out: Option<Arc<Stream>>,
    child_err: Option<Arc<Stream>>,
    /// What a child reads, when its parent gave it something rather than the terminal.
    child_input: Option<Arc<Stream>>,
    inherits: bool,
    /// The directory a child was started in.
    cwd_override: Option<String>,
    /// Which ticket carries each child's exit code, by the handle its parent holds.
    child_exits: HashMap<i32, i32>,
    /// Each child's input queue, so `closeFeed` can end it.
    child_feeds: HashMap<i32, Arc<Stream>>,
    /// **The module's own bytes**, kept so a child can compile them in its own isolate. There is no
    /// way to hand a compiled `WasmModuleObject` across isolates, so the child compiles again.
    wasm: Vec<u8>,
    manifest_text: String,
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
    datagram_of: Option<String>,
    /// `Captured`'s.
    captured_of: Option<String>,
    /// `Exec.of`, for `Cli.exec`'s answer.
    exec_of: Option<String>,
    /// `Child`'s.
    child_of: Option<String>,
    /// `LoadedModule.of` and `CallResult.of`, for `Cli.load` and `Cli.call` — `issues/system/0240c`.
    ///
    /// Cached like the rest, and `None` for a program that never named the type: a module that does
    /// not load anything has no `LoadedModule` class, and building one would be inventing a type it never
    /// declared. That is the same rule `worldFor` reads on the JavaScript side.
    loaded_of: Option<String>,
    called_of: Option<String>,
    /// The modules this program has loaded, by handle. From 1, so a zeroed field names nothing.
    loaded: HashMap<i32, HeldModule>,
    next_loaded: i32,
    /// **The frame stack.** `pushChild` runs an applet *in this program* rather than in a child
    /// process: box's dispatcher re-enters itself, reads the frame's argv, and its output is
    /// collected here instead of reaching a terminal. While a frame is live it is what `argCount`,
    /// `arg`, `cwd`, `write`, `writeErr` and `readChunk` are about.
    frames: Vec<Frame>,
    /// **The open sockets**, by the handle the guest holds. Behind a mutex because `accept` and
    /// `recv` run on worker threads and each needs the listener or stream it was given.
    sockets: Arc<std::sync::Mutex<HashMap<i32, Sock>>>,
    /// **Datagrams that arrived with nobody left to take them**, by socket handle.
    ///
    /// A `receiveFrom` reader runs on a thread, so a caller that gives up — a `waitAny` deadline —
    /// leaves it blocked in `recv_from`. It then takes the *next* datagram, which was nothing to do
    /// with the abandoned call. Discarding it loses a packet the peer will not send again, which is
    /// `issues/system/0207`; this is where it waits for the next reader instead. Cleared with the
    /// socket, since a handle is reused.
    datagrams: Arc<std::sync::Mutex<HashMap<i32, std::collections::VecDeque<Answer>>>>,
    /// Which socket each outstanding `receiveFrom` ticket is reading, so a dropped one knows where
    /// to put back an answer that arrived first.
    receiving: Arc<std::sync::Mutex<HashMap<i32, i32>>>,
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

/// The manifest a module carries in its own `wac.manifest` custom section, if it has one.
///
use wacmanifest::manifest_in;

/// The program built into this binary, when one was: a module carrying its own manifest.
///
/// `None` unless `seed/wacc.wasm` was present at build time — see `build.rs`. With one, this binary
/// is a `wac` command; without, it is the runtime it has always been, and says so rather than
/// pretending.
#[cfg(wac_seed)]
const SEED: Option<&[u8]> = Some(include_bytes!(env!("WAC_SEED_WASM")));
#[cfg(not(wac_seed))]
const SEED: Option<&[u8]> = None;

/// Start V8, once. Both the seeded path and the handed-a-module path go through here.
/// Start V8, once per process however many times this is called.
///
/// V8 refuses a second `initialize` with *Invalid global state*, and the callers below were
/// written when exactly one program ran per process. `wac test` over a directory builds and
/// instantiates one module per file, so the second file panicked before this guard.
fn start_v8() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| {
        let platform = v8::new_default_platform(0, false).make_shared();
        v8::V8::initialize_platform(platform);
        v8::V8::initialize();
    });
}

/// Run the built-in program with these arguments.
///
/// The arguments are passed rather than read from the environment: `run` takes `skip(2)` because the
/// module path is `argv[1]`, and here there is no module path — `wac compile x.wac` means the
/// compiler's own `argv` starts at 1. Handing an argument list in is also what makes this the same
/// call a child makes, which is why there is one body below rather than two.
/// V8 is started by the caller: `run` starts it once and then runs *two* programs on it, and
/// `initialize_platform` twice in a process is not a thing that recovers.
fn run_seed(args: &[String]) -> i32 {
    let mut as_child = AsChild::default();
    let wasm = SEED.expect("a seed");
    let Some(text) = manifest_in(wasm) else {
        eprintln!("wac: the built-in program carries no wac.manifest section — build the seed with packages/platform/native.ts");
        return 1;
    };
    let manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: the built-in manifest is not one — {e}");
            return 1;
        }
    };
    as_child.argv = args.iter().map(|a| a.as_bytes().to_vec()).collect();
    run_as_with(&manifest, wasm, &text, as_child)
}


/// `wac run [--allow-…] <entry.wac> [args…]` — compile a program and run it, with no file in between.
///
/// Two programs on one V8: the compiler inside this binary builds the entry into a temporary
/// artefact, and then this host runs *that* the way it runs any program handed to it. The state a
/// run keeps is replaced wholesale at the start of each, so the second is not living in the first's
/// world.
///
/// **The grants are the ones on this command line**, and they reach the program the only way they
/// can: as the grants baked into the artefact the compiler is asked to write. A flag after the entry
/// belongs to the program rather than to the build, which is why the scan stops there — `wac run
/// --allow-read prog.wac --allow-read` runs a program that may read and is passed the string.
fn run_command(rest: &[String]) -> i32 {
    build_and_call(rest, Entry::Main)
}

/// `wac test [--allow-…] <file.wac>` — compile a file of wac tests and run them.
/// Every `*_test.wac` under `dir`, sorted, so a run is the same twice.
///
/// **By name, not by directory.** A `test/` folder holds probes and fixtures as well as tests —
/// 56 of this repository's 140 files under `test/wac` export nothing runnable and exist to be
/// driven from a host — so walking directories would report each of them as an error. The suffix
/// is exact where it matters: 83 files here export a `test*` and end in `_test.wac`, and the one
/// that does not is `wactest`'s own fixture, which fails on purpose and must stay out of a suite.
fn collect_tests(dir: &std::path::Path, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut names: Vec<_> = entries.filter_map(|e| e.ok()).map(|e| e.path()).collect();
    names.sort();
    for p in names {
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        // Nothing anybody wants compiled, and `target` in particular is enormous.
        if p.is_dir() {
            if !name.starts_with('.') && name != "node_modules" && name != "target" {
                collect_tests(&p, out);
            }
        } else if name.ends_with("_test.wac") {
            out.push(p.display().to_string());
        }
    }
}

/// The `test*` exports a file declares, as `(name, params)`.
///
/// A scan rather than a compile, because this runs *before* anything is built — it is what decides
/// what the aggregate below imports. The shape it looks for is the one `run_tests` will accept:
/// `export string test…(…)`. A parameter list may span lines, so it is read to the first `)`; that is
/// safe because the only types a wac test signature ever carries are `Core` and `Cli`, measured
/// across all 1 960 of them.
fn test_exports_of(path: &str) -> Vec<(String, String)> {
    let Ok(src) = std::fs::read_to_string(path) else { return Vec::new() };
    let mut out = Vec::new();
    for (at, _) in src.match_indices("export string test") {
        // Only at the start of a line — the same words inside a comment or a doc block are prose.
        if src[..at].chars().rev().take_while(|c| *c != '\n').any(|c| !c.is_whitespace()) {
            continue;
        }
        let rest = &src[at + "export string ".len()..];
        let Some(open) = rest.find('(') else { continue };
        let name = rest[..open].trim();
        if !name.chars().all(|c| c.is_alphanumeric() || c == '_') {
            continue;
        }
        let Some(close) = rest[open..].find(')') else { continue };
        out.push((name.to_string(), rest[open + 1..open + close].to_string()));
    }
    out
}

/// One entry that imports every test file and re-exports its tests, for a single build.
///
/// **`issues/system/0192`.** A build per test file recompiles the same import graph once per file:
/// `packages/box`'s sixteen files took 40.9s as sixteen builds and 11.1s as one, and the difference is
/// entirely compilation — the assertions in them total under two seconds.
///
/// Three details each cost a wrong first attempt:
///
///   * **the alias must differ from the wrapper's name**, or the wrapper calls itself and the test
///     recurses until the stack goes;
///   * **the suffix goes on the end**, because `run_tests` recognises a test that wants a trap by
///     `starts_with("test_traps_")` and `--filter` matches a substring of the name a person typed;
///   * **`Core` and `Cli` have to be imported here**, since the wrappers name them in their own
///     signatures. Nothing else appears in a test signature anywhere in the repository.
///
/// Sharing one module across files is safe because wac has no module-level variables: a trap unwinds
/// the call and leaves nothing behind, which is the same reason `test_traps_*` has always been able to
/// run beside its neighbours.
/// Every `.wac` file the aggregate reaches, with its bytes — the input a compile of it actually has —
/// and **whether that is all of them**.
///
/// A plain scan for `from "…"`, resolved against the importing file's directory, followed
/// transitively. That is exactly what the compiler does with a *file* import; a builtin — `from core`
/// — has no path and lives in the seed, which the key below covers separately. There are no
/// conditional imports in wac, so a scan and a compile see the same set of *file* imports.
///
/// ## The second return value, and why a silent drop was a correctness bug
///
/// Not every specifier is a path relative to the importing file. `dep/lib.wac` under a `wac.json5`
/// mapping lives in `$WAC_HOME/cache/git/…`, and `@/x.wac` is relative to the dependency's own root.
/// This scan joins both to the importing file's directory, gets a path that does not exist, and until
/// 2026-08-20 simply `continue`d — so those files were **absent from the cache key while the key went
/// on being used**, which is the one thing a content-addressed cache may not do.
///
/// What that cost: `packages/wacc/test/wac/mappedspec_test.wac` builds a mapped dependency that tries
/// to import outside its `subdir`, and asserts the compiler refuses. Its own last case then compiles a
/// legitimate entry of *identical bytes* and caches the module that entry produces. Every later run
/// took the escape case straight out of the cache — no compile, so no refusal, and the program ran.
/// The test was green on a clean `/tmp` and red on every run after, which is how it passed review and
/// then failed for somebody else the same evening. `issues/system/0219`.
///
/// So an import that names a `.wac` this cannot read makes the closure **incomplete**, and an
/// incomplete closure is not cacheable at all — the callers pass `None` as the key rather than a key
/// that stands for less than it claims. `std/…` is the exception and not a hole: it is the embedded
/// tree, there is no file to read and none is expected, and `test_module_key` already hashes the seed
/// that carries it.
fn closure_of(entry: &std::path::Path) -> (Vec<(String, Vec<u8>)>, bool) {
    let mut out: Vec<(String, Vec<u8>)> = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    let mut whole = true;
    let mut queue = vec![entry.to_path_buf()];
    while let Some(at) = queue.pop() {
        let Ok(text) = std::fs::read(&at) else {
            whole = false;
            continue;
        };
        let name = at.display().to_string();
        if !seen.insert(name.clone()) {
            continue;
        }
        let dir = at.parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
        let src = String::from_utf8_lossy(&text);
        let mut rest = src.as_ref();
        while let Some(from) = rest.find("from") {
            rest = &rest[from + 4..];
            let Some(open) = rest.find('"') else { break };
            let after = &rest[open + 1..];
            let Some(close) = after.find('"') else { break };
            let spec = &after[..close];
            rest = &after[close + 1..];
            if !spec.ends_with(".wac") {
                continue;
            }
            // The embedded trees. Joining one to the importing directory would name a file that has
            // never existed, and treating that as a hole would make every program in the repository
            // uncacheable — almost all of them import `std/platform.wac`.
            //
            // **`core/` as well as `std/`, and leaving it out made the cache cover nothing.** They are
            // the same kind of thing — `tools/genCore.ts` generates both into `coretext.wac`, and
            // `isBuiltinSpec` answers for both — but only `std/` was skipped here. So a file importing
            // `core/option.wac` sent the scan looking for `packages/<pkg>/src/core/option.wac`, which
            // has never existed, `whole` went false, and the caller passed `None` as the key. 75 files
            // in this repository import a `core/…` specifier, so the directories that missed were most
            // of them: `packages/json`, `url`, `fmt` and `bytes` each wrote no cache entry at all for a
            // perturbed source, and a cold run and a warm one timed the same because both compiled.
            // `issues/system/0204`.
            if spec.starts_with("std/") || spec.starts_with("core/") {
                continue;
            }
            // Normalised here rather than by `canonicalize`, which would follow symlinks and answer a
            // different name for the same file depending on where the suite was started.
            let joined = dir.join(spec);
            let whole = joined.to_string_lossy().into_owned();
            let mut parts: Vec<&str> = Vec::new();
            for part in whole.split('/') {
                match part {
                    "." | "" => {}
                    ".." => {
                        parts.pop();
                    }
                    p => parts.push(p),
                }
            }
            queue.push(std::path::PathBuf::from(parts.join("/")));
        }
        out.push((name, text));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    (out, whole)
}

/// The name a built aggregate is cached under: everything a compile of it reads, and what compiled it.
///
/// The sources are keyed by *content*, because that is what a compile depends on — an mtime says a
/// file was touched, which is not the same question. The seed is in there because it is the compiler,
/// and the binary's own version because the manifest shape is its. Grants and `--coverage` are in
/// there because they change what is emitted.
fn test_module_key(entry: &str, sources: &[(String, Vec<u8>)], flags: &[String], coverage: bool) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    };
    eat(b"wac-test-module 1");
    // **The aggregate by its content, never by its name.** Its path carries this process's pid —
    // `.cache/wac-aggregate-<pid>-<n>_test.wac` — so hashing the name made every run a fresh key and
    // the cache a write-only directory. It cost one round of "faster, and three new entries a run" to
    // notice, which is what a hit rate would have said immediately.
    for (name, bytes) in sources {
        if name == entry {
            eat(bytes);
            continue;
        }
        eat(name.as_bytes());
        eat(bytes);
    }
    for f in flags {
        eat(f.as_bytes());
    }
    eat(if coverage { b"coverage" } else { b"plain" });
    eat(env!("CARGO_PKG_VERSION").as_bytes());
    eat(SEED.unwrap_or(&[]));
    h
}

/// This process's CPU time so far, self plus every child it has waited for, in milliseconds.
///
/// **Wall time ranks by whoever else was running.** `wac test` reports what each file cost so that "no
/// slow tests" has a ranking, and the suite runs four of these at once on a machine three agents share
/// — so the wall time of a process-heavy file is two to eight times its work, unevenly, and the
/// ranking it produces is a ranking of contention. Measured 2026-08-19: the suite's own per-file
/// numbers summed to **456s against a 219s wall**, and `native_hostfs_test.wac` was reported at 60.2s
/// where a directory pass puts its run at 7.7s. Two days of "why is this test slow" went to the top of
/// that list.
///
/// CPU time does not move when a neighbour runs. `cutime`/`cstime` cover children this process has
/// reaped, which is every `Cli.exec` — they wait — so a test that spends its time in `ssh` or `deno` is
/// still counted. Read from `/proc/self/stat` rather than through a crate: fields 14-17, after the
/// comm field, which can itself contain spaces and is therefore skipped by its closing parenthesis.
///
/// **A child's CPU is charged when it is *reaped*, not while it runs**, and that is why the two halves
/// are reported apart. A test that leaves a daemon running — `echod_test.wac` starts Deno peers — hands
/// its CPU to whichever file happens to reap it, and the suite duly charged 49.1s to
/// `v8host_test.wac`, the last file of that chunk, which costs 1.6s when run on its own. Split, that
/// reads as "0.4s here and 48.7s in children" and the reader can see it is not v8host's.
///
/// It is also worth knowing what this does *not* fix: it says nothing about **waiting**. Four copies of
/// one chunk put `echod_test.wac` at 2.0-5.4s of CPU against 33.6-97.5s of wall, all of it blocked on a
/// port — no swapping, ten major faults in the whole run. That is why wall is printed beside it rather
/// than dropped.
fn cpu_millis() -> (u128, u128) {
    let Ok(text) = std::fs::read_to_string("/proc/self/stat") else { return (0, 0) };
    let Some(after) = text.rsplit_once(')') else { return (0, 0) };
    let fields: Vec<&str> = after.1.split_whitespace().collect();
    // `after.1` starts at field 3 (state), so utime is index 11 and cstime index 14.
    let at = |i: usize| fields.get(i).and_then(|f| f.parse::<u64>().ok()).unwrap_or(0);
    // `sysconf(_SC_CLK_TCK)` is 100 on every Linux this runs on, and getting it right matters less
    // than being consistent: the number is only ever compared with another from the same machine.
    ((at(11) + at(12)) as u128 * 10, (at(13) + at(14)) as u128 * 10)
}

/// How many built modules the shared directory keeps.
///
/// Sixty was chosen when only directory aggregates landed here — about fifty-one chunks in a suite
/// pass. Single files now key into the same directory, and there are ninety-odd `*_test.wac` in the
/// tree plus whatever `wac run` builds, so sixty evicted the thing about to be asked for. **Measured
/// on 2026-08-19: sixty entries were 30 MB**, half a megabyte each, so two hundred is about 100 MB of
/// a filesystem with seventeen free — and `issues/system/0136`, the day the disk filled, is the reason
/// this is a number with a measurement beside it rather than "plenty".
const KEEP_MODULES: usize = 200;

/// A built aggregate from the cache, or `None`.
///
/// **Why this exists.** `wac test <dir>` compiles the directory's aggregate every run, and for a small
/// directory that is most of the cost: measured 2026-08-19, `packages/url/test/wac` is 674ms of compile
/// in an 887ms run, `packages/json` 934ms of 1426ms, `packages/fmt` 686ms of 1631ms. Fifty-one chunks
/// of that is tens of seconds of the suite and it is the whole of an agent's re-run of one directory.
/// `issues/system/0204`.
///
/// The artefact is the wasm; the manifest is read back out of it exactly as after a fresh build, so a
/// hit and a miss answer the same four things.
/// Where built aggregates are remembered.
///
/// `$WAC_TESTMOD_DIR` overrides it, which is the only way to *test* the cache: its behaviour is
/// visible solely as entries appearing in a directory, and the default one is shared by every agent on
/// the box — so a test asserting "an entry appeared" against `/tmp/wac-testmod` would be asserting
/// something about the other agents' runs as much as its own. `issues/system/0204`.
fn testmod_dir() -> std::path::PathBuf {
    match std::env::var_os("WAC_TESTMOD_DIR") {
        Some(d) if !d.is_empty() => std::path::PathBuf::from(d),
        _ => std::env::temp_dir().join("wac-testmod"),
    }
}

fn cached_module(key: u64) -> Option<Vec<u8>> {
    let path = testmod_dir().join(format!("{key:016x}.wasm"));
    let bytes = std::fs::read(&path).ok()?;
    // Touched so that sweeping drops what is genuinely unused rather than what was built first.
    let now = std::time::SystemTime::now();
    let _ = filetime_set(&path, now);
    Some(bytes)
}

/// Remember a built aggregate, and bound the directory.
fn remember_module(key: u64, wasm: &[u8]) {
    let dir = testmod_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join(format!("{key:016x}.wasm"));
    let tmp = dir.join(format!("{key:016x}.{}.tmp", std::process::id()));
    if std::fs::write(&tmp, wasm).is_ok() && std::fs::rename(&tmp, &path).is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    sweep_modules(&dir);
}

/// Keep the newest `KEEP_MODULES` and remove the rest — the same rule, and the same reason, as the
/// compiled-artefact sweep above: nothing else would ever bound this.
fn sweep_modules(dir: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let mut found: Vec<(std::time::SystemTime, std::path::PathBuf)> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().is_some_and(|x| x == "wasm"))
        .filter_map(|e| e.metadata().ok().and_then(|m| m.modified().ok()).map(|t| (t, e.path())))
        .collect();
    if found.len() <= KEEP_MODULES {
        return;
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in found.into_iter().skip(KEEP_MODULES) {
        let _ = std::fs::remove_file(path);
    }
}

/// `utimes` on a path, so a cache hit counts as use. Best effort: a failure only affects sweeping.
fn filetime_set(path: &std::path::Path, when: std::time::SystemTime) -> std::io::Result<()> {
    let f = std::fs::OpenOptions::new().append(true).open(path)?;
    f.set_modified(when)?;
    Ok(())
}

fn write_aggregate(
    files: &[String],
    which: &[usize],
    to: &std::path::Path,
) -> Option<(String, Vec<usize>)> {
    let up = "../".repeat(to.parent()?.components().count());
    let mut imports = vec![format!(
        "import {{ Cli, Core }} from \"std/platform.wac\";"
    )];
    let mut wrappers = Vec::new();
    // Which files ended up in it, by index into `files`: one with no tests contributes nothing, and
    // the suffixes have to keep pointing at the right path.
    let mut carried = Vec::new();
    for &i in which {
        let f = &files[i];
        let tests = test_exports_of(f);
        if tests.is_empty() {
            continue;
        }
        let aliased: Vec<String> = tests
            .iter()
            .map(|(n, _)| format!("{n} as impl{i}_{n}"))
            .collect();
        imports.push(format!("import {{ {} }} from \"{up}{f}\";", aliased.join(", ")));
        for (n, params) in &tests {
            let ps = params.trim();
            let args: Vec<&str> = if ps.is_empty() {
                Vec::new()
            } else {
                ps.split(',').filter_map(|p| p.trim().split_whitespace().last()).collect()
            };
            wrappers.push(format!(
                "export string {n}__f{i}({ps}) {{ return impl{i}_{n}({}); }}",
                args.join(", ")
            ));
        }
        carried.push(i);
    }
    if wrappers.is_empty() {
        return None;
    }
    let source = format!("{}\n\n{}\n", imports.join("\n"), wrappers.join("\n"));
    std::fs::create_dir_all(to.parent()?).ok()?;
    std::fs::write(to, &source).ok()?;
    Some((to.display().to_string(), carried))
}

/// Compile `entry` once, and hand back the module, its manifest text and the parsed manifest.
///
/// The build half of `build_and_call`, extracted so a caller can run one module more than once —
/// `issues/system/0192`, where a directory of test files becomes one build and one instantiation per
/// file rather than one build *and* one instantiation per file.
///
/// The coverage table comes back with it, because the counters live in the instance and the table is
/// written beside the module: reading it after the run has returned finds nothing.
fn build_module(
    flags: &[String],
    entry: &str,
    coverage: bool,
) -> Result<(Vec<u8>, String, Manifest, Option<String>), i32> {
    sweep_stale_runs();
    let dir = std::env::temp_dir().join(format!("wac-build-{}", std::process::id()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("wac: cannot make a working directory — {e}");
        return Err(1);
    }
    let stem = dir.join("prog");
    let mut build = vec![
        "build".to_string(),
        entry.to_string(),
        "-o".to_string(),
        stem.display().to_string(),
        "--quiet".to_string(),
    ];
    if coverage {
        build.push("--coverage".to_string());
    }
    build.extend(flags.iter().cloned());
    start_v8();
    let built = run_seed(&build);
    if built != 0 {
        let _ = std::fs::remove_dir_all(&dir);
        return Err(built);
    }
    let out = match std::fs::read(dir.join("prog.wasm")) {
        Err(e) => {
            eprintln!("wac: the build wrote nothing to run — {e}");
            let _ = std::fs::remove_dir_all(&dir);
            return Err(1);
        }
        Ok(bytes) => bytes,
    };
    let Some(text) = manifest_in(&out) else {
        eprintln!("wac: the module just built describes itself wrongly");
        let _ = std::fs::remove_dir_all(&dir);
        return Err(1);
    };
    let Ok(manifest) = serde_json::from_str::<Manifest>(&text) else {
        eprintln!("wac: the module just built describes itself wrongly");
        let _ = std::fs::remove_dir_all(&dir);
        return Err(1);
    };
    let cov = if coverage { std::fs::read_to_string(dir.join("prog.cov")).ok() } else { None };
    let _ = std::fs::remove_dir_all(&dir);
    Ok((out, text, manifest, cov))
}

fn test_command(rest: &[String]) -> i32 {
    // The flags are read here as well as in `build_and_call`, because discovery has to happen
    // before any build and the target may be absent entirely — `wac test` with no argument is the
    // thing a person types first.
    let mut i = 0;
    while i < rest.len()
        && (rest[i].starts_with("--allow-")
            || rest[i] == "--coverage"
            || rest[i] == "--verbose"
            || rest[i] == "--ignore"
            || rest[i] == "--filter")
    {
        // `--filter` and `--ignore` carry a value, so stepping one at a time would leave the
        // pattern looking like the path and send a directory to the compiler.
        if rest[i] == "--filter" || rest[i] == "--ignore" {
            i += 1;
        }
        i += 1;
    }
    let mut flags: Vec<String> = rest[..i].to_vec();
    // **A flag after the path is a flag, not a target.** Reading flags only up to the first argument
    // that is not one made `wac test packages/fs/ --allow-write` count `--allow-write` as a file — one
    // that does not exist, so one that "did not run" — and printed a phantom entry in the summary that
    // reads as a failing test, with the grant silently absent from the run that did happen. Neither
    // half says "the flag is in the wrong place", and every other tool here takes them in any position.
    // `tools/wac/testcli_test.wac`.
    let mut targets: Vec<String> = Vec::new();
    let mut j = i;
    while j < rest.len() {
        if rest[j].starts_with('-') {
            flags.push(rest[j].clone());
            // `--filter` carries a value, and moving the flag without it leaves the pattern looking
            // like a second directory — which discovery then reports as a file that did not run.
            if (rest[j] == "--filter" || rest[j] == "--ignore") && j + 1 < rest.len() {
                j += 1;
                flags.push(rest[j].clone());
            }
        } else {
            targets.push(rest[j].clone());
        }
        j += 1;
    }
    let filter_used = flags
        .iter()
        .position(|f| f == "--filter")
        .and_then(|k| flags.get(k + 1))
        .cloned();
    // **`--ignore` is discovery's, and does not reach the build.** It answers "which of the files
    // under this directory are not this run's", which is a question about the walk; `--filter` is
    // per-file and does reach it. Passing this one through would have the compiler read a
    // comma-separated list as an entry path.
    let ignored: Vec<String> = flags
        .iter()
        .position(|f| f == "--ignore")
        .and_then(|k| flags.get(k + 1))
        .map(|v| v.split(',').map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect())
        .unwrap_or_default();
    if let Some(k) = flags.iter().position(|f| f == "--ignore") {
        flags.drain(k..=(k + 1).min(flags.len() - 1));
    }
    // **No `./` stripping here any more.** It was a workaround for `issues/lang/0134` — a leading
    // dot-slash reached the compiler's import resolver and came back as "an import of a file that
    // was not supplied" — and the compiler normalises its entry now, so the path is passed as the
    // caller spelled it.
    // **Every remaining argument, not one.** A caller with a set of files — `tools/mutate.ts`
    // hands over the tests a mutant could possibly have broken — would otherwise invoke this once
    // per file and add up the answers itself, which is the runner's job and not theirs.
    if targets.is_empty() {
        targets.push(".".to_string());
    }
    let target = targets.join(", ");

    if targets.len() == 1 && !std::path::Path::new(&targets[0]).is_dir() {
        // **`--ignore` applies here too.** This path skips the walk, so the filter below never sees
        // it, and `wac test --ignore a.wac a.wac` ran the file — the code disagreeing with its own
        // comment one screen down. A caller assembling both lists from the same source must not get
        // a different answer for naming one file than for naming its directory.
        if ignored.iter().any(|ig| &targets[0] == ig) {
            println!("0 files: 0 ok, 1 not run (--ignore)");
            return 0;
        }
        // Rebuilt rather than passed through as `rest`, so a flag written after the path reaches the
        // build in the position it expects.
        let mut one = flags.clone();
        one.push(targets[0].clone());
        let code = build_and_call(&one, Entry::Tests);
        // You named this file and asked for a test it does not have. During a directory walk the
        // same answer is ordinary; here it is a typo, and exiting 0 would hide it.
        return if code == 5 { 1 } else { code };
    }

    let mut files = Vec::new();
    for t in &targets {
        let path = std::path::Path::new(t);
        if path.is_dir() {
            collect_tests(path, &mut files);
        } else {
            // Named directly, so it runs whether or not it is called `*_test.wac` — discovery's
            // naming rule is for finding files, not for refusing the one you pointed at.
            files.push(t.clone());
        }
    }
    files.dedup();
    // **Applied after the walk, and to a named file too.** A path given directly is normally run
    // whatever it is called, but a caller assembling both lists — `tools/runTests.wac` names the
    // packages and the lane in one command — means the two must not contradict each other. The
    // match is a prefix, as `deno test --ignore` is, so a directory excludes what is under it.
    let before = files.len();
    if !ignored.is_empty() {
        files.retain(|f| !ignored.iter().any(|ig| f == ig || f.starts_with(&format!("{ig}/"))));
    }
    let skipped_by_ignore = before - files.len();
    if files.is_empty() {
        // **Said differently when `--ignore` is what emptied it.** "No tests under packages/" is a
        // wrong answer when there were some and this run excluded every one, and it sends the
        // reader to look for a naming mistake that is not there.
        if skipped_by_ignore > 0 {
            eprintln!(
                "wac: --ignore excluded all {skipped_by_ignore} test file(s) under {target}"
            );
        } else {
            eprintln!(
                "wac: no tests under {target} — a test file is named `*_test.wac` and exports \
                 `test*()` answering a string, empty for a pass"
            );
        }
        return 1;
    }
    if files.len() == 1 {
        let mut args = flags;
        args.push(files.remove(0));
        let code = build_and_call(&args, Entry::Tests);
        // **A walk that found one file still says how many it found.** The summary below is printed for
        // two files and was not printed for one — and a caller counting files across many walks then
        // loses the single-file ones silently. `tools/runTests.wac` runs this lane as a queue of
        // directories and adds the counts up; five of the thirty-eight hold one file, so its own total
        // could say it was short without being able to say by how much.
        //
        // Reached only when the target was a *directory*: naming a file gets the plain run, one screen
        // up, and no summary — which is what a person typing one file wants.
        println!(
            "1 file: {}",
            match code {
                0 => "1 ok",
                3 => "0 ok, 1 with failures",
                4 => "0 ok, 1 needing a host oracle",
                5 => "0 ok, 1 passed over by --filter",
                _ => "0 ok, 1 that did not run",
            }
        );
        return code;
    }

    // **One build for the whole walk, and one instantiation per file** — `issues/system/0192`.
    //
    // It used to be a build *and* an instantiation each, and the build is what costs: `packages/box`'s
    // sixteen files took 40.9s that way and 11.1s as one build, with the assertions in them totalling
    // under two seconds. Every file in a directory imports very nearly the same graph, so compiling
    // once and instantiating per file pays for the graph once and keeps everything the per-file shape
    // was for — a trap unwinds one instance, a failing file is named on its own line, and the summary
    // still counts files.
    //
    // **Instantiating per file rather than running the lot in one instance** is deliberate: it is what
    // keeps a file's tests from seeing anything an earlier file left behind, which is the property the
    // old shape had for free and the one a reader assumes.
    //
    // `--coverage` keeps the old path. Its counters are per module and the table is written beside it,
    // so one aggregate would report one file's worth of positions for all of them.
    let mut grants: Vec<String> = Vec::new();
    let mut coverage = false;
    let mut loud = false;
    let mut only: Option<String> = None;
    let mut flag_iter = flags.iter();
    while let Some(a) = flag_iter.next() {
        match a.as_str() {
            "--coverage" => coverage = true,
            "--verbose" => loud = true,
            // The value travels with it, and taking the flag without the value would leave the
            // pattern looking like a grant.
            "--filter" => only = flag_iter.next().cloned(),
            _ => grants.push(a.clone()),
        }
    }
    // **One aggregate per directory, not one for the walk.** The first version built a single module
    // for everything `wac test packages/` found, and that is the wrong unit: the build is shared, but
    // then every one of 294 files instantiates a module containing the whole repository. Measured, it
    // took the lane from about ten minutes to 409s, where a directory-sized module takes `packages/box`
    // from 40.9s to 11.3s — the same 3.6× the whole walk did not get. A module is cheap to instantiate
    // in proportion to its size, so the group has to be small enough that its files share a graph.
    let mut groups: Vec<(std::path::PathBuf, Vec<usize>)> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        let dir = std::path::Path::new(f).parent().unwrap_or(std::path::Path::new(".")).to_path_buf();
        match groups.iter_mut().find(|(d, _)| *d == dir) {
            Some((_, members)) => members.push(i),
            None => groups.push((dir, vec![i])),
        }
    }
    // Which group each file belongs to, and the module for each group once it is built.
    let mut group_of: Vec<usize> = vec![0; files.len()];
    for (g, (_, members)) in groups.iter().enumerate() {
        for &i in members {
            group_of[i] = g;
        }
    }
    let mut built: Vec<Option<((Vec<u8>, String, Manifest, Option<String>), Vec<usize>)>> = Vec::new();
    for (g, (_, members)) in groups.iter().enumerate() {
        if coverage || members.len() < 2 {
            // A lone file has nothing to share a build with, and `--coverage` keeps the old path: its
            // counters are per module and the table is written beside it, so one aggregate would
            // report one file's positions for all of them.
            built.push(None);
            continue;
        }
        let at = std::path::Path::new(".cache")
            .join(format!("wac-aggregate-{}-{g}_test.wac", std::process::id()));
        let made = write_aggregate(&files, members, &at).and_then(|(agg, carried)| {
            // **The same aggregate, compiled once across runs.** `issues/system/0204`: this file is
            // written and compiled on every `wac test`, and for a small directory that is most of the
            // cost — `packages/url/test/wac` was 674ms of compile in an 887ms run. The key is the
            // aggregate's text, the content of every `.wac` it reaches, the grants, and the seed that
            // would compile it, so a hit is the same bytes a fresh build would have produced.
            let (sources, whole) = closure_of(std::path::Path::new(&agg));
            // `None` when the scan could not read something an import named: see `closure_of`. A
            // directory of tests that reaches a mapped dependency compiles every run, which is the
            // cost of the cache being honest about what it covers.
            let key = whole.then(|| test_module_key(&agg, &sources, &grants, false));
            let m = match key.and_then(cached_module) {
                // **V8 is started here as well, because the fresh path starts it inside
                // `build_module`.** Without this a hit panicked with "Invalid global state" the moment
                // it tried to *run* what it had not compiled — and it looked like a 4ms directory with
                // no failures, which is what a run that never happened looks like from the outside.
                Some(wasm) => {
                    start_v8();
                    manifest_in(&wasm)
                        .and_then(|text| {
                            serde_json::from_str::<Manifest>(&text)
                                .ok()
                                .map(|man| (wasm.clone(), text, man, None))
                        })
                }
                None => {
                    let fresh = build_module(&grants, &agg, false).ok();
                    if let (Some(k), Some((wasm, _, _, _))) = (key, fresh.as_ref()) {
                        remember_module(k, wasm);
                    }
                    fresh
                }
            };
            // **A failed aggregate says so.** Falling back to a build per file is the right answer — the
            // tests still run, and one directory's shared build is an optimisation rather than a
            // promise — but doing it silently turns a broken aggregate into a directory that is
            // mysteriously four times slower, with nothing naming the cause. That is the shape this
            // whole area keeps producing: `issues/lang/0154` was found because its aggregate failed
            // *loudly*, and `issues/lang/0155`'s fix turned the same defect into this quiet path.
            if m.is_none() {
                eprintln!(
                    "wac: the shared build for {} did not build, so its {} files are being built one at \
                     a time — slower, and the reason is above",
                    members
                        .first()
                        .and_then(|&i| files[i].rsplit_once('/').map(|(d, _)| d.to_string()))
                        .unwrap_or_else(|| "this group".to_string()),
                    members.len()
                );
            }
            // **`WAC_KEEP_AGGREGATE=1` keeps a copy**, because a bug in the aggregate is otherwise
            // impossible to look at: the file the compiler saw is gone by the time anything fails, and
            // reconstructing it by hand is a second implementation of `write_aggregate`.
            // `issues/lang/0154` is the bug that wanted it — a struct name declared three times in one
            // link makes the emit answer with the wasm header and nothing else, with nothing declined —
            // and the next step on it is this file, which is the input that does it.
            //
            // The copy is `.kept.wac`, not `_test.wac`: the walk collects the latter, so a kept
            // aggregate under `.cache` would otherwise be read as a test file of its own on the next
            // run — which is what the removal below is for.
            if matches!(std::env::var("WAC_KEEP_AGGREGATE").as_deref(), Ok("1")) {
                let kept = std::path::Path::new(".cache")
                    .join(format!("wac-aggregate-{}-{g}.kept.wac", std::process::id()));
                match std::fs::copy(&at, &kept) {
                    Ok(_) => eprintln!("wac: kept the generated aggregate at {}", kept.display()),
                    Err(e) => eprintln!("wac: could not keep the aggregate — {}", message_of(&e)),
                }
            }
            // **Removed whether or not it built.** A generated file left in `.cache` is read by the
            // next `wac test packages/` as a test file of its own, and then imports every test under
            // it into a run that asked for one directory.
            let _ = std::fs::remove_file(&at);
            m.map(|m| (m, carried))
        });
        built.push(made);
    }
    let mut ok = 0;
    let mut bad = 0;
    let mut broken = 0;
    let mut skipped = 0;
    let mut filtered_files = 0;
    // The files worth going back to. Over eighty files a failure has scrolled off the top long
    // before the summary, and "2 with failures" without saying which is a number you cannot act
    // on without running the whole thing again.
    let mut names: Vec<(String, &str)> = Vec::new();
    // **What each file cost to run, because "no slow tests" needs a ranking.** The aggregate is built
    // before this loop, so these are run times with no compile in them — which is the number to act
    // on: a file that is slow because the directory's graph is large is not the file's fault, and a
    // file that is slow because it emits a thousand modules is.
    //
    // **Ranked by CPU rather than by wall**, for the reason `cpu_millis` carries: four of these run at
    // once and the wall time of a process-heavy file is mostly its neighbours. Both are printed, since
    // wall is what a person waited and CPU is what the file is answerable for.
    let mut cost: Vec<(String, u128, u128, u128)> = Vec::new();
    for (i, f) in files.iter().enumerate() {
        println!("── {f}");
        let began = std::time::Instant::now();
        let (self_began, child_began) = cpu_millis();
        let code = match &built[group_of[i]] {
            Some(((bytes, text, manifest, _), carried)) if carried.contains(&i) => run_as_with(
                manifest,
                bytes,
                text,
                AsChild {
                    entry: Entry::Tests,
                    only: only.clone(),
                    file_suffix: Some(format!("__f{i}")),
                    shown_entry: Some(files[i].clone()),
                    loud,
                    ..Default::default()
                },
            ),
            // In the walk and contributing no test: the same answer the per-file path gave, which is
            // "named like a test and exports none".
            Some(_) => 1,
            None => {
                let mut args = flags.clone();
                args.push(f.clone());
                build_and_call(&args, Entry::Tests)
            }
        };
        let (self_now, child_now) = cpu_millis();
        cost.push((
            f.clone(),
            began.elapsed().as_millis(),
            self_now.saturating_sub(self_began),
            child_now.saturating_sub(child_began),
        ));
        match code {
            0 => ok += 1,
            3 => {
                bad += 1;
                names.push((f.clone(), "failures"));
            }
            // Nothing this host can run, which is not the file's fault and not a failure.
            4 => skipped += 1,
            // Passed over by `--filter`, which during a directory walk is the normal case.
            5 => filtered_files += 1,
            // Did not compile, or is named like a test and exports none. Counted apart from a
            // failing test because they need different work from whoever reads this.
            _ => {
                broken += 1;
                names.push((f.clone(), "did not run"));
            }
        }
    }
    println!();
    // A filter that matched nothing in any file is a typo, and answering 0 for it would be a green
    // run that tested nothing — the failure mode a filter exists to avoid noticing too late.
    if ok == 0 && bad == 0 && broken == 0 && skipped == 0 {
        if let Some(pat) = filter_used {
            eprintln!("wac: no test anywhere under {target} matches --filter {pat}");
            return 1;
        }
    }
    let mut line = format!("{} files: {ok} ok", files.len());
    // **Named, not merely subtracted.** A lane that quietly runs fewer files than the reader thinks
    // is the failure this whole mechanism can produce: the summary would say `220 files: 220 ok`
    // and the eight most expensive checks in the repository would not have run. So the count of
    // what was excluded travels with the count of what passed.
    if skipped_by_ignore > 0 {
        line += &format!(", {skipped_by_ignore} not run (--ignore)");
    }
    if bad > 0 {
        line += &format!(", {bad} with failures");
    }
    // **Split, because the remedies differ.** Both kinds of "nothing ran here" answer 4, so this used
    // to call a file that wanted `--allow-read` one that wanted a host — see `UNGRANTED_FILES`.
    let ungranted_files = UNGRANTED_FILES.load(std::sync::atomic::Ordering::Relaxed);
    let needing_oracle = (skipped as usize).saturating_sub(ungranted_files);
    if needing_oracle > 0 {
        line += &format!(", {needing_oracle} needing a host oracle");
    }
    if ungranted_files > 0 {
        line += &format!(", {ungranted_files} needing a grant");
    }
    // **Tests, not files**, and counted across the whole walk: a file whose *other* tests passed is
    // `ok` above, so without this a run that skipped seventeen of them reported nothing but `13 ok`.
    let ungranted_tests = UNGRANTED_TESTS.load(std::sync::atomic::Ordering::Relaxed);
    if ungranted_tests > 0 {
        line += &format!(", {ungranted_tests} test(s) skipped for a grant");
    }
    if filtered_files > 0 {
        line += &format!(", {filtered_files} with nothing matching --filter");
    }
    if broken > 0 {
        line += &format!(", {broken} that did not run");
    }
    println!("{line}");
    if !names.is_empty() {
        println!();
        let wide = names.iter().map(|(n, _)| n.len()).max().unwrap_or(0);
        for (n, why) in &names {
            println!("   {n:wide$}   {why}");
        }
    }
    // **The slow ones, by name.** A walk that says `42 files: 42 ok` in ninety seconds says nothing
    // about which of the forty-two spent it, and the whole of "no slow tests in the regular suite"
    // is a question about individual files. One second is the floor because below it a ranking is
    // noise, and the count under the floor is stated so this cannot read as "everything else is fast"
    // when it means "nothing else reached the floor".
    let mut slow: Vec<&(String, u128, u128, u128)> =
        cost.iter().filter(|(_, _, mine, kids)| mine + kids >= 1000).collect();
    if files.len() > 1 && !slow.is_empty() {
        slow.sort_by(|a, b| (b.2 + b.3).cmp(&(a.2 + a.3)));
        let under = cost.len() - slow.len();
        println!();
        println!(
            "   {} file(s) cost a second or more of CPU to run — the other {under} did not:",
            slow.len()
        );
        for (f, ms, mine, kids) in slow.iter().take(6) {
            println!(
                "     {:>6} cpu ({:>5} here, {:>5} in children) {:>6} wall  {f}",
                format!("{:.1}s", (*mine + *kids) as f64 / 1000.0),
                format!("{:.1}s", *mine as f64 / 1000.0),
                format!("{:.1}s", *kids as f64 / 1000.0),
                format!("{:.1}s", *ms as f64 / 1000.0)
            );
        }
        if slow.len() > 6 {
            println!("     ... and {} more above the floor", slow.len() - 6);
        }
    }
    if broken > 0 { 1 } else if bad > 0 { 3 } else { 0 }
}

/// What a trap said, as a tail to append to a line about it: `": the ring is full"`, or `""`.
///
/// `trap "…"` writes the message to a global before trapping, because after one there is no code left
/// to run, and `$trap$message` reads it once the trap has unwound — `issues/lang/0147`. Empty for an
/// engine trap, which writes nothing, so the caller gets a tail it can print unconditionally.
///
/// **This used to say that a bounds check reporting the previous `trap`'s sentence "would be worse
/// than reporting none", as though that were the arrangement. It is what happens** — nothing clears
/// the global, so a trap that says nothing is answered with the last sentence any trap in that module
/// wrote. `issues/lang/0254c`, filed rather than fixed here because the fix is in both emitters.
fn trap_said(scope: &mut v8::PinScope, exports: v8::Local<v8::Object>) -> String {
    let said = trap_said_bare(scope, exports);
    if said.is_empty() { String::new() } else { format!(": {said}") }
}

/// The sentence itself, with no punctuation around it — what `Cli.call` puts in `CallResult.text`.
///
/// Split from `trap_said` when `Cli.call` needed the same answer without the `: ` a printed line
/// wants: two readers of one global, and the one that had been guessing was the capability.
fn trap_said_bare(scope: &mut v8::PinScope, exports: v8::Local<v8::Object>) -> String {
    // **Inside a `TryCatch`, because this is asked *of a module that has just trapped*.** Its state is
    // gone, so the call is liable to trap in its own right — and an uncaught one is announced by V8's
    // default handler on **stdout**, in the middle of the test runner's output. `unwrap_or_default()`
    // already reads a failed call as "it said nothing", which is the right answer; what was missing was
    // stopping the engine saying otherwise on the wrong stream.
    let tc = std::pin::pin!(v8::TryCatch::new(scope));
    let mut tc = tc.init();
    let got = get_export(&mut tc, exports, "$trap$message")
        .and_then(|f| f.call(&mut tc, exports.into(), &[]))
        .map(|v| read_string(&mut tc, v))
        .unwrap_or_default();
    tc.reset();
    got
}

/// How many tests a run skipped because it was not granted the capability they take.
///
/// **Counted because the summary is the line anybody reads.** Each file says which of its tests were
/// skipped, once, in a line that scrolls past over eighty files — and the summary then said
/// `15 files: 13 ok, 2 needing a host oracle` about a run that had skipped seventeen tests. Two people
/// measured that directory hours apart, one with grants and one without, and disagreed by 15× on a
/// single file; the counts differed by three tests and neither read that as the answer
/// (`issues/system/0183`). A process-wide counter rather than a return value because the verdict codes
/// are a contract `tools/mutate/native.ts` maps, and this is not a verdict.
static UNGRANTED_TESTS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// Files where *nothing* ran because the run granted no capability — as against needing an oracle.
///
/// **Both answer 4, and the summary was labelling both "needing a host oracle".** `run_tests`'s own
/// note two screens up says why that is wrong: "an oracle needs a host; a capability needs a flag on
/// this command line, and a reader told 'needs an oracle' would go looking for the wrong thing." The
/// per-file message had the distinction and the summary threw it away, because the caller sees only
/// the exit code. `issues/system/0230a`'s differential is where it surfaced.
static UNGRANTED_FILES: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

/// The grant flags this binary knows, by name. Written once because two commands ask the question
/// for opposite reasons: the parser asks "is this mine to take?" and `run` asks "did the caller mean
/// this as an argument?" — and a grant that is only in one of the lists is a grant that goes quiet
/// somewhere.
/// The marker line every `wac app` executable carries, and the version that built it.
const APP_MARK: &str = "# wac-app ";

/// `wac app [--allow-…] <entry.wac> -o <dest>` — build a program that runs by being run.
///
/// The output is a shell preamble with a wasm module glued to the end of it. `./thing` execs
/// `wac app-run "$0"`, which finds the module inside the file it was pointed at and runs it. So the
/// artefact is one file, it is `chmod +x`, it survives an `scp`, and it is **710 KB rather than
/// 67 MB** — because the engine is not in it. What is in it is the program.
///
/// ## Why it calls out rather than carrying a runtime
///
/// The alternative was a self-sufficient executable, which is what `app:binary` and `app:native-binary`
/// built: a whole V8 and a Rust host per program, 105 MB and 67 MB. Dropped on 2026-08-20 — a machine
/// that runs one of these runs `wac`, and a hundred copies of an engine is a hundred copies to keep in
/// step with the compiler that built the modules beside them.
///
/// **The grants are in the manifest, not in the preamble.** They are baked into the module by
/// `wac build`, exactly as for any other artefact, so editing the shell lines at the top of the file
/// cannot widen what the program may do — the manifest is inside the module, after the `\0asm`, and
/// changing it means rebuilding. A preamble that passed `--allow-read` on the command line would put
/// the capability in the one part of the file a text editor can reach.
///
/// **A version line, and `app-run` refuses a mismatch.** wac is unstable by choice: the manifest
/// shape is this binary's, and a module built by another version may name callbacks and structs this
/// one does not read the same way. Refusing with both numbers is a message somebody can act on;
/// running it and trapping somewhere inside is not.
fn app_command(rest: &[String]) -> i32 {
    let mut grants: Vec<String> = Vec::new();
    let mut dest = String::new();
    let mut entry = String::new();
    let mut i = 0;
    while i < rest.len() {
        let a = &rest[i];
        if a == "-o" {
            i += 1;
            match rest.get(i) {
                Some(d) => dest = d.clone(),
                None => {
                    eprintln!("wac: -o wants a path to write");
                    return 2;
                }
            }
        } else if is_grant(a) {
            grants.push(a.clone());
        } else if entry.is_empty() && !a.starts_with('-') {
            entry = a.clone();
        } else {
            eprintln!("wac: {a} is not a grant, -o, or the entry");
            return 2;
        }
        i += 1;
    }
    if entry.is_empty() || dest.is_empty() {
        eprintln!(
            "usage: wac app [--allow-read] [--allow-write] [--allow-net] [--allow-env] \
             [--allow-run] <entry.wac> -o <dest>"
        );
        eprintln!("       ./<dest> runs it, and needs the `wac` command on the machine that does");
        return 2;
    }

    let dir = std::env::temp_dir().join(format!("wac-app-{}", std::process::id()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("wac: no temporary directory to build in — {e}");
        return 1;
    }
    let stem = dir.join("app");
    let mut build = vec![
        "build".to_string(),
        entry.clone(),
        "-o".to_string(),
        stem.display().to_string(),
        "--quiet".to_string(),
    ];
    build.extend(grants.iter().cloned());
    start_v8();
    let built = run_seed(&build);
    if built != 0 {
        return built;
    }
    let wasm = match std::fs::read(stem.with_extension("wasm")) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wac: the build wrote nothing to package — {e}");
            let _ = std::fs::remove_dir_all(&dir);
            return 1;
        }
    };
    let _ = std::fs::remove_dir_all(&dir);

    // No backtick and no `$` that the shell would expand: this text is read by `/bin/sh` on somebody
    // else's machine, and the only thing it may do is check for `wac` and exec it. `command -v` is
    // POSIX, unlike `which`.
    let preamble = format!(
        "#!/bin/sh\n\
         {APP_MARK}{}\n\
         # A wac program. The wasm module begins at the first NUL byte below.\n\
         command -v wac >/dev/null 2>&1 || {{\n\
         \x20 echo \"$0: needs the wac command on PATH — deno task wac:install\" >&2\n\
         \x20 exit 127\n\
         }}\n\
         exec wac app-run \"$0\" \"$@\"\n",
        env!("CARGO_PKG_VERSION")
    );
    let mut out = preamble.into_bytes();
    out.extend_from_slice(&wasm);
    if let Err(e) = std::fs::write(&dest, &out) {
        eprintln!("wac: cannot write {dest} — {e}");
        return 1;
    }
    // Executable for whoever can already read it, which is what a program handed to somebody has to
    // be — owner-only would make `scp` to a shared machine produce a file nobody there can run.
    {
        use std::os::unix::fs::PermissionsExt;
        let made = std::fs::metadata(&dest).and_then(|md| {
            let mut perm = md.permissions();
            perm.set_mode(perm.mode() | 0o111);
            std::fs::set_permissions(&dest, perm)
        });
        if let Err(e) = made {
            eprintln!("wac: cannot make {dest} executable — {e}");
            return 1;
        }
    }
    eprintln!(
        "{dest}  {} KB  [{}]",
        out.len() / 1024,
        if grants.is_empty() { "no capabilities".to_string() } else { grants.join(" ") }
    );
    0
}

/// `wac app-run <file> [args…]` — run the module glued to the end of a `wac app` executable.
///
/// Its own subcommand because the preamble needs something to call: `./thing` has to hand *itself*
/// to `wac`, and `wac thing` would collide with the compiler's own argument shapes the day somebody
/// names a program `test`.
///
/// **The module is found by scanning for the first `\0asm`.** The preamble is shell text, and shell
/// text cannot contain a NUL — so the first one in the file is the module's magic and there is
/// nothing to escape, no length header to keep in step, and no second file. A `\0asm` that is not at
/// a section boundary would still be the module's, because the bytes before it are the ones this
/// command wrote.
fn app_run_command(rest: &[String]) -> i32 {
    let Some(path) = rest.first() else {
        eprintln!("usage: wac app-run <file> [args…]");
        eprintln!("       normally run for you by the first two lines of a `wac app` executable");
        return 2;
    };
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wac: cannot read {path} — {e}");
            return 1;
        }
    };
    let Some(at) = bytes.windows(4).position(|w| w == b"\0asm") else {
        eprintln!("wac: {path} carries no wasm module — is it a `wac app` executable?");
        return 1;
    };
    // The marker is looked for only in the text before the module, so a byte sequence inside the
    // module cannot pass for a version line.
    let head = String::from_utf8_lossy(&bytes[..at]).into_owned();
    let Some(built_by) = head
        .lines()
        .find_map(|l| l.strip_prefix(APP_MARK))
        .map(|v| v.trim().to_string())
    else {
        eprintln!("wac: {path} has a module in it but no `{APP_MARK}` line — not built by `wac app`");
        return 1;
    };
    let mine = env!("CARGO_PKG_VERSION");
    if built_by != mine {
        eprintln!("wac: {path} was built by wac {built_by} and this is wac {mine}");
        eprintln!("     wac is unstable by choice, so a manifest from another version is not read");
        eprintln!("     the same way. Rebuild it: wac app <entry.wac> -o {path}");
        return 1;
    }
    let wasm = &bytes[at..];
    let Some(text) = manifest_in(wasm) else {
        eprintln!("wac: the module inside {path} carries no wac.manifest section");
        return 1;
    };
    let manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: the manifest inside {path} is not one — {e}");
            return 1;
        }
    };
    start_v8();
    let argv = rest[1..].iter().map(|a| a.as_bytes().to_vec()).collect();
    run_as_with(&manifest, wasm, &text, AsChild { argv, ..Default::default() })
}

fn is_grant(a: &str) -> bool {
    matches!(
        a,
        "--allow-read" | "--allow-write" | "--allow-net" | "--allow-env" | "--allow-run"
    )
}

fn build_and_call(rest: &[String], entry_point: Entry) -> i32 {
    let mut i = 0;
    let mut flags: Vec<String> = Vec::new();
    let mut coverage = false;
    // `--coverage` is a *build* flag rather than a grant, and only `test` has anything to do with the
    // counters it produces — a program run with `run` would allocate them and nobody would read one.
    // `--filter` is neither a grant nor a build flag: it changes which of the built module's
    // exports get called, so it is taken here and carried through to the run.
    let mut only: Option<String> = None;
    let mut loud = false;
    while i < rest.len()
        && (rest[i].starts_with("--allow-")
            || rest[i] == "--coverage"
            || rest[i] == "--filter"
            || rest[i] == "--verbose")
    {
        if rest[i] == "--verbose" {
            if entry_point != Entry::Tests {
                eprintln!("wac: --verbose is for `test`; a program says what it says");
                return 2;
            }
            loud = true;
            i += 1;
            continue;
        }
        if rest[i] == "--filter" {
            if entry_point != Entry::Tests {
                eprintln!("wac: --filter is for `test`; there is one entry point here");
                return 2;
            }
            match rest.get(i + 1) {
                Some(v) if !v.starts_with("--") => {
                    only = Some(v.clone());
                    i += 1;
                }
                _ => {
                    eprintln!("wac: --filter wants a substring of a test's name");
                    return 2;
                }
            }
        } else if rest[i] == "--coverage" {
            coverage = entry_point == Entry::Tests;
            if !coverage {
                eprintln!("wac: --coverage is for `test`; nothing would read the counters here");
                return 2;
            }
        } else {
            flags.push(rest[i].clone());
        }
        i += 1;
    }
    if i >= rest.len() {
        let what = if entry_point == Entry::Tests { "test" } else { "run" };
        let tail = if entry_point == Entry::Tests { "" } else { " [args…]" };
        eprintln!(
            "usage: wac {what} [--allow-read] [--allow-write] [--allow-net] [--allow-env] \
             [--allow-run] <entry.wac>{tail}"
        );
        return 2;
    }
    // **An unknown flag is named, rather than becoming the entry.** The loop above stops at the first
    // argument it does not recognise, so `wac run --nonsense p.wac` made `--nonsense` the entry and
    // fell through to the top-level usage block — four commands' worth of flags, in answer to one
    // misspelling. The wac program in `packages/wac/src/wac.wac` says this sentence, and the two
    // have to agree while both exist: `commandparity_test.wac` is what checks that. `issues/system/0230a`.
    if rest[i].starts_with("--") {
        // `--filter` is `test`'s and not `run`'s — the loop above says so in its own words — so the
        // list a reader is given is the one for the command they typed. The wac program in
        // `packages/wac/src/wac.wac` prints the same sentence and
        // `commandparity_test.wac` compares them.
        let tail = if entry_point == Entry::Tests { ", --filter" } else { "" };
        eprintln!(
            "wac: unknown flag '{}' — --allow-read, --allow-write, --allow-net, --allow-env, \
             --allow-run{tail}",
            rest[i]
        );
        return 2;
    }
    let entry = rest[i].clone();

    // **A grant after the entry was handed to the program, silently.** `wac run p.wac --allow-read`
    // built an artefact with no grants and passed the flag as `argv[0]`, so the program ran without
    // the capability it asked for and its next sentence was about the bogus argument — nothing said
    // the command line was the problem. `wac build` takes grants on either side, so the two commands
    // disagreed about where one goes and only one of them said so. `issues/system/0177`.
    //
    // A program may legitimately want the string `--allow-read`, which is why this is not "scan the
    // whole line for grants": `--` says the rest is the program's, whatever it looks like, and this
    // check stops there.
    //
    // `test` does not come through here with program arguments — `test_command` sorts flags from
    // targets in any position — so the check is the entry point's, not the parser's.
    let mut program_args: &[String] = &rest[i + 1..];
    if entry_point == Entry::Main {
        let upto = program_args.iter().position(|a| a == "--").unwrap_or(program_args.len());
        if let Some(bad) = program_args[..upto].iter().find(|a| is_grant(a)) {
            eprintln!(
                "wac: {bad} after the entry is a program argument, not a grant — write it before \
                 {entry}, or after `--` if the program wants the string"
            );
            return 2;
        }
        if program_args.first().is_some_and(|a| a == "--") {
            program_args = &program_args[1..];
        }
    }

    // **Sweep what earlier runs could not.** The directory below is removed on the way out, and that
    // only covers a process that gets there: one killed by a timeout, or one whose guest exits the
    // process from inside, leaves its directory behind for good. A hundred of them had accumulated
    // over two days — `issues/system/0136` is the day the disk filled from exactly this shape.
    //
    // **Swept by age, not by liveness, and that is a correction.** This used to ask `/proc/<pid>`
    // whether the owning process was still running — sound in one PID namespace and meaningless
    // across several that share `/tmp`, which is what a container runner gives you. A foreign
    // namespace's pid 4 is absent from ours while its process runs perfectly well, so the sweep
    // deleted working directories out from under live commands. Reported against this environment on
    // GitHub issue 22, where concurrent runs "each saw PID 4 and removed/corrupted one another's".
    //
    // Age is the same fact in every namespace. It also covers what liveness covered — our own dead
    // runs are old runs — so nothing is lost by dropping the `/proc` question entirely.
    sweep_stale_runs();

    // **The pid is not unique either**, for the same reason, so the name carries the moment it was
    // made. Two commands in two namespaces with the same pid used to name one directory and write
    // over each other.
    let unique = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir()
        .join(format!("wac-run-{}-{unique:x}", std::process::id()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("wac: cannot make a working directory — {e}");
        return 1;
    }
    let stem = dir.join("prog");
    // **The build's own output is not the program's.** `wac run wc README.md` prints wc's three
    // numbers and nothing else; a compiler saying which file it wrote would land in the middle of a
    // pipeline. `--quiet` silences the line it prints when it succeeds and nothing else: a program
    // that does not compile still says so, on stderr, where the shell running this expects it.
    // **One file's module is cacheable too, and was not.** The directory path above caches its
    // aggregate, and a group of one was sent down this path with the note that "a lone file has nothing
    // to share a build with" — true about *sharing* and wrong about *keeping*. So `wac test <one file>`
    // compiled its whole graph every run: measured 2026-08-19, three identical runs of
    // `packages/wacc/test/wac/bindgenwac_test.wac --filter zzz` at **5.38s, 5.33s, 5.42s**, all of it
    // the compile, because every test that imports `packages/wacc/src/api.wac` pulls the compiler in.
    // A file that imports it floors at 5.4-5.9s and one that does not at 1.2s.
    //
    // That is the shape of an agent's inner loop — the house rule is to run the file you are working on
    // rather than the suite — and of the suite's own run-alone lane, where every file is a group of one.
    //
    // The key is the same one the aggregate uses, plus the entry's *name*: `test_module_key` hashes the
    // entry by content and not by name, because an aggregate's path carries a pid, and here the name is
    // real and reaches the manifest. `--filter` is deliberately not in it — it selects exports of an
    // already-built module — and `--coverage` is left out of the cache entirely rather than keyed,
    // because that path writes a table beside the module and a hit would not.
    let key = if coverage {
        None
    } else {
        let mut key_flags = flags.clone();
        key_flags.push(format!("entry={entry}"));
        let (sources, whole) = closure_of(std::path::Path::new(&entry));
        // Not cached at all when the scan hit an import it could not read — a mapped `dep/…` or an
        // `@/…` inside one. `issues/system/0219`: keying on a closure with holes in it served a
        // stale module for an entry whose *dependency* had changed, and the entry's own bytes are
        // a relative path away from colliding across two unrelated projects.
        whole.then(|| test_module_key(&entry, &sources, &key_flags, false))
    };

    let mut build = vec![
        "build".to_string(),
        entry,
        "-o".to_string(),
        stem.display().to_string(),
        "--quiet".to_string(),
    ];
    if coverage {
        build.push("--coverage".to_string());
    }
    build.extend(flags);

    start_v8();
    let from_cache = key.and_then(cached_module);
    let built = if from_cache.is_some() { 0 } else { run_seed(&build) };
    let code = if built != 0 {
        built
    } else {
        match from_cache.map(Ok).unwrap_or_else(|| {
            let read = std::fs::read(dir.join("prog.wasm"));
            if let (Some(k), Ok(bytes)) = (key, read.as_ref()) {
                remember_module(k, bytes);
            }
            read
        }) {
            Err(e) => {
                eprintln!("wac: the build wrote nothing to run — {e}");
                1
            }
            Ok(bytes) => match manifest_in(&bytes).and_then(|t| {
                serde_json::from_str::<Manifest>(&t).ok().map(|m| (m, t))
            }) {
                None => {
                    eprintln!("wac: the module just built describes itself wrongly");
                    1
                }
                Some((manifest, text)) => run_as_with(&manifest, &bytes, &text, AsChild {
                    entry: entry_point,
                    cov: if coverage {
                        std::fs::read_to_string(dir.join("prog.cov")).ok()
                    } else {
                        None
                    },
                    argv: program_args.iter().map(|a| a.as_bytes().to_vec()).collect(),
                    only: only.clone(),
                    loud,
                    ..Default::default()
                }),
            },
        }
    };
    // Best effort: a program that ran is not made wrong by a temporary file that outlived it.
    let _ = std::fs::remove_dir_all(&dir);
    code
}

/// How long a `wac-run-*` directory must have gone untouched before it is somebody's litter.
///
/// **Longer than any command, shorter than the two days it took to fill a disk** (`issues/system/0136`).
/// The suite is minutes; six hours is far past anything this binary does and still bounds the growth
/// that issue was about.
const RUN_DIR_STALE_AFTER: std::time::Duration = std::time::Duration::from_secs(6 * 60 * 60);

/// Remove `wac-run-*` directories that nothing has touched for `RUN_DIR_STALE_AFTER`.
///
/// **By age, because liveness is not answerable here.** This asked `/proc/<pid>` and skipped the
/// directory when the process was alive. That is right in one PID namespace and wrong wherever
/// several share a `/tmp`: a container runner gives each its own pids, so a foreign live pid 4 reads
/// as dead and its directory — in use, being written — was removed. GitHub issue 22 reported exactly
/// that against this repository's own agent environment.
///
/// Age is namespace-independent, and it is not weaker: the runs `/proc` identified as sweepable were
/// dead ones, and a dead run's directory stops being touched. A command that outlives the threshold
/// would have its own directory swept by a *later* command, which is the one case this trades away
/// and is why the threshold is six hours rather than one.
///
/// Best effort throughout: a directory that cannot be read or removed is skipped, because failing to
/// tidy is not a reason to fail to run. Only names this program makes are considered.
fn sweep_stale_runs() {
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
    let now = std::time::SystemTime::now();
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        // `wac-run-<pid>` from a binary before 2026-08-25, or `wac-run-<pid>-<nanos>` from this one.
        // Both are ours and both are dated by the filesystem rather than by their names, so that a
        // directory someone is still writing into is not old however it is named.
        if !name.starts_with("wac-run-") {
            continue;
        }
        let Ok(meta) = entry.metadata() else { continue };
        let Ok(touched) = meta.modified() else { continue };
        let Ok(idle) = now.duration_since(touched) else { continue };
        if idle < RUN_DIR_STALE_AFTER {
            continue;
        }
        let _ = std::fs::remove_dir_all(entry.path());
    }
}

/// Which compiler this binary *is*, as sixteen hex digits.
///
/// The same two inputs `test_module_key` hashes to decide whether a cached module was built by this
/// compiler: the embedded seed, and the binary's own version because the manifest shape is its. A wac
/// program cannot compute this — the seed is inside the executable and there is no file to read — so
/// the host supplies it, which is the one thing `issues/system/0204` says has to come from here before
/// a build cache can live on the wac side.
///
/// **Sixteen hex digits and not a path or a number**: it is compared, never parsed, and a fixed width
/// makes a cache filename out of it without a separator.
fn compiler_id() -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    let mut eat = |bytes: &[u8]| {
        for b in bytes {
            h ^= *b as u64;
            h = h.wrapping_mul(0x100000001b3);
        }
    };
    eat(b"wac-compiler 1");
    eat(env!("CARGO_PKG_VERSION").as_bytes());
    eat(SEED.unwrap_or(&[]));
    format!("{h:016x}")
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // **Every payload can ask which compiler is running it.** Set here rather than per command so
    // that `build`, `run` and `test` all see the same answer, and set unconditionally so that a
    // program reading it never has to distinguish "no compiler" from "not told". Reading it needs the
    // `env` grant the compiler already holds for `$WAC_HOME`. `issues/system/0204`.
    //
    // Not overwritten if the caller set one: a test that wants to force a cache miss says so, and a
    // host that has already decided its identity is not second-guessed here.
    if std::env::var_os("WAC_COMPILER_ID").is_none() {
        // SAFETY: single-threaded, before V8 starts and before any payload runs.
        unsafe { std::env::set_var("WAC_COMPILER_ID", compiler_id()) };
    }
    // **Asked for help, or given nothing.** The commands are in two places because they are
    // implemented in two places — the compiler inside answers `check`, `compile` and `build`, and
    // `run` is this host's. So the seed prints its own usage and this adds the one line it cannot
    // know about, rather than either side keeping a list of the other's commands.
    let asked = args.len() > 1 && (args[1] == "--help" || args[1] == "-h" || args[1] == "help");
    if SEED.is_some() && (args.len() < 2 || asked) {
        start_v8();
        let code = run_seed(&[]);
        // **`run` and `test` are not repeated here.** They used to be: this binary answers both in
        // Rust, so it added its own lines after the seed's usage — and the seed prints them too now
        // that they live in the wac program, so `wac --help` listed each twice and gave two different
        // accounts of `test`. Reported against an external project on 2026-08-25. The seed's list is
        // the one, and it carries the flags this binary accepts.
        eprintln!("       wac app <entry.wac> -o <dest>  an executable that runs itself — one file,");
        eprintln!("                                      needing a `wac` on the machine that runs it");
        eprintln!("       wac uninstall [--keep-cache]");
        eprintln!("                                      remove what `deno task wac:install` put under");
        eprintln!("                                      $WAC_HOME, the profile line, and nothing else");
        std::process::exit(if asked { 0 } else { code });
    }
    if args.len() < 2 {
        eprintln!("usage: wac <program.wasm|stem>   # a module carrying its own manifest, or a pair");
        std::process::exit(2);
    }
    let stem = &args[1];
    // **A module first.** `wac prog.wasm` is the whole of it when the module describes itself;
    // `wac stem` finds `stem.wasm` and `stem.json` beside each other, which is what the pair was.
    let direct = if stem.ends_with(".wasm") { std::fs::read(stem).ok() } else { None };
    if let Some(bytes) = direct {
        let Some(text) = manifest_in(&bytes) else {
            eprintln!("wac: {stem} carries no wac.manifest section — build it with packages/platform/native.ts");
            std::process::exit(1);
        };
        let manifest: Manifest = match serde_json::from_str(&text) {
            Ok(m) => m,
            Err(e) => {
                eprintln!("wac: the manifest inside {stem} is not one — {e}");
                std::process::exit(1);
            }
        };
        start_v8();
        std::process::exit(run(&manifest, &bytes, &text));
    }
    // **Arguments for the program inside, or a bundle to run.** Decided by what the first argument
    // *is* rather than by a flag: `wac compile x.wac` and `wac prog.json` are both what someone
    // would type, and a bundle is a `.wasm` or a stem with a `.json` beside it.
    //
    // A name ending in `.wasm` is a bundle *claim* whether or not the file is there, and is reported
    // as one. Otherwise a mistyped path would reach the compiler and come back as **unknown command
    // 'prog.wasm'** — a message about the wrong thing entirely, for a file that is simply missing.
    if SEED.is_some() && stem.ends_with(".wasm") {
        // `message_of` rather than `to_string`, which is the difference between "No such file or
        // directory" and "No such file or directory (os error 2)". The wac program answers this same
        // sentence from `faultWords`, and `commandparity_test.wac` compares them — an errno is the one
        // part of it no other host would spell the same way.
        let e = std::fs::read(stem).err().map(|e| message_of(&e)).unwrap_or_default();
        eprintln!("wac: cannot read {stem} — {e}");
        std::process::exit(1);
    }
    // `run` is this host's own command rather than the compiler's: the compiler writes a module and
    // cannot instantiate one, and running it is the thing this binary is.
    if SEED.is_some() && stem == "run" {
        std::process::exit(run_command(&args[2..]));
    }
    // `app` builds; `app-run` runs what it built. Both are the host's: the compiler writes a module
    // and knows nothing about making it executable, and `app-run` is what the preamble calls.
    if SEED.is_some() && stem == "app" {
        std::process::exit(app_command(&args[2..]));
    }
    // No `SEED.is_some()`: running an application needs no compiler, and a build carrying only a
    // shell is a perfectly good thing to hand somebody's `./thing` to.
    if stem == "app-run" {
        std::process::exit(app_run_command(&args[2..]));
    }
    // **The one command that needs no compiler at all**, and the only one whose reason for being
    // here is what the person typing it does *not* have. `deno task wac:uninstall` does the same
    // job, and it is a Deno program under `tools/` — so it needs this repository, and somebody who
    // installed the command has a `$WAC_HOME` and no checkout. `design/lang/0009` D1.
    //
    // No `SEED.is_some()`: a build carrying only a shell can still take itself away.
    if stem == "uninstall" {
        std::process::exit(uninstall_command(&args[2..]));
    }
    // **The other thing a person does with a compiler.** 125 files here are wac tests — an export
    // named `test*` answering a `string`, empty for a pass — and every one of them needed a Deno to
    // run. `harness/wacTestRun.ts` is that convention; this is the same convention with nothing
    // underneath it.
    if SEED.is_some() && stem == "test" {
        std::process::exit(test_command(&args[2..]));
    }
    // **Whether the engine accepts a module, without running it.** `WebAssembly.validate` has no
    // equivalent in wac, so a test that emits modules and wants to know they are well-formed had to
    // run each one — a fork per module. `packages/wacc/test/wac/corpusemit_test.wac` compiles the
    // whole repository and paid 543 of them, which is 142s of the 193s it took. Taking a list is the
    // whole point: the isolate is built once and every module is compiled inside it.
    if SEED.is_some() && stem == "validate" {
        std::process::exit(validate_command(&args[2..]));
    }
    // **The counters themselves, not a percentage.** `--coverage` prints how many points were
    // reached; a test about what a counter *means* needs how many times each one ran.
    //
    // This used to add "and nothing in wac can call `__cov_get` — the instrumentation injects it, so
    // no source names it", which was the reason this command lives here. It is no longer true:
    // `issues/system/0243c` puts the three injected exports in the manifest, so `Cli.call` finds
    // them. What keeps this in Rust now is narrower — `counters_of` is handed modules that carry *no
    // manifest*, and `Cli.load` refuses those. `issues/system/0230a` has the two ways out.
    if SEED.is_some() && stem == "covdump" {
        std::process::exit(covdump_command(&args[2..]));
    }
    // **The comparison, not the two journals.** A traced run of a real routine is millions of events,
    // and shipping both out as text to be compared by the caller costs tens of megabytes to learn one
    // number. `issues/system/0161`.
    if SEED.is_some() && stem == "ctcompare" {
        std::process::exit(ctcompare_command(&args[2..]));
    }
    // **No `tracestat` here.** It is `packages/wac/src/wac.wac`'s, as of 2026-08-25 —
    // `issues/system/0257c`'s rule is that a host may implement *running a module* and must not
    // implement the command surface, and reading a journal's size is a command. It reaches the seed
    // through the fall-through below, like `check` and `build`.
    // **A stem is no longer a program.** `wac <stem>` used to run `<stem>.wasm` against a
    // `<stem>.json` beside it, which was the pair form: two files, and a manifest that could be
    // separated from the module it describes. `wac build` writes one artefact now — the manifest is a
    // section inside the module — so anything that is not a command and not a `.wasm` is the
    // compiler's. `issues/system/0161`.
    if SEED.is_some() {
        start_v8();
        let code = run_seed(&args[1..]);
        // **A successful `build` has to have written a module the engine accepts.**
        //
        // `wac run` and `wac test` load what they compiled, so a broken module fails there on its
        // own. `wac build` is the command whose whole output is the artefact, and it had no such
        // check: an ill-typed program wacc's checker has no rule for could be emitted *wrongly* —
        // the function present and the types not agreeing — and the build printed a size and exited
        // 0 over a file the engine refuses to load. `issues/lang/0170a`.
        //
        // `validate_command` is the same validator `wac validate` is, called rather than copied, so
        // there is one answer to "would this load".
        if code == 0 && stem == "build" {
            if let Some(out) = built_module_path(&args[1..]) {
                if std::path::Path::new(&out).is_file() && validate_modules(&[out.clone()], true) != 0 {
                    eprintln!(
                        "wac: the build wrote {out} and the engine will not load it, so the \
                         compiler emitted something invalid rather than refusing the program"
                    );
                    std::process::exit(1);
                }
            }
        }
        std::process::exit(code);
    }
    eprintln!("wac: {stem} is not a command, and this build has no compiler in it");
    std::process::exit(2);
}

/// Where a `build` put its module, so the host can check what the compiler claimed to write.
///
/// `-o <stem>` gives `<stem>.wasm`; with no `-o` the compiler writes beside the entry, so
/// `src/main.wac` gives `src/main.wasm`. `None` when neither can be worked out, which is not an
/// error — it means there is nothing to check rather than that the check failed.
fn built_module_path(args: &[String]) -> Option<String> {
    let mut it = args.iter().skip(1);
    let mut entry: Option<&String> = None;
    while let Some(a) = it.next() {
        if a == "-o" {
            return it.next().map(|s| format!("{s}.wasm"));
        }
        if entry.is_none() && a.ends_with(".wac") {
            entry = Some(a);
        }
    }
    entry.map(|e| format!("{}.wasm", &e[..e.len() - 4]))
}

/// What to call once the module is instantiated and its world is built.
#[derive(Default, PartialEq, Clone, Copy)]
enum Entry {
    /// `main`, with the world its signature asks for. Every program.
    #[default]
    Main,
    /// Every zero-argument `test*` export returning a `string` — `wac test`.
    Tests,
}

/// What makes a child's world different from its parent's. `None` everywhere is the parent.
#[derive(Default)]
struct AsChild {
    /// What is called after the world is built. A child is always `Main`.
    entry: Entry,
    /// The coverage table of an instrumented build — `index<TAB>line<TAB>col<TAB>kind<TAB>file` per
    /// counter. Present only for `test --coverage`, and read where the counters still exist: they
    /// live in the instance, which is gone by the time `run_as_with` has returned.
    cov: Option<String>,
    argv: Vec<Vec<u8>>,
    grants: Option<Grants>,
    cwd: Option<String>,
    /// Run only the tests whose name contains this. `test --filter`, and nothing else reads it.
    only: Option<String>,
    /// Run only the tests whose export name *ends* with this — one file's share of an aggregate
    /// build. `issues/system/0192`; nothing else reads it.
    file_suffix: Option<String>,
    /// **The path to name in a message about this file**, when the module being run is an aggregate.
    ///
    /// Without it the two "every test in {}" lines below named `m.entry`, which for an aggregate is
    /// `.cache/wac-aggregate-<pid>-<n>_test.wac` — a generated file the caller never typed and cannot
    /// look at, in a sentence telling them what to do about their own. `issues/system/0230a`'s
    /// differential is where that showed: the wac program cannot name that file, because its own
    /// aggregate has a different name.
    shown_entry: Option<String>,
    /// Name every test as it passes, with what it took. `test --verbose`.
    loud: bool,
    /// **Print each counter after the run — `wac covdump`, with a world.**
    ///
    /// `covdump` used to instantiate with an empty imports object and call `main` with no arguments,
    /// which meant a coverage exercise could declare no capabilities at all: a `main(Core, Cli)` was
    /// not refused, it *failed to instantiate*, because the imports were absent rather than denied.
    /// So no exercise could read a corpus off disk, and `packages/json` alone needs a directory
    /// listing. `issues/system/0221`.
    ///
    /// Here instead, so the run is the ordinary program path — the world built from the manifest,
    /// grants as the manifest declares them — and the counters are read where they still exist.
    dump_counters: bool,
    /// The exports to call, in order, **each with its trap caught**. Empty means `main`.
    ///
    /// A trap ends the function it is in, so an exercise holding several trapping cases in one `main`
    /// loses every one after the first — measured: the branch before the trap reads 1 and the one
    /// after reads 0. `packages/bytes`'s driver has seven such cases and `packages/bignum`'s four,
    /// and the TypeScript called each from the host in its own `try`. This is that, in the host,
    /// where the counters are.
    ///
    /// **The `i32` is a sweep**: `Some(n)` calls `name(i)` for `i` in `0..n` and `None` calls `name()`
    /// once with no argument. A named export holds one trapping case, so a sweep of a thousand would
    /// otherwise need a thousand names — and the cases are not always separable: zstd's coverage driver
    /// damages a real frame at every byte in turn, over several frames and masks, which is more than a
    /// hundred thousand calls. Sampling was measured and reaches about half, because "the checks are
    /// close enough together that stepping over bytes steps over whole branches".
    cov_exports: Vec<(String, Option<i32>)>,
    /// Where this program's output goes, instead of the terminal.
    out: Option<Arc<Stream>>,
    err: Option<Arc<Stream>>,
    /// What it reads, instead of the process's own standard input.
    input: Option<Arc<Stream>>,
    /// Whether it reads its parent's terminal rather than the queue above.
    inherits: bool,
    /// **The child's end of its filesystem channel**, when the parent agreed to serve one.
    ///
    /// Two queues rather than one because it is a conversation: the child *asks* on `fs_req` and
    /// *reads answers* on `fs_rep`, and a single queue would let it read back its own request.
    /// `std/platform.wac` describes the same pair from the wac side —
    /// `recv(fsHandle)` in the parent reads a request and `send(fsHandle, …)` answers it.
    ///
    /// `None` is a child that was spawned with `serveFs` false, and every program that was not
    /// spawned at all. Both mean `recv(PARENT_FS)` answers "ended", which `Fs.fromParentOrHost`
    /// reads as "there is no parent to ask" and takes the host's filesystem for. issues/system/0157.
    fs_req: Option<Arc<Stream>>,
    fs_rep: Option<Arc<Stream>>,
}

/// `wac validate a.wasm b.wasm …` — whether the engine accepts each module, in one process.
///
/// **Only the failures are named, and then a count.** That is the shape every batched oracle in this
/// repository uses, and for the same reason: a run that stopped halfway reports no rejections, which
/// is indistinguishable from one where nothing was wrong. The last line says how many were looked at
/// so a caller can check it against what it asked for.
fn validate_command(paths: &[String]) -> i32 {
    validate_modules(paths, false)
}

/// The same, with the per-module and summary lines optional.
///
/// `wac build` calls this on what it just wrote, where a clean result has nothing to say — a build
/// that printed `1 module(s): 0 rejected` after every success would be reporting its own plumbing.
/// A *rejected* module still names itself, because that line is the diagnosis.
fn validate_modules(paths: &[String], quiet: bool) -> i32 {
    if paths.is_empty() {
        eprintln!("usage: wac validate <module.wasm> […]");
        return 2;
    }
    start_v8();
    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    let mut bad = 0;
    for p in paths {
        match std::fs::read(p) {
            Err(e) => {
                if !quiet { println!("unreadable {p} — {e}"); }
                bad += 1;
            }
            Ok(bytes) => {
                // **A `TryCatch` per module, and it is not optional.** A rejected module leaves an
                // exception on the isolate, and the next `compile` walks into V8's own check that a
                // null result and a pending exception agree — `Check failed: maybe_compiled.is_null()
                // == i_isolate->has_exception()` — which aborts the process with SIGABRT rather than
                // returning. Nothing else in this file needs one because nothing else compiles twice.
                // `tools/wac/testcli_test.wac` puts a good module *after* a bad one for exactly this.
                let tc = std::pin::pin!(v8::TryCatch::new(scope));
                let mut tc = tc.init();
                if v8::WasmModuleObject::compile(&tc, &bytes).is_none() {
                    println!("rejected {p}");
                    bad += 1;
                }
                tc.reset();
            }
        }
    }
    if !quiet { println!("{} module(s): {bad} rejected", paths.len()); }
    if bad > 0 { 1 } else { 0 }
}

/// `wac covdump <module.wasm>` — run `main` under the counters and print each one.
///
/// **Per counter, in index order**, because that is what the table is keyed by: `covTableFiles`'
/// `i`th row describes counter `i`, and a test asserting "the loop ran three times" needs the pair.
/// The aggregated report `--coverage` prints answers a different question — how much was reached —
/// and cannot say how often.
///
/// The module is instantiated with no imports, which is what an instrumented single file needs.
/// `$WAC_HOME`, or `$HOME/.wac`, with trailing slashes off. `None` when neither is set.
///
/// The same rule as `wacHome` in `tools/install.ts`, and it has to be: the two commands install and
/// remove one tree, so a disagreement about where it is means one of them works on nothing.
fn wac_home() -> Option<String> {
    if let Ok(set) = std::env::var("WAC_HOME") {
        if !set.is_empty() {
            return Some(set.trim_end_matches('/').to_string());
        }
    }
    let home = std::env::var("HOME").ok()?;
    if home.is_empty() {
        return None;
    }
    Some(format!("{home}/.wac"))
}

/// Drop every line carrying the marker from a profile. Returns how many went.
fn remove_profile_line(profile: &str) -> usize {
    let Ok(text) = std::fs::read_to_string(profile) else { return 0 };
    let lines: Vec<&str> = text.split('\n').collect();
    let kept: Vec<&str> = lines.iter().copied().filter(|l| !l.contains("# wac")).collect();
    if kept.len() == lines.len() {
        return 0;
    }
    if std::fs::write(profile, kept.join("\n")).is_err() {
        return 0;
    }
    lines.len() - kept.len()
}

/// **`wac uninstall` — D1's other half, and the half `deno task wac:uninstall` cannot do.**
///
/// It removes what the installer wrote and **nothing else**: not a manifest, not a lockfile, not a
/// source file, not a build product. Those live in projects rather than here, and a package manager
/// that tidies your working directory is one nobody trusts twice. `$WAC_HOME` itself goes only if it
/// is empty afterwards — somebody may keep their own things under it, and what is left is *named*
/// rather than passed over, so "removed" and "found nothing" are never the same line.
///
/// The list is duplicated from `tools/install.ts` rather than shared, because there is nothing to
/// share it through: one is Rust in the binary and the other is TypeScript that needs the checkout.
/// `packages/wacc/test/wac/uninstall_test.wac` is what keeps them the same list — it builds one fake
/// install per implementation and compares what survives, so a divergence is a failing test rather
/// than a surprise in somebody's home directory years later.
fn uninstall_command(args: &[String]) -> i32 {
    let mut keep_cache = false;
    for a in args {
        match a.as_str() {
            "--keep-cache" => keep_cache = true,
            _ => {
                eprintln!("usage: wac uninstall [--keep-cache]");
                eprintln!("wac: unknown argument {a}");
                return 2;
            }
        }
    }
    let Some(home) = wac_home() else {
        eprintln!("wac: neither WAC_HOME nor HOME is set, so there is nowhere to uninstall from");
        return 2;
    };
    let mut went: Vec<String> = Vec::new();

    // **The profile line first.** Removing the files and leaving every profile sourcing an `env`
    // that is gone prints an error on every login, from a command the person has just removed. The
    // task learned that by being run rather than by being tested, so the order is deliberate here.
    if let Ok(h) = std::env::var("HOME") {
        if !h.is_empty() {
            let mut lines = 0;
            for p in [".bashrc", ".zshrc", ".profile"] {
                lines += remove_profile_line(&format!("{h}/{p}"));
            }
            if lines > 0 {
                went.push(format!("{lines} profile line(s)"));
            }
        }
    }
    for name in ["bin/wac", "env", "install.json5"] {
        if std::fs::remove_file(format!("{home}/{name}")).is_ok() {
            went.push(name.to_string());
        }
    }
    let _ = std::fs::remove_dir(format!("{home}/bin")); // only when empty, which is what we want
    if !keep_cache && std::fs::remove_dir_all(format!("{home}/cache")).is_ok() {
        went.push("cache".to_string());
    }
    if let Ok(entries) = std::fs::read_dir(&home) {
        let left = entries.count();
        if left == 0 {
            let _ = std::fs::remove_dir(&home);
        } else {
            went.push(format!(
                "({left} other entr{} left in {home})",
                if left == 1 { "y" } else { "ies" }
            ));
        }
    }
    if went.is_empty() {
        println!("nothing to remove");
    } else {
        println!("{}", went.join(", "));
    }
    0
}

/// Instantiate an instrumented module, run `main`, and hand back the counter array.
///
/// Extracted from `covdump_command` when `ctcompare` wanted the same six steps. The array means
/// different things in the two modes and this does not care which: under `--coverage` slot `i` is how
/// many times point `i` ran, and under the trace mode slot 0 is how many entries are live, then
/// `(site, value)` pairs, and the last slot is how many events happened. Both are the same read.
///
/// The module is instantiated with no imports, which is what an instrumented single file needs.
fn counters_of(path: &str) -> Result<Vec<i32>, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("cannot read {path} — {e}"))?;
    start_v8();
    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    let Some(module) = v8::WasmModuleObject::compile(scope, &bytes) else {
        return Err(format!("{path} was rejected by the engine"));
    };
    let imports = v8::Object::new(scope);
    let global = context.global(scope);
    let mod_key = v8::String::new(scope, "__mod").unwrap();
    global.set(scope, mod_key.into(), module.into()).unwrap();
    let imp_key = v8::String::new(scope, "__imports").unwrap();
    global.set(scope, imp_key.into(), imports.into()).unwrap();
    let src = v8::String::new(scope, "new WebAssembly.Instance(__mod, __imports).exports").unwrap();
    let Some(exports) = v8::Script::compile(scope, src, None)
        .and_then(|sc| sc.run(scope))
        .and_then(|v| v.to_object(scope))
    else {
        return Err(format!("{path} did not instantiate — an import it wants is missing"));
    };

    // The counters are allocated by a call, not by instantiation: skip this and every instrumented
    // function traps on its first branch with a message about the program rather than the omission.
    let Some(init) = get_export(scope, exports, "__cov_init") else {
        return Err(format!("{path} carries no counters — was it built with coverage or tracing?"));
    };
    init.call(scope, exports.into(), &[]);
    if let Some(main) = get_export(scope, exports, "main") {
        // **A `TryCatch`, because a trap here is expected and tolerated.** The next lines say so: the
        // counters stand after a trap and they are what was asked for. Without one, V8's default
        // handler announces the trap on **stdout** — which is the stream `tracestat` prints its one
        // line of numbers to and `ctcompare` prints its verdict to, and `ct.wac` and
        // `packages/crypto/test/wac/constanttime_test.wac` both parse. Measured before the fix: a
        // trapping module gave `tracestat` one stray line and `ctcompare` two, since it reads two
        // modules through here.
        let tc = std::pin::pin!(v8::TryCatch::new(scope));
        let mut tc = tc.init();
        main.call(&mut tc, exports.into(), &[]);
        tc.reset();
    }

    let Some(len_fn) = get_export(scope, exports, "__cov_len") else {
        return Err(format!("{path} has __cov_init and no __cov_len"));
    };
    let len = len_fn
        .call(scope, exports.into(), &[])
        .and_then(|v| v.to_int32(scope))
        .map(|v| v.value())
        .unwrap_or(0);
    let Some(get_fn) = get_export(scope, exports, "__cov_get") else {
        return Err(format!("{path} has __cov_len and no __cov_get"));
    };
    let mut out = Vec::with_capacity(len.max(0) as usize);
    for i in 0..len {
        let idx = v8::Integer::new(scope, i);
        out.push(
            get_fn
                .call(scope, exports.into(), &[idx.into()])
                .and_then(|v| v.to_int32(scope))
                .map(|v| v.value())
                .unwrap_or(-1),
        );
    }
    Ok(out)
}

thread_local! {
    /// Whether a counter table has been printed this process — read by `covdump_command`.
    ///
    /// **`covdump`'s exit status is about the dump, not about the program.** Running through the
    /// ordinary program path means `run_as_with` hands back what `main` returned, and a coverage
    /// exercise returns an accumulator: `packages/codec`'s came back as 205, which `covreport` read as
    /// a failed `covdump` and reported with an empty message. The old bare-instantiate `covdump`
    /// always exited 0 and every caller was written against that.
    static COUNTERS_PRINTED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// `<index>\t<count>` per counter, then how many — `wac covdump`'s output, unchanged.
///
/// **Per counter, in index order**, because that is what the table is keyed by: `covTableFiles`'
/// `i`th row describes counter `i`, and a test asserting "the loop ran three times" needs the pair.
/// The aggregated report `--coverage` prints answers a different question — how much was reached —
/// and cannot say how often.
///
/// Written from inside a live run, because the counters are in the instance and the instance is gone
/// once `run_as_with` has returned. `issues/system/0221`.
fn print_counters(scope: &mut v8::PinScope, exports: v8::Local<v8::Object>) {
    let Some(len_fn) = get_export(scope, exports, "__cov_len") else {
        eprintln!("wac: the module has __cov_init and no __cov_len");
        return;
    };
    let len = len_fn
        .call(scope, exports.into(), &[])
        .and_then(|v| v.to_int32(scope))
        .map(|v| v.value())
        .unwrap_or(0);
    let Some(get_fn) = get_export(scope, exports, "__cov_get") else {
        eprintln!("wac: the module has __cov_len and no __cov_get");
        return;
    };
    for i in 0..len {
        let idx = v8::Integer::new(scope, i);
        let n = get_fn
            .call(scope, exports.into(), &[idx.into()])
            .and_then(|v| v.to_int32(scope))
            .map(|v| v.value())
            .unwrap_or(0);
        println!("{i}\t{n}");
    }
    println!("{len} counter(s)");
    COUNTERS_PRINTED.with(|p| p.set(true));
}

/// Call each named export in turn, **each trap caught** — after `main`, not instead of it.
///
/// A trap ends the function it is in and nothing else: the instance stays usable, which is what lets
/// a trapping branch be counted as covered at all. So seven bounds cases are seven calls rather than
/// seven runs, which is what the TypeScript did from the host and what a single `main` cannot express.
///
/// `call` answering `None` *is* the trap and is not an error here. A name that is not an export is,
/// and is reported after the counters so a mistyped name cannot look like a package with no coverage.
fn call_for_counters(
    scope: &mut v8::PinScope,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    names: &[(String, Option<i32>)],
) {
    let mut missing: Vec<&str> = Vec::new();
    for (name, cases) in names {
        match get_export(scope, exports, name) {
            Some(f) => {
                // **A `TryCatch` per call, and it is not optional** — the same reason
                // `validate_command` has one per module, one paragraph over: a throw leaves an
                // exception on the isolate, and the next operation meets V8's own check that a null
                // result and a pending exception agree. That comment says "nothing else in this file
                // needs one because nothing else compiles twice"; this calls twelve functions that
                // are *meant* to trap, which is the same thing for calls.
                //
                // Without it `packages/bytes` measured 69 covered on one run and 73 on the next from
                // an unchanged tree, which is what a swallowed call looks like from the outside.
                //
                // **A sweep is the same thing per case, and the `TryCatch` is per *call*.** One for
                // the whole loop would leave the first trap pending through every case after it,
                // which is the arrangement the paragraph above says aborts the process.
                //
                // The argument is passed only for a sweep. A wac export taking no parameter is a wasm
                // function of arity zero, and handing it an extra value is harmless; handing a
                // one-parameter function *no* value is not, so "call it once" and "call it with 0"
                // stay distinct rather than being the same case spelled two ways.
                match cases {
                    None => {
                        let tc = std::pin::pin!(v8::TryCatch::new(scope));
                        let mut tc = tc.init();
                        f.call(&tc, exports.into(), &[]);
                        tc.reset();
                    }
                    Some(n) => {
                        for i in 0..*n {
                            let tc = std::pin::pin!(v8::TryCatch::new(scope));
                            let mut tc = tc.init();
                            let arg = v8::Integer::new(&tc, i);
                            f.call(&tc, exports.into(), &[arg.into()]);
                            tc.reset();
                        }
                    }
                }
            }
            None => missing.push(name),
        }
    }
    if !missing.is_empty() {
        // Named and not silent: a mistyped export would otherwise read as a package whose trapping
        // branches are simply uncovered, which is the same number a real gap gives.
        eprintln!("wac: {} exports no {}", m.entry, missing.join(", "));
    }
}

/// `wac covdump <module.wasm> [export…]` — run an instrumented module and print each counter.
///
/// **Through the ordinary program path**, which is the whole of `issues/system/0221`. This used to
/// instantiate with an empty imports object and call `main` with no arguments, so a coverage exercise
/// could declare no capabilities: `main(Core, Cli)` was not refused, it *failed to instantiate*,
/// because the imports were absent rather than denied. No exercise could read a corpus off disk, and
/// `packages/json`'s needs a directory listing. Now the world is built from the manifest and the
/// grants are the ones baked into it, exactly as for `wac prog.wasm`.
///
/// With export names, each is called with its trap caught — see `call_for_counters`. Without, `main`
/// runs, and a trap in it still prints what was reached.
fn covdump_command(rest: &[String]) -> i32 {
    let Some(path) = rest.first() else {
        eprintln!("usage: wac covdump <module.wasm> [export|export:<cases>…]");
        eprintln!("       no export names runs `main`; several are called in order, traps caught");
        eprintln!("       `name:<n>` calls name(0)…name(n-1), each trap caught, for a sweep");
        return 2;
    };
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("wac: cannot read {path} — {e}");
            return 1;
        }
    };
    // **No manifest is not an error here.** `wac compile` and the trace instrumentation write a plain
    // module, and `tools/wac/ctcompare_test.wac` and `coverage_test.wac` hand those straight to this
    // command. A module with no manifest declares no capabilities, so instantiating it with no imports
    // is not a limitation for it — it is the correct world. That is the path this command used to take
    // for *everything*, which is what `issues/system/0221` was about.
    let Some(text) = manifest_in(&bytes) else {
        if rest.len() > 1 {
            eprintln!("wac: {path} carries no wac.manifest section, so it has no world to call \
                       {} in — build it with `wac build`", rest[1..].join(", "));
            return 2;
        }
        match counters_of(path) {
            Ok(counters) => {
                for (i, n) in counters.iter().enumerate() {
                    println!("{i}\t{n}");
                }
                println!("{} counter(s)", counters.len());
                return 0;
            }
            Err(e) => {
                eprintln!("wac: {e}");
                return 1;
            }
        }
    };
    let manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: the manifest inside {path} is not one — {e}");
            return 1;
        }
    };
    // **Parsed here, so a bad count is a usage error rather than a missing export.** Left to
    // `call_for_counters`, `sweep:many` would come back as "exports no sweep:many" — a message about
    // the module, naming a fault in the command line.
    let mut cov_exports: Vec<(String, Option<i32>)> = Vec::new();
    for a in &rest[1..] {
        match a.split_once(':') {
            None => cov_exports.push((a.clone(), None)),
            Some((name, count)) => match count.parse::<i32>() {
                Ok(n) if n > 0 => cov_exports.push((name.to_string(), Some(n))),
                _ => {
                    eprintln!("wac: {a} — `{count}` is not a case count; a sweep is \
                               `name:<n>` for some n above zero");
                    return 2;
                }
            },
        }
    }
    start_v8();
    let code = run_as_with(&manifest, &bytes, &text, AsChild {
        dump_counters: true,
        cov_exports,
        ..Default::default()
    });
    // The program's own status is not this command's answer — see `COUNTERS_PRINTED`. A run that
    // printed a table succeeded at the thing it was asked to do, whatever the exercise returned;
    // one that printed none failed, and `run_as_with` has already said why.
    if COUNTERS_PRINTED.with(|p| p.get()) { 0 } else if code == 0 { 1 } else { code }
}

/// `wac ctcompare <a.wasm> <b.wasm>` — two traced runs, and where their journals first differ.
///
/// **The comparison happens where the modules are.** A journal is `(site, value)` pairs and a real
/// one is large — `x25519Base` produces about 1.6 million events — so `covdump`'s line-per-slot
/// output is the wrong wire for it: a caller would parse tens of megabytes twice to learn one number.
/// This prints one line.
///
///     same <n>                  the two journals are identical, over `n` events
///     differs <i> <sa> <va> <sb> <vb>   at event `i`, where each side stood
///     truncated <a> <b>         a side recorded fewer events than happened, so the answer is not
///                               a comparison — the journal was sized too small for the run
///
/// `--all` answers with every divergent site instead of the first, which is what a caller checking a
/// published list of leaking lines needs. Its walk stops at a **path split** — where the two runs are
/// at different points rather than at one point with different values — because past that the two
/// journals are not comparable event by event and every later "difference" is an artefact of the
/// misalignment. The split is reported as its own line naming both sides:
///
///     split <i> <sa> <sb>       the runs parted; nothing after this is a comparison
///     site <i> <site> <va> <vb> one point, reached by both, with different values — once per site
///     longer <n> <site>         one run kept going; this is where the longer one stood at `n`
///
/// `truncated` is its own answer rather than a difference, because two journals that both overflowed
/// can agree on every event they kept while differing in the ones they dropped. A caller that read
/// that as "no divergence" would be told the routine is uniform on the strength of the part that fit.
fn ctcompare_command(rest: &[String]) -> i32 {
    let all = rest.iter().any(|a| a == "--all");
    let paths: Vec<&String> = rest.iter().filter(|a| !a.starts_with("--")).collect();
    let (Some(a_path), Some(b_path)) = (paths.first().copied(), paths.get(1).copied()) else {
        eprintln!("usage: wac ctcompare [--all] <a.wasm> <b.wasm>");
        return 2;
    };
    let (a, b) = match (counters_of(a_path), counters_of(b_path)) {
        (Ok(a), Ok(b)) => (a, b),
        (Err(e), _) | (_, Err(e)) => {
            eprintln!("wac: {e}");
            return 1;
        }
    };
    // Slot 0 is how many entries are live; the last is how many events happened whether or not there
    // was room. Anything shorter than both cannot be a journal.
    if a.len() < 2 || b.len() < 2 {
        eprintln!("wac: a journal is at least two slots; got {} and {}", a.len(), b.len());
        return 1;
    }
    let (used_a, used_b) = (a[0].max(0) as usize, b[0].max(0) as usize);
    let (want_a, want_b) = (a[a.len() - 1], b[b.len() - 1]);
    // **Truncation is only checked when nothing diverged**, and getting this the other way round was
    // the first version's bug. A difference found inside the prefix both journals kept is a real
    // difference: the events are aligned up to there, and what was dropped after it cannot un-differ
    // them. Refusing to answer would have made the expensive routines unmeasurable for a reason that
    // does not apply to them — a ladder parts at the first differing bit, long before either journal
    // fills. What truncation *does* invalidate is `same`, because two runs that overflowed can agree
    // on every event they kept and differ in the ones they dropped.
    let overflowed = want_a as usize * 2 > used_a || want_b as usize * 2 > used_b;
    let (n_a, n_b) = (used_a / 2, used_b / 2);
    if all {
        // **`same` is printed when nothing diverged**, because no output at all is what a command that
        // did not run also produces, and a caller reading silence as "no leak" would be told a routine
        // is uniform by a broken pipe.
        let mut said = false;
        let mut seen: std::collections::HashSet<i32> = std::collections::HashSet::new();
        let n = n_a.min(n_b);
        for i in 0..n {
            let (sa, va) = (a[1 + 2 * i], a[2 + 2 * i]);
            let (sb, vb) = (b[1 + 2 * i], b[2 + 2 * i]);
            if sa == sb && va == vb {
                continue;
            }
            if sa != sb {
                // Not a leaking site: it is where *this* run happened to be when the two stopped
                // agreeing, and the other was somewhere else. Naming both is the only honest report,
                // and nothing after it is a comparison.
                println!("split {i} {sa} {sb}");
                return 0;
            }
            if seen.insert(sa) {
                said = true;
                println!("site {i} {sa} {va} {vb}");
            }
        }
        if n_a != n_b {
            let longer = if n_a > n_b { &a } else { &b };
            said = true;
            println!("longer {n} {}", longer[1 + 2 * n]);
        }
        if !said {
            if overflowed {
                println!("truncated {want_a} {want_b}");
            } else {
                println!("same {}", n_a.min(n_b));
            }
        }
        return 0;
    }
    for i in 0..n_a.max(n_b) {
        let ev = |v: &[i32], n: usize| -> Option<(i32, i32)> {
            if i < n { Some((v[1 + 2 * i], v[2 + 2 * i])) } else { None }
        };
        match (ev(&a, n_a), ev(&b, n_b)) {
            (Some(x), Some(y)) if x == y => continue,
            (Some(x), Some(y)) => {
                println!("differs {i} {} {} {} {}", x.0, x.1, y.0, y.1);
                return 0;
            }
            // One side ended. The site is whichever side still has one, which is what names the
            // point a caller should look at.
            (Some(x), None) => {
                println!("differs {i} {} {} -1 -1", x.0, x.1);
                return 0;
            }
            (None, Some(y)) => {
                println!("differs {i} -1 -1 {} {}", y.0, y.1);
                return 0;
            }
            (None, None) => break,
        }
    }
    if overflowed {
        println!("truncated {want_a} {want_b}");
    } else {
        // **The count, because `same` over nothing is not agreement.** A mistyped export name calls
        // nothing and records nothing, and two empty journals match perfectly — which would report
        // every routine in the repository as constant-time. A caller checks the number.
        println!("same {}", n_a.min(n_b));
    }
    0
}

fn run(m: &Manifest, wasm: &[u8], manifest_text: &str) -> i32 {
    run_as_with(m, wasm, manifest_text, AsChild { argv: std::env::args().skip(2).map(|a| a.into_bytes()).collect(), ..Default::default() })
}

/// **One body for the parent and for a child**, because a child is this same program with a
/// different world: its own arguments, possibly narrower grants, and streams instead of a terminal.
/// A V8 isolate belongs to one thread, so a child gets a thread and an isolate of its own — and
/// `HOST` is a `thread_local!`, which is why that costs nothing here.
fn run_as(m: &Manifest, wasm: &[u8], as_child: AsChild) -> i32 {
    run_as_with(m, wasm, "", as_child)
}

fn run_as_with(m: &Manifest, wasm: &[u8], manifest_text: &str, as_child: AsChild) -> i32 {
    // Taken before `as_child` is unpacked into the host's state below, which is where it stops
    // being available.
    let entry = as_child.entry;
    let cov = as_child.cov.clone();
    let only = as_child.only.clone();
    let file_suffix = as_child.file_suffix.clone();
    let shown_entry = as_child.shown_entry.clone();
    // Kept because a module with no `main` names the export to call in its first argument, and
    // that decision is made below where the manifest is known — see `call_named`.
    let argv = as_child.argv.clone();
    let loud = as_child.loud;
    let dump_counters = as_child.dump_counters;
    let cov_exports = as_child.cov_exports.clone();
    let isolate = &mut v8::Isolate::new(Default::default());
    v8::scope!(let handle_scope, isolate);
    let context = v8::Context::new(handle_scope, Default::default());
    let scope = &mut v8::ContextScope::new(handle_scope, context);

    let module = match v8::WasmModuleObject::compile(scope, wasm) {
        Some(mo) => mo,
        None => {
            // **The engine rejected the module we emitted, which is our fault and not the
            // program's.** This said "did not compile", which reads as a diagnostic about the source
            // — and the source has already been checked by then, so the reader goes looking for a
            // type error that is not there. It cost exactly that: `issues/system/0170` was filed as
            // "`build` skips a check `run` does", because `run` printed this and `build` printed a
            // byte count for the same module. Neither was checking anything; the checker had a hole,
            // and this message pointed away from it.
            eprintln!(
                "wac: the module compiled from {} was rejected by the engine — this is a compiler \
                 bug rather than a fault in the program. `wac build … -o out` keeps the module.",
                m.entry
            );
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
            eprintln!("wac: could not compile the instantiation");
            return 1;
        }
    };
    let exports = match script.run(scope).and_then(|v| v.to_object(scope)) {
        Some(o) => o,
        None => {
            eprintln!("wac: {} did not instantiate — an import it wants is missing", m.entry);
            return 1;
        }
    };

    // The slot table, filled as capabilities are handed out, so a dispatcher can answer "which
    // function is slot 3 of signature 7" without asking the module.
    let mut caps: Vec<Vec<Cap>> = vec![Vec::new(); m.callbacks.len()];
    let mut names: Vec<Vec<String>> = vec![Vec::new(); m.callbacks.len()];
    let mut unsupported: Vec<String> = Vec::new();

    // **Nor does a `main` that declares no capabilities**, which is the same sentence as the one below
    // about test files and took a second reading to see. `export i32 main() { return 3; }` has no
    // `Core` in its manifest because it asked for none, and this refused it with *no struct Core in the
    // manifest* — the host's own bookkeeping, about the smallest program that demonstrates the
    // language's central claim. Whether `main` wants a world is knowable here and is asked for below;
    // an undefined placeholder is never passed to a `main` that named one. `tools/wac/runcli_test.wac`.
    //
    // **And a module with no `main` at all**, which `is_some_and` answered `false` for — so the
    // named-export path below (`wac run math.wac gcd 48 18`) was refused before it was reached,
    // with a message about the host's bookkeeping rather than about anything the caller did. A
    // named export is called with the arguments it declared and never with a world, so the same
    // "nothing will be handed one" reasoning applies.
    let main_declares_nothing = match m.exports.iter().find(|e| e.name == "main") {
        Some(e) => e.params.is_empty(),
        None => true,
    };

    // **A test file has no world, and must not be asked for one.** A wac test is a pure function
    // answering a report; it declares no capabilities, so its manifest has no `Core` — and building
    // one first meant `wac test` refused every test file in the repository with *no struct Core in
    // the manifest*, about a program that was right.
    let core = match build_struct(scope, exports, m, "Core", &mut caps, &mut names, &mut unsupported) {
        Ok(v) => v,
        Err(e) => {
            if entry == Entry::Tests || main_declares_nothing {
                // `HOST` is still wanted below — `read_string` reads a test's report through the
                // module's own exports — so this falls through with an empty world rather than out.
                v8::undefined(scope).into()
            } else {
                eprintln!("wac: {e}");
                return 1;
            }
        }
    };
    // `Cli` is built whether or not `main` takes it: a program that asks for one capability from it
    // and never touches the rest should run, and the ones this host cannot answer are named on exit.
    // **The reason is kept, not discarded.** Tolerating a `Cli` this host cannot finish is deliberate —
    // see above — but `Err(_) => None` threw away a sentence that already named the fault, so a program
    // whose `main` *does* take a `Cli` was told "the manifest describes none" when the manifest
    // described one perfectly well and a single funcref field in it had no dispatcher. That sent readers
    // looking for a missing struct. `issues/lang/0162b`.
    let (cli, cli_err) =
        match build_struct(scope, exports, m, "Cli", &mut caps, &mut names, &mut unsupported) {
            Ok(v) => (Some(v), None),
            Err(e) => (None, Some(e)),
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
        ("Datagram", Cap::ResolveDatagram),
        ("Read", Cap::ResolveRead),
        ("bool", Cap::ResolveBool),
        ("Captured", Cap::ResolveCaptured),
        ("Exec", Cap::ResolveExec),
        ("Child", Cap::ResolveChild),
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
            argv: as_child.argv.clone(),
            grants: as_child.grants.unwrap_or(m.grants),
            child_out: as_child.out.clone(),
            child_err: as_child.err.clone(),
            child_input: as_child.input.clone(),
            inherits: as_child.inherits,
            cwd_override: as_child.cwd.clone(),
            child_exits: HashMap::new(),
            child_feeds: HashMap::new(),
            wasm: wasm.to_vec(),
            manifest_text: manifest_text.to_string(),
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
            child_of: m
                .find_struct("Child")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            loaded: HashMap::new(),
            next_loaded: 1,
            loaded_of: m
                .find_struct("LoadedModule")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            called_of: m
                .find_struct("CallResult")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            captured_of: m
                .find_struct("Captured")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            exec_of: m
                .find_struct("Exec")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            frames: Vec::new(),
            socket_of: m
                .find_struct("Socket")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            datagram_of: m
                .find_struct("Datagram")
                .and_then(|s| s.methods.iter().find(|mm| mm.name == "of"))
                .map(|mm| mm.export_name.clone()),
            sockets: Arc::new(std::sync::Mutex::new(HashMap::new())),
            datagrams: Arc::new(std::sync::Mutex::new(HashMap::new())),
            receiving: Arc::new(std::sync::Mutex::new(HashMap::new())),
            // Above `STDIN_HANDLE` and `PARENT_FS_HANDLE`: wac reserves those two numbers as
            // channels, and this counter used to collide with the second of them — 0148.
            next_handle: FIRST_FREE_HANDLE,
            read_variants: ["Data", "End", "Failed"]
                .into_iter()
                .filter_map(|v| m.variant_ctor("Read", v).map(|c| (v.to_string(), c.to_string())))
                .collect(),
            input: None,
            output: None,
        })
    });

    // **The child's filesystem channel needs no new capability**, only two entries in the maps
    // `recv` and `send` already consult: `sockets` is what `recv` reads from and `child_feeds` is
    // what `send` writes to, both keyed by handle. Registering the reserved `PARENT_FS` number in
    // each makes `recv(PARENT_FS)`/`send(PARENT_FS)` a conversation with the parent, using exactly
    // the code paths a socket and a child's stdin already use.
    //
    // Nothing is registered when the parent did not agree to serve — `serveFs` false, or no parent
    // at all — and then `recv(PARENT_FS)` falls to the not-found arm and answers "ended", which is
    // the honest "there is nobody to ask". issues/system/0157.
    if let (Some(req), Some(rep)) = (as_child.fs_req.clone(), as_child.fs_rep.clone()) {
        HOST.with(|h| {
            if let Some(st) = h.borrow_mut().as_mut() {
                st.sockets.lock().unwrap().insert(PARENT_FS_HANDLE, Sock::Queue(rep));
                st.child_feeds.insert(PARENT_FS_HANDLE, req);
            }
        });
    }

    if entry == Entry::Tests {
        return run_tests(scope, exports, m, cov.as_deref(), only.as_deref(),
                         file_suffix.as_deref(), shown_entry.as_deref().unwrap_or(&m.entry),
                         loud, core, cli);
    }
    // **The counters are allocated by a call, not by instantiation.** Skip this and every
    // instrumented function traps on its first branch, with a message about the program rather than
    // about the omission.
    if dump_counters {
        match get_export(scope, exports, "__cov_init") {
            Some(f) => { f.call(scope, exports.into(), &[]); }
            None => {
                eprintln!("wac: {} carries no counters — was it built with coverage or tracing?",
                          m.entry);
                return 1;
            }
        }
    }
    let main_sig = match m.exports.iter().find(|e| e.name == "main") {
        Some(e) => e,
        // **No `main`: the first argument names an export.** `wac run math.wac gcd 48 18`, which
        // `spec/cli/wac.md` documents and which was only ever implemented in the reference CLI.
        //
        // `main` wins where it exists, so a program's arguments are never mistaken for a function
        // name — the ambiguity only arises for a module that has both, and a module with a `main`
        // is a program rather than a library to poke at.
        None => {
            let args: Vec<String> =
                argv.iter().map(|a| String::from_utf8_lossy(a).into_owned()).collect();
            return call_named(scope, exports, m, &args);
        }
    };
    // **Named, not guessed.** `main(Core, Cli)` is the ordinary shape and this slice cannot serve
    // `Cli` — saying which capability is missing beats trapping inside the program.
    let args: Vec<v8::Local<v8::Value>> = match main_sig.params.as_slice() {
        // Nothing declared, nothing handed over — and nothing built either, so `core` here is the
        // placeholder from above and is deliberately not in this list.
        [] => Vec::new(),
        [a] if a == "Core" => vec![core],
        [a, b] if a == "Core" && b == "Cli" => match cli {
            Some(c) => vec![core, c],
            None => {
                match &cli_err {
                    Some(e) => eprintln!("wac: main wants a Cli and this host could not build one: {e}"),
                    None => eprintln!("wac: main wants a Cli and the manifest describes none"),
                }
                return 1;
            }
        },
        other => {
            eprintln!(
                "wac: main({}) names a capability this host does not build",
                other.join(", ")
            );
            return 1;
        }
    };

    let main_fn = match get_export(scope, exports, "main") {
        Some(f) => f,
        None => {
            eprintln!("wac: main is not callable");
            return 1;
        }
    };
    // **A `TryCatch` around the program's own call.** Without one, an uncaught trap is reported by
    // V8's *default* handler as well as by this host — and V8's goes to **stdout**, so
    // `wasm://wasm/000eca36:51437: Uncaught RuntimeError: array element access out of bounds` lands in
    // the middle of the program's own output. A program's stdout belongs to the program: a caller
    // reading it gets engine text mixed into the answer, and the same program built for the Deno host
    // writes one clean line to stderr and nothing to stdout.
    //
    // The host still says what it has to say, on stderr, immediately below — so this removes a
    // duplicate report rather than a report. `reset()` clears the caught exception before the branch
    // below uses the scope again, which is the same care the `TryCatch` above `compile` takes.
    let called = {
        let tc = std::pin::pin!(v8::TryCatch::new(scope));
        let mut tc = tc.init();
        let out = main_fn.call(&mut tc, exports.into(), &args);
        tc.reset();
        out
    };
    let r = match called {
        Some(v) => v,
        None => {
            // **What the program said, if it said anything.** `trap "the ring is full"` puts the message
            // in a global before the trap, because after one there is no code left to run, and
            // `$trap$message` reads it once the trap has unwound. Empty for an engine trap — a bounds
            // check, a null dereference — which writes nothing, and reporting a previous message for one
            // of those would be worse than reporting none. `issues/lang/0147`.
            // **And a `TryCatch` around *this* call too**, because asking a trapped module a question
            // is itself liable to trap: after an engine trap the module's own state is gone, and
            // `$trap$message` came back as `dereferencing a null pointer` — reported by V8's default
            // handler, on stdout, in the middle of the program's output. The `unwrap_or_default()`
            // already treats a failed call as "it said nothing", which is the right answer; what was
            // missing was stopping the engine announcing the failure on the program's own stream.
            let said = {
                let tc = std::pin::pin!(v8::TryCatch::new(scope));
                let mut tc = tc.init();
                let got = get_export(&mut tc, exports, "$trap$message")
                    .and_then(|f| f.call(&mut tc, exports.into(), &[]))
                    .map(|v| read_string(&mut tc, v))
                    .unwrap_or_default();
                tc.reset();
                got
            };
            if said.is_empty() {
                eprintln!("wac: {} trapped", m.entry);
            } else {
                eprintln!("wac: {} trapped: {said}", m.entry);
            }
            // **The counters still stand after a trap**, and they are the answer `covdump` was asked
            // for: an exercise whose last case is meant to trap has done its work by the time it does.
            if dump_counters {
                call_for_counters(scope, exports, m, &cov_exports);
                print_counters(scope, exports);
            }
            return 1;
        }
    };
    let code = r.to_int32(scope).map(|i| i.value()).unwrap_or(0);
    if dump_counters {
        call_for_counters(scope, exports, m, &cov_exports);
        print_counters(scope, exports);
    }

    // **Work scheduled and never run is an error.** `main` returning is the program saying it is
    // done, and a continuation still waiting says it was not — the answer would simply never arrive,
    // silently, which is the failure a promise-shaped API is most likely to have. So the world is
    // asked, and a program that meant it says so with `core.dropAll()`.
    //
    // Asked of `Core` rather than of the scheduler this host built, because `Core.outstanding` is the
    // question in the language's own words and survives the scheduler being reshaped.
    if let Some(spec) = m.find_struct("Core") {
        if let Some(mm) = spec.methods.iter().find(|mm| mm.name == "outstanding") {
            if let Some(f) = get_export(scope, exports, &mm.export_name) {
                if let Some(v) = f.call(scope, exports.into(), &[core]) {
                    let left = v.to_int32(scope).map(|i| i.value()).unwrap_or(0);
                    if left > 0 {
                        eprintln!(
                            "wac: {} finished with {left} continuation(s) still waiting — \
                             call `core.drain()` to run them, or `core.dropAll()` to abandon them",
                            m.entry
                        );
                        return 1;
                    }
                }
            }
        }
    }

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
            eprintln!("wac: unanswered capabilities: {}", missed.join(", "));
        }
    }
    code
}

/// Run the tests a module exports, and say which failed.
///
/// **The convention is the repository's own, not a new one.** `harness/wacTestRun.ts` discovers a
/// test as *an export whose name begins with `test` and which answers a `string`* — empty for a
/// pass, the failure report otherwise. 125 files here are written that way and every one of them
/// needed a Deno to run until now.
///
/// A test that takes arguments is an **oracle** test: the harness hands it a host function to
/// compare against, and this host has nothing to hand it. Those are named and skipped rather than
/// quietly left out of the count — a runner that reports "22 passed" for a file with 30 tests is
/// worse than one that cannot run it at all.
fn run_tests(
    scope: &mut v8::PinScope,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    cov: Option<&str>,
    only: Option<&str>,
    // One file's share of an aggregate build: only the exports whose name ends with this, and the
    // suffix comes off before anything is printed. `issues/system/0192`.
    file_suffix: Option<&str>,
    // What to call the file in a message: the aggregate's member, or the entry when there is no
    // aggregate. See `AsChild::shown_entry`.
    shown_entry: &str,
    loud: bool,
    core: v8::Local<v8::Value>,
    cli: Option<v8::Local<v8::Value>>,
) -> i32 {
    // **The counters are allocated by a call, not by instantiation.** Skip this and every
    // instrumented function traps on its first branch with *dereferencing a null pointer* — a
    // message about the program under test rather than about the missing call.
    if cov.is_some() {
        match get_export(scope, exports, "__cov_init") {
            Some(f) => {
                f.call(scope, exports.into(), &[]);
            }
            None => {
                eprintln!("wac: this module carries no counters — was it built with --coverage?");
                return 1;
            }
        }
    }
    // **Per test, when asked.** `tools/mutate.ts` narrows "run the suite" to "run the tests that
    // reach this line", and it can only do that from a profile that says which test reached what.
    // Without one it does not fail — it under-selects, records the mutant as unrun and drops it
    // from the score, which is the failure `harness/wacTestProfile.test.ts` was written about.
    // The env var is the one the Deno path already uses, so the tool needs no new spelling.
    let profile_dir = std::env::var("WAC_PROFILE").ok().filter(|d| !d.is_empty());
    let lines = cov.map(table_lines).unwrap_or_default();
    let mut reached: Vec<(String, Vec<String>)> = Vec::new();

    let mut passed = 0;
    let mut failed = 0;
    let mut skipped: Vec<String> = Vec::new();
    // Wants a capability this run was not granted — distinct from wanting an oracle, because the
    // remedy is a flag rather than a host.
    let mut ungranted: Vec<String> = Vec::new();
    // Counted apart from `skipped`, which means "this host cannot run it". A test the filter
    // excluded is one the person asked not to run, and saying "0 passed" without saying that
    // reads as a suite that has quietly emptied.
    let mut filtered = 0;

    for e in m.exports.iter().filter(|e| e.name.starts_with("test")) {
        // One file's tests out of an aggregate. An *exact* suffix, not `contains`: `__f1` is a prefix
        // of `__f10`, so a contains-match would run eleven files' tests under one file's heading.
        if let Some(suffix) = file_suffix {
            if !e.name.ends_with(suffix) {
                continue;
            }
        }
        // What the reader typed, and what the reader sees: the wrapper's suffix is this runner's
        // bookkeeping and means nothing to anyone reading a failure.
        let shown = file_suffix
            .and_then(|s| e.name.strip_suffix(s))
            .unwrap_or(&e.name)
            .to_string();
        if let Some(pat) = only {
            if !e.name.contains(pat) {
                filtered += 1;
                continue;
            }
        }
        if e.ret != "string" {
            continue;
        }
        // **A test may take the capabilities a program takes** — `issues/system/0161` step 4. It
        // declares them the way `main` does, by naming them, so nothing is ambient: a test that
        // reads a file says so in its signature and gets nothing unless the run was granted it.
        // Anything else in the parameter list is an *oracle* the host supplies, which this cannot,
        // and those are still named and skipped.
        let args: Vec<v8::Local<v8::Value>> = match e.params.as_slice() {
            [] => Vec::new(),
            [a] if a == "Core" => vec![core],
            [a, b] if a == "Core" && b == "Cli" => {
                // **Granted nothing means skipped, not failed.** A `Cli` exists either way — its
                // capabilities refuse individually, with "Not granted to this application" — so
                // running the test anyway would turn `wac test packages/` red for every file that
                // declares a capability, which is the opposite of what declaring one should cost.
                // Not a pass either: nothing was checked. The same answer as an oracle this host
                // cannot supply, because it is the same situation.
                let granted =
                    m.grants.read || m.grants.write || m.grants.env || m.grants.net || m.grants.run;
                match cli {
                    Some(c) if granted => vec![core, c],
                    _ => {
                        ungranted.push(shown.clone());
                        continue;
                    }
                }
            }
            // **A host type in a shape this does not serve is its own answer.** `(Cli)` on its own
            // is not an oracle — every capability in it is one this runner can supply — so telling
            // its author "needs an oracle from the host" sends them looking for a different host
            // when the fix is one word in the signature. The same distinction the arms above are
            // written for, applied to the case that reaches neither.
            other
                if other.iter().all(|p| p == "Core" || p == "Cli") =>
            {
                println!(
                    "FAIL {} — takes ({}); a test takes (), (Core) or (Core, Cli)",
                    shown,
                    other.join(", ")
                );
                failed += 1;
                continue;
            }
            _ => {
                skipped.push(shown.clone());
                continue;
            }
        };
        let Some(f) = get_export(scope, exports, &e.name) else {
            println!("FAIL {shown} — exported and not callable");
            failed += 1;
            continue;
        };
        let before = if profile_dir.is_some() && cov.is_some() {
            counters_now(scope, exports)
        } else {
            Vec::new()
        };
        let began = std::time::Instant::now();
        // **A `TryCatch` around the test itself.** A whole category of tests — `test_traps_*` — is
        // *expected* to trap, so this is the ordinary path rather than an edge of it, and without one
        // V8's default handler announced every trap on **stdout**: one passing file,
        // `packages/crypto/test/wac/traps_test.wac`, printed 108 lines of
        // `wasm://wasm/00083c3e:39651: Uncaught RuntimeError: unreachable` around the single line of
        // its own report. The runner already says what happened, and says it better — it knows which
        // test trapped and whether the test wanted to.
        //
        // **And the noise was the smaller half.** An uncaught trap leaves its exception *pending on
        // the isolate*, and a pending exception makes the next `compile` walk into V8's own
        // `Check failed: maybe_compiled.is_null() == i_isolate->has_exception()` and abort the
        // process — the hazard the module loop in `validate_modules` already documents. Nothing here
        // compiled twice until `Cli.load` existed (`issues/system/0240c`), which is why it had never
        // been reached. Two agents found this from opposite ends within an hour; see the merge in
        // this file's history.
        let outcome = {
            let tc = std::pin::pin!(v8::TryCatch::new(scope));
            let mut tc = tc.init();
            let out = f.call(&mut tc, exports.into(), &args);
            tc.reset();
            out
        };
        if profile_dir.is_some() && cov.is_some() {
            let after = counters_now(scope, exports);
            let mut mine: Vec<String> = Vec::new();
            for (i, now) in after.iter().enumerate() {
                if *now > before.get(i).copied().unwrap_or(0) {
                    if let Some(l) = lines.get(i) {
                        if !mine.contains(l) {
                            mine.push(l.clone());
                        }
                    }
                }
            }
            reached.push((shown.clone(), mine));
        }
        // **`test_traps_*` expects the trap.** A trap unwinds this module and nothing else — the
        // tests after it run normally — so the runner has always survived one; what it could not do
        // was let a test *say* it wanted one, and a trap was therefore unconditionally a failure.
        // That is why 72 of this repository's test files are still TypeScript: `assertTraps` had
        // nowhere to live in wac, and half the promises in `spec/spec/casts.md`, every bounds check
        // and `!` on a null are about trapping. `issues/system/0161`.
        //
        // A name rather than an attribute because the runner works from the export list: it knows a
        // test by its name and signature and nothing else.
        let wants_trap = e.name.starts_with("test_traps_") || e.name.starts_with("testTraps");
        match outcome {
            None if wants_trap => {
                if loud {
                    let said = trap_said(scope, exports);
                    println!(
                        "ok   {} — trapped, as it says{} ({} ms)",
                        shown,
                        said,
                        began.elapsed().as_millis()
                    );
                }
                passed += 1;
            }
            None => {
                // **The trap's own sentence, if it wrote one.** A trap leaves nothing to *return* —
                // the call is over and V8 has unwound — which is why this said only "trapped" for as
                // long as there was nowhere for a message to survive. `trap "…"` puts it in a global
                // now and `$trap$message` reads it afterwards (`issues/lang/0147`), so the one line a
                // reader gets when a test breaks can carry what the program wrote for that moment.
                //
                // Empty for an engine trap — a bounds check, a null dereference — which writes
                // nothing; a previous message reported for one of those would be worse than none.
                println!("FAIL {shown} — trapped{}", trap_said(scope, exports));
                failed += 1;
            }
            Some(v) if wants_trap => {
                // **Returning is the failure here, and the report is ignored on purpose.** A test
                // named for a trap that returns cleanly has not observed the thing it is about, and
                // an empty string from it would otherwise read as a pass.
                let report = read_string(scope, v);
                let tail = if report.is_empty() { String::new() } else { format!(" — {report}") };
                println!("FAIL {shown} — returned instead of trapping{tail}");
                failed += 1;
            }
            Some(v) => {
                let report = read_string(scope, v);
                if report.is_empty() {
                    if loud {
                        println!("ok   {shown} ({} ms)", began.elapsed().as_millis());
                    }
                    passed += 1;
                } else {
                    println!("FAIL {shown} — {report}");
                    failed += 1;
                }
            }
        }
    }

    if !skipped.is_empty() {
        println!(
            "{} test(s) need an oracle from the host and were skipped: {}",
            skipped.len(),
            skipped.join(", ")
        );
    }
    if !ungranted.is_empty() {
        UNGRANTED_TESTS.fetch_add(ungranted.len(), std::sync::atomic::Ordering::Relaxed);
        println!(
            "{} test(s) want a capability this run was not granted: {} — try `wac test --allow-read …`",
            ungranted.len(),
            ungranted.join(", ")
        );
    }
    if passed == 0 && failed == 0 && filtered > 0 {
        // **Not a failure, and not silence either.** Over a directory most files will not hold the
        // test being filtered for, and reporting each as broken would drown the one that matched.
        // A filter that matches nothing *anywhere* is still an error — `test_command` says so once,
        // at the end, where it can see every file.
        // **5, distinct from 4.** Both mean "nothing ran here", and the caller has to tell them
        // apart: a file the filter passed over is fine during discovery and is a mistake when it
        // is the file you named.
        println!("(no test matches --filter {})", only.unwrap_or_default());
        return 5;
    }
    if passed == 0 && failed == 0 {
        // Two different nothings, and saying so is the difference between *this file is not a test
        // file* and *this host cannot run these tests*. The tor and TLS suites are almost entirely
        // the second: they compare against a real implementation, and the comparison arrives as an
        // argument.
        if skipped.is_empty() && ungranted.is_empty() {
            eprintln!("wac: {} exports no tests — a test is `test*()` answering a string", m.entry);
            if let Some(dir) = &profile_dir {
                write_profile(dir, &m.entry, &lines, &reached, &skipped);
            }
            return 1;
        }
        // **4, and not a failure.** 31 of this repository's 83 test files are entirely of this
        // kind — they compare against a real implementation and the comparison arrives as an
        // argument. Calling that a failure would mean `wac test packages/` could never be green
        // here, which would make the exit code useless for the one thing an exit code is for.
        // **Named separately, because the remedies differ.** An oracle needs a host; a capability
        // needs a flag on this command line, and a reader told "needs an oracle" would go looking
        // for the wrong thing. Both are 4: nothing ran here, and neither is a failure.
        if skipped.is_empty() {
            UNGRANTED_FILES.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            eprintln!(
                "wac: every test in {} wants a capability this run was not granted — try `--allow-read`",
                shown_entry
            );
        } else {
            eprintln!(
                "wac: every test in {} needs an oracle from the host, which this cannot supply",
                shown_entry
            );
        }
        // **A profile even so, with nothing in `tests`.** A reader that sees no file at all has to
        // guess whether this was asked and answered nothing or never asked, and guessing wrong the
        // second way means treating every line these tests reach as unhit — which is the
        // under-selection a profile exists to prevent. `issues/system/0161`.
        if let Some(dir) = &profile_dir {
            write_profile(dir, &m.entry, &lines, &reached, &skipped);
        }
        return 4;
    }
    if let Some(dir) = &profile_dir {
        write_profile(dir, &m.entry, &lines, &reached, &skipped);
    }
    let tail = if filtered > 0 { format!(", {filtered} filtered out") } else { String::new() };
    println!("{passed} passed, {failed} failed{tail}");
    if let Some(table) = cov {
        report_coverage(scope, exports, table);
    }
    // **3, not 1.** `spec/cli/wac.md` distinguishes "did not compile" from "ran and did something
    // wrong" because a script needs to; a test that ran and failed is the same distinction one step
    // further on, and returning 1 for both makes a red suite indistinguishable from a typo.
    if failed > 0 { 3 } else { 0 }
}

/// What the run reached, per file, from the counters and the table that says what each one is.
///
/// Per file rather than one number, because "83%" over a package says nothing about where to look —
/// and the table carries the file, so there is no reason to throw it away.
/// Every counter, now.
///
/// `report_coverage` reads them once at the end; attribution needs them either side of each test,
/// because what a test reached is the difference its own call made. Diffing rather than resetting:
/// `__cov_init` allocates the array, and asking it to double as a reset would be relying on a
/// detail of the generated code that nothing states.
/// One file's attribution, in the shape `tools/mutate/profile.ts` reads.
///
/// One JSON per test file rather than one for the run: the tool walks a directory, and a run over
/// eighty files would otherwise have to merge them itself. The name is the entry with its
/// separators flattened, which is enough to be unique and readable in a directory listing.
fn write_profile(
    dir: &str,
    entry: &str,
    all: &[String],
    reached: &[(String, Vec<String>)],
    skipped: &[String],
) {
    if std::fs::create_dir_all(dir).is_err() {
        return;
    }
    let mut uniq: Vec<&String> = Vec::new();
    for l in all {
        if !uniq.contains(&l) {
            uniq.push(l);
        }
    }
    let tests: serde_json::Map<String, serde_json::Value> = reached
        .iter()
        .map(|(name, ls)| (name.clone(), serde_json::json!(ls)))
        .collect();
    // **`skipped` is what makes this profile readable as complete or partial**, and an empty list
    // says so positively. 17 of this repository's test files are *mixed* — `rsa_test.wac` runs 3 of
    // its 12 tests here, the other 9 wanting an oracle the host supplies — so a reader taking the
    // `tests` map at face value would treat every line reached only by the other 9 as unhit, and
    // narrow a mutation sweep to tests that cannot notice it. Under-selection is a wrong verdict
    // arriving as a *better* score, which is the failure mode nothing downstream can see.
    // `issues/system/0161`.
    let doc = serde_json::json!({
        "entry": entry,
        "all": uniq,
        "tests": tests,
        "skipped": skipped,
    });
    let stem: String = entry
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == '.' { '_' } else { c })
        .collect();
    let _ = std::fs::write(
        std::path::Path::new(dir).join(format!("{stem}.json")),
        doc.to_string(),
    );
}

fn counters_now(scope: &mut v8::PinScope, exports: v8::Local<v8::Object>) -> Vec<i32> {
    let Some(len_fn) = get_export(scope, exports, "__cov_len") else { return Vec::new() };
    let Some(get_fn) = get_export(scope, exports, "__cov_get") else { return Vec::new() };
    let Some(len) = len_fn.call(scope, exports.into(), &[]).and_then(|v| v.to_int32(scope)) else {
        return Vec::new();
    };
    let len = len.value();
    let mut out = Vec::with_capacity(len.max(0) as usize);
    for i in 0..len {
        let idx = v8::Integer::new(scope, i);
        out.push(
            get_fn
                .call(scope, exports.into(), &[idx.into()])
                .and_then(|v| v.to_int32(scope))
                .map(|v| v.value())
                .unwrap_or(0),
        );
    }
    out
}

/// `index<TAB>line<TAB>col<TAB>kind<TAB>file` to the `file:line` a profile speaks in.
fn table_lines(table: &str) -> Vec<String> {
    table
        .lines()
        .map(|row| {
            let c: Vec<&str> = row.split('\t').collect();
            format!("{}:{}", c.get(4).unwrap_or(&""), c.get(1).unwrap_or(&""))
        })
        .collect()
}

fn report_coverage(scope: &mut v8::PinScope, exports: v8::Local<v8::Object>, table: &str) {
    let Some(len_fn) = get_export(scope, exports, "__cov_len") else { return };
    let Some(get_fn) = get_export(scope, exports, "__cov_get") else { return };
    let Some(len) = len_fn.call(scope, exports.into(), &[]).and_then(|v| v.to_int32(scope)) else {
        return;
    };
    let len = len.value();

    let mut counts = Vec::with_capacity(len.max(0) as usize);
    for i in 0..len {
        let idx = v8::Integer::new(scope, i);
        let n = get_fn
            .call(scope, exports.into(), &[idx.into()])
            .and_then(|v| v.to_int32(scope))
            .map(|v| v.value())
            .unwrap_or(0);
        counts.push(n);
    }

    // Insertion-ordered, so the report reads in the order the table names files rather than in a
    // hash's order — the same input twice has to print the same way.
    let mut files: Vec<(String, i32, i32)> = Vec::new();
    for row in table.lines() {
        let mut cells = row.split('\t');
        let Some(index) = cells.next().and_then(|c| c.parse::<usize>().ok()) else { continue };
        let (_line, _col, _kind) = (cells.next(), cells.next(), cells.next());
        let file = cells.next().unwrap_or("").to_string();
        let hit = counts.get(index).copied().unwrap_or(0) > 0;
        match files.iter_mut().find(|(f, _, _)| *f == file) {
            Some(e) => {
                e.1 += 1;
                e.2 += i32::from(hit);
            }
            None => files.push((file, 1, i32::from(hit))),
        }
    }

    let total: i32 = files.iter().map(|f| f.1).sum();
    let taken: i32 = files.iter().map(|f| f.2).sum();
    if total == 0 {
        return;
    }
    println!();
    println!("branch coverage: {taken} of {total} points ({}%)", taken * 100 / total);
    for (file, n, c) in &files {
        println!("  {c:>5} / {n:<5} {}", if file.is_empty() { "(unnamed)" } else { file });
    }
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
        // **A field that is not a callback is a value the module makes for itself.**
        //
        // Every other field of a capability is a function this host supplies; `Core.sched` is wac
        // state with wac logic on it, and the host's whole part is calling its `create` once. That
        // is what lets a program be *handed* a scheduler — `core.delay(…).then(f)` — without the
        // program assembling one, and without this host knowing what a continuation is.
        //
        // Looked up by convention (`<Type>.create`, no arguments) rather than by a new manifest
        // entry: the manifest already names every export, and a rule that reads is worth more here
        // than a field that would have to be kept in step in four hosts.
        let sig = match m.callback_index(&field.ty) {
            Some(sig) => sig,
            None => {
                let spec = m.find_struct(&field.ty).ok_or_else(|| {
                    format!(
                        "{name}.{} names {}, which no dispatcher serves and which the manifest \
                         does not describe",
                        field.name, field.ty
                    )
                })?;
                let made = spec
                    .methods
                    .iter()
                    .find(|mm| mm.name == "create")
                    .ok_or_else(|| {
                        format!(
                            "{name}.{} names {}, which no dispatcher serves and which has no \
                             `create` for this host to build it with",
                            field.name, field.ty
                        )
                    })?;
                let ctor = get_export(scope, exports, &made.export_name)
                    .ok_or_else(|| format!("no {}", made.export_name))?;
                let v = ctor
                    .call(scope, exports.into(), &[])
                    .ok_or_else(|| format!("{} trapped while building {name}", made.export_name))?;
                args.push(v);
                continue;
            }
        };
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

/// Where output goes, in the one order every writer must use.
///
/// A frame first — that is what "captured" means, and the applet cannot tell. Then the queue to the
/// **parent**, because a spawned child writes to whoever spawned it and not to the terminal. Only
/// then the process's own stream.
///
/// **Factored because `log` did not do any of it.** `Cap::Log` was a bare `println!`, so a spawned
/// child's `core.log` landed on the host's standard output while its parent read `recv` and heard
/// nothing — `issues/system/0169`, where the child's answers were all *correct* and simply went to the
/// wrong place. The wasmtime host has had one `emit` for log, warn, write and writeErr all along,
/// which is why it was right; this is that shape.
///
/// Answers whether the bytes landed, which is what `write` reports so a wac program can notice a
/// closed pipe. Into a frame it always lands.
fn emit_bytes(bytes: &[u8], to_stderr: bool) -> bool {
    let captured = HOST.with(|h| {
        let mut b = h.borrow_mut();
        let Some(s) = b.as_mut() else { return false };
        match s.frames.last_mut() {
            Some(f) => {
                if to_stderr { f.err.extend_from_slice(bytes) } else { f.out.extend_from_slice(bytes) }
                true
            }
            None => false,
        }
    });
    if captured {
        return true;
    }
    let to_parent = HOST.with(|h| {
        let b = h.borrow();
        let Some(s) = b.as_ref() else { return None };
        if to_stderr { s.child_err.clone() } else { s.child_out.clone() }
    });
    if let Some(q) = to_parent {
        return q.write(bytes);
    }
    if to_stderr {
        let mut err = std::io::stderr();
        return err.write_all(bytes).and_then(|_| err.flush()).is_ok();
    }
    HOST.with(|h| {
        let mut b = h.borrow_mut();
        match b.as_mut().and_then(|s| s.output.as_mut()) {
            Some(f) => f.write_all(bytes).and_then(|_| f.flush()).is_ok(),
            None => {
                let mut out = std::io::stdout();
                out.write_all(bytes).and_then(|_| out.flush()).is_ok()
            }
        }
    })
}

/// `wac run <file.wac> <name> [args…]` for a module with no `main`.
///
/// The reference CLI had this and the binary did not, which is the gap that kept `wacx` alive.
/// Arguments are coerced by the **declared parameter type** rather than guessed from the text —
/// `spec/cli/wac.md` — so `1` is an `i32` where one is declared and the string `"1"` where a
/// `string` is, and a `string` parameter takes the argument exactly as written, which is the whole
/// point of a command line.
fn call_named(
    scope: &mut v8::PinScope,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    args: &[String],
) -> i32 {
    let callable: Vec<&ExportSig> =
        m.exports.iter().filter(|e| !e.name.starts_with("$bind$")).collect();
    let listing = || {
        let mut names: Vec<String> = callable
            .iter()
            .map(|e| format!("{}({})", e.name, e.params.join(", ")))
            .collect();
        names.sort();
        names.join("\n  ")
    };
    let Some(name) = args.first() else {
        eprintln!("wac: {} exports no main, so name the function to run:", m.entry);
        eprintln!("  {}", listing());
        return 2;
    };
    let Some(sig) = callable.iter().find(|e| &e.name == name) else {
        eprintln!("wac: {} exports no `{name}`. It exports:", m.entry);
        eprintln!("  {}", listing());
        return 2;
    };
    let given = &args[1..];
    if given.len() != sig.params.len() {
        eprintln!(
            "wac: {}({}) takes {} argument(s), given {}",
            sig.name,
            sig.params.join(", "),
            sig.params.len(),
            given.len()
        );
        return 2;
    }

    let mut values: Vec<v8::Local<v8::Value>> = Vec::with_capacity(given.len());
    for (text, ty) in given.iter().zip(sig.params.iter()) {
        match coerce_arg(scope, text, ty) {
            Ok(v) => values.push(v),
            Err(why) => {
                eprintln!("wac: {why}");
                return 2;
            }
        }
    }

    let Some(f) = get_export(scope, exports, name) else {
        eprintln!("wac: {name} is not callable");
        return 1;
    };
    let Some(result) = f.call(scope, exports.into(), &values) else {
        // A trap is exit 2 rather than 1: the program ran and stopped, which is a different
        // outcome from one that never compiled.
        let said = trap_said(scope, exports);
        eprintln!("wac: {name} trapped{}", if said.is_empty() { String::new() } else { format!(": {said}") });
        return 2;
    };
    match print_returned(scope, result, &sig.ret) {
        Ok(()) => 0,
        Err(why) => {
            eprintln!("wac: {why}");
            1
        }
    }
}

/// A numeric array from raw little-endian bytes, through the same staging buffer `write_bytes`
/// uses and the module's own `$bind$arr_<ty>_from_mem`.
///
/// One function for every width rather than one per type: the staging step is identical and only
/// the helper's name and the element size differ, which is exactly what a second copy per type
/// would have got subtly wrong.
fn write_num_array<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    raw: &[u8],
    count: usize,
    helper: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let ensure = get_export(scope, exports, "$bind$mem_ensure")?;
    let want = v8::Integer::new(scope, raw.len() as i32);
    ensure.call(scope, exports.into(), &[want.into()])?;
    {
        let key = v8::String::new(scope, "$bind$mem")?;
        let mem = exports.get(scope, key.into())?;
        let mem: v8::Local<v8::WasmMemoryObject> = mem.try_into().ok()?;
        let buf = mem.buffer();
        let store = buf.get_backing_store().data()?;
        // Safety: the buffer was just grown to hold this many bytes and nothing runs between here
        // and the call below — the same reasoning `write_bytes` states.
        unsafe {
            std::ptr::copy_nonoverlapping(raw.as_ptr(), store.as_ptr() as *mut u8, raw.len());
        }
    }
    let from_mem = get_export(scope, exports, helper)?;
    let n = v8::Integer::new(scope, count as i32);
    from_mem.call(scope, exports.into(), &[n.into()])
}

/// One argument, as the declared type. `Err` names the argument rather than the call.
fn coerce_arg<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    text: &str,
    ty: &str,
) -> Result<v8::Local<'s, v8::Value>, String> {
    match ty {
        // `write_string` and `write_bytes` reach the instance through `HOST`, so they take no
        // `exports` — the staging buffer belongs to the one instance this process is running.
        "string" => write_string(scope, text)
            .ok_or_else(|| "this module cannot take a string argument".to_string()),
        "bool" => match text {
            "true" | "1" => Ok(v8::Boolean::new(scope, true).into()),
            "false" | "0" => Ok(v8::Boolean::new(scope, false).into()),
            _ => Err(format!("`{text}` is not a bool — write true, false, 1 or 0")),
        },
        "i64" | "u64" => text
            .parse::<i64>()
            .map(|n| v8::BigInt::new_from_i64(scope, n).into())
            .map_err(|_| format!("`{text}` is not an {ty}")),
        "f64" | "f32" => text
            .parse::<f64>()
            .map(|n| v8::Number::new(scope, n).into())
            .map_err(|_| format!("`{text}` is not an {ty}")),
        "i32" | "u32" | "i8" | "u8" | "i16" | "u16" => text
            .parse::<i64>()
            .map(|n| v8::Number::new(scope, n as f64).into())
            .map_err(|_| format!("`{text}` is not an {ty}")),
        "u8[]" => {
            let bytes = parse_list(text)?
                .iter()
                .map(|e| e.parse::<u8>().map_err(|_| format!("`{e}` is not a u8")))
                .collect::<Result<Vec<u8>, String>>()?;
            write_bytes(scope, &bytes)
                .ok_or_else(|| "this module cannot take a u8[] argument".to_string())
        }
        "i32[]" | "u32[]" => {
            let xs = parse_list(text)?
                .iter()
                .map(|e| e.parse::<i32>().map_err(|_| format!("`{e}` is not an i32")))
                .collect::<Result<Vec<i32>, String>>()?;
            let raw: Vec<u8> = xs.iter().flat_map(|v| v.to_le_bytes()).collect();
            write_num_array(scope, &raw, xs.len(), "$bind$arr_i32_from_mem")
                .ok_or_else(|| "this module cannot take an i32[] argument".to_string())
        }
        "i64[]" | "u64[]" => {
            let xs = parse_list(text)?
                .iter()
                .map(|e| e.parse::<i64>().map_err(|_| format!("`{e}` is not an i64")))
                .collect::<Result<Vec<i64>, String>>()?;
            let raw: Vec<u8> = xs.iter().flat_map(|v| v.to_le_bytes()).collect();
            write_num_array(scope, &raw, xs.len(), "$bind$arr_i64_from_mem")
                .ok_or_else(|| "this module cannot take an i64[] argument".to_string())
        }
        "f64[]" => {
            let xs = parse_list(text)?
                .iter()
                .map(|e| e.parse::<f64>().map_err(|_| format!("`{e}` is not an f64")))
                .collect::<Result<Vec<f64>, String>>()?;
            let raw: Vec<u8> = xs.iter().flat_map(|v| v.to_le_bytes()).collect();
            write_num_array(scope, &raw, xs.len(), "$bind$arr_f64_from_mem")
                .ok_or_else(|| "this module cannot take an f64[] argument".to_string())
        }
        other => Err(format!(
            "a `{other}` cannot be written on a command line; `wac run` takes numbers, bools, \
             strings, and arrays of u8, i32, i64 and f64"
        )),
    }
}

/// The elements of a list argument. Brackets are accepted because people type them, and an empty
/// list is empty rather than one empty element.
fn parse_list(text: &str) -> Result<Vec<String>, String> {
    let inner = text.trim();
    let inner = inner.strip_prefix('[').unwrap_or(inner);
    let inner = inner.strip_suffix(']').unwrap_or(inner);
    let inner = inner.trim();
    if inner.is_empty() {
        return Ok(Vec::new());
    }
    Ok(inner.split(',').map(|e| e.trim().to_string()).collect())
}

/// What the call answered, printed by its declared return type. `void` prints nothing.
fn print_returned(
    scope: &mut v8::PinScope,
    v: v8::Local<v8::Value>,
    ret: &str,
) -> Result<(), String> {
    match ret {
        "" | "void" => Ok(()),
        // A wac `bool` crosses as a number, so this printed `0` and `1` for a function whose
        // argument the caller had just written as `true`. Printed back in the spelling it is read
        // in, because a CLI that answers in a different vocabulary from the one it accepts is one
        // more thing to remember.
        "bool" => {
            println!("{}", if v.boolean_value(scope) { "true" } else { "false" });
            Ok(())
        }
        "string" => {
            println!("{}", read_string(scope, v));
            Ok(())
        }
        "u8[]" => {
            let bytes = read_bytes(scope, v);
            println!(
                "{}",
                bytes.iter().map(|b| b.to_string()).collect::<Vec<_>>().join(" ")
            );
            Ok(())
        }
        "i32[]" => {
            let xs = read_i32_array(scope, v);
            println!("{}", xs.iter().map(|x| x.to_string()).collect::<Vec<_>>().join(" "));
            Ok(())
        }
        _ => {
            println!("{}", v.to_rust_string_lossy(scope));
            Ok(())
        }
    }
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
        // **One slot per capability, not per `Pending<T>`.** `settled` and `drop` do not depend on
        // `T` — every instantiation registers the same `Cap::Settled` and `Cap::Discard` — and
        // registering them per type burned a slot each time: `wc` has **15** `Pending<T>` types, so
        // both of those signature classes sat at 15 of the module's 16 trampolines. One more
        // capability answering through a new `Pending<T>` fills them, for every program, whether or
        // not it uses that capability. `issues/lang/0109`.
        //
        // Reusing is not a saving, it is the truth: the same capability reached through the same
        // signature is the same function, and the slot is what the module calls it by.
        let slot = match caps[sig].iter().position(|c| *c == cap) {
            Some(i) => i,
            None => {
                caps[sig].push(cap);
                names[sig].push(format!("{name}.{field}"));
                caps[sig].len() - 1
            }
        };
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
/// A path as a pushed child means it — joined onto the frame's `cwd`.
///
/// **The native host was not doing this and the Deno host was**, so the same program answered
/// differently depending on which ran it: `packages/platform/example/inside.wac` writes `note.txt` into
/// the directory it is given, pushes a child with that directory as its `cwd`, and the child opens
/// `note.txt` by name — which resolved against the *process* directory here and found nothing.
/// `issues/system/0199`.
///
/// `Cap::Cwd` already answered from the frame, so the program was told where it was and then had its
/// paths resolved somewhere else. That is the worst arrangement of the two halves.
///
/// Semantics copied from `packages/platform/host/child.ts`'s `joinPath`, deliberately including what it
/// does *not* do: `.` and `..` are left alone, because every host below understands them and
/// reimplementing them here would be a second opinion about what a path means.
///
/// **The frame's `cwd` only, not `cwd_override`.** The Deno host's `P` also folds in the world's own
/// `opts.cwd`, so the two still differ about *that* — but applying it here broke
/// `packages/platform/test/wac/v8host_test.wac`'s image differential, where a spawned `imaged` child
/// stopped being able to read the image its parent served. Measured by isolating the two halves: with
/// the frame alone the lane is 34 of 34, and with the override folded in it is 33. So the spawned-child
/// case is a separate question from this issue's, and closing one blind broke something real.
fn framed_path(path: &str) -> String {
    let base = HOST.with(|h| {
        let b = h.borrow();
        let s = b.as_ref()?;
        s.frames.last().map(|f| f.cwd.clone())
    });
    let cwd = match base {
        Some(d) if !d.is_empty() => d,
        _ => return path.to_string(),
    };
    if path.starts_with('/') {
        return path.to_string();
    }
    if path.is_empty() {
        return cwd;
    }
    if cwd.ends_with('/') { format!("{cwd}{path}") } else { format!("{cwd}/{path}") }
}

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
            // The newline `log` adds, added *before* the routing rather than at the terminal, so that
            // a captured frame and a parent reading a child both get it: `log` is where thirty of
            // `packages/box`'s applets send their output, and a capture that dropped the line endings
            // would join every line of `ls` into one.
            let mut bytes = text.into_bytes();
            bytes.push(b'\n');
            emit_bytes(&bytes, cap == Cap::Warn);
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
            // **Wherever output currently goes** — a frame, a parent, or this process's stream, in
            // that order, and `openOutput` may have pointed the last one at a file. One helper, so
            // `log` cannot drift from `write` again; see `emit_bytes`.
            rv.set_bool(emit_bytes(&bytes, cap == Cap::WriteErr));
        }
        Cap::ReadFile => {
            let path = framed_path(&read_string(scope, args.get(1)));
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
                    Err(e) => Answer::File(false, Vec::new(), message_of(&e), fault_of(&e)),
                };
                let _ = worker.complete(id, a);
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
        Cap::AskInterrupt => {
            // **Nobody can ask this host to interrupt, so the answer is no** — and that is the
            // answer rather than a stub. The terminal belongs to whatever started the program;
            // only a page can say yes, because there the keydown listener and the code servicing
            // this bridge are the same thread. Direct rather than a ticket: `askInterrupt` is
            // `fn[i32()]`, and settling one would answer a `Pending<i32>` nobody asked for.
            let v = v8::Integer::new(scope, 0);
            rv.set(v.into());
        }
        Cap::Spawn => {
            // **`spawnSelf` only.** `spawn(path, …)` runs a *different* bundle, which means reading
            // and compiling one; `spawnSelf` runs this same module with new arguments, which is what
            // `packages/sh` uses for a background job and what box's dispatcher needs. The first
            // argument tells them apart: `spawn` is given a path and `spawnSelf` is not.
            //
            // A child is a thread with its own V8 isolate — an isolate belongs to one thread, so
            // there is no sharing to be had — compiling the same bytes again and running `main`.
            // `u8[][]`, not `string[]` — 0148. `pushChild` below is the one that takes text.
            let argv = read_bytes_array(scope, args.get(1));
            let grant_bits = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let cwd = read_string(scope, args.get(3));
            let inherits = args.get(4).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
            // The fifth and last wac argument. Read rather than dropped as it used to be, which is
            // the whole of 0157: a parent that offered to serve a filesystem was never asked to.
            let serve_fs = args.get(5).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;

            let out = Arc::new(Stream::capped());
            let err = Arc::new(Stream::capped());
            let input = Arc::new(Stream::uncapped());
            let feed = input.clone();
            let (wasm, manifest_text, parent_grants) = HOST.with(|h| {
                let b = h.borrow();
                let s = b.as_ref().expect("host");
                (s.wasm.clone(), s.manifest_text.clone(), s.grants)
            });
            // **A child cannot be given more than its parent has.** The bits it asks for are
            // intersected rather than trusted, which is the whole of what a grant means.
            let grants = Grants {
                read: parent_grants.read && grant_bits & GRANT_READ != 0,
                write: parent_grants.write && grant_bits & GRANT_WRITE != 0,
                env: parent_grants.env && grant_bits & GRANT_ENV != 0,
                net: parent_grants.net && grant_bits & GRANT_NET != 0,
                // **Not inheritable yet.** `GRANT_*` has no bit for running a host program, and a
                // child that could exec would be a confined wasm module handed the one authority
                // confinement is for. Allocating a bit needs a `GRANT_RUN` in `platform.wac` and a
                // stage in `wacland` that proves the ceiling holds for it; until then, denied.
                run: false,
            };

            let handle = keep_socket(Sock::Queue(out.clone()));
            let err_handle = keep_socket(Sock::Queue(err.clone()));
            // **The filesystem channel, when the parent offered one.** The read side becomes an
            // ordinary handle in this instance's socket table, so `recv(fsHandle)` and `waitAny`
            // over it work with no capability of their own; the write side goes in `child_feeds`
            // under the same handle, which is what `send` consults first. Two maps, one number, and
            // the conversation is the one `platform.wac`'s `Child.fsHandle` documents. 0157.
            let (fs_req, fs_rep, fs_handle) = if serve_fs {
                let req = Arc::new(Stream::uncapped());
                let rep = Arc::new(Stream::uncapped());
                let h = keep_socket(Sock::Queue(req.clone()));
                HOST.with(|hs| {
                    if let Some(st) = hs.borrow_mut().as_mut() {
                        st.child_feeds.insert(h, rep.clone());
                    }
                });
                (Some(req), Some(rep), h)
            } else {
                // -1 is what `Child.fsHandle` means by "there is no channel", and the child's
                // `recv(PARENT_FS)` answers "ended" for the same reason.
                (None, None, -1)
            };
            if std::env::var_os("WACV8_TRACE").is_some() {
                let shown: Vec<String> =
                    argv.iter().map(|a| String::from_utf8_lossy(a).into_owned()).collect();
                eprintln!("[trace] {:?} spawn argv={shown:?} -> handle {handle}, err {err_handle}", std::thread::current().id());
            }
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let exit_id = t.submit();
            let worker = t.clone();
            let child = AsChild {
                entry: Entry::Main,
                cov: None,
                only: None,
                file_suffix: None,
                shown_entry: None,
                loud: false,
                // A spawned child is never a coverage run: `covdump` is the parent's command, and a
                // child printing its parent's counters would interleave two tables.
                dump_counters: false,
                cov_exports: Vec::new(),
                argv,
                grants: Some(grants),
                cwd: if cwd.is_empty() { None } else { Some(cwd) },
                out: Some(out.clone()),
                err: Some(err.clone()),
                input: Some(input),
                inherits,
                fs_req: fs_req.clone(),
                fs_rep: fs_rep.clone(),
            };
            std::thread::spawn(move || {
                let manifest: Manifest = match serde_json::from_str(&manifest_text) {
                    Ok(m) => m,
                    Err(_) => {
                        out.finish();
                        err.finish();
                        let _ = worker.complete(exit_id, Answer::I32(127));
                        return;
                    }
                };
                let code = run_as(&manifest, &wasm, child);
                // **Both streams end when the child does**, or a parent reading them waits for ever.
                out.finish();
                err.finish();
                // And the channel with them: a parent serving a child sits in `recv(fsHandle)`
                // waiting for the next request, and the child having exited is the only thing that
                // says there will not be one. 0157.
                if let Some(req) = fs_req.as_ref() { req.finish(); }
                let _ = worker.complete(exit_id, Answer::I32(code));
            });
            HOST.with(|h| {
                if let Some(s) = h.borrow_mut().as_mut() {
                    s.child_exits.insert(handle, exit_id);
                    s.child_feeds.insert(handle, feed);
                }
            });
            let a = Answer::Child(handle, err_handle, fs_handle, String::new());
            match ticket_for(scope, "Child", a) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Child> for spawn"),
            }
        }
        Cap::CloseFeed => {
            // **Ends a child's input without stopping it.** A program that reads to the end before
            // answering — `wc` is the obvious one — needs the end while it is still running, so this
            // finishes the queue rather than dropping the child.
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let feed = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_feeds.get(&handle).cloned())
            });
            if let Some(q) = feed {
                q.finish();
            }
            rv.set_undefined();
        }
        Cap::SpawnOther => {
            // **`spawn` takes a program's bytes, and here a program is a wasm module** that carries
            // its own manifest. That is the whole of what this host needs: a module describes its
            // own capability structs and dispatchers, so a child can be started from bytes alone
            // without a second file the parent has no way to find.
            //
            // A JavaScript worker bundle — what the JS hosts are handed — is not a program here, and
            // that answers -1 with a reason rather than -2: -2 means this world has no `spawn` at
            // all, and a caller reading it gives up on `spawnSelf` too, which works.
            let bytes = read_bytes(scope, args.get(1));
            let Some(text) = manifest_in(&bytes) else {
                let why = if bytes.len() >= 4 && &bytes[0..4] == b"\0asm" {
                    "that module carries no wac.manifest section, so this runtime cannot describe it"
                } else {
                    "this runtime starts wasm modules, and that is not one; spawnSelf works"
                };
                let a = Answer::Child(-1, -1, -1, why.into());
                match ticket_for(scope, "Child", a) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Child> for spawn"),
                }
                return;
            };

            // `u8[][]` here too: `spawn` differs from `spawnSelf` only by the bytes in front. 0148.
            let argv = read_bytes_array(scope, args.get(2));
            let grant_bits = args.get(3).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let cwd = read_string(scope, args.get(4));
            let inherits = args.get(5).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
            // The sixth here against the fifth in `spawnSelf`: same list with the program's bytes
            // in front. Getting this index wrong is silent — it reads as `serveFs` never being
            // asked for, which is what 0157 looked like.
            let serve_fs = args.get(6).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;

            let out = Arc::new(Stream::capped());
            let err = Arc::new(Stream::capped());
            let input = Arc::new(Stream::uncapped());
            let feed = input.clone();
            let parent_grants = HOST.with(|h| h.borrow().as_ref().map(|s| s.grants).unwrap_or_default());
            let grants = Grants {
                read: parent_grants.read && grant_bits & GRANT_READ != 0,
                write: parent_grants.write && grant_bits & GRANT_WRITE != 0,
                env: parent_grants.env && grant_bits & GRANT_ENV != 0,
                net: parent_grants.net && grant_bits & GRANT_NET != 0,
                // **Not inheritable yet.** `GRANT_*` has no bit for running a host program, and a
                // child that could exec would be a confined wasm module handed the one authority
                // confinement is for. Allocating a bit needs a `GRANT_RUN` in `platform.wac` and a
                // stage in `wacland` that proves the ceiling holds for it; until then, denied.
                run: false,
            };

            let handle = keep_socket(Sock::Queue(out.clone()));
            let err_handle = keep_socket(Sock::Queue(err.clone()));
            // **The filesystem channel, when the parent offered one.** The read side becomes an
            // ordinary handle in this instance's socket table, so `recv(fsHandle)` and `waitAny`
            // over it work with no capability of their own; the write side goes in `child_feeds`
            // under the same handle, which is what `send` consults first. Two maps, one number, and
            // the conversation is the one `platform.wac`'s `Child.fsHandle` documents. 0157.
            let (fs_req, fs_rep, fs_handle) = if serve_fs {
                let req = Arc::new(Stream::uncapped());
                let rep = Arc::new(Stream::uncapped());
                let h = keep_socket(Sock::Queue(req.clone()));
                HOST.with(|hs| {
                    if let Some(st) = hs.borrow_mut().as_mut() {
                        st.child_feeds.insert(h, rep.clone());
                    }
                });
                (Some(req), Some(rep), h)
            } else {
                // -1 is what `Child.fsHandle` means by "there is no channel", and the child's
                // `recv(PARENT_FS)` answers "ended" for the same reason.
                (None, None, -1)
            };
            if std::env::var_os("WACV8_TRACE").is_some() {
                let shown: Vec<String> =
                    argv.iter().map(|a| String::from_utf8_lossy(a).into_owned()).collect();
                eprintln!("[trace] {:?} spawn argv={shown:?} -> handle {handle}, err {err_handle}", std::thread::current().id());
            }
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let exit_id = t.submit();
            let worker = t.clone();
            let child = AsChild {
                entry: Entry::Main,
                cov: None,
                only: None,
                file_suffix: None,
                shown_entry: None,
                loud: false,
                // A spawned child is never a coverage run: `covdump` is the parent's command, and a
                // child printing its parent's counters would interleave two tables.
                dump_counters: false,
                cov_exports: Vec::new(),
                argv,
                grants: Some(grants),
                cwd: if cwd.is_empty() { None } else { Some(cwd) },
                out: Some(out.clone()),
                err: Some(err.clone()),
                input: Some(input),
                inherits,
                fs_req: fs_req.clone(),
                fs_rep: fs_rep.clone(),
            };
            std::thread::spawn(move || {
                // **A different program**, so its own manifest and its own bytes — the only thing it
                // shares with its parent is the queues.
                let code = match serde_json::from_str::<Manifest>(&text) {
                    Ok(m) => run_as_with(&m, &bytes, &text, child),
                    Err(_) => 127,
                };
                out.finish();
                err.finish();
                if let Some(req) = fs_req.as_ref() { req.finish(); }   // see the arm above — 0157
                let _ = worker.complete(exit_id, Answer::I32(code));
            });
            HOST.with(|h| {
                if let Some(s) = h.borrow_mut().as_mut() {
                    s.child_exits.insert(handle, exit_id);
                    s.child_feeds.insert(handle, feed);
                }
            });
            let a = Answer::Child(handle, err_handle, fs_handle, String::new());
            match ticket_for(scope, "Child", a) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Child> for spawn"),
            }
        }
        Cap::ExitCode => {
            // **The child's ticket, not a poll.** A parent may ask before the child has started;
            // blocking on the ticket is the answer, and the table already does that correctly.
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let known = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_exits.get(&handle).copied())
            });
            match known {
                Some(id) => {
                    // Hand back the child's own ticket rather than a fresh one: the answer is
                    // already promised to that id, and two tickets for one fact is how a `wait`
                    // comes to block for ever.
                    match ticket_pending(scope, "i32", id) {
                        Some(p) => rv.set(p),
                        None => throw(scope, "this program has no Pending<i32> for exitCode"),
                    }
                }
                // Nothing was spawned under that handle. 127 is what a shell says about a command
                // it could not run, which is the truth here.
                None => match ticket_for(scope, "i32", Answer::I32(127)) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<i32> for exitCode"),
                },
            }
        }
        Cap::ReadStdin => {
            // **All of it, to the end** — the unbounded read, as against `readChunk`'s bounded one.
            // A frame's input answers here too, because an applet that reads all of stdin should get
            // what its caller handed it rather than the terminal behind them both.
            // **A child reads what its parent sent, here too.** `readChunk` had this branch and
            // this one did not, so a spawned `wc` read the *process's* standard input — empty — and
            // answered `0 0 0` to a question its parent had asked with bytes in hand. The bounded
            // read and the unbounded one are two capabilities and one rule.
            let from_parent = HOST.with(|h| {
                let b = h.borrow();
                let s = b.as_ref()?;
                if s.inherits { None } else { s.child_input.clone() }
            });
            if let Some(q) = from_parent {
                let Some(t) = table() else { return throw(scope, "no ticket table") };
                let id = t.submit();
                let worker = t.clone();
                std::thread::spawn(move || {
                    // To the end, which is what this capability is: every chunk until the parent
                    // says there are no more.
                    let mut all = Vec::new();
                    loop {
                        let chunk = q.read();
                        if chunk.is_empty() {
                            break;
                        }
                        all.extend_from_slice(&chunk);
                    }
                    let _ = worker.complete(id, Answer::Bytes(Some(all)));
                });
                match ticket_pending(scope, "u8[]", id) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<u8[]> for readStdin"),
                }
                return;
            }
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
                let _ = worker.complete(id, a);
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
        Cap::BindDatagram => {
            // The same one grant as `connect` and `listen`: the authority is "speak to something
            // that is not this process", and the transport does not change what that means.
            let address = read_string(scope, args.get(1));
            let port = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.net));
            let answer = if !granted {
                Answer::Socket(-1, "Not granted to this application".into(), String::new(), 0,
                               FAULT_NOT_GRANTED)
            } else {
                let host = if address.is_empty() { "0.0.0.0" } else { address.as_str() };
                match std::net::UdpSocket::bind((host, port as u16)) {
                    Ok(sk) => {
                        let bound = sk.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let handle = keep_socket(Sock::Datagram(sk));
                        Answer::Socket(handle, String::new(), String::new(), bound, FAULT_NONE)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0, fault_of(&e)),
                }
            };
            match ticket_for(scope, "Socket", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Socket> for bindDatagram"),
            }
        }
        Cap::ReceiveFrom => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let sock = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Datagram(sk)) => sk.try_clone().ok(),
                    _ => None,
                }
            });
            // A bad handle is known now and answers now — there is nothing to wait for.
            let Some(sk) = sock else {
                return match ticket_for(
                    scope,
                    "Datagram",
                    Answer::Datagram(Vec::new(), String::new(), 0, "not an open datagram socket".into()),
                ) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Datagram> for receiveFrom"),
                };
            };
            // **On a thread, with a live ticket — like `recv`, and for a sharper reason.**
            // `recv_from` used to run here, inline, and the ticket was built from the finished
            // answer; so the caller blocked *before* it had an id, and `waitAny` could not bound it.
            // `waitAny`'s own documentation promises the opposite — a deadline belongs to the wait
            // rather than to each capability — and this was the one capability where that mattered
            // most, because a stream read ends when the peer closes and a datagram read ends only
            // when a datagram arrives, which may be never. The Deno host had it right all along
            // (`submit(b, OP.RECEIVE_FROM, …)`), so a program correct under one host parked under
            // the other with nothing said. `issues/system/0206`.
            // **A datagram an abandoned reader took is here, and is answered now.** Otherwise the
            // packet a previous timed-out call swallowed would be lost — `issues/system/0207`.
            let queues = HOST.with(|h| h.borrow().as_ref().map(|st| st.datagrams.clone()));
            let waiting = queues.as_ref().and_then(|q| {
                let mut q = q.lock().unwrap();
                q.get_mut(&handle).and_then(|d| d.pop_front())
            });
            if let Some(a) = waiting {
                return match ticket_for(scope, "Datagram", a) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Datagram> for receiveFrom"),
                };
            }

            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            let parked = queues.clone();
            // Remembered so a *dropped* ticket knows which socket to put its answer back on: the
            // read can finish between the caller's deadline and its `drop`.
            if let Some(r) = HOST.with(|h| h.borrow().as_ref().map(|st| st.receiving.clone())) {
                r.lock().unwrap().insert(id, handle);
            }
            let registry = HOST.with(|h| h.borrow().as_ref().map(|st| st.receiving.clone()));
            std::thread::spawn(move || {
                // 65535 is the largest a UDP payload can be, so a buffer of it cannot truncate one.
                // Truncation here would be silent and would look like a peer sending short datagrams.
                let mut buf = vec![0u8; 65535];
                let a = match sk.recv_from(&mut buf) {
                    Ok((n, from)) => {
                        buf.truncate(n);
                        Answer::Datagram(buf, from.ip().to_string(), from.port() as i32, String::new())
                    }
                    Err(e) => Answer::Datagram(Vec::new(), String::new(), 0, e.to_string()),
                };
                if let Some(unclaimed) = worker.complete(id, a) {
                    // Nobody was waiting. A read error is nothing to keep — it describes a call that
                    // no longer exists — but a datagram is a packet, and it waits for the next
                    // reader on this socket.
                    if let Answer::Datagram(ref bytes, _, _, ref err) = unclaimed {
                        if err.is_empty() && !bytes.is_empty() {
                            if let Some(q) = parked {
                                q.lock().unwrap().entry(handle).or_default().push_back(unclaimed);
                            }
                        }
                    }
                }
                if let Some(r) = registry {
                    r.lock().unwrap().remove(&id);
                }
            });
            match ticket_pending(scope, "Datagram", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Datagram> for receiveFrom"),
            }
        }
        Cap::SendTo => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let address = read_string(scope, args.get(2));
            let port = args.get(3).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let body = read_bytes(scope, args.get(4));
            let sock = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Datagram(sk)) => sk.try_clone().ok(),
                    _ => None,
                }
            });
            let ok = match sock {
                None => false,
                Some(sk) => sk.send_to(&body, (address.as_str(), port as u16)).is_ok(),
            };
            match ticket_for(scope, "bool", Answer::Bool(ok)) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<bool> for sendTo"),
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
                Answer::Socket(-1, "Not granted to this application".into(), String::new(), 0,
                               FAULT_NOT_GRANTED)
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
                        Answer::Socket(handle, String::new(), String::new(), bound, FAULT_NONE)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0, fault_of(&e)),
                }
            } else {
                match std::net::TcpStream::connect((address.as_str(), port as u16)) {
                    Ok(sk) => {
                        let mine = sk.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let handle = keep_socket(Sock::Stream(sk));
                        Answer::Socket(handle, String::new(), String::new(), mine, FAULT_NONE)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0, fault_of(&e)),
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
                let a = Answer::Socket(-1, "no such listener".into(), String::new(), 0, FAULT_OTHER);
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
                        Answer::Socket(handle, String::new(), peer, port, FAULT_NONE)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0, fault_of(&e)),
                };
                let _ = worker.complete(id, a);
            });
            match ticket_pending(scope, "Socket", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Socket> to answer accept with"),
            }
        }
        Cap::Recv => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            enum Source {
                Socket(std::net::TcpStream),
                Queue(Arc<Stream>),
            }
            let source = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Stream(sk)) => sk.try_clone().ok().map(Source::Socket),
                    Some(Sock::Queue(q)) => Some(Source::Queue(q.clone())),
                    _ => None,
                }
            });
            let Some(source) = source else {
                // **Which handle, and what this instance actually has.** The message alone sent an
                // investigation looking for a lost socket when the number was negative all along —
                // a child that never started answers -1, and `recv` on it reads as a table fault
                // rather than as the spawn that failed. 0148.
                if std::env::var_os("WACV8_TRACE").is_some() {
                    let known = HOST.with(|h| {
                        h.borrow().as_ref().map(|st| {
                            let socks = st.sockets.lock().unwrap();
                            let mut v: Vec<i32> = socks.keys().copied().collect();
                            v.sort_unstable();
                            v
                        }).unwrap_or_default()
                    });
                    eprintln!("[trace] {:?} recv({handle}) -> not found; this instance holds {known:?}", std::thread::current().id());
                }
                // **An absent parent is an answer, not a fault.** `PARENT_FS` is a channel number
                // rather than a socket, and `Fs.fromParentOrHost` asks on it precisely to find out
                // whether there is a parent to ask — `packages/fs/src/fs.wac` reads a null back as
                // "use the host's filesystem". This host has no `serveFs` yet, so the honest answer
                // is always "ended", and throwing instead made every `box` applet trap: `wac sh.wasm
                // true` died before running anything. The JS host has said this all along, by
                // checking `n_HANDLE` before its socket table. issues/system/0148.
                if handle == PARENT_FS_HANDLE {
                    return match ticket_for(scope, "Read", Answer::Read(ReadAnswer::End)) {
                        Some(p) => rv.set(p),
                        None => throw(scope, "this program has no Pending<Read> to answer recv with"),
                    };
                }
                return throw(scope, "recv on something that is not a connected socket or a child");
            };
            if let Source::Queue(q) = source {
                let Some(t) = table() else { return throw(scope, "no ticket table") };
                let id = t.submit();
                let worker = t.clone();
                std::thread::spawn(move || {
                    let bytes = q.read();
                    let a = if bytes.is_empty() {
                        Answer::Read(ReadAnswer::End)
                    } else {
                        Answer::Read(ReadAnswer::Data(bytes))
                    };
                    let _ = worker.complete(id, a);
                });
                match ticket_pending(scope, "Read", id) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<Read> to answer recv with"),
                }
                return;
            }
            let Source::Socket(mut stream) = source else { unreachable!() };
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 65536];
                let a = match stream.read(&mut buf) {
                    Ok(0) => Answer::Read(ReadAnswer::End),
                    Ok(n) => Answer::Read(ReadAnswer::Data(buf[..n].to_vec())),
                    Err(e) => Answer::Read(ReadAnswer::Failed(message_of(&e))),
                };
                let _ = worker.complete(id, a);
            });
            match ticket_pending(scope, "Read", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Read> to answer recv with"),
            }
        }
        Cap::Send => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let bytes = read_bytes(scope, args.get(2));
            // **A child is fed on the same handle its output comes back on.** `send` knew only
            // sockets, so `runner` fed its child nothing and `wc` counted an empty stream — `0 0 0`,
            // which is a right-looking answer to a question never asked.
            let feed = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_feeds.get(&handle).cloned())
            });
            if let Some(q) = feed {
                let ok = q.write(&bytes);
                match ticket_for(scope, "bool", Answer::Bool(ok)) {
                    Some(p) => rv.set(p),
                    None => throw(scope, "this program has no Pending<bool> to answer send with"),
                }
                return;
            }
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
        // **End the outbound direction and keep reading** — `issues/system/0215`.
        //
        // Only a connected stream has two directions to separate, so a listener, a datagram socket
        // and a child's queue are left alone rather than half-closed by analogy. The handle stays in
        // the table: `recv` on it is the whole point, and the socket is closed by `closeSocket` as
        // before.
        //
        // An error from `shutdown` is dropped for the same reason `closeSocket` drops one — a peer
        // that has already gone is not a failure of this call, and a program that tidies up on every
        // path should not have to know which paths already did it.
        Cap::CloseSend => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            HOST.with(|h| {
                if let Some(st) = h.borrow().as_ref() {
                    if let Some(Sock::Stream(s)) = st.sockets.lock().unwrap().get(&handle) {
                        let _ = s.shutdown(std::net::Shutdown::Write);
                    }
                }
            });
            rv.set_undefined();
        }
        Cap::CloseSocket => {
            let handle = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            HOST.with(|h| {
                if let Some(st) = h.borrow().as_ref() {
                    st.sockets.lock().unwrap().remove(&handle);
                    // **And anything parked for it.** A handle is reused, so a datagram left over
                    // from a closed socket would be answered to whatever opens next —
                    // `issues/system/0207` is about not losing packets, not about inventing them.
                    st.datagrams.lock().unwrap().remove(&handle);
                }
            });
            rv.set_undefined();
        }
        Cap::ReadDir => {
            let path = framed_path(&read_string(scope, args.get(1)));
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
                let _ = worker.complete(id, a);
            });
            match ticket_pending(scope, "string[]", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<string[]> to answer readDir with"),
            }
        }
        // `Cli.load` — a module in this isolate, whose exports this program may call.
        // `issues/system/0240c`.
        Cap::Load => {
            let bytes = read_bytes(scope, args.get(1));
            let asked = args.get(2).int32_value(scope).unwrap_or(0);
            let (handle, why) = match load_module(scope, &bytes, asked) {
                Ok(h) => (h, String::new()),
                Err(e) => (-1, e),
            };
            match build_loaded(scope, handle, &why) {
                Some(v) => rv.set(v),
                None => throw(scope, "could not build a LoadedModule for the answer"),
            }
            return;
        }
        Cap::Call => {
            let handle = match args.get(1).int32_value(scope) {
                Some(n) => n,
                None => 0,
            };
            let name = read_string(scope, args.get(2));
            let arg = args.get(3).int32_value(scope).unwrap_or(0);
            let (status, text, value) = call_loaded(scope, handle, &name, arg);
            match build_called(scope, status, &text, value) {
                Some(v) => rv.set(v),
                None => throw(scope, "could not build a CallResult for the answer"),
            }
            return;
        }
        Cap::Unload => {
            if let Some(n) = args.get(1).int32_value(scope) {
                HOST.with(|h| {
                    if let Some(st) = h.borrow_mut().as_mut() {
                        st.loaded.remove(&n);
                    }
                });
            }
            return;
        }
        Cap::Exec => {
            // A host program, run to completion. `issues/system/0165`.
            //
            // **`--allow-run` is its own grant**, not `write`'s and not `spawn`'s. A build that may
            // start a confined wasm module must be able to refuse a host binary without refusing
            // both, and in a browser the second is always refused.
            //
            // **On a thread, so the ticket is handed back while the child is still running.** The
            // reads above touch the v8 heap and have to happen here; nothing in `run_host_program`
            // does. This used to run the child to completion inside the capability call and settle
            // the ticket in the same breath, so a `Pending<Exec>` on this host was a promise of
            // something that had already happened — three concurrent `sleep 1` were 3013ms here
            // against 1009ms for the same program on the Deno host, which dispatches and returns at
            // once. Issue 0211, held by `packages/platform/test/wac/exec_test.wac`. The lost overlap
            // was the smaller half: a ticket that exists only after the work is over cannot be
            // watched by `waitAny`, so a child that wedged had nothing bounding it.
            let path = read_string(scope, args.get(1));
            let argv: Vec<String> = read_string_array_bytes(scope, args.get(2))
                .into_iter()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .collect();
            let stdin = read_bytes(scope, args.get(3));
            let env: Vec<String> = read_string_array_bytes(scope, args.get(4))
                .into_iter()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .collect();
            let clear_env = args.get(5).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
            let inherit = args.get(6).to_int32(scope).map(|v| v.value()).unwrap_or(0) != 0;
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.run));
            if !granted {
                let refused =
                    Answer::Exec(0, Vec::new(), Vec::new(), "Not granted to this application".into());
                match ticket_for(scope, "Exec", refused) {
                    Some(v) => rv.set(v),
                    None => throw(scope, "this program has no Pending<Exec> to answer exec with"),
                }
                return;
            }
            let Some(t) = table() else { return throw(scope, "no ticket table") };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                // **Dropped deliberately, and the `#[must_use]` is why this says so.** An answer
                // nobody took means the ticket was cancelled while the child ran. A datagram in that
                // position is a packet lost (`issues/system/0207`); a finished process is not — it
                // ran, its effects happened, and its output is a computation the caller stopped
                // wanting. There is nothing to hand back to.
                let _ = worker.complete(
                    id,
                    run_host_program(path, argv, stdin, env, clear_env, inherit),
                );
            });
            match ticket_pending(scope, "Exec", id) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Exec> to answer exec with"),
            }
        }
        Cap::Rename | Cap::Remove | Cap::Mkdir | Cap::SetExecutable => {
            // Four mutations behind one grant, because they are one authority: the ability to change
            // what is on disk. Each answers a `Change`, and a refusal is `FAULT_NOT_GRANTED` rather
            // than the operating system's `FAULT_DENIED` — this build cannot, as against this file
            // will not.
            let a = framed_path(&read_string(scope, args.get(1)));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                let r = match cap {
                    Cap::Rename => {
                        let to = framed_path(&read_string(scope, args.get(2)));
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
                            // **Execute follows read, and clearing clears all three** — the rule the
                            // other three hosts implement and this one did not. It said "the
                            // owner-execute bit and nothing else, which is what `setExecutable` is:
                            // git's 100644 against its 100755", and git's 100755 is `0755` on checkout,
                            // not `0744`. Measured before the change: the same program setting the same
                            // file gave **744** here and **755** under Deno.
                            //
                            // `chmod +x`'s rule is what `packages/platform/host/deno.ts` and `node.ts`
                            // both carry with the reason — a file readable only by its owner becomes
                            // executable only by its owner — and `native/src/main.rs`, the wasmtime
                            // host, already had it. Clearing matters as much: `& !0o100` left group and
                            // other executable, so a file could go non-executable to its owner alone.
                            //
                            // `issues/system/0132`, and `conformance_test.wac` named this as a gap:
                            // "the arithmetic is duplicated three times and only the Deno copy is
                            // exercised, so a wrong mask in the other two would not be caught here".
                            perm.set_mode(if on { mode | ((mode & 0o444) >> 2) } else { mode & !0o111 });
                            std::fs::set_permissions(&a, perm)
                        })
                    }
                };
                match r {
                    Ok(()) => Answer::Change(FAULT_NONE, String::new()),
                    Err(e) => Answer::Change(fault_of(&e), message_of(&e)),
                }
            };
            match ticket_for(scope, "Change", answer) {
                Some(p) => rv.set(p),
                None => throw(scope, "this program has no Pending<Change> for that"),
            }
        }
        Cap::WriteFile => {
            let path = framed_path(&read_string(scope, args.get(1)));
            let data = read_bytes(scope, args.get(2));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                match std::fs::write(&path, &data) {
                    Ok(()) => Answer::Change(FAULT_NONE, String::new()),
                    Err(e) => Answer::Change(fault_of(&e), message_of(&e)),
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
            let path = framed_path(&read_string(scope, args.get(1)));
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
            let path = framed_path(&read_string(scope, args.get(1)));
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
                    Err(e) => Answer::Change(fault_of(&e), message_of(&e)),
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
            // A child reads what its parent sends — unless it inherits, when the terminal is what
            // was meant.
            let from_parent = HOST.with(|h| {
                let b = h.borrow();
                let s = b.as_ref()?;
                if s.inherits { None } else { s.child_input.clone() }
            });
            if let Some(q) = from_parent {
                let Some(t) = table() else { return throw(scope, "no ticket table") };
                let id = t.submit();
                let worker = t.clone();
                std::thread::spawn(move || {
                    let bytes = q.read();
                    let a = if bytes.is_empty() {
                        Answer::Read(ReadAnswer::End)
                    } else {
                        Answer::Read(ReadAnswer::Data(bytes))
                    };
                    let _ = worker.complete(id, a);
                });
                // `readChunk` is `fn[Read()]` — not a ticket — so this one blocks on the table
                // rather than handing a `Pending` back.
                let built = match table().and_then(|t| t.take(id)) {
                    Some(Answer::Read(ReadAnswer::Data(b))) => build_read_data(scope, &b),
                    Some(Answer::Read(ReadAnswer::Failed(w))) => build_read_failed(scope, &w),
                    _ => build_read_end(scope),
                };
                match built {
                    Some(v) => rv.set(v),
                    None => throw(scope, "could not build a Read for the parent's bytes"),
                }
                return;
            }
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
                Some(Err(e)) => build_read_failed(scope, &message_of(&e)),
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
            let path = framed_path(&read_string(scope, args.get(1)));
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
                    Err(e) => Answer::Change(fault_of(&e), message_of(&e)),
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
                let b = h.borrow();
                let s = b.as_ref()?;
                s.frames.last().map(|f| f.cwd.clone()).or_else(|| s.cwd_override.clone())
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
                let _ = worker.complete(id, Answer::I64(millis as i64));
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
        | Cap::ResolveDatagram
        | Cap::ResolveRead
        | Cap::ResolveBool
        | Cap::ResolveCaptured
        | Cap::ResolveExec
        | Cap::ResolveChild => {
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
                Some(Answer::Child(handle, err_handle, fs_handle, error)) => {
                    match build_child(scope, handle, err_handle, fs_handle, &error) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Child for the answer"),
                    }
                }
                Some(Answer::Exec(status, out, err, error)) => {
                    match build_exec(scope, status, &out, &err, &error) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build an Exec for the answer"),
                    }
                }
                Some(Answer::Captured(out, err, truncated)) => {
                    match build_captured(scope, &out, &err, truncated) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Captured for the answer"),
                    }
                }
                Some(Answer::Datagram(bytes, peer, port, error)) => {
                    match build_datagram(scope, &bytes, &peer, port, &error) {
                        Some(v) => rv.set(v),
                        None => throw(scope, "could not build a Datagram for the answer"),
                    }
                }
                Some(Answer::Socket(handle, error, peer, port, fault)) => {
                    match build_socket(scope, handle, &error, &peer, port, fault) {
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
                // **What the ticket already held goes back where it came from.** For most work
                // discarding it is right; for a `receiveFrom` the answer *is* a datagram, read off
                // the socket once. `issues/system/0207`.
                if let Some(answer) = t.drop_ticket(id) {
                    let socket = HOST.with(|h| {
                        h.borrow().as_ref().and_then(|st| st.receiving.lock().unwrap().remove(&id))
                    });
                    if let (Some(handle), Answer::Datagram(ref bytes, _, _, ref err)) =
                        (socket, &answer)
                    {
                        if err.is_empty() && !bytes.is_empty() {
                            if let Some(q) = HOST.with(|h| {
                                h.borrow().as_ref().map(|st| st.datagrams.clone())
                            }) {
                                q.lock().unwrap().entry(handle).or_default().push_back(answer);
                            }
                        }
                    }
                }
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

/// A wac `u8[][]` out of the module's memory — `spawn` and `spawnSelf`'s argv.
///
/// **Not `read_string_array_bytes`, and telling them apart is the whole of `issues/system/0148`.**
/// The three capabilities that take an argument list do not agree on its type: `pushChild` takes
/// `string[]`, while `spawn` and `spawnSelf` take `u8[][]` — `packages/platform/src/stream.wac` says
/// why, that an argument is bytes and not text (wac-mono 0065). Both spawns were read with the
/// `string[]` accessors, so `$bind$arr_string_len` was called on a `u8[][]` reference; the call fails
/// and *every* path in that reader returns an empty `Vec`. The child was therefore started with no
/// arguments at all, and a shell asked for nothing exits 0 without printing: `seq 1 3` through the
/// native host produced silence, and `imaged` printed its own usage, once per stage of the pipeline.
///
/// The module has always exported what this needs. `$bind$arr_u8Arr_len` and `$bind$arr_u8Arr_get`
/// are emitted for any `u8[][]` the boundary reaches — the outer array's helpers are named from the
/// element, so an array of `u8[]` is `u8Arr` — and nothing on this side ever asked for them.
fn read_bytes_array(scope: &mut v8::PinScope, v: v8::Local<v8::Value>) -> Vec<Vec<u8>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
    let Some(exports) = exports else { return Vec::new() };
    let exports = v8::Local::new(scope, exports);
    let Some(len_fn) = get_export(scope, exports, "$bind$arr_u8Arr_len") else { return Vec::new() };
    let Some(n) = len_fn.call(scope, exports.into(), &[v]).and_then(|r| r.to_int32(scope)) else {
        return Vec::new();
    };
    let n = n.value();
    let Some(get) = get_export(scope, exports, "$bind$arr_u8Arr_get") else { return Vec::new() };
    let mut out = Vec::with_capacity(n.max(0) as usize);
    for i in 0..n {
        let idx = v8::Integer::new(scope, i);
        let Some(item) = get.call(scope, exports.into(), &[v, idx.into()]) else { continue };
        // Each element is a `u8[]`, which is the reader a string takes minus the decode.
        out.push(read_bytes(scope, item));
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

/// `Child.of(handle, errHandle, fsHandle, error)`.
fn build_child<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    handle: i32,
    err_handle: i32,
    fs_handle: i32,
    error: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.child_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let msg = write_string(scope, error)?;
    let a = v8::Integer::new(scope, handle);
    let b = v8::Integer::new(scope, err_handle);
    let c = v8::Integer::new(scope, fs_handle);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[a.into(), b.into(), c.into(), msg])
}


/// Instantiate `wasm` in this isolate and keep what is needed to call into it.
///
/// **The same sequence `run_as_with` uses to start a program**, stopping before `main`: compile, build
/// one dispatcher per callback signature, instantiate, build the capability structs. The world it gets
/// is this program's own — `dispatch` reaches the same `HOST`, so a loaded module's `readFile` is
/// served exactly as its loader's is and the grants are the loader's by construction, which is why
/// `Cli.load` takes no grant argument. `issues/system/0240c`.
fn load_module(scope: &mut v8::PinScope, wasm: &[u8], asked: i32) -> Result<i32, String> {
    let Some(text) = manifest_in(wasm) else {
        return Err("this module carries no wac.manifest section".into());
    };
    let m: Manifest = serde_json::from_str(&text)
        .map_err(|e| format!("its wac.manifest section does not parse: {e}"))?;
    // No version check: this host's `Manifest` does not carry the field, and `serde` refusing an
    // incompatible shape is the check it has. `native/src/manifest.rs` is the one that versions.
    let module = v8::WasmModuleObject::compile(scope, wasm)
        .ok_or_else(|| "the engine would not compile it".to_string())?;

    // One dispatcher per callback signature, each carrying its index as external data — the same
    // shape as the program's own imports, because it is the same `dispatch`.
    let wac_ns = v8::Object::new(scope);
    for (j, cb) in m.callbacks.iter().enumerate() {
        let index = v8::Integer::new(scope, j as i32);
        let f = v8::Function::builder(dispatch)
            .data(index.into())
            .build(scope)
            .ok_or_else(|| "could not build a dispatcher".to_string())?;
        let key = v8::String::new(scope, &cb.field).ok_or_else(|| "a field name".to_string())?;
        wac_ns.set(scope, key.into(), f.into());
    }
    let imports = v8::Object::new(scope);
    let wac_key = v8::String::new(scope, "wac").ok_or_else(|| "the wac key".to_string())?;
    imports.set(scope, wac_key.into(), wac_ns.into());

    let context = scope.get_current_context();
    let global = context.global(scope);
    let mod_key = v8::String::new(scope, "__mod").ok_or_else(|| "__mod".to_string())?;
    global.set(scope, mod_key.into(), module.into());
    let imp_key = v8::String::new(scope, "__imports").ok_or_else(|| "__imports".to_string())?;
    global.set(scope, imp_key.into(), imports.into());
    let src = v8::String::new(scope, "new WebAssembly.Instance(__mod, __imports).exports")
        .ok_or_else(|| "the instantiation source".to_string())?;
    let script = v8::Script::compile(scope, src, None)
        .ok_or_else(|| "could not compile the instantiation".to_string())?;
    let exports = script
        .run(scope)
        .and_then(|v| v.to_object(scope))
        .ok_or_else(|| "it did not instantiate — an import it wants is missing".to_string())?;

    let mut caps: Vec<Vec<Cap>> = vec![Vec::new(); m.callbacks.len()];
    let mut names: Vec<Vec<String>> = vec![Vec::new(); m.callbacks.len()];
    let mut unsupported: Vec<String> = Vec::new();

    // **`Core` and `Cli`, and neither is required.** A module of pure test functions names no
    // capability, so its manifest has no `Core` — building one first is what made `wac test` refuse
    // every test file in this repository once, and the same mistake is available here.
    let mut world: Vec<v8::Global<v8::Value>> = Vec::new();
    if let Ok(core) = build_struct(scope, exports, &m, "Core", &mut caps, &mut names, &mut unsupported) {
        world.push(v8::Global::new(scope, core));
        if let Ok(cli) = build_struct(scope, exports, &m, "Cli", &mut caps, &mut names, &mut unsupported) {
            world.push(v8::Global::new(scope, cli));
        }
    }

    let of = |name: &str| -> Option<String> {
        m.find_struct(name)
            .and_then(|st| st.methods.iter().find(|mm| mm.name == "of"))
            .map(|mm| mm.export_name.clone())
    };
    // A ceiling of the caller's own: asking for more than this program holds is not an error, and the
    // module finds the capability denied — `spawn`'s rule, one layer in.
    let mine = HOST.with(|h| h.borrow().as_ref().map(|st| st.grants.clone())).unwrap_or_default();
    let entry = HeldModule {
        ctx: ModuleCtx {
            exports: v8::Global::new(scope, exports),
            caps,
            cap_names: names,
            grants: Grants {
                read: mine.read && (asked & GRANT_READ) != 0,
                write: mine.write && (asked & GRANT_WRITE) != 0,
                env: mine.env && (asked & GRANT_ENV) != 0,
                net: mine.net && (asked & GRANT_NET) != 0,
                // **Not inheritable, exactly as for a spawned child.** `GRANT_*` has no bit for
                // running a host program, and a loaded module that could `exec` would hold the one
                // authority this narrowing is for. `spawn_instance` in `native/src/main.rs` refuses
                // it in the same words, and both will gain it the same way.
                run: false,
            },
        },
        exports: m.exports.clone(),
        world,
        loaded_of: of("LoadedModule"),
        called_of: of("CallResult"),
    };
    Ok(HOST.with(|h| {
        let mut b = h.borrow_mut();
        let st = b.as_mut().expect("a host");
        let handle = st.next_loaded;
        st.next_loaded += 1;
        st.loaded.insert(handle, entry);
        handle
    }))
}

/// Call `name` on a loaded module: `(status, text, value)` as `Called` carries them.
///
/// **The context swap is the whole of the difficulty.** While the loaded module runs, every capability
/// it reaches goes through `dispatch`, which finds `HOST.exports` — and `write_string` copies into
/// *that* module's memory. Pointing it at the loader would corrupt silently rather than fail, so the
/// module's own `ModuleCtx` is installed for the duration and put back after, including when the call
/// traps. `issues/system/0240c`.
fn call_loaded(scope: &mut v8::PinScope, handle: i32, name: &str, arg: i32) -> (i32, String, i32) {
    // What to call it with, decided from the *module's* manifest — the closed set `Called` documents.
    let plan = HOST.with(|h| {
        let b = h.borrow();
        let st = b.as_ref()?;
        let lm = st.loaded.get(&handle)?;
        let sig = lm.exports.iter().find(|e| e.name == name)?;
        Some((sig.params.clone(), sig.ret.clone(), lm.world.len()))
    });
    let Some((params, ret, worlds)) = plan else {
        return (2, format!("no export named {name}"), 0);
    };
    let takes_int = params.len() == 1 && params[0] == "i32";
    let world_arity = if params.iter().enumerate().all(|(i, t)| t == ["Core", "Cli"][i.min(1)])
        && params.len() <= 2
        && !params.is_empty()
        && params[0] == "Core"
    {
        params.len()
    } else {
        0
    };
    if !params.is_empty() && !takes_int && world_arity == 0 {
        return (3, format!("cannot call {name}({})", params.join(", ")), 0);
    }
    if world_arity > worlds {
        return (3, format!("this module was built without {}", params.join(" and ")), 0);
    }
    if !ret.is_empty() && ret != "void" && ret != "i32" && ret != "string" {
        return (3, format!("{name} answers {ret}"), 0);
    }

    // Install the module's context, remembering the caller's.
    let saved = HOST.with(|h| {
        let mut b = h.borrow_mut();
        let st = b.as_mut().expect("a host");
        let lm = st.loaded.get(&handle).expect("the module");
        let mine = ModuleCtx {
            exports: lm.ctx.exports.clone(),
            caps: lm.ctx.caps.clone(),
            cap_names: lm.ctx.cap_names.clone(),
            grants: lm.ctx.grants.clone(),
        };
        let world: Vec<v8::Global<v8::Value>> = lm.world.clone();
        let was = ModuleCtx {
            exports: st.exports.clone(),
            caps: std::mem::take(&mut st.caps),
            cap_names: std::mem::take(&mut st.cap_names),
            grants: st.grants.clone(),
        };
        st.exports = mine.exports;
        st.caps = mine.caps;
        st.cap_names = mine.cap_names;
        st.grants = mine.grants;
        (was, world)
    });
    let (was, world) = saved;

    // **Called inside a `TryCatch`, and read outside it.** The answer has to be turned into a wac
    // `string` through the module's own helpers, which wants the outer scope — so the call happens in
    // the catch, and what survives it is a `Global` and a flag.
    let mut trapped: Option<String> = None;
    let mut answer: Option<v8::Global<v8::Value>> = None;
    let mut found = false;
    {
        let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()));
        if let Some(exports) = exports {
            let exports = v8::Local::new(scope, exports);
            if let Some(f) = get_export(scope, exports, name) {
                found = true;
                let mut argv: Vec<v8::Local<v8::Value>> = Vec::new();
                if takes_int {
                    argv.push(v8::Integer::new(scope, arg).into());
                }
                for g in world.iter().take(world_arity) {
                    argv.push(v8::Local::new(scope, g.clone()));
                }
                let tc = std::pin::pin!(v8::TryCatch::new(scope));
                let mut tc = tc.init();
                let out = f.call(&tc, exports.into(), &argv);
                if tc.exception().is_some() {
                    // **What the program said, and nothing when it said nothing.** This used to
                    // answer the exception's `message` — `unreachable` — because that is the word V8
                    // hands a JavaScript host, and the wasmtime host then *synthesised* the same word
                    // so the three would agree. A field whose value one host invents to match another
                    // is carrying no information: every wac trap produces it, so it distinguishes
                    // nothing that `status == 1` has not already said.
                    //
                    // What a caller can use is the sentence `trap "…"` left behind, which is what the
                    // test runner ten screens up has always printed and what `Cli.call` had no way to
                    // reach. Empty for an engine trap — a bounds check, a null dereference — which
                    // writes none, and reporting the previous one's would be worse than reporting
                    // nothing (`issues/lang/0254c`, which is that this global is never cleared).
                    tc.reset();
                    trapped = Some(trap_said_bare(&mut tc, exports));
                } else if let Some(v) = out {
                    answer = Some(v8::Global::new(&tc, v));
                }
                tc.reset();
            }
        }
    }
    let outcome = if let Some(why) = trapped {
        (1, why, 0)
    } else if !found {
        (2, format!("no export named {name}"), 0)
    } else if ret == "string" {
        match answer {
            Some(g) => {
                let v = v8::Local::new(scope, g);
                (0, read_string(scope, v), 0)
            }
            None => (0, String::new(), 0),
        }
    } else if ret == "i32" {
        let n = answer
            .map(|g| v8::Local::new(scope, g))
            .and_then(|v| v.to_int32(scope))
            .map(|v| v.value())
            .unwrap_or(0);
        (0, String::new(), n)
    } else {
        (0, String::new(), 0)
    };

    // ...and put the caller's back, whatever happened.
    HOST.with(|h| {
        if let Some(st) = h.borrow_mut().as_mut() {
            st.exports = was.exports;
            st.caps = was.caps;
            st.cap_names = was.cap_names;
            st.grants = was.grants;
        }
    });
    outcome
}

/// `LoadedModule.of(handle, error)` — `issues/system/0240c`.
fn build_loaded<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    handle: i32,
    error: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.loaded_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let msg = write_string(scope, error)?;
    let a = v8::Integer::new(scope, handle);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[a.into(), msg])
}

/// `CallResult.of(status, text, value)`.
fn build_called<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    status: i32,
    text: &str,
    value: i32,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.called_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let msg = write_string(scope, text)?;
    let a = v8::Integer::new(scope, status);
    let c = v8::Integer::new(scope, value);
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[a.into(), msg, c.into()])
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

fn build_exec<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    status: i32,
    out: &[u8],
    err: &[u8],
    error: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.exec_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let st = v8::Integer::new(scope, status);
    let o = write_bytes(scope, out)?;
    let e = write_bytes(scope, err)?;
    // **A wac `string`, not a JS one.** `write_string` stages it through the module's own buffer and
    // hands back the object the binding expects; a `v8::String` is the wrong type and the
    // constructor throws. Built after the two byte arrays because all three share that buffer.
    let msg = write_string(scope, error)?;
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[st.into(), o, e, msg])
}

/// One open socket: a listener waiting for connections, or a stream carrying them.
enum Sock {
    Listener(std::net::TcpListener),
    Stream(std::net::TcpStream),
    /// A bound UDP socket. Neither a listener nor a stream: nothing connects to it and nothing is
    /// accepted from it, and every datagram carries its own peer. design/system 0007.
    Datagram(std::net::UdpSocket),
    /// **A child's output, read exactly as a socket is.** `waitAny` over a child and a socket
    /// together is what `platform.wac` says handles are for, and that only works if one capability
    /// serves both.
    Queue(Arc<Stream>),
}

/// `Socket.of(handle, error, peer, port)` — declared in `platform.wac` rather than left to bindgen
/// precisely so a host can build one without reaching for a generated name.
/// `Datagram(bytes, peer, port, error)`, built through the module's own constructor.
fn build_datagram<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    bytes: &[u8],
    peer: &str,
    port: i32,
    error: &str,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.datagram_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let body = write_bytes(scope, bytes)?;
    let who = write_string(scope, peer)?;
    let p = v8::Integer::new(scope, port);
    let err = write_string(scope, error)?;
    let ctor = get_export(scope, exports, &ctor_name)?;
    ctor.call(scope, exports.into(), &[body, who, p.into(), err])
}

fn build_socket<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    handle: i32,
    error: &str,
    peer: &str,
    port: i32,
    fault: i32,
) -> Option<v8::Local<'s, v8::Value>> {
    let ctor_name = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.socket_of.clone()))?;
    let exports = HOST.with(|h| h.borrow().as_ref().map(|x| x.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let err = write_string(scope, error)?;
    let who = write_string(scope, peer)?;
    let h = v8::Integer::new(scope, handle);
    let p = v8::Integer::new(scope, port);
    let ctor = get_export(scope, exports, &ctor_name)?;
    let f = v8::Integer::new(scope, fault);
    ctor.call(scope, exports.into(), &[h.into(), err, who, p.into(), f.into()])
}

/// `STDIN`, in `std/platform.wac`. A channel number, never a socket.
///
/// **Declared but not read here, deliberately.** `packages/platform/test/wac/handles_test.wac` reads this
/// name out of every host's source and checks the five of them agree, so the declaration is the
/// point; `#[allow(dead_code)]` says that rather than letting the constant be deleted as unused and
/// the guard go quiet.
///
/// Unread because this host serves standard input through `readStdin` and never through `recv` —
/// where `packages/platform/host/deno.ts` and `native/src/main.rs` both branch on `h == STDIN_HANDLE`
/// inside `recv`, this one has no such branch, so `recv(STDIN)` would reach the not-found arm. No
/// program does: `cat`, `wc -l` and a piped shell all read through `readStdin` and answer correctly
/// on this host. It is written down because it is the same shape as the bug above — a reserved
/// number one host treats differently — and the next person to reach it should find a sentence
/// rather than a trap.
#[allow(dead_code)]
const STDIN_HANDLE: i32 = 0;

/// `PARENT_FS`, in `std/platform.wac` — the channel a spawned program asks its
/// parent for a filesystem on. `packages/platform/host/children.ts` calls the same number `n_HANDLE`
/// and checks for it *before* looking anything up in its socket table.
///
/// **Reserved, because this host used to allocate it.** `next_handle` began at 1, so the first
/// socket handed out — a child's stdout — took the number that already meant "ask my parent". Two
/// faults came of it, and the quiet one is worse: before any spawn `recv(PARENT_FS)` found nothing
/// and *threw*, so every `box` applet trapped on this host; after one it would have found the
/// child's output queue and read that instead, with nothing to say it had. issues/system/0148.
const PARENT_FS_HANDLE: i32 = 1;

/// The first handle this host may hand out, which is past every reserved one.
///
/// The same number as `FIRST_FREE_HANDLE` in `packages/platform/host/children.ts` and in
/// `native/src/main.rs`, and named the same so `packages/platform/test/wac/handles_test.wac` can hold all
/// five hosts to it. **That test existed while this host was getting it wrong**: it was written when
/// the wasmtime host allocated from 0 and handed a child the number that means standard input, and
/// it reads the four files that declared these constants. This one declared none of them, so the
/// guard walked past the host that then repeated the bug one number along. issues/system/0148.
const FIRST_FREE_HANDLE: i32 = 2;

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

/// A host program, run to completion, off the thread that answers capabilities — the body of
/// `Cap::Exec`.
///
/// Lifted out so the ticket can be handed back before any of this happens; see the note there and
/// issue 0211. Nothing in here touches the v8 heap, which is what makes it liftable at all.
fn run_host_program(
    path: String,
    argv: Vec<String>,
    stdin: Vec<u8>,
    env: Vec<String>,
    clear_env: bool,
    inherit: bool,
) -> Answer {
    let mut cmd = std::process::Command::new(&path);
    cmd.args(&argv).stdin(std::process::Stdio::piped());
    // **`inherit` is the real file descriptor**, so the child's output reaches this process's own
    // stdout and stderr and there is nothing here to collect.
    if inherit {
        cmd.stdout(std::process::Stdio::inherit()).stderr(std::process::Stdio::inherit());
    } else {
        cmd.stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped());
    }
    // `Command` inherits this process's environment unless it is told not to, which is
    // `issues/system/0198`: the authority to run a program has been carrying the authority to read
    // the environment, because a child can print it. `clear_env` is what a caller says to stop that,
    // and the pairs below are then the whole of what the child gets.
    if clear_env {
        cmd.env_clear();
    }
    for pair in &env {
        // Split at the *first* `=`: a value may contain one and a name may not. A string with no
        // `=` is dropped rather than being a fault — there is nothing it could mean.
        if let Some(at) = pair.find('=') {
            if at > 0 {
                cmd.env(&pair[..at], &pair[at + 1..]);
            }
        }
    }
    match cmd.spawn() {
        Err(e) => Answer::Exec(0, Vec::new(), Vec::new(), format!("{path}: {e}")),
        Ok(mut child) if inherit => {
            // No drain, because there are no pipes to drain: the deadlock the buffered path below
            // is careful about is a property of reading a child's output, and this one's output is
            // not coming here. Stdin is still ours to close.
            if let Some(mut w) = child.stdin.take() {
                use std::io::Write;
                let _ = w.write_all(&stdin);
            }
            match child.wait() {
                Err(e) => Answer::Exec(0, Vec::new(), Vec::new(), format!("{path}: {e}")),
                // Empty rather than what was printed: the bytes went to a descriptor this process
                // shares, and reporting them here as well would be a copy the caller cannot refuse.
                Ok(status) => Answer::Exec(status.code().unwrap_or(-1), Vec::new(), Vec::new(), String::new()),
            }
        }
        Ok(mut child) => {
            // **Draining starts before the write, not after.** A child that answers
            // while it is still being fed — `cat`, `grep`, any filter — blocks on its
            // own output once the pipe buffer is full, and a host that writes the whole
            // of stdin first blocks on the write. Both waiting on the other.
            //
            // `wait_with_output` does read both pipes concurrently, which is what the
            // comment here used to say, and it is not enough: it does not start until
            // the write has finished. Two megabytes through `cat` hung every host.
            let (out_tx, out_rx) = std::sync::mpsc::channel();
            let (err_tx, err_rx) = std::sync::mpsc::channel();
            let mut out_pipe = child.stdout.take();
            let mut err_pipe = child.stderr.take();
            std::thread::spawn(move || {
                use std::io::Read;
                let mut v = Vec::new();
                if let Some(p) = out_pipe.as_mut() {
                    let _ = p.read_to_end(&mut v);
                }
                let _ = out_tx.send(v);
            });
            std::thread::spawn(move || {
                use std::io::Read;
                let mut v = Vec::new();
                if let Some(p) = err_pipe.as_mut() {
                    let _ = p.read_to_end(&mut v);
                }
                let _ = err_tx.send(v);
            });
            // Dropped at the end of the block, which is what closes the child's input:
            // a program that reads to the end needs the end to arrive.
            if let Some(mut w) = child.stdin.take() {
                use std::io::Write;
                let _ = w.write_all(&stdin);
            }
            let out = out_rx.recv().unwrap_or_default();
            let err = err_rx.recv().unwrap_or_default();
            match child.wait() {
                Err(e) => Answer::Exec(0, Vec::new(), Vec::new(), format!("{path}: {e}")),
                Ok(status) => Answer::Exec(
                    // A signalled child has no code. -1 rather than 0, so it is never
                    // mistaken for success by a caller reading only the status.
                    status.code().unwrap_or(-1),
                    out,
                    err,
                    String::new(),
                ),
            }
        }
    }
}
