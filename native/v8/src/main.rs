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
    BindDatagram,
    ReceiveFrom,
    SendTo,
    Rename,
    Remove,
    Mkdir,
    SetExecutable,
    /// `Cli.exec` — a host program, run to completion.
    Exec,
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
        ("Cli", "bindDatagram") => Cap::BindDatagram,
        ("Cli", "receiveFrom") => Cap::ReceiveFrom,
        ("Cli", "sendTo") => Cap::SendTo,
        ("Cli", "rename") => Cap::Rename,
        ("Cli", "remove") => Cap::Remove,
        ("Cli", "mkdir") => Cap::Mkdir,
        ("Cli", "setExecutable") => Cap::SetExecutable,
        ("Cli", "exec") => Cap::Exec,
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

/// The manifest a module carries in its own `wac.manifest` custom section, if it has one.
///
/// **A module that describes itself is one artefact rather than two**, which is what lets `spawn`
/// take wasm: a program handed bytes can run them without being handed a second file it has no way
/// to find. A custom section is the format's own extension point — id 0, a name, and bytes nobody
/// else reads — so a module carrying this runs anywhere a module without it runs.
fn manifest_in(wasm: &[u8]) -> Option<String> {
    if wasm.len() < 8 || &wasm[0..4] != b"\0asm" {
        return None;
    }
    let mut at = 8;
    while at < wasm.len() {
        let id = wasm[at];
        at += 1;
        let (size, used) = uleb(wasm, at)?;
        at += used;
        let end = at.checked_add(size)?;
        if end > wasm.len() {
            return None;
        }
        if id == 0 {
            let (n, used) = uleb(wasm, at)?;
            let name_at = at + used;
            let name_end = name_at.checked_add(n)?;
            if name_end <= end && &wasm[name_at..name_end] == b"wac.manifest" {
                return String::from_utf8(wasm[name_end..end].to_vec()).ok();
            }
        }
        at = end;
    }
    None
}

