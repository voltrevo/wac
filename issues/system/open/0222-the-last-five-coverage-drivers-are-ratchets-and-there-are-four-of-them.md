# 0222 — the last five coverage drivers are exemption ratchets, and the ratchet is written four times

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** task
- **Symptom:** not implemented

Fourteen `cov.ts` drivers have moved to wac (`issues/system/0161`) and every number is preserved or
better. The six that remain are not more of the same work. Five are **ratchets** — a coverage run plus
a ledger of reasoned exemptions that fails when the ledger goes stale — and the sixth belongs to
another agent.

| package | lines | pins | ledger machinery |
|---|---:|---:|---|
| `crypto` | 1,101 | 28 | snippet staleness, `Deno.exit(1)` |
| `zstd` | 1,022 | 8 | `NOT_COVERED`, snippet staleness, `Deno.exit(1)` |
| `ssh` | 794 | 0 | **none** — no staleness check at all |
| `gzip` | 605 | 3 | snippet staleness, `Deno.exit(1)` |
| `fs` | 582 | 33 | `NOT_COVERED` *and* `CATEGORIES`, snippet staleness, `Deno.exit(1)` |
| `sh` | 473 | — | another agent's package |

**The ratchet is four separate implementations of one idea**, and `ssh` is a fifth position: it has no
ratchet, so nothing there notices when an exemption stops being true. `fs` is the most developed — it
has category rules matched against the *enclosing declaration* of an uncovered point, with a
deliberately crude "opens a block" heuristic and a comment explaining why it is one level in rather
than at column 0 — and none of that is available to the other four.

## Why this is a decision and not a port

`fs` is 582 lines of which **372 are data** (the pins and the category rules) and about 210 are
machinery. That ratio is the argument: port the machinery once and each package supplies only its
pins. The pins are prose about that package's own code and belong in that package; the walk that
checks them does not.

But it is a decision, because it changes behaviour in four packages at once — each currently ratchets
its own way, `ssh` does not ratchet at all, and a shared implementation has to pick one answer for
"what counts as accounted for". Getting that wrong makes `deno task coverage:all` red for everyone,
which is the case `CLAUDE.md` says to file rather than to guess at.

## The shape that seems right

`tools/wac/covreport.wac` is already the shared half of the *reporting* — twelve packages' exercises
call it and it produces the missed points. The ledger is the same story one layer up:

- a shared module with the pin and category types, the staleness walk, and the accounted/unaccounted
  split. wac can do the source scanning: `packages/regex` exists, and `covreport` already reads and
  splits files;
- each package keeps a small wac program holding **its own pins as wac data** — structs in the
  package, not a frozen fixture — which is where the reasoning belongs;
- `ssh` gains a ratchet by joining, which is most of the value: nothing there currently notices a
  stale exemption.

## Both open questions have an answer already written in the tree — 2026-08-20

I filed this saying two things had to be settled. Reading the five ledgers rather than counting them,
both are already decided somewhere, and the strongest statement is `packages/gzip/cov.ts`'s:

> Named rather than tolerated as a percentage below 100: a report that sits at 99.6% forever teaches
> everyone to ignore the last line, and then a genuinely new gap arrives and looks like the one that
> was always there. **Anything not listed here is expected to be covered and the run fails if it is
> not — and anything listed that *does* get covered fails too, since the reason has stopped holding.**

That is a **two-way ratchet** and it is the answer to question 1, not `fs`'s. `fs`'s category rules are
a *softening* — a way to speak for a group of points without naming each — which is a reasonable
convenience and a weaker guarantee. Generalise gzip's contract; keep categories, if at all, as sugar
over it rather than as the definition.

Question 2 answers itself the same way: a stale pin has to fail, because the point of the snippet is
that a line number alone is fragile. gzip says why, from experience — *"this list started out pointing
at line 306 and the comment explaining why moved the code to 322"*.

**And there is a third constraint I had not noticed: the output phrasing is an API.**
`tools/coverageAll.ts:168` matches on

    /no longer holds|is listed as unreached but was covered|branch point\(s\) uncovered|^error/

and line 153 decides whether a package "holds a coverage floor" by whether its output says
`branch point(s) uncovered`. So a shared ledger has to emit those exact strings, and the twenty-producer
convention `0161` mentions is narrower than it sounds: three phrases and a leading `error`.

## What is left to decide is therefore only the shape

The contract is settled; where the code lives is not. `covreport.wac` computes the missed set already,
so either it grows an optional pins input, or it splits into a library the per-package ledger programs
import. The second is better — a package's ledger wants to *be* a wac program holding its own pins as
data — but it means refactoring a file twelve packages now depend on, which is the part worth doing
deliberately.

Suggested order: extract the library, port **`gzip`** first because its ledger is three pins and its
contract is the one being generalised, and let the remaining four follow the template. `ssh` last,
since it has never had a ratchet and is the one most likely to go red.

## Notes

Nothing here blocks anything. The fourteen converted packages are all green and
`deno task coverage:all` is 21/21; these five keep working exactly as they did. The cost of leaving it
is that five packages' coverage stays on Deno and one of them has an unchecked ledger.

Measured while porting the fourteen: `packages/bytes` gained **nineteen** branches purely because the
wac exercise derives its trap-probe names from the file instead of listing seven by hand, and
`packages/fmt` gained three because its second entry point turned out to cover none of what it existed
for. A ledger nobody re-derives drifts the same way a probe list does.
