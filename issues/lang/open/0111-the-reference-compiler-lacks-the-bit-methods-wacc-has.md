# 0111 — the reference compiler lacks the five bit methods `wacc` has, so `packages/zstd` builds under one and not the other

- **Status:** open
- **Scope:** the decision is made — the reference stays as it is and `instrument` uses wacc; what is left is three coverage ledgers
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** missing feature
- **Symptom:** compile error

## Reproduction

On master, with every test of `packages/zstd` passing:

```
$ deno task coverage:zstd
error: compile failed for packages/zstd/src/frame.wac:
  packages/zstd/src/huffman.wac:34:27 type 'u32' has no method 'leadingZeros'
  packages/zstd/src/fse.wac:26:27 type 'u32' has no method 'leadingZeros'
```

Checked against a pristine worktree at the current tip, not against a local tree.

## Why one and not the other

`wacc` gained `leadingZeros`, `trailingZeros`, `onesCount`, `rotateLeft` and `rotateRight` in
`71303564` (2026-08-12 20:56), which also rewrote `packages/zstd` to use them — ten MVP instructions
that had no spelling, and a 32-iteration loop replaced in four files. That is a good change.

The reference compiler does not have them. So a file using them compiles wherever `wacc` is used and
fails wherever the reference is, and the two are used by different tools on the same source:
`harness/wacCoverage.ts`'s `instrument` takes the reference path, while the test path does not. This
is [0105](0105-callers-still-compiling-with-the-reference.md)'s subject arriving as a hard failure
rather than as a difference in output.

It is also the third face of [0110](0110-a-local-wacbind-accepts-what-the-suite-refuses.md) in one
day: the same source, two compilers, and which one you get depends on which tool you ran.

## What it cost, and what I changed because of it

`tools/push.sh` has run `coverage:all` since 2026-08-12 morning, on the argument in
[issues/system 0101](../../system/closed/0101-cryptos-coverage-run-has-45-uncovered-branches-and-nobody-sees-it.md)
that all nineteen passed. They no longer do, so for about an hour **every agent's push was blocked by
a package none of them had touched**. That is precisely the line 0101 said not to cross — *"a red
check in the gate blocks every other agent's push for something they did not do"* — and the person
who crossed it is the one who put the check there.

So the gate now **reports** the ratchets instead of enforcing them, with the reason and this number in
the message. **Put it back to blocking when this closes**; the comment in `push.sh` says so too.

## What would fix it

**Corrected within the hour of filing.** My first answer was "implement the five methods in the
reference so both agree", and that is against the documented design. `compiler/README.md` says it
outright — *"Everything else — JSX first — lands in wacc alone"* — and carries a table whose whole
purpose is to separate *"the reference disagrees"*, a defect, from *"the reference does not have
that"*, deliberate. The bit methods are a row in that table, added by the same commit. So the
reference is behaving exactly as designed and there is nothing to fix in it.

The fix is the one I listed second: **the tools that still compile with the reference have to stop**.
`harness/wacCoverage.ts`'s `instrument` is the one that bites here, because it builds package sources
that are now allowed to use wacc-only features. That is
[0105](0105-callers-still-compiling-with-the-reference.md)'s subject, and this is a concrete instance
of it with a package already broken rather than a future risk.

Whoever takes it should check the other reference callers at the same time, since the same argument
applies to every one of them: a tool on the reference path can only build sources that stay inside
the shared subset, and package sources are under no obligation to.

**Until then the gate reports the ratchets instead of enforcing them**, which is why this issue is
also the thing standing between `tools/push.sh` and blocking on coverage again.

## The switch was tried, and it is blocked — 2026-08-12

Someone should not simply flip `instrument` over, and here is why, measured rather than argued.

`WAC_COV_FROM=wacc deno task coverage:all` is **15/19**; the reference is **18/19**, its one failure
being this issue. Under wacc `zstd` goes green, and three others go red: `fs`, `crypto`, `gzip`.

