# 0242c — a loaded module got the loader's whole world, so `wac test --allow-read` could write

- **Status:** closed
- **Fixed in:** `grants` restored to `Cli.load` in `std/platform.wac`, narrowed in
  `packages/platform/host/provider.ts`, `native/v8/src/main.rs` and `native/src/main.rs`
- **Reported by:** agent-c
- **Date:** 2026-08-24
- **Kind:** bug
- **Symptom:** wrong answer

    $ cat src/writes_test.wac
    export string test_writes_a_file(Core core, Cli cli) {
      Change c = cli.writeFile("leaked.txt", "leaked\n".toBytes()).wait();
      ...
    }

    $ wac test --allow-read src/writes_test.wac      # the native binary
    0 passed, 1 failed

    $ ./wac-deno test --allow-read src/writes_test.wac
    1 passed, 0 failed
    $ ls leaked.txt
    leaked.txt

**A test given read access wrote a file, on a run that granted only read.** The command itself is
built with every grant — it has to be, to compile and to write a module — and a loaded module was
handed the command's world rather than the one the caller asked for.

## Why the argument had been left out, and why that was wrong

`issues/system/0240c` gave `Cli.load` no grants argument, and said so in the docstring: a loaded module
lives in the caller's own realm, its `Core` and `Cli` are built against the caller's own bridge, and
**the launcher cannot tell its calls from its loader's** — so there is nowhere to enforce a narrowing.

Every clause of that is true, and the conclusion does not follow. The launcher is not the only place a
capability can be withheld: the *world the module is handed* is built in the worker, and a module can
only reach what it was handed. That is the argument `Cli.spawn`'s own note already makes about itself —
**"the isolation is the language's, not the runtime's"** — because wac has no ambient anything. It
would not hold for arbitrary JavaScript. A loaded module is a wac module.

So `load` takes `grants` again, and it narrows:

| host | how |
|---|---|
| Deno, Node, a page | `cliOf(b, cls, grants)` — a denied call gets a ticket that is never submitted, and the shadowed `collect` throws for it; each shape's resolver already turns that into *its own* refusal |
| `wac` (V8) | `grants` joins the `ModuleCtx` that `call` swaps, so every existing `HOST.grants` check applies to the loaded module and nothing else had to learn about it |
| `wacland` | the loaded module's `Host` already had its own `grants` field; it is intersected now instead of copied |

**Intersection needs no arithmetic on the JavaScript hosts.** Asking for more than the loader holds
still ends at the launcher, which refuses on the loader's grants. The worker narrows; the bridge cannot
widen.

`run` is not inheritable, in all three, for the reason `spawn_instance` already gives: `GRANT_*` has no
bit for running a host program, and a loaded module that could `exec` would hold the one authority this
narrowing is for.

## Two things fixed on the way, both about refusals reading as the wrong kind

- **`Change` did not read the fault off what it caught.** `FileResult` has always done it; `Change` had
  a hardcoded `FAULT_OTHER`, so a refused *write* answered `failed` where a refused *read* answered
  `denied` — one capability's refusal being a different kind of thing from another's. It reads
  `HostCallError.fault` now.
- **A test that wants a capability the run has not granted is skipped, not failed.** "You forgot
  `--allow-read`" and "your test is wrong" are different answers, and running it gives the second to
  the first question. The rule is the native command's, read from the manifest — a test declaring
  `Cli` under no grants at all — and the exit code is **4**, "could not run".

## What it cost

The leak existed for one day, in unpushed work. Two readings were wrong before the right one, and both
were wrong in the same way — **asserting instead of measuring**:

- *"there is nowhere to enforce a narrowing"* — written into a docstring as settled. The place was the
  world the module is handed, which the same file describes two paragraphs away.
- *"the native exits 0 for an all-skipped run"* — read from `$?` after a pipe, which is the pipe's
  status. It exits 4. That is the second time in this session a piped exit code has misled me.

`GRANT_ALL()` is new and is what a caller that means "as much as I have" writes, so that a bit added
later does not leave four hand-written masks behind.
