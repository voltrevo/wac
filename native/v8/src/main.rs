// A wac host on V8, driven from Rust.
//
//   wac <stem>            # runs <stem>.wasm against <stem>.json
//
// `native/` is the same idea against wasmtime, and is shelved: wasmtime's GC costs 2–6× on the
// workloads wac programs actually run (`issues/system/0138`), while V8 from Rust matches V8 from
// Deno exactly (`native/spike-v8`). design/lang/0003 records the decision — **rusty_v8 is the
// primary platform** — and this is the beginning of the host that decision needs.
//
// **The flat ABI** (design/system/0013 step 6). A program exports `__wacHost`, which this host calls
// with four funcrefs — `request`, `waitAny`, `exitWith`, `interrupted` — and `__wacAnswered`, through
// which every answer arrives, from inside `request` or `waitAny` only. A request is a number and
// plain values; an answer is one shape. So the host builds no wac value but a string and a `u8[]`,
// and std decodes the rest.
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
// native.ts` writes it. The host reads the callback signatures `__wacHost` takes and the exports.

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
    /// Running a host program — `procs.exec`. Separate from `spawn`'s authority on purpose: a host
    /// that will start a confined wasm module must be able to refuse a host binary without
    /// refusing both. `issues/system/0165`.
    #[serde(default)]
    run: bool,
}

#[derive(Deserialize)]
struct Manifest {
    entry: String,
    /// **Nothing reads it, and removing it would be wrong.** The field is not optional in the
    /// format, so requiring it here is what makes a manifest without one fail to parse rather than
    /// load as a half-described program. The binary happens not to need the value because it runs
    /// the module it carries rather than one named by a path.
    #[allow(dead_code)]
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
    methods: Vec<Method>,
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

    /// The index of the callback signature spelled `ty` — how a field names its dispatcher.
    fn callback_index(&self, ty: &str) -> Option<usize> {
        self.callbacks.iter().position(|c| c.ty == ty)
    }
}

// ---------------------------------------------------------------------------------------------
// What a slot means, and what a request asks.
//
// A funcref reaches the guest as a slot number in a per-signature registry: the module calls
// `wac.cb<j>(slot, …)` and the host decides what that slot *is*. A program is handed four —
// `request`, `waitAny`, `exitWith` and `interrupted` (design/system/0013 step 6) — and every
// capability is a numbered request through the first, mapped to its behaviour by `cap_of_op`.

#[derive(Clone, Copy, PartialEq, Debug)]
enum Cap {
    /// The four functions `__wacHost` is handed.
    Request,
    WaitAny,
    Exit,
    AskInterrupt,
    /// What each request asks — `OP_*` in `std/platform.wac`.
    ArgCount,
    Arg,
    Write,
    WriteErr,
    ReadFile,
    NowMillis,
    MonotonicNanos,
    RandomBytes,
    SleepMillis,
    Env,
    Cwd,
    ReadChunk,
    WriteFile,
    Stat,
    LinkStat,
    ReadDir,
    ReadStdin,
    Spawn,
    SpawnOther,
    ExitCode,
    CloseFeed,
    Connect,
    Listen,
    Accept,
    Recv,
    Send,
    CloseSocket,
    CloseSend,
    OpenFile,
    CloseFile,
    CloseOutput,
    BindDatagram,
    ReceiveFrom,
    SendTo,
    Rename,
    Remove,
    Mkdir,
    SetExecutable,
    Chmod,
    Exec,
    Load,
    Call,
    Unload,
    Validated,
    Unsupported,
}

/// The request numbered `op`: std's `OP_*` table, which is the JavaScript bridge's numbering.
/// `OP_DROP` (0) is not here — it names another request rather than asking anything, and the
/// dispatcher handles it before this is consulted.
fn cap_of_op(op: i32) -> Cap {
    match op {
        1 => Cap::NowMillis,
        2 => Cap::MonotonicNanos,
        3 => Cap::RandomBytes,
        6 => Cap::ArgCount,
        7 => Cap::Arg,
        8 => Cap::Env,
        9 => Cap::ReadFile,
        10 => Cap::WriteFile,
        11 => Cap::ReadStdin,
        12 => Cap::Write,
        13 => Cap::Stat,
        14 => Cap::ReadDir,
        15 => Cap::Mkdir,
        16 => Cap::Remove,
        17 => Cap::Rename,
        19 => Cap::ReadChunk,
        21 => Cap::Connect,
        22 => Cap::Listen,
        23 => Cap::Accept,
        24 => Cap::Recv,
        25 => Cap::Send,
        26 => Cap::CloseSocket,
        27 => Cap::SpawnOther,
        28 => Cap::ExitCode,
        29 => Cap::CloseFeed,
        30 => Cap::SleepMillis,
        41 => Cap::Cwd,
        47 => Cap::LinkStat,
        48 => Cap::WriteErr,
        49 => Cap::Spawn,
        52 => Cap::SetExecutable,
        53 => Cap::BindDatagram,
        54 => Cap::ReceiveFrom,
        55 => Cap::SendTo,
        57 => Cap::CloseSend,
        59 => Cap::Exec,
        60 => Cap::Chmod,
        61 => Cap::OpenFile,
        62 => Cap::CloseFile,
        63 => Cap::CloseOutput,
        64 => Cap::Load,
        65 => Cap::Call,
        66 => Cap::Unload,
        67 => Cap::Validated,
        _ => Cap::Unsupported,
    }
}

/// `OP_DROP`: withdraw request `id`.
const OP_DROP: i32 = 0;
// The requests whose answers take something (see `takes`), by std's numbers.
const OP_READ_STDIN: i32 = 11;
const OP_READ_CHUNK: i32 = 19;
const OP_CONNECT: i32 = 21;
const OP_LISTEN: i32 = 22;
const OP_ACCEPT: i32 = 23;
const OP_RECV: i32 = 24;
const OP_SPAWN: i32 = 27;
const OP_SPAWN_SELF: i32 = 49;
const OP_BIND_DATAGRAM: i32 = 53;
const OP_RECEIVE_FROM: i32 = 54;
const OP_OPEN_FILE: i32 = 61;
/// `Launch.detached`, in a spawn's `b`: dropping the child's ticket does not stop it.
const DETACHED: i32 = 4;
/// `Launch.flags()`'s bits as `spawn` carries them in `b` — `INHERIT_IN`, `INHERIT_OUT`, and
/// `SPAWN_SERVES` when the child's files are served by this program. `DETACHED` (4) is std's.
const INHERIT_IN: i64 = 1;
const INHERIT_OUT: i64 = 2;
const SPAWN_SERVES: i64 = 256;

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
/// Running a host program — `procs.exec`. See `GRANT_RUN` in `std/platform.wac`.
const GRANT_RUN: i32 = 16;

const FAULT_NONE: i32 = 0;
const FAULT_NOT_FOUND: i32 = 1;
const FAULT_DENIED: i32 = 2;
const FAULT_EXISTS: i32 = 3;
const FAULT_NOT_EMPTY: i32 = 4;
const FAULT_OTHER: i32 = 5;
/// The host cannot express this name — `issues/system/0295c`, and `0065` before it.
///
/// A name that came *out* of `readDir` lossily carries U+FFFD, and handing it back in names a file
/// that does not exist. Saying "not found" about it reads as *the caller got the name wrong* rather
/// than *this runtime cannot express it*, and `test -e` then answers no about a file that is there.
const FAULT_NOT_REPRESENTABLE: i32 = 6;
/// **Not the operating system's `FAULT_DENIED`.** This build was not granted the capability, which a
/// caller can and does tell apart from a file that will not open — `platform.wac` keeps them
/// separate for exactly that reason.
const FAULT_NOT_GRANTED: i32 = 7;
/// A directory where a file was wanted.
const FAULT_IS_DIR: i32 = 8;
/// A capability this host does not have — a value the caller reads, not a trap.
const FAULT_UNSUPPORTED: i32 = 9;
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
/// Put back the bytes a reader took for a ticket nobody claimed, for the next `recv` on that handle.
///
/// Only a non-empty `Data`. `End` and `Failed` describe a call that no longer exists, and neither is
/// something the next reader is missing. `issues/system/0307b`.
/// Put stream bytes nobody claimed back into the queue they came from.
///
/// Preferred to `park_read` wherever there *is* a queue: another reader may already be parked on it
/// — a bounded read that timed out and was retried is exactly that — and it would never look in a
/// side table. A socket has no queue, so that one still parks. `issues/system/0307b`.
fn unread_bytes(q: &streams::Stream, unclaimed: Option<Answer>) {
    if let Some(Answer::Read(ReadAnswer::Data(bytes))) = unclaimed {
        q.unread(bytes);
    }
}

fn park_read(
    back: &Option<Arc<std::sync::Mutex<HashMap<i32, Vec<u8>>>>>,
    handle: i32,
    unclaimed: Option<Answer>,
) {
    if let Some(Answer::Read(ReadAnswer::Data(bytes))) = unclaimed {
        if !bytes.is_empty() {
            if let Some(map) = back {
                map.lock().unwrap().entry(handle).or_default().extend(bytes);
            }
        }
    }
}

fn message_of(e: &std::io::Error) -> String {
    let text = e.to_string();
    match text.rfind(" (os error ") {
        Some(at) if text.ends_with(')') => text[..at].to_string(),
        _ => text,
    }
}

/// The fault for an operation on `path`, given what the OS said.
///
/// The one refinement over `fault_of`, and the same one `packages/platform/host/faults.ts` makes in
/// `faultOfPath`: a `NotFound` for a path containing U+FFFD is almost certainly a name this host
/// could not express, because U+FFFD is what a lossy `readDir` produces and a name carrying it
/// round-trips only if the file really does have a replacement character in it. Checked rather than
/// assumed — a path that resolves keeps whatever fault it had.
fn fault_of_path(e: &std::io::Error, path: &str) -> i32 {
    let fault = fault_of(e);
    if fault != FAULT_NOT_FOUND || !path.contains('\u{FFFD}') {
        return fault;
    }
    FAULT_NOT_REPRESENTABLE
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
/// and finds its context through the `HOST` thread-local, so until `modules.load` existed there was
/// exactly one module per thread and these three fields could live directly on `HostState`. A loaded
/// module is a second one in the same thread, and its capability calls have to resolve against *its*
/// exports — `write_string` copies into the module's own memory, and the wrong memory is silent
/// corruption rather than an error. So `call` swaps this in and out around the call it makes.
///
/// A child spawned with `procs.spawn` needs none of this: it gets a thread, and the thread-local with it.
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
    /// The `__WacHost` its `__wacHost` answered and its `__wacAnswered`, when it wants a host.
    /// Per module because each is that module's own value and export — handing one module's
    /// answers to another's export would settle the wrong program's requests.
    wac: Option<WacHost>,
    /// Its requests whose answers are still on a thread: the program's id, and the ticket's.
    /// The ids are the module's own (each `__WacHost` counts from 1), so these swap with it.
    inflight: HashMap<i32, i32>,
}

/// A module `modules.load` instantiated, and what is needed to call into it.
struct HeldModule {
    ctx: ModuleCtx,
    /// Its own manifest's export list, so `call` dispatches on the signature the *module* declares
    /// rather than on anything the caller says about it.
    exports: Vec<ExportSig>,
}

/// What a module's `__wacHost` answered, and the export answers are delivered through.
#[derive(Clone)]
struct WacHost {
    host: v8::Global<v8::Value>,
    answered: v8::Global<v8::Function>,
}

/// Everything a dispatcher needs, reachable from a `fn` pointer that cannot close over anything.
struct HostState {
    exports: v8::Global<v8::Object>,
    /// The last export `Module.call` resolved, as `(handle, name, function)`.
    ///
    /// **Because resolving is a V8 string per call.** `get_export` builds a fresh `v8::String` from
    /// the name and does a property lookup, and a caller may take this path millions of times in a
    /// row: `wac ctcompare` reads one journal slot per call, so `issues/system/0274b` was making 8.4
    /// million short-lived strings for one comparison. One entry is enough — the loops that matter
    /// call the same export over and over — and a miss costs what every call used to.
    ///
    /// Cleared when a module is unloaded, so a handle reused for a different module cannot answer
    /// with the old one's function.
    last_call: Option<(i32, String, v8::Global<v8::Function>)>,
    /// `caps[signature][slot]`, the same shape the wasmtime host uses.
    caps: Vec<Vec<Cap>>,
    /// The same table, spelled — so a capability this host cannot answer says *which* it was
    /// instead of "that capability yet". `wc` reaching an unserved `Cli.stat` looked identical to
    /// `wc` reaching an unserved `procs.spawn`, and the whole point of the list on exit is that the
    /// next slice knows what to build.
    cap_names: Vec<Vec<String>>,
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
    /// Whether this program resolves its own paths, or a parent resolves them for it.
    ///
    /// **True unless a parent is serving its filesystem.** A child spawned with `serveFs` sends every
    /// file operation up the channel and the parent answers it, so the path it sends has already been
    /// resolved by whoever handed it over — resolving it again against this program's own directory
    /// is what broke `v8host_test.wac`'s image differential when `cwd_override` was folded in blind.
    /// A child *without* that channel reaches the host itself, and then its directory is the only
    /// base there is. `issues/system/0281c`.
    resolves_own_paths: bool,
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
    /// This module's `__WacHost` and `__wacAnswered`, and its requests on threads — swapped with
    /// the rest of `ModuleCtx` while a loaded module runs.
    wac: Option<WacHost>,
    inflight: HashMap<i32, i32>,
    /// The modules this program has loaded, by handle. From 1, so a zeroed field names nothing.
    loaded: HashMap<i32, HeldModule>,
    next_loaded: i32,
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
    /// Stream bytes a reader took for a ticket nobody claimed — the same idea as `datagrams`, for
    /// the resource it was never applied to. `issues/system/0307b`.
    pushback: Arc<std::sync::Mutex<HashMap<i32, Vec<u8>>>>,
    /// A connection a *dropped* accept had already taken, waiting for the next accept on that
    /// listener. The two orderings need different remedies: a thread whose ticket is gone hands the
    /// connection to a **live** ticket, because the retry is already blocked inside `accept()`; a
    /// `drop` holding the answer has no live ticket to hand to, because the retry has not been
    /// issued yet, so it waits here. `issues/system/0310b`.
    parked_accepts: Arc<std::sync::Mutex<HashMap<i32, std::collections::VecDeque<Answer>>>>,
    /// Live `accept` tickets per listener, oldest first. A connection cannot be handed to a thread
    /// already blocked in `listener.accept()` — it waits in the kernel for a *different* one — so a
    /// thread whose ticket is gone completes somebody else's instead. `issues/system/0310b`.
    accepting: Arc<std::sync::Mutex<HashMap<i32, std::collections::VecDeque<i32>>>>,
    /// Which handle a read ticket is reading, so a *dropped* one knows where to put its answer back.
    /// `receiving` is this for `receiveFrom` and has been since `0207`; this is reads.
    /// `issues/system/0308b`.
    reading: Arc<std::sync::Mutex<HashMap<i32, i32>>>,
    /// The spawn tickets not yet collected, and whether each child was started detached: a dropped one
    /// stops its child unless it was (spec ch44 `§wac-std-child-drop-n2r5vxe`).
    spawned: Arc<std::sync::Mutex<HashMap<i32, bool>>>,
    /// Which socket each outstanding `receiveFrom` ticket is reading, so a dropped one knows where
    /// to put back an answer that arrived first.
    receiving: Arc<std::sync::Mutex<HashMap<i32, i32>>>,
    next_handle: i32,
    /// Standard output and standard error, once `closeOutput` has ended them: a write after it is refused.
    out_closed: [bool; 2],
}

