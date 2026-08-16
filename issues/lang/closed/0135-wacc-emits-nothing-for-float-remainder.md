# 0135 — wacc emits nothing for `%` on a float, so it answers the second operand

- **Status:** closed
- **Claimed by:** agent-c
- **Fixed in:** this commit
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```wac
export f64 fmod(f64 a, f64 b) { return a % b; }
```

| call | reference | wacc |
|---|---:|---:|
| `-7.0 % 2.0` | -1 | **2** |
| `7.0 % -2.0` | 1 | **-2** |
| `7.0 % 2.0` | 1 | **2** |
| `7.5 % 2.0` | 1.5 | **2** |

**wacc answers the second operand, every time.**

## Where, exactly

`emitBinary` in `emit.wac` has a branch per value type. The float branch handles `+ - * /` and the six
comparisons and **has no `kPercent()` case**, so `%` on an `f64` emits *no instruction*: both operands
are pushed and neither is consumed, and the value left on the stack is `b`.

The integer branches below it do have one — `fb.byte(u ? 112 : 111)` for `i32`, `fb.byte(u ? 130 : 129)`
for `i64` — which is why this is float-only and why it reads as an omission rather than a mistake.

## Why it was not caught

Nothing runs `spec/tour.wac`'s `selfTest()` under wacc. The reference does, in
`compiler/wacSpec.test.ts`, and the tour tests this exact function — `rem(-7.0, 2.0) -> -1.0` is on the
line below its definition. The tour is in wacc's corpus for *checking* and *emitting*, so wacc compiles
it into a module that validates and computes the wrong answer, and no test asks what it computes.

That gap is now closed: `packages/wacc/test/tour.test.ts` calls the tour's functions under wacc and
under the reference and compares, with this bug in a `KNOWN_DIFFERENT` map. **When `%` is fixed the
test fails**, saying `rem agrees with the reference now — take it out of KNOWN_DIFFERENT`, which is
`specEmit.test.ts`'s rule and is what stops a fixed bug going on looking open.

So the next float-arithmetic mistake is caught by a wrong *answer* rather than by nothing, and this
one has a line with its number on it.

## The fix is not one opcode

wasm has no `f64.rem`. It has to be synthesised, and the tour's own comment says the obvious synthesis
is wrong: *"Writing `a - trunc(a/b)*b` yourself would NOT match, because the quotient rounds before
trunc sees it"*, with `rem(1.0, 0.1) -> 0.09999999999999995` as the case that catches it. So this wants
the exact algorithm the reference uses rather than an approximation.

### The algorithm exists, in the reference, and it is not small

`makeFmod()` in `compiler/wasmBuildBin.ts` is it: raw wasm bytes implementing binary restoring
division — NaN in NaN out first so no comparison sees one, `fmod(±inf, y)` and `fmod(x, 0)` as NaN,
`fmod(x, ±inf)` and `|x| < |y|` returning **x** rather than `|x|` so `-0.0` and a negative `x` survive,
then a scale-up loop and a subtract-and-halve loop. `makeFmodF` is `f32` calling into it.

Porting it means giving wacc a builtin-helper family. It has the mechanism — `outHelpers`,
`wrapHelpers`, `boundHelpers` are all emitted this way — and the hazard is the one
`design/lang/0002` records from its first attempt at wrappers: the helper indices are arithmetic over
a table whose base moves, and getting that wrong emitted invalid modules for 96 corpus files. So this
is a contained change in shape and a delicate one in fact, and it wants doing with the corpus tests to
hand rather than at the end of a session.

### Where a helper family plugs in, read out of the emitter

The arithmetic is in one place and says so — *"where each block of functions begins, said once … four
places used to spell that arithmetic out separately, and they disagreed the moment a family was added
between them"*. So the change is bounded, and these are the lines it touches:

- **A count and a base**, in the chain that runs `memHelperAt` → `arrayHelpersAt` →
  `structHelpersAt` → `enumHelpersAt` → `bindStrHelpersAt` → `cbHelpersAt` → `covHelpersAt` →
  `outHelpersAt` → `wrapHelpersAt` → `boundHelpersAt` → `startFunctionAt`. Each is the previous plus
  its size, so a new pair inserted anywhere shifts what follows automatically. **Put it late** —
  after `covHelpers`, before the wrappers — because `env.wrapAt` and `env.boundAt` are published to
  other code and a family in front of them is one more thing that must not be miscounted.
