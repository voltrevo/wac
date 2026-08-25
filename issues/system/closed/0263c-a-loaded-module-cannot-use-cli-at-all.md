# 0263c — the native host's loaded module traps on any capability that answers a `Pending`

- **Status:** closed — 2026-08-25
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
- **Symptom:** an engine trap with no message, from the first `Pending`-answering capability a loaded module reaches — on one host of the four
- **Note:** the filename says `cannot-use-cli`, which is where this started; the table below is what it is

`Cli.load` a module and `Cli.call` an export that takes `(Core, Cli)`: **`Core` works and every `Cli`
method traps.** Not a fault, not a refusal — `status == 1` and an empty message, which
`issues/lang/0254c` says is an engine trap: a bounds check or a null dereference.

    import { Core, Cli } from "std/platform.wac";
    export i32 main(Core core, Cli cli) {
      i32 n = cli.argCount().wait();          // traps here
      core.log("ARGC " + (n >= 0 ? "ok" : "neg"));
      return 0;
    }

Built with `wac build`, then from another program:

    LoadedModule m = cli.load(bytes, grants);
    CallResult r = cli.call(m.handle, "main", 0);   // status 1, text ""

## What it is not

- **Not grants.** Measured with `grants` of 0, 1 and 31 — every one traps, identically. A denied
  capability is supposed to answer a fault anyway, not trap.
- **Not the instrumentation.** An uninstrumented module traps the same way; a coverage-instrumented one
  with `__cov_init` called first traps the same way.
- **Not `Core`.** `main(Core, Cli)` whose body is only `core.log("HELLO")` returns 0 and prints.
- **Not the export's name or arity.** `main()` returning 7 works; `main(Core, Cli)` that touches `cli`
  does not.
- **Not `readFile` specifically.** `cli.argCount()` needs no grant at all and traps.

So it is the whole of `Cli` on a loaded module, which most likely means the `Pending` machinery: every
`Cli` method answers a `Pending`, and `Core.log` does not.

## The part that makes it strange

**`wac test` does exactly this and works.** `packages/wac/src/testrun.wac` loads an aggregate module and
`cli.call`s its `test*` exports, and those take `(Core, Cli)` and use `cli` — `grants_test.wac` reads
and writes files that way, on all three hosts. So a loaded module using `Cli` is a path the whole suite
depends on.

The difference between the two is not obvious from the source: the runner builds the module in-process
and loads the bytes it just made, and this loads bytes `wac build` wrote to a file. Both carry a
manifest, both declare the same grants, both are loaded and called the same way. Finding what actually
differs is the work here.

## What it blocks

`issues/system/0257c`'s last row. `covdump` cannot move out of `native/v8/src/main.rs` until this is
fixed: the command's whole job is to run a module *with its declared world* and read the counters
afterwards, and `tools/wac/covdump_test.wac`'s
`test_covdump_builds_a_world_so_a_grant_is_refused_rather_than_absent` is the case that catches it —
a module built `--allow-read` must print `READ OK`, and through `Cli.load` it prints nothing at all
because `main` traps before it logs.

`tracestat` **did** move, and is not affected in practice: the host implementation instantiated with no
imports, so a traced module that uses any capability could not be read that way either — it failed with
*an import it wants is missing*. Both arrangements decline such a module; only the wording differs.
`packages/wac/src/counters.wac` is the reader `covdump` will use when this is fixed.

## Narrowed: it is the native V8 host, and Deno is fine — 2026-08-25

The same probe, the same module, through `harness/appRun.ts` on the Deno host:

    init status 2 no export text=no export named __cov_init
    ARGC ok
    main status 0 ok

So this is **not** a design gap in `Cli.load` — one host builds a usable `Cli` for a loaded module and
the other does not. `native/v8/src/main.rs` is the one that does not.

**Not the spawn boundary either.** Measured both ways on the native host: the probe run through
`wac run` (a spawned child) and the same program built and run directly as `wac mpa.wasm` (top level,
no spawn) trap identically. So it is not about being inside a child.

