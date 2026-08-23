# 0240c — four commands are native-only because `spawn` hands over a program, not a module

- **Status:** closed
- **Reported by:** agent-c
- **Date:** 2026-08-22
- **Fixed in:** `Cli.load`/`call`/`unload` in `std/platform.wac`, implemented in
  `packages/platform/host/provider.ts`, `native/v8/src/main.rs` and `native/src/main.rs`
- **Kind:** decision
- **Symptom:** not implemented

`issues/system/0230a`'s goal, in the operator's words on 2026-08-22: *"the goal is that they all work
more or less the same way."* `check`, `compile`, `build`, `bindgen`, `run` and `wac <prog.wasm>` now do.
Four commands cannot, and they all fail for one reason.

**`spawn` gives a wac program a *program*: an argument vector, two streams and an exit code.** These
four need to call a module's **exports**:

| command | the export it needs |
|---|---|
| `test` | every `test*` — and it must survive one of them trapping |
| `covdump` | `__cov_init`, `__cov_len`, `__cov_get` |
| `tracestat` | the journal a traced build writes |
| `ctcompare` | the same, twice |

There is no capability for "instantiate this module and call that export", and `std/platform.wac` has
nothing close to one.

## The hosts already do this. It is a capability surface, not new machinery

Every host acquired the machinery when `issues/system/0144` closed:

- `packages/platform/host/driver.ts` — `asAppModule(drive(wasm, manifest))` already returns **every
  non-`$bind$` export** of a module driven from its manifest. `test*` and `__cov_get` are in there
  today; nothing exposes them to a wac program.
- `native/v8/src/main.rs` — `run_tests` enumerates exports and calls each `test*`, catching a trap per
  test. That is the reference implementation of exactly this.
- `native/src/main.rs` — `run_child` instantiates an arbitrary module from bytes since 2026-08-21.

So four hosts can do it and none of them offers it.

## Why reimplementing `test` around the gap is the wrong answer

It is *partly* possible, and the two gaps are why it should not be done that way:

- **A wac program cannot catch a trap**, and **389 of 2553 test exports are `test_traps_*`** — 15% of
  the suite. An aggregate whose `main` called them would die on the first one. The only route without
  a new capability is a spawned child per trapping test, dispatched by index the way
  `packages/crypto/test/cov_exercise.wac` already does with `trapCase(i)` — 389 module
  instantiations where the native host does 389 calls.
- **`--coverage` cannot move at all.** The counters are reached through injected exports. The Rust
  comment says why nothing in wac can name them: *"the instrumentation injects it, so no source names
  it."*

So the wac-only version is a slower `test` that silently lacks the flag `tools/mutate.ts` depends on.

## What is being asked for

A capability shaped roughly like:

    Pending<Instance> load(u8[] module, i32 grants)     // a module, not a program
    Pending<Called> call(i32 instance, string export)   // by name; a trap is a value, not the end

`Called` has to distinguish *returned*, *trapped* and *no such export*, because `test_traps_*` is a
test that passes by trapping. Marshalling can stay narrow — every test export is
`string test…(Core, Cli)` and the counter exports are `i32(i32)` — so this does not need the general
boundary, which is what makes it small.

It is four hosts, `provider.ts`, `ops.ts` and `order_test.wac`: the same shape of change 0144 was, and
bounded by the same manifest machinery.

**The decision is whether a wac program may hold a module rather than a program.** That is a real
widening of the capability model — `spawn`'s confinement story is "a child is a process with its own
world", and this is "a module in my own world, whose functions I call". It deserves the operator's
call rather than an agent's, which is why this is filed rather than built.

## What is not blocked by this

`test`, `uninstall` and `app` were listed as unblocked in 0230a. Two of them still are — `uninstall` is
filesystem work and `app` is a preamble and a build. `test` is the one that turns out to need this.

## Closed 2026-08-23: all four hosts, one answer

    test_passes            0  0
    test_fails             0  0  two of two assertions failed
    test_traps_on_purpose  1  0  unreachable
    test_core_only         0  0
    test_no_world          0  0
    answer                 0 42
    twice                  0 42
    nothing                0  0
    no_such_export         2  0  no export named no_such_export
    half                   3  0  cannot call half(f64)
    after-unload           2

Identical under Deno, Node, `wac` and `wacland`. `packages/platform/test/wac/load_test.wac` holds it,
with no column skipped, and `packages/platform/example/testrun.wac` is a **test runner written in wac**
— forty lines that read a module's manifest for its `test*` exports, call each, and treat a trap as a
pass when the name says so.

