# 0131 — the blocked walk settles a different `Env` than the emitter, which is what 0090 was about

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** wrong answer — latent, and not yet reachable: the divergence is proven, a program that suffers from it is not

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

That first move took a 52-line block containing `collectCallbackSigs`, `collectOutSigs` and the
start function as well, so it did not show *which* part mattered. Moving **only** the 42-line
registration block, leaving everything else in place, gives boxsh 736,545 -> 686,926 against the
686,131 above: the registrations account for about 98% of it. It is the helpers.

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

**I could not make it produce a wrong answer, and that is worth saying plainly.** `declinedExport`
reads `env.funcOk[at]`, which *is* what `settleEmittable` writes, so the mechanism looks like it
should fire. It does not. `blockedFiles` answers `""` for all 79 programs, and for six hand-written
shapes aimed straight at it — an exported `==` on strings, `+`, `.slice`, `.toBytes`, `.indexOf`,
and a string feeding an array — every one of which emits and reports nothing.

So what is established is the divergence, not a bug reachable today. The declines the experiment
exposes must be landing on declarations `declinedExport` skips — it walks exported, non-generic ones
only. Whoever picks this up should start by finding a program where the two `Env`s disagree *about
an exported declaration*, because if no such program can exist the honest fix is a comment
explaining why, not code. The direction, if it ever fires, is a **false alarm**: a blocker reported
for something the emitter would have emitted happily, failing a build that should have worked.

The fix is to give the blocked walk the emitter's registrations before it settles — the same
`if (env.coverage)` / `hasStringType` block, or better, one function both call so there is no second
copy to drift. That is small. What makes it worth doing carefully is that it changes what
`blockedFiles` answers, and the honest gate is the one used above: hash every emitted module, run
the suite, and check `blockedFiles` over every program before and after.

Found while pricing `issues/lang/0129`, which wanted to know whether the emitter's registrations
could move after the fixed point. They cannot, and that answer is recorded there.