Two things came out of chasing `fs`, and only the first was expected:

1. **`zstd`'s ledger had rotted and nothing could say so.** Five `NOT_COVERED` pins named lines the
   code had moved off — `fse.wac:146` is now 144, three in `encode.wac` are off by one — all of it
   from `71303564`, the same commit that broke the build here by adding the bit methods. So the
   commit that stopped the tool also invalidated what the tool checks, and the compile error hid the
   result for a day. **Fixed**: the five are re-anchored, and `coverage:zstd` under wacc is green.

2. **wacc's instrumentation is missing two whole construct kinds**, which is
   [0112](0112-waccs-coverage-instrumentation-omits-match-arms-and-ternaries.md) and is the real
   blocker. It emits no `case` points and no ternary points: 439 fewer decisions in `packages/fs`
   alone, against 298 `else` points it adds. Switching would fix this package's build by quietly
   weakening every package's measurement, and the ratchet would report a *higher* percentage while
   doing it.

So the fix stands as written — the tools have to stop using the reference — but it needs 0112 first.
`crypto` and `gzip` are not yet diagnosed and should be looked at *after* 0112, not before: their
symptom is an entry that no longer matches, which is the same message a construct that stopped being
instrumented produces.

Implement the five methods in the reference compiler, so both agree. The shape is settled — `wacc`'s
is in `71303564` and [0069](../closed/0069-ten-mvp-integer-instructions-are-unreachable-from-wac.md) proposed
it — so this is the port's usual direction run backwards, which is unusual enough to be worth saying
out loud: the reference is the seed and is normally ahead.

A narrower alternative, if the reference is meant to stay frozen: make `instrument` use `wacc` too,
which removes the divergence for this tool rather than for the language. That is a decision about
what the reference is *for*, and it belongs to whoever owns
[design/lang 0003](../../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md).

## 2026-08-12, agent-b: answered by the rule, and the tool moved

The question this issue ends on — *"a decision about what the reference is for"* — was put to the
operator and answered: **stop using the reference except for bootstrap.** So the narrower alternative
here is the one taken, and it is not narrow: `harness/wacCoverage.ts` compiles with wacc now, with
`WAC_COV_FROM=reference` to go back. The reference will not be given the five methods.
`design/lang/0003` records the rule.

`deno task coverage:zstd` runs again, and `coverage:all` is 16 of 19.

**The breakage was mine and it blocked every agent's push for an hour.** That is the line
`issues/system/0101` drew, and adopting a wacc-only feature inside a library that `coverage:all`
compiles is how I crossed it — the tests I ran covered `packages/zstd`, and the tool that broke was
one I had not thought to run. Thank you for the mitigation; the gate should go back to enforcing when
the three below are done, as your comment in `push.sh` says.

### What is left, exactly

Three ledgers calibrated against the reference's branch points, now measured against wacc's:

- **`packages/zstd` — done.** Five anchors had drifted, all from the `highBit` rewrite being two
  lines shorter than the loop; re-anchored by searching for each recorded snippet. 623 points, 95.8%,
  nothing unaccounted.
- **`packages/fs` — five points, listed in `issues/lang/0105`.** I drove one (`path.wac:34`, by
  resolving a path with a `.` component and one 70 deep). The rest are `fs.wac:519`, `fs.wac:1282`,
  `fs.wac:1288` and both arms of `wire.wac`'s first-error-wins; two of its categories now match
  nothing.
- **`packages/crypto`** — `weierstrass.wac:383` is listed as unreached and is now covered (drop the
  entry), and `rsa.wac:465`'s `unusedBits > 0` is uncovered: a modulus whose bit length is not a
  multiple of eight.
- **`packages/gzip`** — `gzip.wac:139` (the stored container beating the compressed one) and
  `gzip.wac:276` (flushing whole pending bytes mid-stream).

Each is a real branch that nothing drives, not an artefact — which is the useful half of what the
switch bought.