thread_local! {
    static HOST: RefCell<Option<HostState>> = const { RefCell::new(None) };
    /// When this host started, which is what `monotonicNanos` counts from.
    static START: std::time::Instant = std::time::Instant::now();
    /// **The status `sys.exit` asked for**, set just before it throws. The throw unwinds the program's
    /// wasm frames to the call of `main`, which reads this to tell an exit from a trap.
    static EXIT_REQUEST: std::cell::Cell<Option<i32>> = const { std::cell::Cell::new(None) };
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
    let mut manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: the built-in manifest is not one — {e}");
            return 1;
        }
    };
    // **The built-in program holds every capability, and this host parses no `--allow-*` at all.**
    //
    // It is the toolchain — the payload this binary was built around — so the question "may it read a
    // file" is the same question as "may this binary run", which the person invoking it has already
    // answered. What is *not* settled here is what a program it goes on to load may do, and that is
    // the point: `load_module` narrows to the loader's grants intersected with what is asked, so with
    // the loader holding everything the effective set is exactly what the seed decided. **One place
    // decides, and it is written in wac.**
    //
    // The alternative — this host reading `--allow-run` off the command line — was what
    // `test_command` did, and it is why a whole test runner lived in Rust: the fall-through could not
    // grant, so anything needing a capability had to be reimplemented on the host to obtain one.
    // Baking the answer here instead of parsing it puts the decision in the program, where the rest of
    // the command surface already is. `issues/system/0264c`, `issues/system/0257c`.
    manifest.grants.read = true;
    manifest.grants.write = true;
    manifest.grants.env = true;
    manifest.grants.net = true;
    manifest.grants.run = true;
    as_child.argv = args.iter().map(|a| a.as_bytes().to_vec()).collect();
    run_as_with(&manifest, wasm, &text, as_child)
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

/// The sentence itself, with no punctuation around it — what `Module.call` puts in `CallResult.text`.
///
/// Split from `trap_said` when `Module.call` needed the same answer without the `: ` a printed line
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