- **`helpers`**, the sum, which is summed separately from the chain and is therefore the one place
  that can silently disagree with it.
- **`funcs.u32leb(count + helpers)`** and **`code.u32leb(count + helpers)`** follow from it.
- The **exports** line does *not*: a helper called only from inside the module is not exported, which
  is what `wrapHelpers` and `boundHelpers` already do — they appear in `helpers` and not in the
  export count.
- Then the type, the body, and `emitBinary`'s float branch emitting `call <fmodAt>` instead of nothing.

**Always emit it, rather than detecting whether a module uses `%` on a float.** That is the argument
`design/lang/0002` settled for the wrappers: a walk that decides which functions need one is a
complete expression walk, and an incomplete one names a function index that does not exist — silent
and catastrophic, where always-emit costs a hundred bytes and is correct by construction.

**The oracle is already in place.** `packages/wacc/test/tour.test.ts` compares `rem` against the
reference on four inputs, with this issue in `KNOWN_DIFFERENT` — so a wrong transcription shows as a
wrong *answer* rather than as nothing, and a right one fails the test with "take it out of
KNOWN_DIFFERENT". The index arithmetic going wrong shows up as invalid modules across `corpusEmit`,
`checked` and `names`, which is loud.

**Until then, declining would be better than answering.** `packages/wacc` has a `blocked` channel for a
feature it cannot emit, and a caller told "unsupported" can act on it; one handed a module that returns
the wrong operand cannot. The cost to weigh is that the tour uses `%` on floats, so declining makes the
tour un-emittable by wacc and something in the corpus tests has to say that is expected.

## Fixed, 2026-08-16

`__fmod` and `__fmodf` are a helper family in `emit.wac`, ported from the reference's `makeFmod`, and
the float branch of `emitBinary` emits `call __fmod` for `kPercent()` — `__fmodf` sits immediately
after it, so one index serves both widths.

**The differential is 40 comparisons wide and all of them agree.** Not only the four in the table
above: NaN in either operand, `±inf % y`, `x % ±inf`, `x % 0`, `-0.0`, a negative dividend smaller
than the divisor, `1e308 % 3`, and a subnormal pair — each against the reference, for `f64` and `f32`
alike. Before the fix 38 of the 40 disagreed. `1.0 % 0.1` is `0.09999999999999995`, which is the case
the tour warned the obvious synthesis would get wrong, and it agrees exactly.

Two things the issue predicted, both of which happened:

- **The index arithmetic is where the risk was.** It was wrong once — the two signatures were
  registered from `emitFmodHelpers`, which runs *after* `declTypes` is snapshotted, so every program
  declined with "a type this emitter names only while emitting". That is the guard in `emitModule`
  working correctly on a mistake made here, and the fix was to register them beside
  `pairEverySignature()` and on its far side, so neither grows a pair it will never use.
- **`names.test.ts` caught the second one**, reporting "2 of 153 unnamed" against
  `packages/bls/src/fp.wac` the moment the helpers existed. They are named `__fmod` and `__fmodf` and
  not exported, the same standing as `__wac_start`. 309,371 functions across 409 modules are named
  again.

**The oracle fired as designed.** `tour.test.ts` failed with *"rem agrees with the reference now —
take it out of KNOWN_DIFFERENT"*, which was the point of writing it that way. That map is now empty,
which arms the tour's whole `selfTest()` rather than the sample of calls listed above it — so wacc is
held to every function in `spec/tour.wac`, not to the twenty-seven that localise a failure.

`spec/cases/0182`, `0183` and `0184` state the behaviour for both compilers: the sign follows the
dividend, the result is exact rather than a subtracted quotient, and the `f32` path — which promotes,
uses the `f64` routine and demotes — is a second path a `f64`-only case would not have reached.

**The cost is 269 bytes per module**, measured on `export i32 f() { return 42; }`: 246 bytes before
and 515 after. The helpers are emitted unconditionally, as the reference emits them, because deciding
which modules need them requires a complete expression walk and an incomplete one names a function
index that does not exist. Against the ~347 KiB floor `issues/system/0129` is about, it is noise.