fn uleb(bytes: &[u8], at: usize) -> Option<(usize, usize)> {
    let mut value: usize = 0;
    let mut shift = 0;
    let mut used = 0;
    loop {
        let b = *bytes.get(at + used)?;
        value |= ((b & 0x7f) as usize) << shift;
        used += 1;
        if b & 0x80 == 0 {
            return Some((value, used));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

/// The program built into this binary, when one was: a module carrying its own manifest.
///
/// `None` unless `seed/wacc.wasm` was present at build time — see `build.rs`. With one, this binary
/// is a `wac` command; without, it is the runtime it has always been, and says so rather than
/// pretending.
#[cfg(wac_seed)]
const SEED: Option<&[u8]> = Some(include_bytes!(env!("WAC_SEED_WASM")));
#[cfg(not(wac_seed))]
const SEED: Option<&[u8]> = None;

/// The shell, for `wac sh`. Embedded the same way the compiler is, and optional in the same way.
#[cfg(wac_shell)]
const SHELL: Option<&[u8]> = Some(include_bytes!(env!("WAC_SHELL_WASM")));
#[cfg(not(wac_shell))]
const SHELL: Option<&[u8]> = None;

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

/// `wac sh [--allow-…] [args…]` — the shell inside this binary.
///
/// **Sealed is the default, because it is the absence of grants rather than a mode.** `wac sh` on
/// its own gets an in-memory filesystem and no host at all; `wac sh --allow-read --allow-write` gets
/// the machine's. There is deliberately no `--sealed`: a flag that turns something *off* would
/// suggest the grants were there to begin with, and the whole argument of this system is that a
/// program reaches only what it was handed.
///
/// **The flags can only narrow.** The embedded shell is built with everything, and what the caller
/// asks for is *intersected* with what the payload carries — the same rule `spawn` uses one layer
/// down, and for the same reason: a grant that could be widened at the point of use is not a grant.
/// So the payload's own manifest is the ceiling and this can never exceed it.
///
/// Unlike `run`, nothing is compiled: the shell is already a module, so the flags are not build
/// flags being passed through. They are the world this invocation is handed.
fn run_shell(rest: &[String]) -> i32 {
    let Some(wasm) = SHELL else {
        eprintln!("wac: this build carries no shell — build one into seed/sh.wasm, see native/v8/README.md");
        return 1;
    };
    let mut asked = Grants::default();
    let mut i = 0;
    while i < rest.len() && rest[i].starts_with("--allow-") {
        match rest[i].as_str() {
            "--allow-read" => asked.read = true,
            "--allow-write" => asked.write = true,
            "--allow-net" => asked.net = true,
            "--allow-env" => asked.env = true,
            "--allow-run" => asked.run = true,
            other => {
                eprintln!("wac: {other} is not a grant — read, write, net, env, run");
                return 2;
            }
        }
        i += 1;
    }
    let Some(text) = manifest_in(wasm) else {
        eprintln!("wac: the built-in shell carries no wac.manifest section");
        return 1;
    };
    let manifest: Manifest = match serde_json::from_str(&text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: the built-in shell's manifest is not one — {e}");
            return 1;
        }
    };
    let held = manifest.grants;
    // Every path that instantiates a module starts V8 first; this one is reached without going
    // through the compiler, so it is the only caller that has to say so itself.
    start_v8();
    let mut as_child = AsChild { argv: rest[i..].iter().map(|a| a.as_bytes().to_vec()).collect(), ..Default::default() };
    as_child.grants = Some(Grants {
        read: asked.read && held.read,
        write: asked.write && held.write,
        net: asked.net && held.net,
        env: asked.env && held.env,
        run: asked.run && held.run,
    });
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

fn test_command(rest: &[String]) -> i32 {
    // The flags are read here as well as in `build_and_call`, because discovery has to happen
    // before any build and the target may be absent entirely — `wac test` with no argument is the
    // thing a person types first.
    let mut i = 0;
    while i < rest.len()
        && (rest[i].starts_with("--allow-")
            || rest[i] == "--coverage"
            || rest[i] == "--verbose"
            || rest[i] == "--filter")
    {
        // `--filter` carries a value, so stepping one at a time would leave the pattern looking
        // like the path and send a directory to the compiler.
        if rest[i] == "--filter" {
            i += 1;
        }
        i += 1;
    }
    let flags: Vec<String> = rest[..i].to_vec();
    let filter_used = flags
        .iter()
        .position(|f| f == "--filter")
        .and_then(|k| flags.get(k + 1))
        .cloned();
    // **No `./` stripping here any more.** It was a workaround for `issues/lang/0134` — a leading
    // dot-slash reached the compiler's import resolver and came back as "an import of a file that
    // was not supplied" — and the compiler normalises its entry now, so the path is passed as the
    // caller spelled it.
    // **Every remaining argument, not one.** A caller with a set of files — `tools/mutate.ts`
    // hands over the tests a mutant could possibly have broken — would otherwise invoke this once
    // per file and add up the answers itself, which is the runner's job and not theirs.
    let targets: Vec<String> = if i >= rest.len() {
        vec![".".to_string()]
    } else {
        rest[i..].to_vec()
    };
    let target = targets.join(", ");

    if targets.len() == 1 && !std::path::Path::new(&targets[0]).is_dir() {
        let code = build_and_call(rest, Entry::Tests);
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
    if files.is_empty() {
        eprintln!(
            "wac: no tests under {target} — a test file is named `*_test.wac` and exports \
             `test*()` answering a string, empty for a pass"
        );
        return 1;
    }
    if files.len() == 1 {
        let mut args = flags;
        args.push(files.remove(0));
        return build_and_call(&args, Entry::Tests);
    }

    // One build and one instantiation per file, which is what keeps a failing file from taking the
    // rest of the run with it: a trap unwinds that module and nothing else.
    let mut ok = 0;
    let mut bad = 0;
    let mut broken = 0;
    let mut skipped = 0;
    let mut filtered_files = 0;
    // The files worth going back to. Over eighty files a failure has scrolled off the top long
    // before the summary, and "2 with failures" without saying which is a number you cannot act
    // on without running the whole thing again.
    let mut names: Vec<(String, &str)> = Vec::new();
    for f in &files {
        println!("── {f}");
        let mut args = flags.clone();
        args.push(f.clone());
        match build_and_call(&args, Entry::Tests) {
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
    if bad > 0 {
        line += &format!(", {bad} with failures");
    }
    if skipped > 0 {
        line += &format!(", {skipped} needing a host oracle");
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
    if broken > 0 { 1 } else if bad > 0 { 3 } else { 0 }
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
        eprintln!("usage: wac {what} [--allow-read] [--allow-write] [--allow-net] [--allow-env] <entry.wac>{tail}");
        return 2;
    }
    let entry = rest[i].clone();

    // **Sweep what earlier runs could not.** The directory below is removed on the way out, and that
    // only covers a process that gets there: one killed by a timeout, or one whose guest exits the
    // process from inside, leaves its directory behind for good. A hundred of them had accumulated
    // over two days — `issues/system/0136` is the day the disk filled from exactly this shape.
    //
    // Swept by liveness, the way `tools/suiteGate.ts` sweeps its notes: the name carries the pid, so
    // a directory whose process is gone is finished with, and one whose process is alive belongs to a
    // concurrent run and is left alone. On a system with no `/proc` nothing is swept, which is the
    // safe direction — a stale directory costs disk and a live one costs a running program.
    sweep_stale_runs();

    let dir = std::env::temp_dir().join(format!("wac-run-{}", std::process::id()));
    if let Err(e) = std::fs::create_dir_all(&dir) {
        eprintln!("wac: cannot make a working directory — {e}");
        return 1;
    }
    let stem = dir.join("prog");
    // **The build's own output is not the program's.** `wac run wc README.md` prints wc's three
    // numbers and nothing else; a compiler saying which file it wrote would land in the middle of a
    // pipeline. `--quiet` silences the line it prints when it succeeds and nothing else: a program
    // that does not compile still says so, on stderr, where the shell running this expects it.
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
    let built = run_seed(&build);
    let code = if built != 0 {
        built
    } else {
        match std::fs::read(dir.join("prog.wasm")) {
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
                    argv: rest[i + 1..].iter().map(|a| a.as_bytes().to_vec()).collect(),
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

/// Remove `wac-run-<pid>` directories whose process is no longer running.
///
/// Best effort throughout: a directory that cannot be read or removed is skipped, because failing to
/// tidy is not a reason to fail to run. Only names this program makes are considered, and only when
/// the pid parses — anything else in the temp directory is somebody else's.
fn sweep_stale_runs() {
    if !std::path::Path::new("/proc").is_dir() {
        return;
    }
    let Ok(entries) = std::fs::read_dir(std::env::temp_dir()) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(pid) = name.strip_prefix("wac-run-") else { continue };
        if pid.is_empty() || !pid.bytes().all(|c| c.is_ascii_digit()) {
            continue;
        }
        if std::path::Path::new(&format!("/proc/{pid}")).exists() {
            continue;
        }
        let _ = std::fs::remove_dir_all(entry.path());
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    // **Asked for help, or given nothing.** The commands are in two places because they are
    // implemented in two places — the compiler inside answers `check`, `compile` and `build`, and
    // `run` is this host's. So the seed prints its own usage and this adds the one line it cannot
    // know about, rather than either side keeping a list of the other's commands.
    let asked = args.len() > 1 && (args[1] == "--help" || args[1] == "-h" || args[1] == "help");
    if SEED.is_some() && (args.len() < 2 || asked) {
        start_v8();
        let code = run_seed(&[]);
        eprintln!("       wac run [--allow-read] [--allow-write] [--allow-net] [--allow-env] <entry.wac> [args…]");
        eprintln!("                                      compile and run it, with no file in between");
        eprintln!("       wac test [--coverage] [--filter <name>] [--verbose] [path…]");
        eprintln!("                                      run `test*()` exports; paths may be files or");
        eprintln!("                                      directories, and default to here and down");
        if SHELL.is_some() {
            eprintln!("       wac sh  [--allow-read] [--allow-write] [--allow-net] [--allow-env] [-c script]");
            eprintln!("                                      the shell, sealed unless granted");
        }
        std::process::exit(if asked { 0 } else { code });
    }
    // A build with a shell and no compiler still answers `help` — the seed's own usage is the part
    // that is missing, not the host's, and saying nothing at all would be the worse failure.
    if SEED.is_none() && SHELL.is_some() && (args.len() < 2 || asked) {
        eprintln!("usage: wac sh [--allow-read] [--allow-write] [--allow-net] [--allow-env] [-c script]");
        eprintln!("       wac <program.wasm|stem>   # a module carrying its own manifest, or a pair");
        eprintln!("this build carries a shell and no compiler");
        std::process::exit(if asked { 0 } else { 2 });
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
        let e = std::fs::read(stem).err().map(|e| e.to_string()).unwrap_or_default();
        eprintln!("wac: cannot read {stem} — {e}");
        std::process::exit(1);
    }
    // `run` is this host's own command rather than the compiler's: the compiler writes a module and
    // cannot instantiate one, and running it is the thing this binary is.
    if SEED.is_some() && stem == "run" {
        std::process::exit(run_command(&args[2..]));
    }
    // `sh` is the host's too, and needs no compiler at all — the shell is already a module. It is
    // tested before the seed check for that reason: a build with a shell and no compiler is a
    // perfectly good `wac sh`, and refusing it because there is nothing to compile would be a
    // message about the wrong half.
    if SHELL.is_some() && stem == "sh" {
        std::process::exit(run_shell(&args[2..]));
    }
    // **The other thing a person does with a compiler.** 125 files here are wac tests — an export
    // named `test*` answering a `string`, empty for a pass — and every one of them needed a Deno to
    // run. `harness/wacTestRun.ts` is that convention; this is the same convention with nothing
    // underneath it.
    if SEED.is_some() && stem == "test" {
        std::process::exit(test_command(&args[2..]));
    }
    if SEED.is_some() && !std::path::Path::new(&format!("{stem}.json")).exists() {
        start_v8();
        std::process::exit(run_seed(&args[1..]));
    }
    let manifest_text = match std::fs::read_to_string(format!("{stem}.json")) {
        Ok(t) => t,
        Err(e) => {
            eprintln!("wac: cannot read {stem}.json — {e}");
            std::process::exit(1);
        }
    };
    let manifest: Manifest = match serde_json::from_str(&manifest_text) {
        Ok(m) => m,
        Err(e) => {
            eprintln!("wac: {stem}.json is not a manifest — {e}");
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
            eprintln!("wac: cannot read {} — {e}", wasm_path.display());
            std::process::exit(1);
        }
    };

    start_v8();
    let code = run(&manifest, &wasm, &manifest_text);
    std::process::exit(code);
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
    /// Name every test as it passes, with what it took. `test --verbose`.
    loud: bool,
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
    /// `packages/platform/src/platform.wac` describes the same pair from the wac side —
    /// `recv(fsHandle)` in the parent reads a request and `send(fsHandle, …)` answers it.
    ///
    /// `None` is a child that was spawned with `serveFs` false, and every program that was not
    /// spawned at all. Both mean `recv(PARENT_FS)` answers "ended", which `Fs.fromParentOrHost`
    /// reads as "there is no parent to ask" and takes the host's filesystem for. issues/system/0157.
    fs_req: Option<Arc<Stream>>,
    fs_rep: Option<Arc<Stream>>,
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
    let loud = as_child.loud;
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

    // **A test file has no world, and must not be asked for one.** A wac test is a pure function
    // answering a report; it declares no capabilities, so its manifest has no `Core` — and building
    // one first meant `wac test` refused every test file in the repository with *no struct Core in
    // the manifest*, about a program that was right.
    let core = match build_struct(scope, exports, m, "Core", &mut caps, &mut names, &mut unsupported) {
        Ok(v) => v,
        Err(e) => {
            if entry == Entry::Tests {
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
        return run_tests(scope, exports, m, cov.as_deref(), only.as_deref(), loud, core, cli);
    }
    let main_sig = match m.exports.iter().find(|e| e.name == "main") {
        Some(e) => e,
        None => {
            eprintln!("wac: {} exports no main", m.entry);
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
                eprintln!("wac: main wants a Cli and the manifest describes none");
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
    let r = match main_fn.call(scope, exports.into(), &args) {
        Some(v) => v,
        None => {
            eprintln!("wac: {} trapped", m.entry);
            return 1;
        }
    };
    let code = r.to_int32(scope).map(|i| i.value()).unwrap_or(0);

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
    let mut skipped: Vec<&str> = Vec::new();
    // Wants a capability this run was not granted — distinct from wanting an oracle, because the
    // remedy is a flag rather than a host.
    let mut ungranted: Vec<&str> = Vec::new();
    // Counted apart from `skipped`, which means "this host cannot run it". A test the filter
    // excluded is one the person asked not to run, and saying "0 passed" without saying that
    // reads as a suite that has quietly emptied.
    let mut filtered = 0;

    for e in m.exports.iter().filter(|e| e.name.starts_with("test")) {
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
                        ungranted.push(&e.name);
                        continue;
                    }
                }
            }
            _ => {
                skipped.push(&e.name);
                continue;
            }
        };
        let Some(f) = get_export(scope, exports, &e.name) else {
            println!("FAIL {} — exported and not callable", e.name);
            failed += 1;
            continue;
        };
        let before = if profile_dir.is_some() && cov.is_some() {
            counters_now(scope, exports)
        } else {
            Vec::new()
        };
        let began = std::time::Instant::now();
        let outcome = f.call(scope, exports.into(), &args);
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
            reached.push((e.name.clone(), mine));
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
                    println!("ok   {} — trapped, as it says ({} ms)", e.name, began.elapsed().as_millis());
                }
                passed += 1;
            }
            None => {
                // A trap is a failure with no report to read: the module is not in a state to hand
                // one back, and V8 has already unwound.
                println!("FAIL {} — trapped", e.name);
                failed += 1;
            }
            Some(v) if wants_trap => {
                // **Returning is the failure here, and the report is ignored on purpose.** A test
                // named for a trap that returns cleanly has not observed the thing it is about, and
                // an empty string from it would otherwise read as a pass.
                let report = read_string(scope, v);
                let tail = if report.is_empty() { String::new() } else { format!(" — {report}") };
                println!("FAIL {} — returned instead of trapping{tail}", e.name);
                failed += 1;
            }
            Some(v) => {
                let report = read_string(scope, v);
                if report.is_empty() {
                    if loud {
                        println!("ok   {} ({} ms)", e.name, began.elapsed().as_millis());
                    }
                    passed += 1;
                } else {
                    println!("FAIL {} — {report}", e.name);
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
            eprintln!(
                "wac: every test in {} wants a capability this run was not granted — try `--allow-read`",
                m.entry
            );
        } else {
            eprintln!(
                "wac: every test in {} needs an oracle from the host, which this cannot supply",
                m.entry
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
    // **3, not 1.** `spec/cli/main.md` distinguishes "did not compile" from "ran and did something
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
    skipped: &[&str],
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
                loud: false,
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
                        worker.complete(exit_id, Answer::I32(127));
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
                worker.complete(exit_id, Answer::I32(code));
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
                loud: false,
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
                worker.complete(exit_id, Answer::I32(code));
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
                    worker.complete(id, Answer::Bytes(Some(all)));
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
        Cap::BindDatagram => {
            // The same one grant as `connect` and `listen`: the authority is "speak to something
            // that is not this process", and the transport does not change what that means.
            let address = read_string(scope, args.get(1));
            let port = args.get(2).to_int32(scope).map(|v| v.value()).unwrap_or(0);
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.net));
            let answer = if !granted {
                Answer::Socket(-1, "Not granted to this application".into(), String::new(), 0)
            } else {
                let host = if address.is_empty() { "0.0.0.0" } else { address.as_str() };
                match std::net::UdpSocket::bind((host, port as u16)) {
                    Ok(sk) => {
                        let bound = sk.local_addr().map(|a| a.port() as i32).unwrap_or(0);
                        let handle = keep_socket(Sock::Datagram(sk));
                        Answer::Socket(handle, String::new(), String::new(), bound)
                    }
                    Err(e) => Answer::Socket(-1, e.to_string(), String::new(), 0),
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
            // 65535 is the largest a UDP payload can be, so a buffer of it cannot truncate one.
            // Truncation here would be silent and would look like a peer sending short datagrams.
            let answer = match sock {
                None => Answer::Datagram(Vec::new(), String::new(), 0, "not an open datagram socket".into()),
                Some(sk) => {
                    let mut buf = vec![0u8; 65535];
                    match sk.recv_from(&mut buf) {
                        Ok((n, from)) => {
                            buf.truncate(n);
                            Answer::Datagram(buf, from.ip().to_string(), from.port() as i32, String::new())
                        }
                        Err(e) => Answer::Datagram(Vec::new(), String::new(), 0, e.to_string()),
                    }
                }
            };
            match ticket_for(scope, "Datagram", answer) {
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
                    worker.complete(id, a);
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
        Cap::Exec => {
            // A host program, run to completion. `issues/system/0165`.
            //
            // **`--allow-run` is its own grant**, not `write`'s and not `spawn`'s. A build that may
            // start a confined wasm module must be able to refuse a host binary without refusing
            // both, and in a browser the second is always refused.
            let path = read_string(scope, args.get(1));
            let argv: Vec<String> = read_string_array_bytes(scope, args.get(2))
                .into_iter()
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .collect();
            let stdin = read_bytes(scope, args.get(3));
            let granted = HOST.with(|h| h.borrow().as_ref().is_some_and(|s| s.grants.run));
            let answer = if !granted {
                Answer::Exec(0, Vec::new(), Vec::new(), "Not granted to this application".into())
            } else {
                // `args` is an argument *vector*. Nothing here builds a shell line, so a value
                // containing a space or a semicolon arrives whole and is never re-split — a caller
                // who wants a shell asks for `/bin/sh -c` by name.
                let mut cmd = std::process::Command::new(&path);
                cmd.args(&argv)
                    .stdin(std::process::Stdio::piped())
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::piped());
                match cmd.spawn() {
                    Err(e) => Answer::Exec(0, Vec::new(), Vec::new(), format!("{path}: {e}")),
                    Ok(mut child) => {
                        // Written and closed before waiting. A program that reads to the end — which
                        // is most oracles — needs the end to arrive, and `wait_with_output` reads
                        // both pipes concurrently, so a child that fills stderr cannot wedge us.
                        if let Some(mut w) = child.stdin.take() {
                            use std::io::Write;
                            let _ = w.write_all(&stdin);
                        }
                        match child.wait_with_output() {
                            Err(e) => Answer::Exec(0, Vec::new(), Vec::new(), format!("{path}: {e}")),
                            Ok(out) => Answer::Exec(
                                // A signalled child has no code. -1 rather than 0, so it is never
                                // mistaken for success by a caller reading only the status.
                                out.status.code().unwrap_or(-1),
                                out.stdout,
                                out.stderr,
                                String::new(),
                            ),
                        }
                    }
                }
            };
            match ticket_for(scope, "Exec", answer) {
                Some(v) => rv.set(v),
                None => throw(scope, "this program has no Pending<Exec> to answer exec with"),
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
                    worker.complete(id, a);
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

/// `STDIN`, in `packages/platform/src/platform.wac`. A channel number, never a socket.
///
/// **Declared but not read here, deliberately.** `packages/platform/test/handles.test.ts` reads this
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

/// `PARENT_FS`, in `packages/platform/src/platform.wac` — the channel a spawned program asks its
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
/// `native/src/main.rs`, and named the same so `packages/platform/test/handles.test.ts` can hold all
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
