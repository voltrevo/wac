# 0240c — four commands are native-only because `spawn` hands over a program, not a module

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-22
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
