# 0316 — the wasmtime host runs no tests at all, and the freshness guard passes anyway

- **Status:** open
- **Claimed by:** agent-b
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** bug
- **Symptom:** silent loss of a whole host's coverage — eleven test files skip or fail and the check written to catch this stays green

## Reproduction

```
$ ./native/target/release/wac test --allow-read --allow-write --allow-run --allow-net --allow-env \
    packages/platform/test/wac/hostfaults_test.wac
FAIL test_a_path_the_system_refuses_is_denied_rather_than_absent — this module was built without Core and Cli
0 passed, 6 failed in 0 ms
```

Not that file: `packages/wactest/test/wac/` fails the same way in `daemon_test.wac`, `itoa64_test.wac`
and `runner_test.wac`. Every wac test on that host fails before running.

`wac run` on the same binary is **fine** — a program compiled and run there works and answers
correctly. Hold on to that asymmetry; it is the whole diagnosis.

## What it is

`prepare` in `native/src/main.rs` built the world from **`main`'s** parameters:

```rust
let main_params = m.exports.iter().find(|e| e.name == "main").map(|e| e.params.clone()).unwrap_or_default();
let args: Vec<Val> = if main_params.is_empty() { Vec::new() } else { … };
```

A test file compiles to a module whose exports are all `test_*(Core, Cli)` and which **has no `main`
at all**. So the lookup found nothing, the world was built empty, and `call_loaded` refused every
export with *this module was built without Core and Cli* — its `world_arity > lm.world.len()` arm.

`prepare` is shared by `enter` and `load`. `enter` runs a program, which is exactly the case that has
the export the sizing was keyed on, so the program path never noticed. `load` is what `wac test` uses,
and it has no `main` by construction. That is why `wac run` works and `wac test` does not.

The V8 host builds the world from what the *module* offers, and its comment says why in these words:

> **`Core` and `Cli`, and neither is required.** A module of pure test functions names no capability,
> so its manifest has no `Core` — building one first is what made `wac test` refuse every test file in
> this repository once, and the same mistake is available here.

It was available, and it was taken. The wasmtime host now builds what the module offers; `call_loaded`
already takes `world_arity` from the export being called, and `enter` truncates to `main`'s own
signature, so each caller takes its share of one world rather than the module being sized for one
caller.

## The stale seed is a real second finding and was not the cause

`native/seed/wacc.wasm` was **1.6 days** behind `packages/wacc/src` when this was found, and nothing
caught it: `tools/wac/seedfresh_test.wac` compared the wasmtime **binary** against the **Rust it is
built from**, and both were current. The payload is the thing `cargo build` cannot fix — `native/build.rs`
reads `seed/wacc.wasm` as an *input*, so rebuilding the crate refreshes the binary's timestamp and
leaves an old compiler inside it. The check answered a true statement that was not the question.

**I recorded that as the cause and it was wrong.** The rebuild is what disproved it: the seed went
current, the guard went green, and every test on that host still failed with the same sentence. Worth
being precise about, because `issues/system/closed/0306b` met the identical message, rebuilt this seed,
saw it clear, and recorded the rebuild as the remedy — a plausible cause that held for one
observation. Whatever cleared it that day, it was not this.

So the guard is worth having and is now in `seedfresh_test.wac` as
`test_the_wasmtime_seed_if_built_is_not_older_than_anything_it_is_built_from`, sharing one
implementation with the V8 seed check rather than a second copy of the rule. It is a stale-compiler
check, not a this-host-is-broken check.

## Why the coverage loss was silent

Eleven test files reach for this host through `nativeHostWhyNot()`, which asks the same
binary-versus-Rust question and so returns `""` — *nothing wrong* — in both of these states. The host
is therefore not skipped with a reason: either it fails loudly in the two files that assert the native
half, or it passes vacuously in the ones that compare and find nothing to compare. The second is the
dangerous one. `design/system/0001` D9 says this host exists to test the claim that a wac program does
not depend on one, and a green suite that never asked it does not test that claim.

## Still open

The fix and the guard are in. What is not done:

- **`nativeHostWhyNot()` should have a reason to return for a stale seed**, which its docstring already
  promises callers. Today it answers the binary question only, so the four files that consult it still
  cannot tell a current host from one carrying an old compiler.
- **Nothing asserts that `wac test` works on this host**, which is the check that would have caught
  this in a form no freshness rule can: every guard here compares timestamps, and the failure was in
  what the binary *does*. A single test file run under the wasmtime host, asserting it ran at all,
  is the shape — and it belongs wherever `tools/push.sh` can see it.
- **`issues/system/0128`** is a two-host differential timing out under load; worth a glance from
  whoever picks this up, since a host that refuses every export is one way for a differential to look
  slow rather than broken.

**And the host is not well yet, which is what a fixed instrument is for.** With tests able to run,
`packages/wactest/test/wac/` goes from 0 of 8 files to 7, and the eighth is a real second defect:
`issues/system/0317b` — a dial to an unbound port appears to succeed there, so two of `daemon_test`'s
tests fail and a third hangs, where the v8 host passes all four in 1.4s. It was unreachable while
every export was refused before running, and it is filed separately because it will outlive this.

## How it was found

Incidental to `issues/system/0295c`, running a new cross-host test on both Rust hosts. The v8 arm
passed 6 of 6 and the wasmtime arm failed 6 of 6, which looked like the new test until the same
failure turned up in three files I had not touched. The measurement 0295c needed was taken with
`wac run` instead — which is why that issue could still be closed, and, in hindsight, was the first
evidence of what this actually was.