/// **This binary runs one program, and it is written in wac.**
///
/// Every argument goes to the built-in program verbatim and it decides everything: which commands
/// exist, what `--help` says, what a grant means, whether an argument names a module or a mistake.
/// There is no command surface here at all — no list of names to keep in step with the program's,
/// no interception that shadows what the program would have done, and nothing that can be true on
/// this host and false on the two JavaScript ones.
///
/// That is `issues/system/0257c` taken to its end. The rule was that a host may implement *running a
/// module* and must not implement the command surface; the way it kept being broken was not by
/// disagreeing with it but by *exception* — `test` needed a capability the fall-through could not
/// grant, so it was implemented here; `covdump` needed a loaded module to be able to `exec`, so it
/// came back; `run`, `app` and `app-run` were "the host's own" because starting a program is what
/// this binary is. Each was locally reasonable and the sum was a second implementation of the whole
/// command line, 700 lines of test runner included.
///
/// **The one that made the exceptions unnecessary is `run_seed` granting everything.** The program is
/// the toolchain — the payload this binary was built around — so "may it read a file" is the same
/// question as "may this binary run", which whoever typed the command has already answered. With the
/// program holding every capability, `load_module` and `spawn` narrow *from* it, and what a program it
/// starts may do is the program's decision rather than a policy compiled in here.
///
/// Without a seed this is what it always was: a runtime, told to run a module. It says so rather than
/// pretending to be a `wac` command, because there is no program in it to be one.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    // **Every payload can ask which compiler is running it.** Set before V8 starts, and set
    // unconditionally so that a program reading it never has to distinguish "no compiler" from "not
    // told". Reading it needs the `env` grant the program already holds. `issues/system/0204`.
    //
    // Not overwritten if the caller set one: a test that wants to force a cache miss says so, and a
    // host that has already decided its identity is not second-guessed here.
    if std::env::var_os("WAC_COMPILER_ID").is_none() {
        // SAFETY: single-threaded, before V8 starts and before any payload runs.
        unsafe { std::env::set_var("WAC_COMPILER_ID", compiler_id()) };
    }
    // **No `WAC_VERSION` here, and that is the ruling rather than an omission.** This set it from
    // `env!("CARGO_PKG_VERSION")` until 2026-08-26, so `wac app` stamped `# wac-app 0.1.0` into every
    // executable this binary wrote — and **no other host stamped anything**, because no other host has
    // a Cargo package to read. Two `wac` commands built from one program produced artefacts differing
    // in exactly that line, which is the one thing about them that was allowed to differ and the one
    // thing that did.
    //
    // The operator's answer is to not define a version yet: *"we should avoid defining it for now, so
    // the correct output is the one that omits a version"*. `0.1.0` was never a version anybody had
    // decided — it is cargo's default, carried into an artefact format by the accident of this host
    // being the one written in Rust. So the blank the other hosts write is right and this was wrong.
    //
    // **The skew check stays and is dormant, not dead.** `app-run` still compares, and its rule is that
    // only two versions which both *exist* can differ — so with nothing published, nothing is refused,
    // and the day a version is defined it starts working with no change here. `packages/wac/src/app.wac`
    // has that rule; the environment variable is still the seam, and this is simply no longer a host
    // that fills it. A caller who exports one anyway is passed through, which is how the skew case is
    // exercised in `packages/wac/test/wac/app_test.wac`.
    //
    // **Not `WAC_COMPILER_ID`, though it is right there and is a stronger key.** It hashes the seed's
    // bytes as well, so it changes whenever anyone rebuilds the compiler — which in this repository is
    // several times a day, and would make every `app` artefact stale by the afternoon. The version is
    // the coarser question and the one that was being asked. Recorded because it is the first thing to
    // reach for if the deferral above is ever revisited, and it is the wrong thing to reach for.

    if SEED.is_some() {
        start_v8();
        let code = run_seed(&args[1..]);
        // **A successful `build` has to have written a module the engine accepts.**
        //
        // The one thing here that outlives the command surface, and it is not a command: it is the
        // engine being asked whether it would load what the compiler claimed to write, which is a
        // question only the engine can answer. `wac run` and `wac test` load what they compiled, so a
        // broken module fails there on its own. `build`'s whole output is the artefact, and an
        // ill-typed program wacc has no rule for could be emitted *wrongly* — the function present and
        // the types not agreeing — with the build printing a size and exiting 0 over a file the engine
        // refuses. `issues/lang/0170a`.
        //
        // Keyed on the command word only to know whether there is an artefact to look for. It reads
        // nothing else off the line and refuses nothing: an argument this does not understand simply
        // yields no path, and the program has already had its say either way.
        if code == 0 && args.get(1).is_some_and(|a| a == "build") {
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

    // **No seed: a runtime, and nothing more.** `wac prog.wasm` is the whole of it — a module
    // carrying its own manifest, run with what that manifest declares.
    let Some(stem) = args.get(1) else {
        eprintln!("usage: wac <program.wasm>   # a module carrying its own manifest");
        eprintln!("       this build has no compiler in it, so it has no other commands");
        std::process::exit(2);
    };
    let bytes = match std::fs::read(stem) {
        Ok(b) => b,
        Err(e) => {
            // `message_of` rather than `to_string`, which is the difference between "No such file or
            // directory" and "No such file or directory (os error 2)".
            eprintln!("wac: cannot read {stem} — {}", message_of(&e));
            std::process::exit(1);
        }
    };
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

/// What makes a child's world different from its parent's. `None` everywhere is the parent.
#[derive(Default)]
struct AsChild {
    argv: Vec<Vec<u8>>,
    grants: Option<Grants>,
    cwd: Option<String>,
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
                // `packages/wac/test/wac/testcli_test.wac` puts a good module *after* a bad one for exactly this.
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




fn run(m: &Manifest, wasm: &[u8], manifest_text: &str) -> i32 {
    run_as_with(m, wasm, manifest_text, AsChild { argv: std::env::args().skip(2).map(|a| a.into_bytes()).collect(), ..Default::default() })
}

/// **One body for the parent and for a child**, because a child is this same program with a
/// different world: its own arguments, possibly narrower grants, and streams instead of a terminal.

/// A V8 isolate belongs to one thread, so a child gets a thread and an isolate of its own — and
/// `HOST` is a `thread_local!`, which is why that costs nothing here.
///
/// **`manifest_text` is not decoration.** A child re-parses it to build the world for its own child,
/// so a caller that has it must pass it — `run_as` was a two-line wrapper that passed `""`, and
/// `issues/system/0280c` is what that cost. It had one caller and is gone.
fn run_as_with(m: &Manifest, wasm: &[u8], manifest_text: &str, as_child: AsChild) -> i32 {
    // Taken before `as_child` is unpacked into the host's state below, which is where it stops
    // being available.
    // Kept because a module with no `main` names the export to call in its first argument, and
    // that decision is made below where the manifest is known — see `call_named`.
    let argv = as_child.argv.clone();
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

    // **The host's four functions, handed to `__wacHost`** — a module that exports none wants no
    // host (a library, a pure test), and is run without one.
    let wac = match bind_host(scope, exports, m, &mut caps, &mut names) {
        Ok(w) => w,
        Err(e) => {
            eprintln!("wac: {e}");
            return 1;
        }
    };

    HOST.with(|h| {
        *h.borrow_mut() = Some(HostState {
            last_call: None,
            exports: v8::Global::new(scope, exports),
            caps,
            cap_names: names,
            argv: as_child.argv.clone(),
            grants: as_child.grants.unwrap_or(m.grants),
            child_out: as_child.out.clone(),
            child_err: as_child.err.clone(),
            child_input: as_child.input.clone(),
            inherits: as_child.inherits,
            cwd_override: as_child.cwd.clone(),
            // `fs_req` is `Some` exactly when the parent agreed to serve this child's filesystem —
            // see `AsChild::fs_req`, whose own note says `None` covers both a `serveFs false` child
            // and a program nobody spawned.
            resolves_own_paths: as_child.fs_req.is_none(),
            child_exits: HashMap::new(),
            child_feeds: HashMap::new(),
            wasm: wasm.to_vec(),
            manifest_text: manifest_text.to_string(),
            tickets: Arc::new(Tickets::default()),
            wac: wac.clone(),
            inflight: HashMap::new(),
            loaded: HashMap::new(),
            next_loaded: 1,
            sockets: Arc::new(std::sync::Mutex::new(HashMap::new())),
            datagrams: Arc::new(std::sync::Mutex::new(HashMap::new())),
            pushback: Arc::new(std::sync::Mutex::new(HashMap::new())),
            parked_accepts: Arc::new(std::sync::Mutex::new(HashMap::new())),
            accepting: Arc::new(std::sync::Mutex::new(HashMap::new())),
            reading: Arc::new(std::sync::Mutex::new(HashMap::new())),
            spawned: Arc::new(std::sync::Mutex::new(HashMap::new())),
            receiving: Arc::new(std::sync::Mutex::new(HashMap::new())),
            // Above `STDIN_HANDLE` and `PARENT_FS_HANDLE`: wac reserves those two numbers as
            // channels, and this counter used to collide with the second of them — 0148.
            next_handle: FIRST_FREE_HANDLE,
            out_closed: [false, false],
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

    // **A `main` that takes something other than a world is an ordinary export** (spec ch07,
    // `§wac-main-ordinary-pnxd9gt`): the module is a library, not a program, and `wac run m.wasm main wac`
    // calls it by name like any other.
    let is_world = |ps: &[String]| ps.is_empty() || (ps.len() == 1 && ps[0] == "__WacHost");
    let main_sig = match m.exports.iter().find(|e| e.name == "main" && is_world(&e.params)) {
        Some(e) => e,
        // **No `main`: the first argument names an export.** `wac run math.wac gcd 48 18`, which
        // spec/cli/wac.md documents and which was only ever implemented in the reference CLI.
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
    // `main()` is handed nothing, and `main(__WacHost)` what `__wacHost` answered.
    let host_v: Option<v8::Local<v8::Value>> = wac.as_ref().map(|w| v8::Local::new(scope, w.host.clone()));
    let args: Vec<v8::Local<v8::Value>> = match (main_sig.params.len(), host_v) {
        (0, _) => Vec::new(),
        (_, Some(h)) => vec![h],
        (_, None) => {
            eprintln!("wac: main takes a __WacHost and the module exports no __wacHost to make one");
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
        // **Read the exception before `reset()` discards it.** An engine trap — a bounds check, a
        // null dereference, a stack overflow — writes no `$trap$message`, so the branch below has
        // nothing of the program's to report. But V8 has a reason, and until 2026-08-31 this line
        // threw it away one statement before the code that needed it, leaving a bare
        // `wac: <entry> trapped` as the whole diagnostic. `issues/system/0306b` spent ten
        // eliminated hypotheses on a trap whose cause the host had in hand and dropped.
        let why = if out.is_none() {
            let got = tc.exception().map(|e| e.to_rust_string_lossy(&mut tc)).unwrap_or_default();
            // **Except `unreachable`, which is not a reason.** That is the instruction a wac `trap`
            // compiles to, so V8 reporting it restates the word "trapped" and adds nothing — and
            // `trapmessage_test.wac` is right to insist that a trap with nothing to say must not
            // invent a message. Every other exception here names something the bare word does not:
            // a host capability's `Error`, a null dereference, an index out of bounds.
            if got.ends_with("unreachable") { String::new() } else { got }
        } else {
            String::new()
        };
        tc.reset();
        (out, why)
    };
    let (called, why) = called;
    if let Some(code) = EXIT_REQUEST.with(|e| e.take()) {
        return code;
    }
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
            // The program's own message when it trapped deliberately, and the engine's when it
            // did not. Both, if somehow both exist — they answer different questions.
            if !said.is_empty() {
                eprintln!("wac: {} trapped: {said}", m.entry);
            } else if !why.is_empty() {
                eprintln!("wac: {} trapped: {why}", m.entry);
            } else {
                eprintln!("wac: {} trapped", m.entry);
            }
            return 1;
        }
    };
    let code = r.to_int32(scope).map(|i| i.value()).unwrap_or(0);

    // **Work scheduled and never run is an error.** `main` returning is the program saying it is
    // done, and a continuation still waiting says it was not — the answer would simply never arrive,
    // silently, which is the failure a promise-shaped API is most likely to have. So the program's
    // `__wacOutstanding` is asked: the requests in flight and the continuations queued.
    //
    // **A module that took a host and cannot be asked is refused**, not let off: this called
    // `__WacHost.outstanding` through a bindgen export until that value began crossing opaque
    // (`issues/lang/0398a`), and when the export went the check was skipped without a word.
    if let Some(h) = host_v {
        let Some(f) = get_export(scope, exports, "__wacOutstanding") else {
            eprintln!("wac: {} exports no `__wacOutstanding`, so its unfinished work cannot be asked about", m.entry);
            return 1;
        };
        if let Some(v) = f.call(scope, exports.into(), &[h]) {
            let left = v.to_int32(scope).map(|i| i.value()).unwrap_or(0);
            if left > 0 {
                eprintln!(
                    "wac: {} finished with {left} continuation(s) still waiting — \
                     call `sys.drain()` to run them",
                    m.entry
                );
                return 1;
            }
        }
    }
    code
}





/// Bind the host's four functions and call `__wacHost` with them — `None` for a module that exports
/// no `__wacHost`, which wants no host.
///
/// Each is a slot in the registry of its signature, turned into a funcref by the module's own
/// `$bind$fnref_<j>` — the one operation a host cannot do for itself. The signatures are read off
/// `__wacHost`'s own parameters rather than spelled here, so the manifest stays the authority.
fn bind_host(
    scope: &mut v8::PinScope,
    exports: v8::Local<v8::Object>,
    m: &Manifest,
    caps: &mut [Vec<Cap>],
    names: &mut [Vec<String>],
) -> Result<Option<WacHost>, String> {
    let Some(sig) = m.exports.iter().find(|e| e.name == "__wacHost") else { return Ok(None) };
    let wanted = [
        (Cap::Request, "request"),
        (Cap::WaitAny, "waitAny"),
        (Cap::Exit, "exitWith"),
        (Cap::AskInterrupt, "interrupted"),
    ];
    if sig.params.len() != wanted.len() {
        return Err(format!("__wacHost takes {} functions, and this host has four", sig.params.len()));
    }
    let mut args: Vec<v8::Local<v8::Value>> = Vec::with_capacity(4);
    for (ty, (cap, name)) in sig.params.iter().zip(wanted) {
        let j = m
            .callback_index(ty)
            .ok_or_else(|| format!("__wacHost's {name} is a {ty}, which no dispatcher serves"))?;
        let slot = caps[j].len();
        caps[j].push(cap);
        names[j].push(name.to_string());
        let helper = get_export(scope, exports, &m.callbacks[j].helper)
            .ok_or_else(|| format!("no {}", m.callbacks[j].helper))?;
        let slot_v = v8::Integer::new(scope, slot as i32);
        let fr = helper
            .call(scope, exports.into(), &[slot_v.into()])
            .ok_or_else(|| format!("{} refused slot {slot}", m.callbacks[j].helper))?;
        args.push(fr);
    }
    let make = get_export(scope, exports, "__wacHost").ok_or_else(|| "__wacHost is not callable".to_string())?;
    let host = make
        .call(scope, exports.into(), &args)
        .ok_or_else(|| "__wacHost trapped".to_string())?;
    let answered = get_export(scope, exports, "__wacAnswered")
        .ok_or_else(|| "the module exports __wacHost and no __wacAnswered".to_string())?;
    Ok(Some(WacHost { host: v8::Global::new(scope, host), answered: v8::Global::new(scope, answered) }))
}

/// Where output goes, in the one order every writer must use: the queue to the **parent**, because
/// a spawned child writes to whoever spawned it and not to the terminal, and only then the process's
/// own stream.
///
/// **Factored because `log` did not do any of it.** `Cap::Log` was a bare `println!`, so a spawned
/// child's `core.log` landed on the host's standard output while its parent read `recv` and heard
/// nothing — `issues/system/0169`, where the child's answers were all *correct* and simply went to the
/// wrong place. The wasmtime host has had one `emit` for every writer all along, which is why it was
/// right; this is that shape.
///
/// Answers whether the bytes landed, which is what a write reports so a wac program can notice a
/// closed pipe.
fn emit_bytes(bytes: &[u8], to_stderr: bool) -> bool {
    let closed = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.out_closed[to_stderr as usize]));
    if closed {
        return false;
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
    let mut out = std::io::stdout();
    out.write_all(bytes).and_then(|_| out.flush()).is_ok()
}

/// Point descriptor `fd` (1 or 2) at `/dev/null`: whoever reads the pipe it was sees the end, and the number
/// stays taken, so nothing opened later receives a stray write meant for the terminal.
fn close_std_stream(fd: i32) -> bool {
    use std::io::Write;
    if fd == 1 { let _ = std::io::stdout().flush(); } else { let _ = std::io::stderr().flush(); }
    let Ok(null) = std::fs::OpenOptions::new().write(true).open("/dev/null") else { return false };
    use std::os::fd::AsRawFd;
    unsafe { libc::dup2(null.as_raw_fd(), fd) == fd }
}

/// `wac run <file.wac> <name> [args…]` for a module with no `main`.
///
/// The reference CLI had this and the binary did not, which is the gap that kept `wacx` alive.
/// Arguments are coerced by the **declared parameter type** rather than guessed from the text —
/// spec/cli/wac.md — so `1` is an `i32` where one is declared and the string `"1"` where a
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
        // `trap_said` already carries the `": "` — its doc says so, and `trap_said_bare` is the one
        // without. Adding a second here printed `trapped: : the message`, which is what running a
        // *named* function showed and running `main` did not, because that path reads the global
        // itself.
        let said = trap_said(scope, exports);
        eprintln!("wac: {name} trapped{said}");
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
    // **`null` is a wac literal**, and an argument is written as one (spec README) — so a
    // nullable parameter takes it, whatever it is nullable of: a wasm reference is null as JS
    // `null`, a struct and a boxed number alike. A present value of a nullable reference is the
    // reference itself, so it is read as the inner type.
    if let Some(inner) = ty.strip_suffix('?') {
        if text == "null" {
            return Ok(v8::null(scope).into());
        }
        return match inner {
            "string" | "u8[]" | "i32[]" | "u32[]" | "i64[]" | "u64[]" | "f64[]" => {
                coerce_arg(scope, text, inner)
            }
            // **A nullable number is its box**, which only the module can build: the value is read
            // as the number and handed to `$bind$box_<t>_new`.
            "i32" | "u32" | "i64" | "u64" | "f32" | "f64" | "bool" | "i8" | "u8" | "i16" | "u16" => {
                let v = coerce_arg(scope, text, inner)?;
                call_bind(scope, &format!("$bind$box_{inner}_new"), &[v])
                    .ok_or_else(|| format!("this module cannot take a `{ty}` argument"))
            }
            _ => Err(format!(
                "a present `{ty}` cannot be written on a command line — only `null`, or a value \
                 of a nullable string or array"
            )),
        };
    }
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
        "i64" => wac_int(text)
            .filter(|n| *n >= i64::MIN as i128 && *n <= u64::MAX as i128)
            .map(|n| v8::BigInt::new_from_i64(scope, n as i64).into())
            .ok_or_else(|| format!("`{text}` is not an {ty}")),
        // **A `u64` takes all of its range**: one above `i64`'s maximum is a `u64`, and it crosses as
        // the `i64` with the same bits — which is what the wasm parameter holds.
        "u64" => wac_int(text)
            .filter(|n| *n >= 0 && *n <= u64::MAX as i128)
            .map(|n| v8::BigInt::new_from_u64(scope, n as u64).into())
            .ok_or_else(|| format!("`{text}` is not a {ty}")),
        "f64" | "f32" => text
            .parse::<f64>()
            .map(|n| v8::Number::new(scope, n).into())
            .map_err(|_| format!("`{text}` is not an {ty}")),
        "i32" | "u32" => wac_int(text)
            .filter(|n| *n >= i32::MIN as i128 && *n <= u32::MAX as i128)
            .map(|n| v8::Number::new(scope, n as f64).into())
            .ok_or_else(|| format!("`{text}` is not an {ty}")),
        // **A narrow type takes its own range**, not an `i32`'s: `300` is not a `u8`, and handing it
        // over as one gave a function declared to take a byte a value no byte holds.
        "i8" | "u8" | "i16" | "u16" => {
            let (lo, hi): (i128, i128) = match ty {
                "i8" => (-128, 127),
                "u8" => (0, 255),
                "i16" => (-32768, 32767),
                _ => (0, 65535),
            };
            wac_int(text)
                .filter(|n| *n >= lo && *n <= hi)
                .map(|n| v8::Number::new(scope, n as f64).into())
                .ok_or_else(|| format!("`{text}` is not a {ty}"))
        }
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
        // **Comma-separated, kept exactly**: no trimming and no brackets, because a string element may
        // begin with a space or be empty — `ab,,cd` is three strings. One holding a comma cannot be
        // written this way, which is the limit of a command line rather than of the type.
        "string[]" => {
            let xs: Vec<String> = if text.is_empty() { Vec::new() } else { text.split(',').map(String::from).collect() };
            build_names(scope, &xs).ok_or_else(|| "this module cannot take a string[] argument".to_string())
        }
        other => Err(format!(
            "a `{other}` cannot be written on a command line; `wac run` takes numbers, bools, \
             strings, and arrays of u8, i32, i64, f64 and string"
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
        // **An unsigned answer prints unsigned.** A `u32` crosses as a wasm `i32`, which V8 reads as
        // signed, so `0xFFFFFFFF` printed as `-1`; a `u64` crosses as an `i64` BigInt the same way.
        "u32" => {
            println!("{}", v.int32_value(scope).unwrap_or(0) as u32);
            Ok(())
        }
        "u64" => {
            match v.to_big_int(scope) {
                Some(b) => println!("{}", b.u64_value().0),
                None => println!("{}", v.to_rust_string_lossy(scope)),
            }
            Ok(())
        }
        // **An `f32` prints as an `f32`**: the shortest digits that read back as the same `f32`, placed
        // as JavaScript places a number's — which is how an `f64` answer already prints. It crosses
        // widened to an `f64`, so V8 alone spells `3.14f` as 3.140000104904175.
        "f32" => {
            println!("{}", f32_text(v.number_value(scope).unwrap_or(0.0) as f32));
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
        // **A nullable reference prints as what it holds, or `null`.** A `string?` is the string
        // itself in wasm — every reference can be null — and fell through to the arm below, which
        // asks V8 to stringify a wasm struct and prints nothing, so `wac run f.wac cityOf` answered
        // an empty line for "Oslo".
        "string?" | "u8[]?" | "i32[]?" => {
            if v.is_null() || v.is_undefined() {
                println!("null");
                Ok(())
            } else {
                print_returned(scope, v, &ret[..ret.len() - 1])
            }
        }
        // **A nullable number prints as what its box holds**, read back through the module's own
        // `$bind$box_<t>_get` — the box is a wasm struct, which V8 cannot open.
        "i32?" | "u32?" | "i64?" | "u64?" | "f32?" | "f64?" | "bool?" | "i8?" | "u8?" | "i16?" | "u16?" => {
            if v.is_null() || v.is_undefined() {
                println!("null");
                return Ok(());
            }
            let inner = &ret[..ret.len() - 1];
            let held = v8::Local::new(scope, v);
            let got = call_bind(scope, &format!("$bind$box_{inner}_get"), &[held])
                .ok_or_else(|| format!("this module cannot hand back a `{ret}`"))?;
            print_returned(scope, got, inner)
        }
        _ => {
            println!("{}", v.to_rust_string_lossy(scope));
            Ok(())
        }
    }
}

/** An `f32`'s shortest round-trip digits, with the point placed as `Number::toString` places it. */
fn f32_text(x: f32) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if x == 0.0 {
        return "0".to_string();
    }
    let sign = if x < 0.0 { "-" } else { "" };
    // `{:e}` is the shortest representation that round-trips, in scientific form: `3.14e0`.
    let sci = format!("{:e}", x.abs());
    let (mantissa, exp) = sci.split_once('e').unwrap_or((&sci, "0"));
    let digits: String = mantissa.chars().filter(|c| *c != '.').collect();
    let k = digits.len() as i32;
    let n = exp.parse::<i32>().unwrap_or(0) + 1;
    let body = if k <= n && n <= 21 {
        format!("{}{}", digits, "0".repeat((n - k) as usize))
    } else if 0 < n && n <= 21 {
        format!("{}.{}", &digits[..n as usize], &digits[n as usize..])
    } else if -6 < n && n <= 0 {
        format!("0.{}{}", "0".repeat((-n) as usize), digits)
    } else {
        let e = n - 1;
        let mant = if k > 1 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits.clone() };
        format!("{}e{}{}", mant, if e < 0 { "-" } else { "+" }, e.abs())
    };
    format!("{}{}", sign, body)
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

/// The table, for a capability that is about to start work on a thread.
fn table() -> Option<Arc<Tickets>> {
    HOST.with(|h| h.borrow().as_ref().map(|s| s.tickets.clone()))
}

/// What answering a request came to: an answer in hand, a ticket a thread will complete, or nothing —
/// a request nobody answers, like a close.
enum Reply {
    Now(Answer),
    Later(i32),
    Nothing,
}

/// One request's arguments, as `request(op, id, a, b, text, bytes)` carried them.
struct Req {
    a: i64,
    b: i64,
    text: String,
    bytes: Vec<u8>,
}

fn no_table() -> Reply {
    Reply::Now(Answer::Change(FAULT_OTHER, "no ticket table".into()))
}

/// A path as this program means it: joined onto the directory it was started in, when it resolves
/// its own paths.
///
/// Semantics copied from `packages/platform/host/child.ts`'s `joinPath`, deliberately including what it
/// does *not* do: `.` and `..` are left alone, because every host below understands them and
/// reimplementing them here would be a second opinion about what a path means.
fn resolve_path(path: &str) -> String {
    // **And never for the empty path**, which is the standard-input convention rather than a
    // relative path. Below that, a spawned child's directory is the base for a path *it* built,
    // which is what makes `cd sub; cat f.txt` find the file — but not for a child whose parent
    // resolves paths on its behalf. `issues/system/0281c`.
    let base = HOST.with(|h| {
        let b = h.borrow();
        let s = b.as_ref()?;
        if s.resolves_own_paths && !path.is_empty() { s.cwd_override.clone() } else { None }
    });
    let cwd = match base {
        Some(d) if !d.is_empty() => d,
        _ => return path.to_string(),
    };
    if path.starts_with('/') {
        return path.to_string();
    }
    if cwd.ends_with('/') { format!("{cwd}{path}") } else { format!("{cwd}/{path}") }
}

/// An answer in the one shape every request is answered in — `(fault, text, bytes, n, m, flags)`, the
/// table in design/system/0013 step 6. std's decoders (`readOfFile`, `statOf`, `childOf`, …) read it.
///
/// **A refusal is a fault, never a flag.** `send`'s `false` and `write`'s used to be a `bool`; std's
/// `lineSentOf`, `fedOf` and `wroteOf` read `fault`, so `false` is `FAULT_OTHER` with no words of its
/// own, and `true` is `flags` 1 for a reader that asks.
fn flat(a: Answer) -> (i32, String, Vec<u8>, i64, i64, i32) {
    let none = (FAULT_NONE, String::new(), Vec::new(), 0i64, 0i64, 0i32);
    match a {
        Answer::I32(n) => (FAULT_NONE, String::new(), Vec::new(), n as i64, 0, 0),
        Answer::I64(n) => (FAULT_NONE, String::new(), Vec::new(), n, 0, 0),
        Answer::Text(t) => (FAULT_NONE, t, Vec::new(), 0, 0, 0),
        Answer::Bytes(Some(b)) => (FAULT_NONE, String::new(), b, 0, 0, 1),
        Answer::Bytes(None) => none,
        Answer::File(true, b, _, _) => (FAULT_NONE, String::new(), b, 0, 0, 0),
        Answer::File(false, _, why, fault) => (if fault == FAULT_NONE { FAULT_OTHER } else { fault }, why, Vec::new(), 0, 0, 0),
        Answer::Change(fault, why) => (fault, why, Vec::new(), 0, 0, 0),
        Answer::Stat(st) => {
            if st.fault != FAULT_NONE {
                return (st.fault, String::new(), Vec::new(), 0, 0, 0);
            }
            let kind = i32::from(st.exists)
                | i32::from(st.is_file) << 1
                | i32::from(st.is_dir) << 2
                | i32::from(st.is_symlink) << 3
                | i32::from(st.is_executable) << 4;
            (FAULT_NONE, String::new(), Vec::new(), st.size, st.modified_millis, kind | (st.mode & 0xffff) << 16)
        }
        Answer::Names(names) => {
            let mut b = Vec::new();
            for n in names {
                b.extend_from_slice(n.as_bytes());
                b.push(0);
            }
            (FAULT_NONE, String::new(), b, 0, 0, 1)
        }
        Answer::Socket(handle, why, peer, port, fault) => {
            if handle < 0 {
                (if fault == FAULT_NONE { FAULT_OTHER } else { fault }, why, Vec::new(), 0, 0, 0)
            } else {
                (FAULT_NONE, peer, Vec::new(), handle as i64, port as i64, 0)
            }
        }
        Answer::Datagram(bytes, peer, port, why) => {
            if !why.is_empty() {
                (FAULT_OTHER, why, Vec::new(), 0, 0, 0)
            } else {
                (FAULT_NONE, peer, bytes, port as i64, 0, 0)
            }
        }
        Answer::Read(ReadAnswer::Data(b)) => (FAULT_NONE, String::new(), b, 0, 0, 0),
        Answer::Read(ReadAnswer::End) => (FAULT_NONE, String::new(), Vec::new(), 0, 0, 1),
        Answer::Read(ReadAnswer::Failed(why)) => (FAULT_OTHER, why, Vec::new(), 0, 0, 0),
        Answer::Bool(true) => (FAULT_NONE, String::new(), Vec::new(), 0, 0, 1),
        Answer::Bool(false) => (FAULT_OTHER, String::new(), Vec::new(), 0, 0, 0),
        // `m` packs the error stream's handle (low 32) and the served-files channel's (high 32).
        Answer::Child(handle, err, fs, why) => {
            if handle < 0 {
                let fault = if handle == -2 { FAULT_UNSUPPORTED } else { FAULT_OTHER };
                (fault, why, Vec::new(), 0, 0, 0)
            } else {
                (FAULT_NONE, String::new(), Vec::new(), handle as i64, (err as u32 as i64) | ((fs as i64) << 32), 0)
            }
        }
        // Both streams in `bytes`, split at `m`.
        Answer::Exec(status, out, err, why) => {
            if !why.is_empty() {
                (FAULT_OTHER, why, Vec::new(), 0, 0, 0)
            } else {
                let split = out.len() as i64;
                let mut b = out;
                b.extend_from_slice(&err);
                (FAULT_NONE, String::new(), b, status as i64, split, 0)
            }
        }
        Answer::Called(status, text, value) => (FAULT_NONE, text, Vec::new(), value as i64, 0, status),
    }
}

/// Hand request `id`'s answer to the module through its `__wacAnswered`. Only ever called from inside
/// `request` or `waitAny`, which is what makes it safe to run the program's code from here: the
/// program is parked in one of its own host calls and expects to be re-entered.
///
/// Answers whether the program's code returned: `false` leaves its trap or exit pending, and nothing
/// more may be delivered on top of it.
fn deliver(scope: &mut v8::PinScope, id: i32, answer: Answer) -> bool {
    let Some(wac) = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.wac.clone())) else { return true };
    let Some(exports) = HOST.with(|h| h.borrow().as_ref().map(|s| s.exports.clone())) else { return true };
    let exports = v8::Local::new(scope, exports);
    let (fault, text, bytes, n, m, flags) = flat(answer);
    // Each conversion finishes before the next starts: both stage through the module's one buffer.
    let Some(text_v) = write_string(scope, &text) else {
        throw(scope, "could not build an answer's text");
        return false;
    };
    let Some(bytes_v) = write_bytes(scope, &bytes) else {
        throw(scope, "could not build an answer's bytes");
        return false;
    };
    let host = v8::Local::new(scope, wac.host);
    let f = v8::Local::new(scope, wac.answered);
    let args: [v8::Local<v8::Value>; 8] = [
        host,
        v8::Integer::new(scope, id).into(),
        v8::Integer::new(scope, fault).into(),
        text_v,
        bytes_v,
        v8::BigInt::new_from_i64(scope, n).into(),
        v8::BigInt::new_from_i64(scope, m).into(),
        v8::Integer::new(scope, flags).into(),
    ];
    // A trap or an exit inside the program's continuation is left pending, and unwinds through the
    // host call that is delivering — the program's own failure, reported where it would have been.
    f.call(scope, exports.into(), &args).is_some()
}

/// `waitAny(ids, millis)`: block until one of the program's requests `ids` has an answer, deliver
/// every one that has, and say which came first — its index in `ids`, or -1 when none did in time.
/// An id with nothing on a thread was answered or dropped already, and is not waited for.
fn wait_and_deliver(scope: &mut v8::PinScope, ids: &[i32], millis: i32) -> i32 {
    let Some(t) = table() else { return -1 };
    let pairs: Vec<(usize, i32, i32)> = HOST.with(|h| {
        let b = h.borrow();
        let Some(st) = b.as_ref() else { return Vec::new() };
        ids.iter()
            .enumerate()
            .filter_map(|(i, id)| st.inflight.get(id).map(|tid| (i, *id, *tid)))
            .collect()
    });
    if pairs.is_empty() {
        return -1;
    }
    let tids: Vec<i32> = pairs.iter().map(|p| p.2).collect();
    let first = t.wait_any(&tids, millis);
    if first < 0 {
        return -1;
    }
    for &(_, id, tid) in &pairs {
        if !t.is_settled(tid) {
            continue;
        }
        HOST.with(|h| {
            if let Some(st) = h.borrow_mut().as_mut() {
                st.inflight.remove(&id);
                // Collected, so nothing can be given up on and the handle note goes — `0308b`.
                st.reading.lock().unwrap().remove(&tid);
            }
        });
        if let Some(answer) = t.take(tid) {
            if !deliver(scope, id, answer) {
                break;
            }
        }
    }
    pairs[first as usize].0 as i32
}

/// Withdraw ticket `id`, whose request the program dropped before its answer was delivered.
///
/// **An answer nobody has read is still the host's** (design/system/0013, settled before step 6), so
/// what the ticket already held goes back where it came from — bytes to their stream, a datagram to its
/// socket, an accepted connection to the next accept — or is closed. An answer still on a thread is
/// handled by that thread, which finds its ticket gone and does the same.
fn drop_ticket(id: i32) {
    if let Some(t) = table() {
        // **What the ticket already held goes back where it came from.** For most work
        // discarding it is right; for a `receiveFrom` the answer *is* a datagram, read off
        // the socket once. `issues/system/0207`.
        if let Some(answer) = t.drop_ticket(id) {
            // **A read's bytes go back too**, and for the same reason the datagram does:
            // they came off a stream once, and an answer that landed between the caller
            // giving up and this call was being binned every time. `issues/system/0308b`.
            let reading = HOST.with(|h| {
                h.borrow().as_ref().and_then(|st| st.reading.lock().unwrap().remove(&id))
            });
            // **`Read` *or* `Bytes`.** `recv` answers a `Read`; `readStdin` answers
            // `Answer::Bytes`, and matching only the first left its late ordering losing the
            // lot — 0 of 6 — while its early one was fixed. The question is whether bytes
            // came off a stream, not which capability spelled them. `issues/system/0310b`.
            // **An accepted connection is handed on or parked, never put down.** There is
            // nowhere to put a socket back: it is in the table with a client attached. If an
            // accept is still waiting on that listener it gets it; if none is — the retry
            // comes after the give-up in this ordering — it waits for one.
            // `issues/system/0310b`.
            if let (Some(listener), Answer::Socket(slot, _, _, _, _)) = (reading, &answer) {
                if *slot >= 0 {
                    let next = HOST.with(|h| {
                        h.borrow().as_ref().and_then(|st| {
                            st.accepting.lock().unwrap()
                                .get_mut(&listener).and_then(|q| q.pop_front())
                        })
                    });
                    match next {
                        Some(other) => { let _ = t.complete(other, answer); }
                        None => HOST.with(|h| {
                            if let Some(st) = h.borrow().as_ref() {
                                st.parked_accepts.lock().unwrap()
                                    .entry(listener).or_default().push_back(answer);
                            }
                        }),
                    }
                    return;
                }
            }
            // **A child nobody collected is stopped**, unless it was started detached: the ticket owned it, and
            // no one else can reach it now (spec ch44 `§wac-std-child-drop-n2r5vxe`).
            if let Answer::Child(handle, _, _, _) = &answer {
                let detached = HOST.with(|h| {
                    h.borrow().as_ref().and_then(|st| st.spawned.lock().unwrap().remove(&id))
                });
                if *handle >= 0 && detached != Some(true) {
                    close_socket(*handle);
                }
                return;
            }
            // **An abandoned `connect` is closed, not handed on.** Nothing else wants this
            // connection — it is a line this program dialled and stopped caring about — so
            // left alone the handle never leaves the table and the peer holds an open line
            // to nobody. An accept has a listener noted against it and was handled above; a
            // socket answer with no note is a dial. `issues/system/0310b`.
            if let (None, Answer::Socket(slot, _, _, _, _)) = (reading, &answer) {
                if *slot >= 0 {
                    HOST.with(|h| {
                        if let Some(st) = h.borrow().as_ref() {
                            if let Some(Sock::Stream(sk)) =
                                st.sockets.lock().unwrap().remove(slot)
                            {
                                let _ = sk.shutdown(std::net::Shutdown::Both);
                            }
                        }
                    });
                }
                return;
            }
            let taken: Option<&Vec<u8>> = match &answer {
                Answer::Read(ReadAnswer::Data(b)) => Some(b),
                Answer::Bytes(Some(b)) => Some(b),
                _ => None,
            };
            if let (Some(handle), Some(bytes)) = (reading, taken) {
                if !bytes.is_empty() {
                    let queue = HOST.with(|h| {
                        h.borrow().as_ref().and_then(|st| {
                            match st.sockets.lock().unwrap().get(&handle) {
                                Some(Sock::Queue(q)) => Some(q.clone()),
                                _ => None,
                            }
                        })
                    });
                    match queue {
                        // Into the queue, so a reader parked on it is woken by them.
                        Some(q) => q.unread(bytes.clone()),
                        // A socket has none, so they wait under the handle instead.
                        None => {
                            if let Some(map) = HOST.with(|h| {
                                h.borrow().as_ref().map(|st| st.pushback.clone())
                            }) {
                                map.lock().unwrap().entry(handle).or_default()
                                    .extend(bytes.iter().copied());
                            }
                        }
                    }
                }
            }
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
    return;
}

/// Close a handle: end a child's queues and input, shut a connection, forget what was parked for it — what
/// `closeSocket` does, and what dropping an uncollected spawn or connect does too.
fn close_socket(handle: i32) {
    HOST.with(|h| {
        if let Some(st) = h.borrow().as_ref() {
            // **Ending the queue is what stops the child**, and dropping the entry is not
            // that. This removed the handle and nothing else — so the *parent's* `Arc` went
            // and the child's stayed, the stream was never marked done, and the child's
            // `write` kept answering `true` to a pipe nobody was reading. `yes | head -2`
            // printed both lines and then never returned. `issues/system/0275c`.
            //
            // `streams.rs` states the contract this restores: *"`false` is what `write`
            // answers to a closed pipe, and what a program like `yes` is written to
            // notice."* And `native/src/main.rs` — the wasmtime host — has done exactly
            // this since `issues/system/0123`, which is where the wording below comes from:
            // ending the queues is what the child's *parent* needs, and a reader parked on
            // its output has to find out.
            match st.sockets.lock().unwrap().remove(&handle) {
                Some(Sock::Queue(q)) => q.finish(),
                // **Dropping a `TcpStream` is not closing the connection when a `recv` is
                // parked on it.** `recv` takes its own descriptor with `try_clone`, which
                // dups the fd, so removing this entry drops one of two and the peer is told
                // nothing: a client reading to end-of-stream waits for ever. With no read
                // outstanding there is no dup, the drop is the close, and it works — which
                // is why this went unseen until something read from a proxy.
                // `issues/system/0304b`, and its probe is
                // `packages/platform/test/wac/closewhilereading_test.wac`.
                //
                // `shutdown` acts on the *connection* rather than on a descriptor, so it
                // reaches the peer however many clones are live. The error is dropped for
                // the same reason the rest of this handler drops errors: a socket already
                // gone is the state the caller asked for.
                Some(Sock::Stream(sk)) => {
                    let _ = sk.shutdown(std::net::Shutdown::Both);
                }
                _ => {}
            }
            // Its input too: a child parked reading what nobody will send is stopped just as
            // surely as one writing where nobody reads, and `closeFeed` is the capability
            // for ending *only* that — see its note on why the two are not one thing.
            if let Some(feed) = st.child_feeds.get(&handle) {
                feed.finish();
            }
            // **And any bytes parked for it**, for the reason given a few lines down about
            // a leftover datagram: the handle is reused, so what `0307b` set aside for this
            // socket would be handed to the next one to take the number.
            st.pushback.lock().unwrap().remove(&handle);
            // **The child's handle stays in `child_exits`.** Its status is still worth
            // asking for — a parent that stops a child and wants to know it is gone asks
            // `exitCode` next — which is the wasmtime host's rule and the JavaScript hosts'.
            //
            // **And anything parked for it.** A handle is reused, so a datagram left over
            // from a closed socket would be answered to whatever opens next —
            // `issues/system/0207` is about not losing packets, not about inventing them.
            st.datagrams.lock().unwrap().remove(&handle);
        }
    });
}

/// Whether request `op` takes something — a connection, a child, a file, bytes off a stream — that a
/// dropped request has to give back. Its answer is never delivered inside the request.
fn takes(op: i32) -> bool {
    matches!(
        op,
        OP_READ_STDIN | OP_READ_CHUNK | OP_RECV | OP_RECEIVE_FROM | OP_CONNECT | OP_LISTEN | OP_ACCEPT
            | OP_BIND_DATAGRAM | OP_SPAWN | OP_SPAWN_SELF | OP_OPEN_FILE
    )
}

/// A little-endian `u32`-length-prefixed part, and the rest.
fn take_part(b: &[u8]) -> Option<(&[u8], &[u8])> {
    let n = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
    let rest = &b[4..];
    Some((rest.get(..n)?, &rest[n..]))
}

/// A `u32` count, then that many parts.
fn take_list(mut b: &[u8]) -> Option<(Vec<Vec<u8>>, &[u8])> {
    let n = u32::from_le_bytes(b.get(..4)?.try_into().ok()?) as usize;
    b = &b[4..];
    let mut out = Vec::with_capacity(n.min(4096));
    for _ in 0..n {
        let (part, rest) = take_part(b)?;
        out.push(part.to_vec());
        b = rest;
    }
    Some((out, b))
}

/// `spawn`'s `bytes`: the module (empty for this program), then the arguments — std's `spawnBytes`.
fn unpack_spawn(b: &[u8]) -> Option<(Vec<u8>, Vec<Vec<u8>>)> {
    let (wasm, rest) = take_part(b)?;
    let (args, _) = take_list(rest)?;
    Some((wasm.to_vec(), args))
}

/// `exec`'s `bytes`: the program, its arguments, its input, and `NAME=value` pairs — std's `execBytes`.
fn unpack_exec(b: &[u8]) -> Option<(String, Vec<String>, Vec<u8>, Vec<String>)> {
    let text = |v: Vec<Vec<u8>>| v.into_iter().map(|x| String::from_utf8_lossy(&x).into_owned()).collect();
    let (program, rest) = take_part(b)?;
    let (args, rest) = take_list(rest)?;
    let (input, rest) = take_part(rest)?;
    let (pairs, _) = take_list(rest)?;
    Some((String::from_utf8_lossy(program).into_owned(), text(args), input.to_vec(), text(pairs)))
}

/// A funcref the guest called: `wac.cb<j>(slot, …)` — one of the four `__wacHost` was handed.
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
        return throw(scope, "no function in that slot");
    };
    match cap {
        // **End the program now** (spec ch07 `sys.exit`): unwind to `main`'s call, abandoning
        // whatever is left. A throw rather than `process::exit` because a child is a thread here.
        Cap::Exit => {
            let code = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(1);
            EXIT_REQUEST.with(|e| e.set(Some(code)));
            throw(scope, "the program exited");
        }
        // **Nobody can ask this host to interrupt, so the answer is no** — and that is the answer
        // rather than a stub. The terminal belongs to whatever started the program; only a page can
        // say yes, because there the keydown listener and the code servicing requests are one thread.
        Cap::AskInterrupt => rv.set_bool(false),
        Cap::WaitAny => {
            let ids = read_i32_array(scope, args.get(1));
            let millis = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let which = wait_and_deliver(scope, &ids, millis);
            rv.set(v8::Integer::new(scope, which).into());
        }
        Cap::Request => {
            let op = args.get(1).to_int32(scope).map(|v| v.value()).unwrap_or(-1);
            let id = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            // **A wasm `i64` is a JavaScript `BigInt`** at this boundary, and V8 is the one holding
            // that rule.
            let wide = |v: v8::Local<v8::Value>| v.to_big_int(scope).map(|b| b.i64_value().0).unwrap_or(0);
            let a = wide(args.get(3));
            let b = wide(args.get(4));
            let text = read_string(scope, args.get(5));
            let bytes = read_bytes(scope, args.get(6));
            if op == OP_DROP {
                let tid = HOST.with(|h| h.borrow_mut().as_mut().and_then(|s| s.inflight.remove(&id)));
                if let Some(tid) = tid {
                    drop_ticket(tid);
                }
                rv.set_undefined();
                return;
            }
            match serve(scope, cap_of_op(op), op, &Req { a, b, text, bytes }) {
                // **What a request takes stays the host's until somebody waits for it** (design/system/0013,
                // settled before step 6): a connection, a child, a file opened, bytes off a stream. Answered at
                // once, it was the program's before the call returned, and a `cancel` that never waited could
                // not give it back. So it waits in a settled ticket, which `waitAny` delivers and `OP_DROP` undoes.
                Reply::Now(answer) if id != 0 && takes(op) => {
                    let Some(t) = table() else { rv.set_undefined(); return };
                    let tid = t.submit();
                    let _ = t.complete(tid, answer);
                    HOST.with(|h| {
                        if let Some(st) = h.borrow_mut().as_mut() {
                            match op {
                                OP_READ_STDIN | OP_READ_CHUNK => { st.reading.lock().unwrap().insert(tid, STDIN_HANDLE); }
                                OP_RECV | OP_ACCEPT => { st.reading.lock().unwrap().insert(tid, a as i32); }
                                OP_RECEIVE_FROM => { st.receiving.lock().unwrap().insert(tid, a as i32); }
                                OP_SPAWN | OP_SPAWN_SELF => { st.spawned.lock().unwrap().insert(tid, (b & DETACHED as i64) != 0); }
                                _ => {}
                            }
                            st.inflight.insert(id, tid);
                        }
                    });
                }
                Reply::Now(answer) if id != 0 => {
                    deliver(scope, id, answer);
                }
                Reply::Later(tid) if id != 0 => HOST.with(|h| {
                    if let Some(st) = h.borrow_mut().as_mut() {
                        st.inflight.insert(id, tid);
                    }
                }),
                // Nobody will ask for it: the ticket goes as a dropped one would.
                Reply::Later(tid) => drop_ticket(tid),
                _ => {}
            }
            rv.set_undefined();
        }
        // Only the four above are ever bound; a request's capability is never a slot.
        _ => {
            let who = HOST.with(|h| {
                h.borrow()
                    .as_ref()
                    .and_then(|s| s.cap_names.get(sig).and_then(|v| v.get(slot)).cloned())
                    .unwrap_or_else(|| format!("signature {sig} slot {slot}"))
            });
            throw(scope, &format!("{who} is not answered by this host"));
        }
    }
}

/// Answer one request — or start the work that will, on a thread.
fn serve(scope: &mut v8::PinScope, cap: Cap, op: i32, r: &Req) -> Reply {
    match cap {
        Cap::ArgCount => {
            let n = HOST.with(|h| {
                let b = h.borrow();
                let Some(s) = b.as_ref() else { return 0 };
                s.argv.len()
            }) as i32;
            if std::env::var_os("WACV8_TRACE").is_some() {
                eprintln!("[trace] argCount -> {n}");
            }
            return Reply::Now(Answer::I32(n));
        }
        Cap::Arg => {
            let i = r.a;
            let bytes = HOST.with(|h| {
                let b = h.borrow();
                let Some(s) = b.as_ref() else { return Vec::new() };
                usize::try_from(i).ok().and_then(|i| s.argv.get(i).cloned()).unwrap_or_default()
            });
            if std::env::var_os("WACV8_TRACE").is_some() {
                eprintln!("[trace] arg({i}) -> {:?}", String::from_utf8_lossy(&bytes));
            }
            return Reply::Now(Answer::Bytes(Some(bytes)));
        }
        Cap::Write | Cap::WriteErr => {
            // **Wherever output currently goes** — a parent, or this process's stream, in that order.
            // One helper, so the two streams cannot drift apart; see `emit_bytes`. Answered at once,
            // which is what lets a program ignore a write to its diagnostic output.
            return Reply::Now(Answer::Bool(emit_bytes(&r.bytes, cap == Cap::WriteErr)));
        }
        Cap::ReadFile => {
            let path = resolve_path(&r.text);
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
                return Reply::Now(a);
            }
            // **On a thread**, which is the whole reason this returns a ticket rather than a value:
            // a slow disk must not stop the program from doing what else it had in flight.
            let Some(t) = table() else { return no_table() };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                let a = match std::fs::read(&path) {
                    Ok(bytes) => Answer::File(true, bytes, String::new(), FAULT_NONE),
                    Err(e) => Answer::File(false, Vec::new(), message_of(&e), fault_of_path(&e, &path)),
                };
                let _ = worker.complete(id, a);
            });
            return Reply::Later(id);
        }
        Cap::Env => {
            // **Refused, not absent**: std's `Env` answers `NotGranted` when the host withheld the
            // environment, and an unset variable is `flags` 0 — two facts, two spellings.
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.env));
            if !granted {
                return Reply::Now(Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into()));
            }
            return Reply::Now(Answer::Bytes(std::env::var(&r.text).ok().map(String::into_bytes)));
        }
        Cap::Spawn => {
            // **`spawnSelf` only.** `spawn(path, …)` runs a *different* bundle, which means reading
            // and compiling one; `spawnSelf` runs this same module with new arguments, which is what
            // `packages/sh` uses for a background job and what box's dispatcher needs. The first
            // argument tells them apart: `spawn` is given a path and `spawnSelf` is not.
            //
            // A child is a thread with its own V8 isolate — an isolate belongs to one thread, so
            // there is no sharing to be had — compiling the same bytes again and running `main`.
            // The arguments are bytes, not text — 0148 — packed after the (empty) module.
            let Some((_, argv)) = unpack_spawn(&r.bytes) else {
                return Reply::Now(Answer::Child(-1, -1, -1, "a spawn request that does not unpack".into()));
            };
            let grant_bits = r.a as i32;
            let cwd = r.text.clone();
            // The `INHERIT_*` mask: the input bit and the output bit are the host's — `DETACHED` (4) is
            // handled in std, where the ticket decides whether to stop the child. `issues/system/0312b`.
            let mask = r.b;
            let inherits = mask & INHERIT_IN != 0;
            // **The child writes this process's own streams**, as `spawn`'s does — this read only the
            // input bit, so a `spawnSelf` child handed the output wrote into a queue nobody read.
            let inherit_out = mask & INHERIT_OUT != 0;
            // Read rather than dropped as it used to be, which is the whole of 0157: a parent that
            // offered to serve a filesystem was never asked to.
            let serve_fs = mask & SPAWN_SERVES != 0;

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
                // **Inheritable, and narrowed like every other bit.** This was `false` with a note
                // saying `GRANT_*` had no bit for running a host program and that allocating one
                // needed a `GRANT_RUN` in `platform.wac` plus a stage that proves the ceiling holds.
                // Both exist — `issues/system/0264c` — so the answer is the ordinary intersection: a
                // child gets `run` if it asked for it *and* its parent had it. The confinement
                // argument the old note made is intact, because that is what the `&&` is.
                run: parent_grants.run && grant_bits & GRANT_RUN != 0,
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
            let Some(t) = table() else { return no_table() };
            let exit_id = t.submit();
            let worker = t.clone();
            let child = AsChild {
                argv,
                grants: Some(grants),
                cwd: if cwd.is_empty() { None } else { Some(cwd) },
                // None is what `emit_bytes` falls through on: no parent queue, so the real stream.
                out: if inherit_out { None } else { Some(out.clone()) },
                err: if inherit_out { None } else { Some(err.clone()) },
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
                // **`run_as_with`, so the manifest text reaches the child.** `run_as` passes `""`,
                // and a child re-parses this string to build the world for *its* own child — so an
                // empty one made every **grandchild** fail: `serde_json::from_str("")` is an error,
                // and the arm above answers 127 before anything starts.
                //
                // `init` starting services out of an image is the ordinary case. Each service came
                // back 127 and the boot still ended `init: all services have stopped`, because a
                // service that never started has stopped. `issues/system/0280c`.
                let code = run_as_with(&manifest, &wasm, &manifest_text, child);
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
            return Reply::Now(a);
        }
        Cap::CloseFeed => {
            // **Ends a child's input without stopping it.** A program that reads to the end before
            // answering — `wc` is the obvious one — needs the end while it is still running, so this
            // finishes the queue rather than dropping the child.
            let handle = r.a as i32;
            let feed = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_feeds.get(&handle).cloned())
            });
            if let Some(q) = feed {
                q.finish();
            }
            return Reply::Nothing;
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
            let Some((bytes, argv)) = unpack_spawn(&r.bytes) else {
                return Reply::Now(Answer::Child(-1, -1, -1, "a spawn request that does not unpack".into()));
            };
            let Some(text) = manifest_in(&bytes) else {
                let why = if bytes.len() >= 4 && &bytes[0..4] == b"\0asm" {
                    "that module carries no wac.manifest section, so this runtime cannot describe it"
                } else {
                    "this runtime starts wasm modules, and that is not one; spawnSelf works"
                };
                let a = Answer::Child(-1, -1, -1, why.into());
                return Reply::Now(a);
            };

            let grant_bits = r.a as i32;
            let cwd = r.text.clone();
            // **Flags, not a bool**, as `platform.wac`'s `INHERIT_IN`/`INHERIT_OUT`.
            let inherit = r.b;
            let inherits = inherit & INHERIT_IN != 0;
            // **The child writes this process's own streams.** A child here is a thread, so the two
            // reach the real descriptors in the order it wrote them — which two queues cannot,
            // because the parent reads whichever answers first. `issues/system/0282c`.
            let inherit_out = inherit & INHERIT_OUT != 0;
            let serve_fs = inherit & SPAWN_SERVES != 0;

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
                // **Inheritable, and narrowed like every other bit.** This was `false` with a note
                // saying `GRANT_*` had no bit for running a host program and that allocating one
                // needed a `GRANT_RUN` in `platform.wac` plus a stage that proves the ceiling holds.
                // Both exist — `issues/system/0264c` — so the answer is the ordinary intersection: a
                // child gets `run` if it asked for it *and* its parent had it. The confinement
                // argument the old note made is intact, because that is what the `&&` is.
                run: parent_grants.run && grant_bits & GRANT_RUN != 0,
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
            let Some(t) = table() else { return no_table() };
            let exit_id = t.submit();
            let worker = t.clone();
            let child = AsChild {
                argv,
                grants: Some(grants),
                cwd: if cwd.is_empty() { None } else { Some(cwd) },
                // None is what `emit_bytes` falls through on: no parent queue, so the real stream.
                out: if inherit_out { None } else { Some(out.clone()) },
                err: if inherit_out { None } else { Some(err.clone()) },
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
            return Reply::Now(a);
        }
        Cap::ExitCode => {
            // **The child's ticket, not a poll.** A parent may ask before the child has started;
            // blocking on the ticket is the answer, and the table already does that correctly.
            let handle = r.a as i32;
            let known = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_exits.get(&handle).copied())
            });
            match known {
                Some(id) => {
                    // Hand back the child's own ticket rather than a fresh one: the answer is
                    // already promised to that id, and two tickets for one fact is how a `wait`
                    // comes to block for ever.
                    return Reply::Later(id);
                }
                // Nothing was spawned under that handle. 127 is what a shell says about a command
                // it could not run, which is the truth here.
                None => return Reply::Now(Answer::I32(127)),
            }
        }
        Cap::ReadStdin => {
            // **What an abandoned read already took, in front of the rest.** A `drop` holding this
            // capability's answer leaves it under standard input's handle, and this is where it is
            // collected — without it the late ordering lost the lot on this host, 0 of 6, while the
            // early one was fixed. `issues/system/0310b`.
            let waiting: Vec<u8> = HOST
                .with(|h| {
                    h.borrow()
                        .as_ref()
                        .and_then(|st| st.pushback.lock().unwrap().remove(&STDIN_HANDLE))
                })
                .unwrap_or_default();
            // **All of it, to the end** — the unbounded read, as against `readChunk`'s bounded one.
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
                let Some(t) = table() else { return no_table() };
                let id = t.submit();
                    HOST.with(|h| { if let Some(st) = h.borrow().as_ref() { st.reading.lock().unwrap().insert(id, STDIN_HANDLE); } });
                let worker = t.clone();
                std::thread::spawn(move || {
                    // To the end, which is what this capability is: every chunk until the parent
                    // says there are no more.
                    let mut all = waiting.clone();
                    loop {
                        // **Stops if nobody is waiting.** Reading to EOF for a ticket that has been
                        // given up on lost the whole of standard input — 1 run in 6 on this host,
                        // 7 in 8 on the other. Whatever was already gathered goes back at the front
                        // of the queue for the next `readStdin`. `issues/system/0310b`.
                        let Some(chunk) = q.read_unless(|| !worker.is_live(id)) else {
                            q.unread(all);
                            return;
                        };
                        if chunk.is_empty() {
                            break;
                        }
                        all.extend_from_slice(&chunk);
                    }
                    // And the narrow order, where it is given up on between the last read and
                    // here: put back rather than dropped.
                    if let Some(Answer::Bytes(Some(back))) = worker.complete(id, Answer::Bytes(Some(all))) {
                        q.unread(back);
                    }
                });
                return Reply::Later(id);
            }
            let Some(t) = table() else { return no_table() };
            let id = t.submit();
                    HOST.with(|h| { if let Some(st) = h.borrow().as_ref() { st.reading.lock().unwrap().insert(id, STDIN_HANDLE); } });
            let worker = t.clone();
            std::thread::spawn(move || {
                // **Starts from what was put back, and hands back what nobody takes.** This is the
                // process's own input rather than a child's feed, so there is no queue to decline
                // from — the read has happened by the time anything can be asked, exactly like a
                // socket. Both halves were missing: the drained `waiting` was dropped on the floor
                // here, which is worse than not draining it, and an answer nobody collected went the
                // same way. `issues/system/0310b`.
                let mut buf = waiting.clone();
                let a = match std::io::stdin().read_to_end(&mut buf) {
                    Ok(_) => Answer::Bytes(Some(buf)),
                    Err(_) => Answer::Bytes(Some(Vec::new())),
                };
                if let Some(Answer::Bytes(Some(back))) = worker.complete(id, a) {
                    HOST.with(|h| {
                        if let Some(st) = h.borrow().as_ref() {
                            st.pushback.lock().unwrap().entry(STDIN_HANDLE).or_default().extend(back);
                        }
                    });
                }
            });
            return Reply::Later(id);
        }
        Cap::BindDatagram => {
            // The same one grant as `connect` and `listen`: the authority is "speak to something
            // that is not this process", and the transport does not change what that means.
            let address = r.text.clone();
            let port = r.a as i32;
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
            return Reply::Now(answer);
        }
        Cap::ReceiveFrom => {
            let handle = r.a as i32;
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
                return Reply::Now(Answer::Datagram(Vec::new(), String::new(), 0, "not an open datagram socket".into()),);
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
                return Reply::Now(a);
            }

            let Some(t) = table() else { return no_table() };
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
            return Reply::Later(id);
        }
        Cap::SendTo => {
            let handle = r.a as i32;
            let address = r.text.clone();
            let port = r.b as i32;
            let body = &r.bytes;
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
                Some(sk) => sk.send_to(body, (address.as_str(), port as u16)).is_ok(),
            };
            return Reply::Now(Answer::Bool(ok));
        }
        Cap::Listen | Cap::Connect => {
            // **One grant for both ends.** Dialling out and accepting in are the same authority —
            // the ability to speak to something that is not this process — and `platform.wac` gives
            // them one flag.
            let address = r.text.clone();
            let port = r.a as i32;
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
            return Reply::Now(answer);
        }
        Cap::Accept => {
            let handle = r.a as i32;
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
                return Reply::Now(a);
            };
            // A connection a dropped accept already took is answered before waiting for another.
            let already = HOST.with(|h| {
                h.borrow().as_ref().and_then(|st| {
                    st.parked_accepts.lock().unwrap().get_mut(&handle).and_then(|q| q.pop_front())
                })
            });
            if let Some(a) = already {
                return Reply::Now(a);
            }
            let Some(t) = table() else { return no_table() };
            let listen_handle = handle;
            let waiting = HOST.with(|h| h.borrow().as_ref().map(|st| st.accepting.clone()));
            let id = t.submit();
            // Registered so a connection taken for a ticket nobody wants can be handed to this one
            // wherever it is waiting. `issues/system/0310b`.
            if let Some(ref w) = waiting {
                w.lock().unwrap().entry(listen_handle).or_default().push_back(id);
            }
            // Which listener, so a `drop` holding an accepted connection knows whose queue it is.
            HOST.with(|h| {
                if let Some(st) = h.borrow().as_ref() {
                    st.reading.lock().unwrap().insert(id, listen_handle);
                }
            });
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
                // **A connection is consumed to make this.** The socket is in the table by now,
                // so an answer nobody takes leaves a client attached to a handle that will never be
                // handed out — 0 of 6 kept on this host. Given to a ticket that is still live rather
                // than parked, because a thread blocked in `accept()` cannot be handed a connection
                // that arrived on another one. `issues/system/0310b`.
                if let Some(ref w) = waiting {
                    w.lock().unwrap().get_mut(&listen_handle).map(|q| q.retain(|&x| x != id));
                }
                let mut answer = worker.complete(id, a);
                while let Some(unclaimed) = answer.take() {
                    let next = waiting.as_ref().and_then(|w| {
                        w.lock().unwrap().get_mut(&listen_handle).and_then(|q| q.pop_front())
                    });
                    match next {
                        Some(other) => answer = worker.complete(other, unclaimed),
                        None => break,
                    }
                }
            });
            return Reply::Later(id);
        }
        Cap::Recv => {
            let handle = r.a as i32;
            enum Source {
                Socket(std::net::TcpStream),
                Queue(Arc<Stream>),
                File(std::fs::File),
            }
            let source = HOST.with(|h| {
                let b = h.borrow();
                let st = b.as_ref()?;
                let socks = st.sockets.lock().unwrap();
                match socks.get(&handle) {
                    Some(Sock::Stream(sk)) => sk.try_clone().ok().map(Source::Socket),
                    Some(Sock::Queue(q)) => Some(Source::Queue(q.clone())),
                    Some(Sock::File(f)) => f.try_clone().ok().map(Source::File),
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
                // whether there is a parent to ask — the wac client that asked, removed in step 5 of
                // design/system/0013 (385d952b9), read a null back as "use the host's filesystem". This host has no `serveFs` yet, so the honest answer
                // is always "ended", and throwing instead made every `box` applet trap: `wac sh.wasm
                // true` died before running anything. The JS host has said this all along, by
                // checking `n_HANDLE` before its socket table. issues/system/0148.
                if handle == PARENT_FS_HANDLE {
                    return Reply::Now(Answer::Read(ReadAnswer::End));
                }
                // **A handle that is gone is an answer too, for the same reason the parent is.**
                // A reader parked in `recv` while another task closes that socket is an ordinary
                // race — `packages/tor/src/socks.wac` does it every time a client goes away — and
                // this line turned it into a dead program with no message anyone could read. The
                // other hosts have always answered: `native/src/main.rs` settles `Read.Failed`
                // here and says why it is `Failed` rather than `End` — the peer did not finish,
                // there was never one. `issues/system/0306b`, and the same shape as `0148` one
                // branch up.
                let why = if HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.net)) {
                    "no such handle".to_string()
                } else {
                    "network access not granted to this application".to_string()
                };
                return Reply::Now(Answer::Read(ReadAnswer::Failed(why)));
            };
            // **What an abandoned reader already took, before asking the source for more.** Order
            // is the whole of a stream's meaning, so these come first and whole. 0307b.
            let waiting = HOST.with(|h| {
                h.borrow().as_ref().and_then(|st| st.pushback.lock().unwrap().remove(&handle))
            });
            if let Some(bytes) = waiting {
                if !bytes.is_empty() {
                    return Reply::Now(Answer::Read(ReadAnswer::Data(bytes)));
                }
            }
            let back = HOST.with(|h| h.borrow().as_ref().map(|st| st.pushback.clone()));
            let note = |id: i32| {
                HOST.with(|h| {
                    if let Some(st) = h.borrow().as_ref() {
                        st.reading.lock().unwrap().insert(id, handle);
                    }
                });
            };
            if let Source::Queue(q) = source {
                let Some(t) = table() else { return no_table() };
                let id = t.submit();
                note(id);
                let worker = t.clone();
                std::thread::spawn(move || {
                    // Declines to take them at all if nobody is waiting — see `read_unless`. The
                    // `unread_bytes` below is the backstop for a caller that gives up between the
                    // two. `issues/system/0307b`.
                    let Some(bytes) = q.read_unless(|| !worker.is_live(id)) else { return };
                    let a = if bytes.is_empty() {
                        Answer::Read(ReadAnswer::End)
                    } else {
                        Answer::Read(ReadAnswer::Data(bytes))
                    };
                    unread_bytes(&q, worker.complete(id, a));
                });
                return Reply::Later(id);
            }
            // A file is read on a thread as a socket is: a slow disk must not stop the program. The
            // descriptor is a duplicate sharing the original's offset, so reads continue where the last
            // left off.
            if let Source::File(mut file) = source {
                let Some(t) = table() else { return no_table() };
                let id = t.submit();
                note(id);
                let worker = t.clone();
                std::thread::spawn(move || {
                    let mut buf = [0u8; 65536];
                    let a = match file.read(&mut buf) {
                        Ok(0) => Answer::Read(ReadAnswer::End),
                        Ok(n) => Answer::Read(ReadAnswer::Data(buf[..n].to_vec())),
                        Err(e) => Answer::Read(ReadAnswer::Failed(message_of(&e))),
                    };
                    park_read(&back, handle, worker.complete(id, a));
                });
                return Reply::Later(id);
            }
            let Source::Socket(mut stream) = source else { unreachable!() };
            let Some(t) = table() else { return no_table() };
            let id = t.submit();
            note(id);
            let worker = t.clone();
            std::thread::spawn(move || {
                let mut buf = [0u8; 65536];
                let a = match stream.read(&mut buf) {
                    Ok(0) => Answer::Read(ReadAnswer::End),
                    Ok(n) => Answer::Read(ReadAnswer::Data(buf[..n].to_vec())),
                    Err(e) => Answer::Read(ReadAnswer::Failed(message_of(&e))),
                };
                park_read(&back, handle, worker.complete(id, a));
            });
            return Reply::Later(id);
        }
        Cap::Send => {
            let handle = r.a as i32;
            let bytes = &r.bytes;
            // **A child is fed on the same handle its output comes back on.** `send` knew only
            // sockets, so `runner` fed its child nothing and `wc` counted an empty stream — `0 0 0`,
            // which is a right-looking answer to a question never asked.
            let feed = HOST.with(|h| {
                h.borrow().as_ref().and_then(|s| s.child_feeds.get(&handle).cloned())
            });
            if let Some(q) = feed {
                let ok = q.write(bytes);
                return Reply::Now(Answer::Bool(ok));
            }
            let sent = HOST.with(|h| {
                let b = h.borrow();
                let Some(st) = b.as_ref() else { return false };
                let mut socks = st.sockets.lock().unwrap();
                match socks.get_mut(&handle) {
                    Some(Sock::Stream(sk)) => sk.write_all(bytes).and_then(|_| sk.flush()).is_ok(),
                    Some(Sock::File(f)) => f.write_all(bytes).is_ok(),
                    _ => false,
                }
            });
            return Reply::Now(Answer::Bool(sent));
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
        // **A file as a stream of its own** — `files.openRead`/`openWrite`. `how` is 0 to read, 1 to create or truncate,
        // 2 to create or append; the grant is the one `readFile` or `writeFile` would need.
        Cap::OpenFile => {
            let path = resolve_path(&r.text);
            let how = r.a as i32;
            let granted = HOST.with(|h| {
                h.borrow().as_ref().is_some_and(|s| if how == 0 { s.grants.read } else { s.grants.write })
            });
            let answer = if !granted {
                Answer::Socket(-1, "Not granted to this application".into(), String::new(), 0, FAULT_NOT_GRANTED)
            } else {
                let mut o = std::fs::OpenOptions::new();
                if how == 0 {
                    o.read(true);
                } else {
                    o.write(true).create(true);
                    if how == 2 { o.append(true); } else { o.truncate(true); }
                }
                match o.open(&path) {
                    Ok(f) => Answer::Socket(keep_socket(Sock::File(f)), String::new(), String::new(), 0, FAULT_NONE),
                    Err(e) => Answer::Socket(-1, message_of(&e), String::new(), 0, fault_of_path(&e, &path)),
                }
            };
            return Reply::Now(answer);
        }
        // The end of a file `openFile` opened. `std::fs::File` does not buffer — each `send` was a write
        // to the system — so dropping it is the whole of closing, and a later read finds every byte.
        Cap::CloseFile => {
            let handle = r.a as i32;
            let gone = HOST.with(|h| {
                h.borrow().as_ref().and_then(|st| st.sockets.lock().unwrap().remove(&handle))
            });
            let ok = match gone {
                Some(Sock::File(_)) => true,
                _ => false,
            };
            return Reply::Now(Answer::Bool(ok));
        }
        // The end of this program's output or its diagnostic output; it goes on running. A spawned child's
        // queue is finished, so its parent reads the end; this process's own stream is pointed at
        // `/dev/null` rather than closed, so the descriptor cannot be reused by a file opened later.
        Cap::CloseOutput => {
            let to_err = r.a != 0;
            let ok = HOST.with(|h| {
                let mut b = h.borrow_mut();
                let Some(s) = b.as_mut() else { return false };
                if s.out_closed[to_err as usize] {
                    return true;
                }
                s.out_closed[to_err as usize] = true;
                if let Some(q) = if to_err { s.child_err.clone() } else { s.child_out.clone() } {
                    q.finish();
                    return true;
                }
                close_std_stream(if to_err { 2 } else { 1 })
            });
            return Reply::Now(Answer::Bool(ok));
        }
        Cap::CloseSend => {
            let handle = r.a as i32;
            HOST.with(|h| {
                if let Some(st) = h.borrow().as_ref() {
                    if let Some(Sock::Stream(s)) = st.sockets.lock().unwrap().get(&handle) {
                        let _ = s.shutdown(std::net::Shutdown::Write);
                    }
                }
            });
            return Reply::Nothing;
        }
        Cap::CloseSocket => {
            close_socket(r.a as i32);
            return Reply::Nothing;
        }
        Cap::ReadDir => {
            let path = resolve_path(&r.text);
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.read));
            if !granted {
                return Reply::Now(Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into()));
            }
            let Some(t) = table() else { return no_table() };
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
                        Answer::Names(names)
                    }
                    // Which failure, now that the answer can say: `ls` on a file and on nothing are
                    // different sentences.
                    Err(e) => Answer::Change(fault_of_path(&e, &path), message_of(&e)),
                };
                let _ = worker.complete(id, a);
            });
            return Reply::Later(id);
        }
        // `modules.load` — a module in this isolate, whose exports this program may call. Answered at
        // once: `n` the handle. `issues/system/0240c`.
        Cap::Load => {
            return Reply::Now(match load_module(scope, &r.bytes, r.a as i32) {
                Ok(h) => Answer::I32(h),
                Err(e) => Answer::Change(FAULT_OTHER, e),
            });
        }
        // `flags` the status, `n` the value, `text` what a trap said.
        Cap::Call => {
            let (status, text, value) = call_loaded(scope, r.a as i32, &r.text, r.b as i32);
            return Reply::Now(Answer::Called(status, text, value));
        }
        // **A `TryCatch`, and it is not optional.** A rejected module leaves an exception on the
        // isolate, and the *next* compile walks into V8's own check that a null result and a pending
        // exception agree — `Check failed: maybe_compiled.is_null() == i_isolate->has_exception()` —
        // which aborts the process with SIGABRT rather than returning. Nothing else in this file needs
        // one because nothing else compiles twice in a row; a caller validating a corpus does nothing
        // else. `packages/wac/test/wac/testcli_test.wac` puts a good module *after* a bad one for exactly this.
        Cap::Validated => {
            let said = {
                let tc = std::pin::pin!(v8::TryCatch::new(scope));
                let mut tc = tc.init();
                let ok = v8::WasmModuleObject::compile(&tc, &r.bytes).is_some();
                // The engine's own sentence when it has one. It usually does — "expected magic word",
                // "section out of order" — and it is the difference between a caller able to say what
                // is wrong with a module and one able only to say that something is.
                let why = if ok {
                    String::new()
                } else {
                    tc.exception()
                        .and_then(|e| e.to_string(&mut tc))
                        .map(|s| s.to_rust_string_lossy(&mut tc))
                        .unwrap_or_else(|| "the engine would not compile it".to_string())
                };
                tc.reset();
                why
            };
            return Reply::Now(if said.is_empty() {
                Answer::Change(FAULT_NONE, String::new())
            } else {
                Answer::Change(FAULT_OTHER, said)
            });
        }
        Cap::Unload => {
            let n = r.a as i32;
            HOST.with(|h| {
                if let Some(st) = h.borrow_mut().as_mut() {
                    st.loaded.remove(&n);
                    // The cache names a function inside the module that is going away.
                    if matches!(&st.last_call, Some((hh, _, _)) if *hh == n) {
                        st.last_call = None;
                    }
                }
            });
            return Reply::Nothing;
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
            // the ticket in the same breath, so an `exec` answer on this host was a promise of
            // something that had already happened — three concurrent `sleep 1` were 3013ms here
            // against 1009ms for the same program on the Deno host, which dispatches and returns at
            // once. Issue 0211, held by `packages/platform/test/wac/exec_test.wac`. The lost overlap
            // was the smaller half: a ticket that exists only after the work is over cannot be
            // watched by `waitAny`, so a child that wedged had nothing bounding it.
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.run));
            if !granted {
                return Reply::Now(Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into()));
            }
            let Some((path, argv, stdin, env)) = unpack_exec(&r.bytes) else {
                return Reply::Now(Answer::Change(FAULT_OTHER, "an exec request that does not unpack".into()));
            };
            let clear_env = r.a & 1 != 0;
            let inherit = r.a & 2 != 0;
            // Empty means "wherever this process already is", matching `spawn`'s `cwd`.
            let cwd = r.text.clone();
            let Some(t) = table() else { return no_table() };
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
                    run_host_program(path, argv, stdin, env, clear_env, inherit, cwd),
                );
            });
            return Reply::Later(id);
        }
        Cap::Rename | Cap::Remove | Cap::Mkdir | Cap::SetExecutable | Cap::Chmod => {
            // Four mutations behind one grant, because they are one authority: the ability to change
            // what is on disk. Each answers a `Change`, and a refusal is `FAULT_NOT_GRANTED` rather
            // than the operating system's `FAULT_DENIED` — this build cannot, as against this file
            // will not.
            let a = resolve_path(&r.text);
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                let r = match cap {
                    Cap::Rename => {
                        // The second path rides in `bytes`, as UTF-8 — a request carries one string.
                        let to = resolve_path(&String::from_utf8_lossy(&r.bytes));
                        std::fs::rename(&a, &to)
                    }
                    Cap::Remove => {
                        // `recursive` is the second argument, and a directory is not removed without
                        // it — the difference between `rm` and `rm -r`, which the caller chose.
                        let recursive = r.a != 0;
                        let is_dir = std::fs::metadata(&a).map(|m| m.is_dir()).unwrap_or(false);
                        match (is_dir, recursive) {
                            (true, true) => std::fs::remove_dir_all(&a),
                            (true, false) => std::fs::remove_dir(&a),
                            _ => std::fs::remove_file(&a),
                        }
                    }
                    Cap::Mkdir => {
                        let parents = r.a != 0;
                        if parents { std::fs::create_dir_all(&a) } else { std::fs::create_dir(&a) }
                    }
                    Cap::Chmod => {
                        // The whole mode, written as given. `setExecutable` below reads the mode and
                        // changes one bit, because one bit is all it promises; this promises the mode.
                        // `issues/system/0296c`.
                        use std::os::unix::fs::PermissionsExt;
                        let mode = r.a as u32 & 0o7777;
                        std::fs::set_permissions(&a, std::fs::Permissions::from_mode(mode))
                    }
                    _ => {
                        use std::os::unix::fs::PermissionsExt;
                        let on = r.a != 0;
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
                    Err(e) => Answer::Change(fault_of_path(&e, &a), message_of(&e)),
                }
            };
            return Reply::Now(answer);
        }
        Cap::WriteFile => {
            let path = resolve_path(&r.text);
            let data = &r.bytes;
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.write));
            let answer = if !granted {
                Answer::Change(FAULT_NOT_GRANTED, "Not granted to this application".into())
            } else {
                match std::fs::write(&path, data) {
                    Ok(()) => Answer::Change(FAULT_NONE, String::new()),
                    Err(e) => Answer::Change(fault_of_path(&e, &path), message_of(&e)),
                }
            };
            return Reply::Now(answer);
        }
        Cap::Stat | Cap::LinkStat => {
            // **`stat` follows a link and `linkStat` does not**, which is the whole difference
            // between "what does this name lead to" and "what is this name" — `find` wants the
            // first and `tar` the second.
            let path = resolve_path(&r.text);
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
                        mode: {
                            use std::os::unix::fs::PermissionsExt;
                            (md.permissions().mode() & 0o7777) as i32
                        },
                    },
                    // **Except when the name is one this host mangled.** `issues/system/0295c`:
                    // a `NotFound` for a path carrying U+FFFD is this runtime being unable to
                    // express the name, and answering `exists: false, FAULT_NONE` about it is how
                    // `test -e` came to say no about a file that is there — `issues/system/0065`.
                    Err(e)
                        if e.kind() == std::io::ErrorKind::NotFound
                            && path.contains('\u{FFFD}') =>
                    {
                        StatAnswer { fault: FAULT_NOT_REPRESENTABLE, ..Default::default() }
                    }
                    // **Not an error.** A path that is not there is a fact about the world, and
                    // `exists: false` with `FAULT_NONE` is how this world says it.
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => StatAnswer::default(),
                    Err(e) => StatAnswer { fault: fault_of_path(&e, &path), ..Default::default() },
                }))
            };
            return Reply::Now(answer);
        }
        Cap::ReadChunk => {
            // The *bounded* read: it answers with whatever is there, or that the input has ended, and
            // a program loops on it — awaiting each answer, so a world that cannot block (a page) can
            // run the same loop.
            // Here the answer is usually ready by the time the ticket is made; reading what a parent
            // sends is the one that waits, and it waits on a thread, as `recv` does.
            // A child reads what its parent sends — unless it inherits, when the terminal is what
            // was meant.
            let from_parent = HOST.with(|h| {
                let b = h.borrow();
                let s = b.as_ref()?;
                if s.inherits { None } else { s.child_input.clone() }
            });
            if let Some(q) = from_parent {
                let Some(t) = table() else { return no_table() };
                let id = t.submit();
                HOST.with(|h| { if let Some(st) = h.borrow().as_ref() { st.reading.lock().unwrap().insert(id, STDIN_HANDLE); } });
                let worker = t.clone();
                std::thread::spawn(move || {
                    let Some(bytes) = q.read_unless(|| !worker.is_live(id)) else { return };
                    let a = if bytes.is_empty() {
                        Answer::Read(ReadAnswer::End)
                    } else {
                        Answer::Read(ReadAnswer::Data(bytes))
                    };
                    unread_bytes(&q, worker.complete(id, a));
                });
                return Reply::Later(id);
            }
            let mut buf = [0u8; 65536];
            let answer = match std::io::stdin().read(&mut buf) {
                Ok(0) => ReadAnswer::End,
                Ok(n) => ReadAnswer::Data(buf[..n].to_vec()),
                Err(e) => ReadAnswer::Failed(message_of(&e)),
            };
            return Reply::Now(Answer::Read(answer));
        }
        Cap::Cwd => {
            // **Where the program thinks it is**, which is where every relative path it hands back
            // will be resolved from. Not behind the read grant: knowing the name of the directory
            // is not reading anything in it, and `box` asks for it to print paths.
            let framed = HOST.with(|h| h.borrow().as_ref().and_then(|s| s.cwd_override.clone()));
            let here = match framed {
                Some(d) if !d.is_empty() => d,
                _ => std::env::current_dir()
                    .map(|p| p.to_string_lossy().into_owned())
                    .unwrap_or_default(),
            };
            return Reply::Now(Answer::Text(here));
        }
        Cap::SleepMillis => {
            let millis = r.a.clamp(0, i32::MAX as i64);
            let Some(t) = table() else { return no_table() };
            let id = t.submit();
            let worker = t.clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(millis as u64));
                let _ = worker.complete(id, Answer::I64(millis as i64));
            });
            return Reply::Later(id);
        }
        Cap::RandomBytes => {
            // **From the operating system**, not from a generator this host seeds: `box` uses these
            // for temporary names, and a program that gets predictable ones has a race with anything
            // else running. `/dev/urandom` is the whole of it — no crate, no state, no reseeding.
            let n = r.a.clamp(0, i32::MAX as i64) as usize;
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
            return Reply::Now(match bytes {
                Some(b) => Answer::Bytes(Some(b)),
                // **Not an empty array.** A program handed zero bytes where it asked for sixteen
                // would build a name out of nothing and think it had one.
                None => Answer::Change(FAULT_UNSUPPORTED, "this host could not read /dev/urandom".into()),
            });
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
            return Reply::Now(Answer::I64(n));
        }
        Cap::Request | Cap::WaitAny | Cap::Exit | Cap::AskInterrupt | Cap::Unsupported => {
            Reply::Now(Answer::Change(FAULT_UNSUPPORTED, format!("request {op} is not answered by this host")))
        }
    }
}

