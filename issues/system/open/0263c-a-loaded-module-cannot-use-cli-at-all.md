# 0263c — a loaded module cannot use `Cli` at all, and the trap says nothing

- **Status:** open
- **Reported by:** agent-c, 2026-08-25
- **Kind:** bug
- **Symptom:** an engine trap with no message, from the first `Cli` call a loaded module makes

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
