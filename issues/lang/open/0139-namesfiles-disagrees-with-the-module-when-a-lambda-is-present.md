# 0139 — `namesFiles` lists a different order from the module when a lambda is present

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-16
- **Kind:** bug
- **Symptom:** wrong answer

## What

`namesLinked` answers "what each emitted function is called, in the order the module emits them", and
`packages/wacc/test/names.test.ts`'s *rung 4: every exported function is where `namesFiles` says it
is* checks that claim by looking up each export's index in the list. With a lambda anywhere in the
program the two disagree from the first entry:

```
closure_test.wac: test_a_lambda_is_a_value is function #0, the list says T.create
closure_test.wac: test_a_lambda_captures_by_reference is function #1, the list says T.fail
closure_test.wac: test_a_lambda_captures_a_parameter is function #2, the list says T.failNow
```

The module puts the entry file's functions first; the list puts the imported file's first. Not an
off-by-N — a different order.

## Reproduction

Any wac test file with a lambda in it, under a directory `names.test.ts` walks. The one that found
this is preserved at the end of this issue; dropping it into `packages/wactest/test/wac/` reproduces.

**Without the lambdas the same file passes**, which is the whole of the evidence that this is about
lambdas rather than about a new file.

## What is already ruled out

- **Not the unnamed-function half.** That was a real second bug and is fixed: the hoisted lambdas had
  no names, and then had them written at the wrong index because `lambdaFirst` counts declared
  functions while the lambdas sit *after* the string builtins. `names.test.ts`'s other test —
  *the name section names every function* — passes now.
- **Not the index arithmetic in the module itself.** `issues/lang/0138` was that, and it is fixed and
  verified: rung 4, rung 5, 193 spec cases, and a program that captures a local building and running
  under wasmtime.

## The lead

`emitNamesOf` lists **registered** functions in `funcIndex` order, and a hoisted lambda is not
registered — so the list cannot contain one. That alone would make the list *short*, not *reordered*,
so something else is moving: the likely candidate is that `emitNamesOf` builds its `Env` through a
different preamble from `frontOf`, and the lambda walk now runs in `frontOf`. If the two preambles
disagree about which functions are emittable, `settleEmittable` decides a different set and the whole
order shifts.

Start by comparing the two `Env`s rather than reading the list: `emitDeclineLinked` and
`lambdaReportLinked` are exported for exactly this kind of question, and the last three bugs in this
area were each found by one reading of an instrument and none by inspection.

## The test that found it

Removed from the tree so the suite is green, and worth restoring the moment this is fixed — it is the
only closure test that runs the feature through `wac test`, on wasmtime, compiled by the seed rather
than by a host. It is kept in the issue rather than in the repository because a red suite blocks every
agent's push.

```wac
import { T } from "../../src/assert.wac";

export string test_a_lambda_is_a_value() {
  T t = T.create();
  fn[i32()] answer = () => 42;
  fn[i32(i32)] inc = (i32 a) => a + 1;
  fn[i32(i32,i32)] mul = (i32 a, i32 b) => { return a * b; };
  t.eqI32(answer(), 42, "an expression body");
  t.eqI32(inc(41), 42, "one parameter");
  t.eqI32(mul(6, 7), 42, "a block body");
  return t.report();
}

export string test_a_lambda_captures_by_reference() {
  T t = T.create();
  i32 n = 0;
  fn[void()] bump = () => { n = n + 20; };
  bump();
  t.eqI32(n, 20, "the lambda's write is visible outside");
  n = n + 1;
  bump();
  t.eqI32(n, 41, "and the outer write was visible to it");
  i32 shared = 0;
  fn[void()] add = () => { shared = shared + 21; };
  fn[i32()] read = () => shared;
  add();
  add();
  t.eqI32(read(), 42, "two closures, one cell");
  return t.report();
}

export string test_a_lambda_captures_a_parameter() {
  T t = T.create();
  t.eqI32(twice(2), 42, "a parameter is captured like a local");
  return t.report();
}

i32 twice(i32 start) {
  i32 v = start;
  fn[void()] bump = () => { v = v + 20; };
  bump();
  bump();
  return v;
}
```

It passes under `wac test` — three tests, and canaried. Only `namesFiles` objects.