**And a second finding, in the same function.** `load_module` builds `Core` and `Cli` with
`build_struct(…, &mut unsupported)` and then **drops the `unsupported` list on the floor**. The program
path at `main.rs:3039` stores it in the host state and `3291` reports it. So a loaded module whose world
the host could only build in part is handed that partial world silently, and the first call to a missing
field is an engine trap with no message — which is the shape of this bug even if `capability_for` is a
static mapping and not the cause of *this* instance.

## The mechanism, as a table

One module, five exports, loaded and called by one program on the native host. The rows are ordered by
what the *host* has to construct to answer:

| the answer's shape | what the host must build | result |
|---|---|---|
| `bool` — `Cli.write` | nothing | ok, and `W` is printed |
| nothing — `Core.log` | nothing | ok, and `LOG` is printed |
| `Read` — `Cli.readChunk` | an enum, through `read_variants` | **ok** |
| `Pending<i32>` — `Cli.argCount` | a struct holding funcrefs | **TRAP** |
| `Pending<i64>` — `Core.monotonicNanos` | a struct holding funcrefs | **TRAP** |

So it is not `Cli`: a `Core` capability answering a `Pending` traps in the same breath, and a `Cli`
capability answering an enum does not. **Everything the host builds as a `Pending` traps and nothing
else does.**

The enum row is the one that changes the diagnosis. `read_variants` is in `HostState` and is *not*
swapped per loaded module either — so "the host used the loader's constructor" is by itself not fatal,
because for `Read` it works. What distinguishes `Pending` is that it **carries funcrefs**: the resolve,
settled and drop callbacks. A `Pending` built through the loader's constructor holds funcrefs from the
loader's table, and the loaded module's `wait()` is what calls them.

## The earlier reading, kept because it is still where to look

One module, two exports, loaded and called by the same program on the native host:

    export i32 writeOnly(Core core, Cli cli) { return cli.write("W\n".toBytes()) ? 1 : 2; }
    export i32 pendingOne(Core core, Cli cli) { return cli.argCount().wait(); }

    writeOnly  (fn[bool(u8[])])      -> ok, and "W" is printed
    pendingOne (fn[Pending<i32>()])  -> TRAP

So a loaded module's **plain** capabilities work and every **`Pending`**-returning one traps. That is
why `Core.log` was fine — it answers nothing — and why every `Cli` method was not: they all answer a
`Pending`. The title's "cannot use `Cli`" is the symptom; the fault is in the `Pending` a loaded
module's capability builds or resolves.

Ruled out along the way, each measured rather than reasoned:

    grants           0, 1 and 31 — identical traps, and all-granted on both sides too
    provenance       a module built *in this process* traps exactly as one read from disk does
                     (the two manifests differ only in the `entry` path string)
    the export name  `main` and `test_uses_cli` in one module both trap
    the spawn        `wac run` (a child) and a directly-run built program both trap
    the loader       a plain program, and a *test* run by `wac test`, both trap

## The smallest reproduction: a module that loads *itself*

    // selfload.wac — built with --allow-read, run as `wac selfload.wasm`
    export i32 pendingOne(Core core, Cli cli) { return cli.argCount().wait(); }
    export i32 main(Core core, Cli cli) {
      FileResult f = cli.readFile("selfload.wasm").wait();     // works
      LoadedModule m = cli.load(f.bytes, 31);                  // ok
      CallResult r = cli.call(m.handle, "pendingOne", 0);      // TRAP
      …
    }

The loader and the loaded module are **the same bytes**, so there is no difference of shape, of
manifest, of provenance or of compiler version to appeal to — and the loader's own
`cli.readFile(…).wait()` on the line above succeeds, so `Pending` works for it and not for its own
copy. Anyone fixing this should start here.

## Two candidate mechanisms, both in the native host

