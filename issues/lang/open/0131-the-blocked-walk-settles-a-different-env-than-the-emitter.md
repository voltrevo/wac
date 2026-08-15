# 0131 — the blocked walk settles a different `Env` than the emitter, which is what 0090 was about

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer — latent; the two paths agree on every program here, by luck rather than by construction

## Reproduction

Not a program — an experiment, and the experiment is the evidence.

`emitModuleOfInto` registers array types and about ten synthetic string helpers — ` str_eq`,
` str_concat`, ` str_slice` and the rest — into the `Env` between `assignGlobals` and
`settleEmittable`, conditional on `env.coverage` and on `hasStringType`. I moved that block to
*after* `settleEmittable` to find out whether the fixed point depends on it. It does, emphatically:

| program | before | after | |
|---|---:|---:|---:|
| `packages/box/example/boxsh.wac` | 736,545 | 686,131 | −50,414 |
| `packages/box/example/desk.wac` | 776,384 | 717,166 | −59,218 |
| `packages/box/example/hash.wac` | 156,281 | 146,444 | −9,837 |

**All 79 programs changed, every one of them smaller, by 7-8%.** Not reordering — declarations were
being declined, because settling without the helpers registered makes the fixed point decide fewer
things can be emitted. `packages/json` went from 51 passing to 25 failing. Reverted.

Now the point. `blockedOf` runs on a `Front` from `frontOf`, and `frontOf` goes
`collectDeclarations` → `assignGlobals` → `settleEmittable` with **nothing registered in between**.
That is precisely the arrangement the experiment above shows produces a different answer. So the
walk whose job is to report what the emitter declined is settling an `Env` the emitter never has,
and it declines *more* than the emitter does.

## Notes

This is not new and I did not introduce it: `emitBlockedOf` built its own `Env` the same way long
before `frontOf` existed. Folding the prefix made it visible rather than making it true.

It is also exactly `issues/lang/0090`, which is worth reading first — the blocked report and the
emitter answered with different algorithms, 29 of 335 files silently lost an export, and the fix was
to make this walk run "the same fixed point the emitter runs, because the answer has to be the
same". It runs the same *function*. It does not run it over the same `Env`, and the difference is
the one thing the emitter adds before calling it.

**Why nothing is failing today.** `blockedFiles` answers `""` for all 79 programs, so the extra
declines are not reaching the report — either the affected declarations are not exported, or
`declinedExport` and the per-declaration `canEmit` walk do not consult the state that differs. That
is a reason it has not bitten, not a reason it cannot: the direction of the error is a **false
alarm**, a blocker reported for something the emitter would have emitted happily, which fails a
build that should have worked.

The fix is to give the blocked walk the emitter's registrations before it settles — the same
`if (env.coverage)` / `hasStringType` block, or better, one function both call so there is no second
copy to drift. That is small. What makes it worth doing carefully is that it changes what
`blockedFiles` answers, and the honest gate is the one used above: hash every emitted module, run
the suite, and check `blockedFiles` over every program before and after.

Found while pricing `issues/lang/0129`, which wanted to know whether the emitter's registrations
could move after the fixed point. They cannot, and that answer is recorded there.
