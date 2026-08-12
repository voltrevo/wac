# 0112 — wacc's coverage instrumentation emits no `case` and no ternary points, so switching to it measures 439 fewer decisions in `packages/fs` alone

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
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
| `crypto` | 14 entries "listed as unreached but was covered" | not yet diagnosed; the same question applies — covered, or no longer instrumented? |
| `gzip` | 2 reachable uncovered | not yet diagnosed |

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

## What would fix it

Emit the two missing kinds from wacc's instrumenting emitter, with the same `file`/`line`/`kind`
shape `covTableFiles` already writes for `then` and `loop`. Ternaries are the easier of the two.
`match` arms are the one that matters more, because a `match` is how this codebase spells a
closed set of cases and an unreached arm is a case nobody tested.

A test that would have caught this, and which should land with the fix: instrument one file with
each compiler and assert the *kinds* present are the same set. Counts may differ — the `else`
convention is a deliberate disagreement — but a kind the reference emits and wacc does not is a
construct that stopped being measured.
