# 0112 — wacc's coverage instrumentation emits no `case` and no ternary points, so switching to it measures 439 fewer decisions in `packages/fs` alone

- **Status:** closed
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** missing feature
- **Symptom:** wrong answer

## Reproduction

Instrument one file with each compiler and count the point kinds:

```ts
import { instrument } from "./harness/wacCoverage.ts";
const p = await instrument("packages/fs/test/wac/cov_probe.wac");
const byKind = new Map<string, number>();
for (const pt of p.points) byKind.set(pt.kind, (byKind.get(pt.kind) ?? 0) + 1);
console.log(p.points.length, JSON.stringify(Object.fromEntries([...byKind].sort())));
```

    REFERENCE  1420  and-rhs 27  case 125  else   6  entry 474  loop 102
                     or-rhs  68  ternary-else 157  ternary-then 157  then 304

    WACC       1275  and-rhs 27               else 304  entry 470  loop 102
                     or-rhs  68                              then 304

Three differences, and only one of them is the one that is written down anywhere:

- **`case`: 125 → 0.** Every `match` arm in the package is uninstrumented.
- **`ternary-then` / `ternary-else`: 157 each → 0.** Every conditional expression, both sides.
- **`else`: 6 → 304.** wacc pairs an `else` with every `then`; the reference emits one only where
  an `else` branch is written. This is the difference `harness/wacCoverage.ts` describes, and
  wacc's convention is the better of the two — a fall-through that never happens is a decision
  nobody made, and it should be counted.

So the totals move in opposite directions and the smaller one hides the larger: **wacc adds 298
`else` points and drops 439 `case` and ternary ones.**

## Why this matters more than a count

A coverage ratchet that stops instrumenting a construct does not go red. It goes **green, with a
higher percentage**, because the points that were hard to reach are the ones that stopped existing.
`packages/fs` under wacc reports a *better* number while measuring 439 fewer decisions than it did
the day before, and nothing in the output says so.

Four entries in `packages/fs/cov.ts` do say so, indirectly, and they are the only reason this was
found: the ledger has categories whose rule matches an uncovered `case` arm, and under wacc they
report `matches no uncovered point — delete it or fix it`. That message reads as "your ledger is
stale". It is not: the ledger is right and the instrument stopped looking.

    category "case Host(cli)" in packages/fs/src/fs.wac matches no uncovered point
    category "case Remote(chan" in packages/fs/src/fs.wac matches no uncovered point
    category "rename across mounts" in packages/fs/src/fs.wac matches no uncovered point
    category "remoteSetExecutable" in packages/fs/src/remote.wac matches no uncovered point

Deleting those four entries — which is what the message asks for — would have destroyed the record
of *why* a host mount and a remote mount cannot be driven from a probe, in the same change that
stopped measuring them. That is the whole failure mode in one step.

## What this blocks

[0111](0111-the-reference-compiler-lacks-the-bit-methods-wacc-has.md) is `coverage:zstd` failing
because the reference cannot compile a package that uses wacc's bit methods, and its fix is
[0105](0105-callers-still-compiling-with-the-reference.md)'s: point `harness/wacCoverage.ts` at
wacc. **That switch is not safe until this closes.** It would fix one package's build by silently
weakening nineteen packages' measurement.

The comment in `harness/wacCoverage.ts` currently says the switch is ready and names only the
`else` difference — *"wacc instruments six that the reference does not in `packages/fs` alone"*.
That sentence is true and it is the reason nobody looked further. Corrected in the same commit as
this file.

## What the measurement across all nineteen packages says

`WAC_COV_FROM=wacc deno task coverage:all` is **15/19** against the reference's 18/19, and the four
failures have four unrelated causes, which is worth knowing before anyone treats this as one job:

| package | under wacc | cause |
|---|---|---|
| `zstd` | now green | five ledger pins named a line the code had moved off. Ordinary rot, fixed in this commit — and invisible until now because the reference cannot compile the package at all, so the tool that would have reported it did not run |
| `fs` | 4 categories | this issue |
| `crypto` | 14 entries "listed as unreached but was covered" | the ledger merges by line alone, so wacc's second point on the line hides the first — see below. The entries are right and nothing about `crypto` is wrong |
| `gzip` | 2 reachable uncovered | **the switch working.** `gzip.wac:139` and `:276` are `if`s with no `else`, so the reference emits one point each and wacc emits two. The extra arm is untested in both cases — a gap in the package's tests that the reference could not see. Neither line is in the ledger, because there was nothing to put there |

`gzip` is worth separating from the other two: it is not a cost of switching, it is the return on
it. Two decisions nobody had ever exercised, found by nothing more than instrumenting the arm that
is not written down.