fn throw(scope: &mut v8::PinScope, what: &str) {
    let msg = v8::String::new(scope, what).unwrap();
    let e = v8::Exception::error(scope, msg);
    scope.throw_exception(e);
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



// **The enum constructors come from the manifest**, like every other export this host calls. They
// used to be spelled here — `$bind$e_Read_Data_new` and its two neighbours — which is the one thing
// `StructSpec` exists to prevent, and `native/src/main.rs` still does it. `issues/system/0141`.









/// Instantiate `wasm` in this isolate and keep what is needed to call into it.
///
/// **The same sequence `run_as_with` uses to start a program**, stopping before `main`: compile, build
/// one dispatcher per callback signature, instantiate, bind its `__wacHost`. The world it gets
/// is this program's own — `dispatch` reaches the same `HOST`, so a loaded module's `readFile` is
/// served exactly as its loader's is and the grants are the loader's by construction, which is why
/// `modules.load` is bounded by the loader's grants. `issues/system/0240c`.
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

    // **Its own `__WacHost`, and none is required.** A module of pure test functions exports no
    // `__wacHost` and is called with nothing. One that does gets the host's four functions bound in
    // *its* slot table, so its requests come back through `dispatch` with its own context installed,
    // and its answers go to its own `__wacAnswered` — never the loader's. `issues/system/0263c` was
    // that mistake once, with `Pending`'s funcrefs.
    let wac = bind_host(scope, exports, &m, &mut caps, &mut names)?;

    // A ceiling of the caller's own: asking for more than this program holds is not an error, and the
    // module finds the capability denied — `spawn`'s rule, one layer in.
    let mine = HOST.with(|h| h.borrow().as_ref().map(|st| st.grants.clone())).unwrap_or_default();
    let entry = HeldModule {
        ctx: ModuleCtx {
            exports: v8::Global::new(scope, exports),
            wac,
            inflight: HashMap::new(),
            caps,
            cap_names: names,
            grants: Grants {
                read: mine.read && (asked & GRANT_READ) != 0,
                write: mine.write && (asked & GRANT_WRITE) != 0,
                env: mine.env && (asked & GRANT_ENV) != 0,
                net: mine.net && (asked & GRANT_NET) != 0,
                // **Bounded by the loader's own, like every other bit.** This was `false`
                // unconditionally while `GRANT_*` had no bit for running a host program — a loaded
                // module that could `exec` would have held the one authority the narrowing exists
                // for, and nothing could have granted it deliberately.
                //
                // `GRANT_RUN` is that bit. It is not a widening: the intersection with `mine.run` is
                // the same ceiling every other capability has, so a loader without `run` still hands
                // over none. What it buys is a test runner able to grant its own oracle the right to
                // spawn, which is what kept a whole test implementation in this host.
                // `issues/system/0264c`.
                run: mine.run && (asked & GRANT_RUN) != 0,
            },
        },
        exports: m.exports.clone(),
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
    // **Decided without copying the signature.** This read `sig.params.clone()` and `sig.ret.clone()`
    // and then asked questions of the copies — two allocations on a path a caller may take millions of
    // times in a row. `wac ctcompare` calls `__cov_get` once per journal slot, so `issues/system/0274b`
    // was paying for them 8.4 million times a comparison. The facts below are all that is wanted; the
    // spellings are re-read from the manifest only on the paths that refuse.
    let plan = HOST.with(|h| {
        let b = h.borrow();
        let st = b.as_ref()?;
        let lm = st.loaded.get(&handle)?;
        let sig = lm.exports.iter().find(|e| e.name == name)?;
        let takes_int = sig.params.len() == 1 && sig.params[0] == "i32";
        // A test that takes the module's own `__WacHost`, as `main` may.
        let takes_host = sig.params.len() == 1 && sig.params[0] == "__WacHost";
        // 0 nothing to read, 1 an `i32`, 2 a `string`, 3 something this cannot answer for.
        let ret_kind: u8 = if sig.ret.is_empty() || sig.ret == "void" {
            0
        } else if sig.ret == "i32" {
            1
        } else if sig.ret == "string" {
            2
        } else {
            3
        };
        Some((takes_int, takes_host, ret_kind, sig.params.is_empty(), lm.ctx.wac.is_some()))
    });
    let Some((takes_int, takes_host, ret_kind, no_params, has_host)) = plan else {
        return (2, format!("no export named {name}"), 0);
    };
    // Only a refusal needs the words, and a refusal happens once.
    let spelled = |joiner: &str| -> String {
        HOST.with(|h| {
            let b = h.borrow();
            b.as_ref()
                .and_then(|st| st.loaded.get(&handle))
                .and_then(|lm| lm.exports.iter().find(|e| e.name == name))
                .map(|s| s.params.join(joiner))
                .unwrap_or_default()
        })
    };
    if !no_params && !takes_int && !takes_host {
        return (3, format!("cannot call {name}({})", spelled(", ")), 0);
    }
    if takes_host && !has_host {
        return (3, format!("{name} takes a {} and this module exports no __wacHost", spelled(", ")), 0);
    }
    if ret_kind == 3 {
        let ret = HOST.with(|h| {
            let b = h.borrow();
            b.as_ref()
                .and_then(|st| st.loaded.get(&handle))
                .and_then(|lm| lm.exports.iter().find(|e| e.name == name))
                .map(|s| s.ret.clone())
                .unwrap_or_default()
        });
        return (3, format!("{name} answers {ret}"), 0);
    }

    // Install the module's context, remembering the caller's.
    let saved = HOST.with(|h| {
        let mut b = h.borrow_mut();
        let st = b.as_mut().expect("a host");
        let lm = st.loaded.get_mut(&handle).expect("the module");
        let mine = ModuleCtx {
            exports: lm.ctx.exports.clone(),
            caps: lm.ctx.caps.clone(),
            cap_names: lm.ctx.cap_names.clone(),
            grants: lm.ctx.grants.clone(),
            wac: lm.ctx.wac.clone(),
            // Taken, and given back after: requests it left in flight are still its own next call.
            inflight: std::mem::take(&mut lm.ctx.inflight),
        };
        // Only when the callee takes one. `__cov_get(i32)` does not.
        let host: Option<v8::Global<v8::Value>> =
            if takes_host { mine.wac.as_ref().map(|w| w.host.clone()) } else { None };
        let was = ModuleCtx {
            exports: st.exports.clone(),
            caps: std::mem::take(&mut st.caps),
            cap_names: std::mem::take(&mut st.cap_names),
            grants: st.grants.clone(),
            wac: st.wac.take(),
            inflight: std::mem::take(&mut st.inflight),
        };
        st.exports = mine.exports;
        st.caps = mine.caps;
        st.cap_names = mine.cap_names;
        st.grants = mine.grants;
        // The loaded module's own host value and export, for the reason `ModuleCtx.wac` gives.
        st.wac = mine.wac;
        st.inflight = mine.inflight;
        (was, host)
    });
    let (was, host) = saved;

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
            let cached = HOST.with(|h| {
                let b = h.borrow();
                b.as_ref().and_then(|st| match &st.last_call {
                    Some((hh, nn, f)) if *hh == handle && nn == name => Some(f.clone()),
                    _ => None,
                })
            });
            let resolved = match cached {
                Some(g) => Some(v8::Local::new(scope, g)),
                None => {
                    let f = get_export(scope, exports, name);
                    if let Some(f) = f {
                        let g = v8::Global::new(scope, f);
                        HOST.with(|h| {
                            if let Some(st) = h.borrow_mut().as_mut() {
                                st.last_call = Some((handle, name.to_string(), g));
                            }
                        });
                    }
                    f
                }
            };
            if let Some(f) = resolved {
                found = true;
                let mut argv: Vec<v8::Local<v8::Value>> = Vec::new();
                if takes_int {
                    argv.push(v8::Integer::new(scope, arg).into());
                }
                if let Some(g) = host.clone() {
                    argv.push(v8::Local::new(scope, g));
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
                    // test runner ten screens up has always printed and what `Module.call` had no way to
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
    } else if ret_kind == 2 {
        match answer {
            Some(g) => {
                let v = v8::Local::new(scope, g);
                (0, read_string(scope, v), 0)
            }
            None => (0, String::new(), 0),
        }
    } else if ret_kind == 1 {
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
            // The module's requests still in flight go back with it, if it is still loaded.
            let left = std::mem::replace(&mut st.inflight, was.inflight);
            if let Some(lm) = st.loaded.get_mut(&handle) {
                lm.ctx.inflight = left;
            }
            st.exports = was.exports;
            st.caps = was.caps;
            st.cap_names = was.cap_names;
            st.grants = was.grants;
            // **And the caller's own host value.** Forgetting this is what "the test trapped" was
            // once, with `Pending`: the save above *takes* it, so a loader that did not get it back
            // would deliver its next answer nowhere.
            st.wac = was.wac;
        }
    });
    outcome
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
    /// **A file opened as a stream** — `files.openRead`/`openWrite`. Read with `recv` and written with `send` like a
    /// socket, so a program holds as many as it likes; `closeFile` ends it.
    File(std::fs::File),
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


/// A wac `string` from Rust, through the staging buffer.
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

/**
 * An integer argument as wac writes one: decimal or `0x` hex, a sign, `_` between digits. A hex
 * literal is a bit pattern (spec ch09), so `0xFFFFFFFF` is a `u32`'s whole range and an `i32`'s
 * `-1` alike — the wasm parameter takes the bits either way.
 */
fn wac_int(text: &str) -> Option<i128> {
    let (neg, body) = match text.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, text),
    };
    let clean: String = body.chars().filter(|c| *c != '_').collect();
    let n = if let Some(hex) = clean.strip_prefix("0x").or_else(|| clean.strip_prefix("0X")) {
        i128::from_str_radix(hex, 16).ok()?
    } else {
        clean.parse::<i128>().ok()?
    };
    Some(if neg { -n } else { n })
}

/** Call one of the module's `$bind$` helpers by name, through the instance this process runs. */
fn call_bind<'s>(
    scope: &mut v8::PinScope<'s, '_>,
    name: &str,
    args: &[v8::Local<'s, v8::Value>],
) -> Option<v8::Local<'s, v8::Value>> {
    let exports = HOST.with(|h| h.borrow().as_ref().map(|st| st.exports.clone()))?;
    let exports = v8::Local::new(scope, exports);
    let f = get_export(scope, exports, name)?;
    f.call(scope, exports.into(), args)
}

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
    cwd: String,
) -> Answer {
    let mut cmd = std::process::Command::new(&path);
    cmd.args(&argv).stdin(std::process::Stdio::piped());
    // **Empty means "wherever this process already is"**, which is `spawn`'s rule for the same
    // parameter — so a caller with no opinion keeps the behaviour it had. `issues/system/0290b`.
    if !cwd.is_empty() {
        cmd.current_dir(&cwd);
    }
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