### The shape, which is not what was proposed above

This issue sketched `Pending<Instance>` and `Pending<Called>` with a grants argument. What it wanted:

```wac
fn[Loaded(u8[])] load;
fn[Called(i32, string, i32)] call;
fn[void(i32)] unload;
```

- **No opcode on the JavaScript hosts.** The sketch assumed the module loads in the *launcher*. It
  does not: it loads in the caller's own realm, and its `Core`/`Cli` are built by `worldFor` against
  the caller's own bridge — so the launcher serves the loaded module exactly as it serves the program
  that loaded it and cannot tell them apart. `host/childWasm.ts` already proved that path. Loading in
  the launcher would have needed a second implementation of the whole world with no bridge under it.
- **Not `Pending`.** Nothing crosses to a host, so there is no ticket to wait on. Every other field on
  `Cli` answers one because it asks the launcher something; these three ask nobody.
- **No grants argument.** It would have been a lie. The module runs with the caller's own
  capabilities and there is nowhere for a narrowing to be enforced — so it gets exactly what the
  caller has, and confinement stays `spawn`'s job.

### Three implementations, because the hosts differ in what they are

| host | how |
|---|---|
| Deno, Node, a page | `provider.ts`, in the caller's realm against the caller's bridge |
| `wac` (V8) | `HostState`'s three module-specific fields split into a `ModuleCtx`, swapped around the call |
| `wacland` (wasmtime) | a `Store` of its own whose `Host` shares the caller's `tickets`, `handles` and `grants` by `Arc` |

**The V8 host was the interesting one.** A dispatcher there is a bare `fn` pointer — its own comment
says *"reachable from a `fn` pointer that cannot close over anything"* — so it finds its context in a
thread-local naming **one** module's `exports`, `caps` and `cap_names`. That is why `spawn` works (a
child gets a thread, and the thread-local with it) and why `load` could not. All 22 readers use one
idiom, so splitting those three fields out changed none of them. A swap that failed to restore would
not error — `write_string` would copy into the wrong module's memory — so the test reads a file after
unloading, which is the cheapest thing that would notice.

**`wacland` was easier than predicted.** The risk named above was re-entrancy; the fix was splitting
`enter` into `prepare` (instantiate, register the `Pending<T>` hooks, build the world) and `enter`
(call `main`). A second store is legal from inside a host call — it is the *same* store that cannot be
re-entered.

### One bug the four-way comparison caught

`wacland` reported a trap with an **empty** message where the others said `unreachable`. The code
stripped the prefix `error while executing at wasm backtrace:`, which is the whole first line — the
useful part is three lines down, past a backtrace. It downcasts to `wasmtime::Trap` now and maps
`UnreachableCodeReached` to the word V8's `e.message` gives.

**No translation table beyond that, deliberately.** A program's own `trap "…"` message is identical on
every host, because `$trap$message` carries it. An exotic *engine* trap's wording is not, and
inventing translations for traps nothing here produces would be a second copy of somebody else's
spelling. `engine_trap_words` says so where a reader will find it.

### What this unblocks

`wac test` in the wac program — `issues/system/0230a` step 5's hardest piece, and the reason this was
filed. `covdump`, `tracestat` and `ctcompare` become expressible too: they need `__cov_init`,
`__cov_len` and `__cov_get`, which are `void f()`, `i32 f()` and `i32 f(i32)` — three of the four
shapes in the closed set.

### What it costs, measured

**7 KB in every built program.** `provider.ts` imports `driver.ts`, so the module driver is in every
worker bundle whether or not the program ever loads anything — `packages/box/src/bin/wc.wac` went from
570,467 to 577,465 bytes. Most of `driver.ts` and `marshal.ts` is tree-shaken; a first guess of 37 KB,
from the size of the separately-bundled wasm-child entry, was five times too high.

It is not avoidable without giving the capability up on the JavaScript hosts. A loaded module's `Core`
and `Cli` are built against the *caller's* bridge, which exists in the worker — putting `load` in the
launcher instead would need a second implementation of the world with no bridge under it, and would
need a thread to avoid the launcher serving itself.

**It broke one assertion, and the assertion was the fragile thing.** `packages/box/test/box.test.ts`
had `alone * 2 < all` — one applet against `box`'s sixty-five. Those two files share about 550 KB of
identical host runtime, so the *ratio* decays toward 1.0 as the runtime grows however the applets
change; measured, it had 3,795 bytes of headroom out of 1.1 MB. It asserts a difference now
(> 400 KB, against 560,264 measured), which is the claim it was making and does not move when the
host gains a capability.
