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

Two things to settle before writing it:

1. **What "accounted for" means**, given four current answers. `fs`'s is the strictest (pins *plus*
   category rules, and leftovers are named rather than counted).
2. **Whether a stale pin fails the run**, which four of the five do with `Deno.exit(1)` and `ssh` does
   not. If the shared one fails, `ssh` acquires a way to go red that it has never had, and its
   exemptions have never been checked — so the first run may well be red, and that is the point of
   doing it rather than a reason not to.

## Notes

Nothing here blocks anything. The fourteen converted packages are all green and
`deno task coverage:all` is 21/21; these five keep working exactly as they did. The cost of leaving it
is that five packages' coverage stays on Deno and one of them has an unchecked ledger.

Measured while porting the fourteen: `packages/bytes` gained **nineteen** branches purely because the
wac exercise derives its trap-probe names from the file instead of listing seven by hand, and
`packages/fmt` gained three because its second entry point turned out to cover none of what it existed
for. A ledger nobody re-derives drifts the same way a probe list does.
