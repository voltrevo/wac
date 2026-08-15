# 0131 — the blocked walk settles a different `Env` than the emitter, which is what 0090 was about

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** none demonstrated
- **Fixed in:** this commit — withdrawn rather than fixed; there was nothing to fix

Closed because the claim did not survive its own evidence — not because it was fixed.

## What was claimed

That `blockedOf` settles an `Env` without the array types and ten string helpers the emitter
registers, so the walk whose job is to report what the emitter declined declines *more* than the
emitter does — a latent false alarm, and a return of `issues/lang/0090`.

The evidence was an experiment: move the registration block from before `settleEmittable` to after
it, and every one of 79 modules comes out 7-8% smaller, with `packages/json` going from 51 passing
to 25 failing. I read "smaller" as "declarations were declined".

## What the evidence actually shows

It is not declines. Building `packages/box/example/hash.wac` with the block moved gives a module of
147,334 bytes against 156,281, and that module **does not validate**:

```
CompileError: WebAssembly.Module(): Compiling function #55:"page" failed:
  not enough arguments on the stack
```

The registrations have to precede `settleEmittable` because the emitter's **codegen** emits calls to
those helpers and needs them in the function table; without them it writes malformed calls. The
missing bytes are the helpers' own bodies. Nothing here shows `settleEmittable`'s *decisions about
user declarations* changing at all — and the blocked walk does no codegen, so the difference in
`Env` content has no path to its answer.

That is consistent with the other half of the original report, which I could not explain at the
time: `blockedFiles` answers `""` for all 79 programs and for six shapes written to provoke it
(exported `==` on strings, `+`, `.slice`, `.toBytes`, `.indexOf`, a string feeding an array). It was
not luck. There is no mechanism.

## What is worth keeping

**A `namesFiles` diff cannot see this, and I used one before noticing.** `namesLinked` builds its own
`Env` through `emitNamesOf` and never runs the emitter's registrations, so it reported byte-identical
output across an experiment that changed every module. An instrument on a different code path from
the change reports "no difference" exactly as loudly as one that looked.

**`blockedFiles` answered `""` for a module that fails wasm validation.** That is arguably correct —
it reports declined declarations, not malformed codegen — but it is worth knowing that "nothing
blocked" is not "the module is sound", and that a build with `blocked == ""` has been told nothing
about validity.

The `Env`s do still differ, and if `settleEmittable` is ever made to consult the function table in a
way that reaches user declarations, the two walks would diverge for real. That fragility is recorded
in `issues/lang/0129`, which is the live issue about the shared front end and the place someone will
be reading when it matters.

Closed rather than left open: an open bug that nobody can reproduce sends the next person looking
for a symptom that does not exist, which costs more than the note is worth.