**`call_loaded`'s context swap is incomplete.** `HostState` carries the module's own constructors for
every result type — `pending: HashMap<String, PendingGlobals>`, `file_result_of`, `change_of`,
`stat_of`, `read_variants`, `socket_of`, `datagram_of`, `captured_of`, `exec_of`, `child_of` — and
`ModuleCtx`, the part that is swapped, holds only `exports`, `caps`, `cap_names` and `grants`. So when a
loaded module asks for `argCount`, the host builds the `Pending` with the **loader's** constructor and
hands it to the loaded module. `HeldModule` stores `loaded_of` and `called_of` for exactly this reason —
"a monomorphisation binds under a mangled name and only the module is the authority on it" — and stops
one field short of the rest.

**Or the loader's own path.** `wac test` loads a test module and its `Pending`-using tests work, and the
seed is run by `run_seed` where a plain program goes through `run_as_with`. That is the one difference
the self-load reproduction does not eliminate.

## The question that remains

**`wac test` loads and calls world-using exports on the native host and works** — `grants_test.wac`
does `cli.readFile(path).wait()`, a `Pending`, inside a module the seed loaded. But a test that *itself*
loads a module and calls a `Pending`-using export gets the trap. So the first load level works and the
next does not, and a plain program's first load behaves like the second.

That shape — one specific loader's modules get working `Pending`s and everyone else's do not — is where
to start in `load_module`/`call_loaded`. The context swap in `call_loaded` looks right on the face of it;
what is built at *load* time, while the loader's context is still installed, is the `world` vector and
the `caps` table behind it.

**`wac test` loads and calls world-using exports on the native host and works.** `grants_test.wac` reads
and writes files that way. Both loads happen inside the same seed program, both modules carry a manifest
with the same shape — 31 structs, 62 callbacks, 473 bind keys, compared — and both are loaded with
`cli.load(bytes, grants)` and called with `cli.call(handle, name, 0)`.

The one difference left standing is provenance: the test runner loads bytes it built *in this process*,
and `covdump` loads bytes `wac build` wrote to a file. That should not matter, which is why it is the
next thing to look at.

## Fixed: `Pending` constructors travel with the context swap — 2026-08-25

`HostState.pending` maps a type name to the four `v8::Global`s that build a `Pending<T>` **in one
module's terms** — its constructor and its resolve, settled and drop funcrefs. `ModuleCtx`, the part
`call_loaded` swaps, held `exports`, `caps`, `cap_names` and `grants` and not that. So every `Pending`
the host handed a loaded module was built by the *loader's* constructor and carried funcrefs indexing
the loader's `caps` table; called with the loaded module's context installed, they reached the wrong
slot.

Five lines, in three places:

    ModuleCtx      gains `pending: HashMap<String, PendingGlobals>`
    load_module    builds the loaded module's own map — the same fifteen-type loop `run_as_with` runs
    call_loaded    saves the caller's map, installs the module's, and **puts the caller's back**

## The fourth line is the one worth writing down

The first version had the save and the install and no restore. The save *takes* the map, so the loader
was left with an empty one — and died on its next `Pending`-answering capability, **after** the call had
returned. `packages/platform/test/wac/load_test.wac` went from 2 passed to *"the test trapped"*, and the
trap looked as though it came from somewhere else entirely.

I mis-diagnosed that too, and the mis-diagnosis is instructive: I decided `pending_hooks` must be
trapping inside the load and wrapped it in a `TryCatch`, with a comment asserting it had been measured.
It changed nothing. Removed, along with the comment — a `TryCatch` that catches nothing, documented as
load-bearing, is worse than no `TryCatch`.

**And I nearly shipped the regression as a fix.** The two halves — a program loading a module, and the
seed loading a test — were each broken by one version and fixed by the other, and only running the
existing differential caught it. `load_test.wac` was green before the change; I measured that
*afterwards*, by restoring the backup and rebuilding, which is the only reason I knew it was mine.

## What it unblocks

`issues/system/0257c`'s last row. `covdump` can move now: `packages/wac/src/counters.wac` is written and
`tools/wac/covdump_test.wac`'s world case is what will say so.