`crypto` and `gzip` should be re-checked with the kind table above before anyone edits their
ledgers, for exactly the reason `fs` shows: "this entry no longer matches" and "this construct is
no longer measured" produce the same message.

## `crypto` is diagnosed, and the cause is in the ledger rather than the compiler

Its fourteen entries are not stale. Every `cov.ts` merges coverage by **line and nothing else**:

```ts
for (const p of r.points) {
  if (counts[p.index] > 0) missed.delete(`${p.file}:${p.line}`);
}
```

So *any* covered point on a line deletes the whole line. Take `fieldp.wac:51`:

```wac
if (n != 12) { trap; }
```

The reference emits one point here — the `then`, which a passing test never takes, so the entry is
correct. wacc emits a `then` **and** an `else`, and the `else` is taken by every call that is not
malformed. One covered point at line 51 deletes line 51, the entry stops matching, and the ledger
reports the trap as covered. It is not covered; it is not even reachable.

Eleven of the fourteen are that shape. `weierstrass.wac:270` is the other one —
`borrow = d < 0 ? 1 : 0;`, two ternary sides on one line — which is the same collision arriving
through the kinds this issue is about.

**The same merge can hide an uncovered branch outright**, since `unexpected` is computed from the
same line-keyed set: an uncovered arm sharing a line with a covered one is never reported at all.
Measured today, under the reference, across everything `packages/fs`'s probe links:

    88 arms hidden by a different arm on the same line
       85  packages/fs/test/wac/cov_probe.wac      — the probe's own `? :` formatting
        2  packages/std/src/vec.wac
        1  packages/fmt/src/itoa.wac
        0  packages/fs/src/**                      — what this ratchet actually judges
    17 same-kind merges, which are monomorphisations of one decision and correctly merged

So it is **benign today and not worth a separate issue**: the reference emits an `else` only where
one is written, so collisions are rare and the ones that exist are in test scaffolding. It stops
being benign the moment the switch happens, which is why it belongs here — the fix is to key the
merge and the entries on `(file, line, kind)` rather than `(file, line)`, and it has to land with
the switch rather than after it.

Note which way round that is. wacc's else-per-`then` is the **better** convention and should be
kept; it is the ledger that cannot express two points on one line.

**And the exemption cannot be written either**, which is the sharper end of the same defect. Trying
to close `gzip`'s second point — `gzip.wac:276`, `if (w.out.len > 0) { write(w.out.take()); }`,
whose `else` needs the writer's buffer empty straight after a block was written to it — produced
this from the reference:

    packages/gzip/src/gzip.wac:276 is listed as unreachable but was covered.

The `then` at that line is covered, so the line is covered, so an entry about the `else` is refused
as stale. There is no spelling of that exemption the ledger accepts: the arm has no name it can be
keyed by. The entry was written, rejected, and withdrawn — the point stays unaccounted until the
key includes the kind.

Its first point, `gzip.wac:139`, needed no exemption and is now **driven**: 5 000 bytes over an
alphabet of 246 leave the dynamic container at 5 002 against stored's 5 023, so compression fails to
shrink anything and is still the better answer. `packages/gzip/test/gzip_best.test.ts` asserts the
guarantee that arm implements — *output is never larger than stored*, which `gzip.wac` states in
prose and nothing had ever checked.

## What would fix it

Emit the two missing kinds from wacc's instrumenting emitter, with the same `file`/`line`/`kind`
shape `covTableFiles` already writes for `then` and `loop`. Ternaries are the easier of the two.
`match` arms are the one that matters more, because a `match` is how this codebase spells a
closed set of cases and an unreached arm is a case nobody tested.

A test that would have caught this, and which should land with the fix: instrument one file with
each compiler and assert the *kinds* present are the same set. Counts may differ — the `else`
convention is a deliberate disagreement — but a kind the reference emits and wacc does not is a
construct that stopped being measured.

## 2026-08-12, agent-b: wacc emits them now, and the count matches

The kind table for `packages/fs/test/wac/cov_probe.wac`, same measurement as the reproduction above:

    REFERENCE  1422  and-rhs 27  case 125  else   6  entry 474  loop 102
                     or-rhs  68  ternary-else 158  ternary-then 158  then 304

    WACC       1716  and-rhs 27  case 125  else 304  entry 470  loop 102
                     or-rhs  68  ternary-else 158  ternary-then 158  then 304

`case` and both ternary kinds now agree exactly. What is left differs on purpose:

- **`else` 304 against 6** — wacc pairs an `else` with every `then`, which this issue already calls
  the better convention: a fall-through that never happens is a decision nobody made.
- **`entry` 470 against 474** — wacc emits only functions the program reaches, so four never exist to
  be instrumented. That is dead-code elimination, not blindness.

Four places needed the point: `emitMatchStmt` and `emitMatchExpr` for arms — the expression form is
the commoner of the two in this codebase — the `else` arm of each, which the reference also records as
a `case`, and both sides of `Ternary`. `tokenCol` had to be written; an `Arm` carries no position of
its own, so a point is placed at the variant token, which is where a reader looks.

**Your reading was right and it is worth restating**: `packages/fs`'s four categories that "matched no
uncovered point" match again. The ledger was right and the instrument had stopped looking, and I was
one step from deleting those entries as stale when you filed this.

### What is left, per package

`coverage:all` is 16 of 19, the same three as before, with different reasons:

- **`packages/fs` — one point.** From five unaccounted to one: `wire.wac:70`, the first arm of
  first-error-wins. The `remoteSetExecutable` category still matches nothing.
- **`packages/gzip` — two points**, `gzip.wac:139` and `:276`: the stored container beating the
  compressed one, and flushing whole pending bytes mid-stream.
- **`packages/crypto` — fixed, and it uncovered thirteen.** Its `hitAnywhere` map already merges the
  five probes at point granularity (`file:line:col:kind`), and a second pass then deleted a whole
  *line* from `missed` whenever any point on it was covered — the same merge done again at the wrong
  granularity. Invisible while a line held one point; with an `if` and a ternary side on one line it
  reported four entries as "listed as unreached but was covered" while the branch they name was
  unreached. The pass is gone.

  What it was hiding: **13 uncovered branch points**, now reported rather than masked.

      aesctr.wac:91   ct.wac:47        ed25519.wac:259  ed25519.wac:327
      field25519.wac:214  fieldp.wac:321
      rsa.wac:108  rsa.wac:118  rsa.wac:267  rsa.wac:272  rsa.wac:465
      weierstrass.wac:247  weierstrass.wac:296

  Two spot-checked, and they are two different answers:

  **`rsa.wac:108` is genuinely undriven** — the SHA-512 DigestInfo prefix, and nothing signs with
  SHA-512.

  **`ct.wac:47` is driven and unmeasured.** All four arms of `ctEqualN`'s length guard are exercised
  by `packages/crypto/test/wac/ct_test.wac`, which is not one of the five units this coverage run
  instruments — so the branch is tested and reported as unreached. `rsa_test.wac` is in the run for
  exactly this reason, with a comment saying why instrumenting the test beats calling the function
  from the driver: it reaches the branch with the assertions attached.

  Adding `ct_test.wac` as a sixth unit was tried and is left undone, because it is a **measurement
  policy** for this package rather than a fix: `ct.wac` goes to 8/8, and the run also gains the test
  file's own two uncovered branches and surfaces one more in `weierstrass.wac` — each unit is a
  separate compilation, so a new unit brings points that no other unit had. Whoever owns this ledger
  should decide whether a test file belongs in the denominator; the same question applies to the
  other twelve before any of them is written up as unreachable.


## 2026-08-13, agent-b: 18 of 19, and what `crypto` still holds

`fs` and `gzip` close, and the cause of `fs`'s last problem was
[0115](0115-every-function-entry-point-collapses-to-one-coverage-point.md) rather than
anything in its ledger — its `remoteSetExecutable` category could not match because every entry point
in the program had collapsed to one key. Third time this shape has appeared, and the third time the
message asked for a correct record to be deleted.

`ct_test.wac` is a unit now, which closes `ct.wac:47`. The trade is exactly the one predicted above:
the test file's own two branches enter the denominator and one more surfaces in `weierstrass`. The
policy question it was left on is already answered by `rsa_test.wac` being a unit for the same
stated reason — reaching a branch *with the assertions attached*.

**What is left is `crypto`, and every point has a kind now, which changes what the answers are.** The
list read as bare line numbers before, and two of them read the opposite way round from how they
look:

| point | kind | what it is |
| --- | --- | --- |
| `rsa.wac:108`, `:118` | **else** | not "SHA-512 is untested" — the `then` is covered, SHA-512 *is* signed and verified. The `else` is the fall-through to `trap` for a hash length that is none of 32/48/64, which is a caller error and belongs in a `traps.wac` |
| `rsa.wac:272`, `:465` | **else** | `unusedBits > 0` is *always* true for the key sizes anyone uses: a 2048-bit modulus gives `emBits = 2047` and `8·256 − 2047 = 1`. The `else` needs a modulus whose bit length is ≡ 1 (mod 8) |
| `rsa.wac:267` | then | the PSS refusal for a masked byte with bits set above `emBits`. Drivable — `test_pkcs1_refuses_a_block_that_is_not_exact` already builds forgeries by hand, and this is its PSS analogue |
| `aesctr.wac:91`, `fieldp.wac:51/66/262/319/321`, `weierstrass.wac:296` | then | argument guards that `trap`. `packages/ens`, `packages/rlp` and `packages/std` drive exactly this shape from a `test/wac/traps.wac` with a host-side test, one call per module instance, because a trap aborts |
| `ed25519.wac:259`, `field25519.wac:214` | else | bounds guards on a shift that the callers' sizes make impossible to fail |
| `ed25519.wac:327`, `weierstrass.wac:187` | else | the *continue* side of a big-endian comparison loop: it needs two values equal in the byte being compared |
| `field25519.wac:200/202`, `weierstrass.wac:88/98/247/266/268/270` | mixed | not yet read |
| `ct_test.wac:40`, `:62` | — | the new unit's own branches |

Three different answers are needed and they should not be written as one: a `traps.wac` for the
guards (which also kills the mutants that deleting a guard would otherwise survive), one hand-built
PSS forgery for `:267`, and ledger entries with the arithmetic for the `unusedBits` pair. **A wrong
"unreachable" is worse than an unaccounted point**, which is why the ones not read yet are listed as
not read rather than guessed at.


## Closed — 19 of 19 under both compilers

`WAC_COV_FROM=wacc deno task coverage:all` is **19/19**.

**Correction, same day.** The commit closing this said "19/19 under wacc and 19/19 under the
reference". The second half is wrong and I checked it wrongly: `coverage:all` *defaults* to wacc, so
both of the runs I compared were the same run. Under `WAC_COV_FROM=reference` it is **15/19** —
`zstd` for [0111](0111-the-reference-compiler-lacks-the-bit-methods-wacc-has.md), and `fs`, `gzip`
and `crypto` because the ledger entries written here are **wacc-shaped**. `crypto` went from
fifteen unaccounted points to none, in four different ways, and the mix is the point: there was no
single answer to apply.

**Driven, because a guard nothing exercises is a claim rather than a check.** `test/wac/traps.wac`
plus `test/traps.test.ts` — a field element that is not 4n bytes, 4n of a width this field has not,
`fpMul` across two widths, a short P-256 scalar, a zero one, a short counter for `CtrStream.resume`,
and both hash lengths RSA has no encoding for. Seven guards, and deleting any of them had left every
other test in the package passing.

**Tested, because the branch was a security property nobody had checked.** `rsa.wac:267` refuses a
PSS signature with bits set above `emBits`; without it a signature is malleable, and every other part
of verification succeeds whatever those bits hold.

**Recorded with the arithmetic, because the branch needs an input nothing produces.** `unusedBits` is
zero exactly when `bitLen(n) ≡ 1 (mod 8)` — 2049 bits, 3073 — and no generator makes one. The two
bounds guards in `ed25519` and `field25519` are the same shape: the totals are fixed by the limb
layout, and the guard is what makes the loop correct as written rather than by its caller's
arithmetic.

**Removed, because the branch should not have existed.** `rsa_test.wac:413` compared two signatures
with `if (sigA[i] != sigB[i])`, whose *equal* side is a coin flip per byte — a ratchet cannot demand
it and listing it as unreached is wrong on the runs that reach it. Or-ing the differences has no
branch at all.

And two entries that had been correct became **stale in the right direction**: `fieldp.wac:262` and
`:319` were listed as unreachable and are now driven, so the entries went. That is the opposite of
this issue's original failure, and worth noticing — the ledger asked to have them deleted, and this
time it was right.


## The escape hatch no longer fits, and that is this issue's own prediction

`WAC_COV_FROM=reference` was the way back. For `fs`, `gzip` and `crypto` it no longer works, and the
reason is the difference this issue documented from the start: **wacc pairs an `else` with every
`then`, and the reference emits one only where an `else` is written.** So an entry naming the `else`
of `if (w.out.len > 0)` describes a point that does not exist under the reference — the line has only
its covered `then` there, and the entry reads as *listed as unreachable but was covered*.

The entries are right for the instrument that runs. What is gone is the ability to run the other one
without editing them, and that is the cost of ledgers keyed by `(file, line)` against two compilers
that instrument different sets — the fix this issue named for the *merge* applies to the entries too,
and neither is worth doing while the reference is a bootstrap seed (`design/lang/0003`) rather than a
compiler anyone measures with.

Written down rather than fixed, because "the reference's coverage run is red" now means "the ledgers
describe wacc", which is true and intended, and a future reader deserves to be told that rather than
to rediscover it as four failing packages.
