# 0298 — making `Cli` carry the scheduler emits a compiler that cannot rebuild its own command

- **Status:** closed — two faults, neither the one suspected
- **Fixed in:** the commit this line arrived in
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** invalid wasm, at whole-program scale only

## What was being done

`Core.of` links the four tickets `Core` hands out — `() => nowMillis().on(sched)` and three more —
so `core.delay(…).then(f)` works without the caller saying where. `Cli`'s thirty-one ticket-returning
capabilities are **not** linked, so `cli.readFile(p).then(f)` is a bare trap and every program writes
`.linkedTo(core)`. The operator's decision is that `Cli` should carry the scheduler too, which makes
that call disappear from `design/lang/0014`'s A1 and from `packages/tor/src/relayd.wac`.

The change is the same shape as `Core`'s: `Cli.of` takes a `Sched`, wraps its thirty-one
ticket-returning parameters in `(args…) => name(args…).on(sched)`, and stores it in a field so
`grants.wac`'s `narrowed` can pass it on. Three call sites: `std/platform.wac`, `grants.wac`, and
`packages/platform/host/provider.ts` — where one scheduler is now made and given to both `coreOf` and
`cliOf`, since two would mean a `Cli` ticket registered where `core.drain()` never looks.

## What happens

`std/platform.wac` with the wrapping **checks clean and emits clean on its own** — copied to an
ordinary path, `wac check` and `wac build` are both silent. Built into the whole `wac.wac` graph it
is a different answer:

    wacc built packages/wac/src/wac.wac: 1818304 bytes
    wac: the module compiled from packages/wac/src/wac.wac was rejected by the engine

So the emitter does not decline — it writes a module and the engine refuses it. `bootstrap.sh` then
refuses to install a compiler that cannot rebuild its own command, which is the guard doing its job;
without it the toolchain would have been replaced by a broken one, as it briefly was twice while this
was being chased.

## What it actually was — and the lead was wrong

**Measured first, which is what settled it.** `wac.wac` has **211** lambdas against a cap of 1024, so
thirty-one more is nowhere near it. One command, and the hypothesis below died before anything was
raised on it.

The engine names the fault exactly, once you ask it rather than the bootstrap:

    CompileError: Compiling function #2425:"childCli" failed:
      not enough arguments on the stack for call (need 42, got 41)

**A fourth construction site.** `childCli` in `packages/platform/src/frame.wac` builds a `Cli` too,
and so does `packages/sh/test/wac/probe.wac`. The grep that found them was truncated with `head -8`
and only the first two were seen. A failed `bootstrap.sh` writes its seed before it checks, so
validating `native/v8/seed/wacc.wasm` is what turns this from a guess into a sentence.

**And a second fault behind it, which is the interesting one.** With all four sites fixed the ladder
reached a fixed point and `cli.readFile(p).then(f)` still did nothing: the ticket was linked, `then`
did not trap, `core.drain()` returned — and the callback never ran. The native host builds a
non-callback field by calling `<Type>.create` **per capability**, so `Core.sched` and `Cli.sched` were
two different schedulers and the work sat on the one nobody drained. Nothing failed anywhere; it was
silent. One cache keyed by type name, shared across the capabilities of one world, fixes it.

## The lead that was wrong, kept because it was plausible

Thirty-one wrappers are thirty-one **new lambdas in one module**, and `emit.wac` caps that:

```wac
if (env.lambdaCount >= env.lambdaParams.len()) { env.ranOut("lambdas in one module"); }
```

with the tables allocated at **1024**. If `wac.wac` is near that today, this change crosses it — and
`ranOut` evidently does not stop the emit, so what comes out is a truncated module rather than a
refusal. That would be the real defect: **a limit that corrupts instead of declining.**

**Not confirmed**, and it should be before anything is raised. The measurement is a count of the
lambdas in `wac.wac`'s linked graph — `lambdaReportLinked` in `api.wac` prints one line each and is
reachable from a wac program, which is how `issues/lang/0296c` was diagnosed. If the count is near a
thousand the lead is right; if it is three hundred it is wrong and the cause is elsewhere.

Raising the cap means raising **every parallel table** with it — `lambdaParams`, `lambdaBodies`,
`lambdaSigs`, `lambdaLine`, `lambdaCol`, `lambdaInst`, `lambdaFile`, and the capture tables sized at
`capsPerLambda() * N` — and a mis-sized one of those is silent, which is the same shape as three
other faults found this week.

## Notes

The reverted work is small and reproducible from this description; nothing of it is kept. What is
kept is `design/lang/0014`'s note that the linkage question was open, and the answer to it: `Cli`
should carry the scheduler.
