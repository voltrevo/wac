# 0191 — issue numbers are a read-modify-write with three writers, and every collision reds master

- **Status:** closed
- **Closed by:** agent-a, 2026-08-24
- **Fixed in:** the suffix convention and the guard that understands it, both landed 2026-08-19 — see
  *"A second session, and the answer"* below
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** process
- **Symptom:** the shared suite goes red on a clash between two people filing at the same time

## Closed, and the evidence is that everybody uses it — 2026-08-24

The answer this issue reached is `0213a`: a one-letter suffix, per writer, needing no coordination
because two agents both taking "highest + 1" produce different identifiers. It has been in use since,
by all three of us — **53 suffixed issues** across the two trees today, `0230a` and `0230c` and `0241a`
and `0241b` and `0241c` among them, several of which are two agents filing about the same subject at
the same time and *not* colliding. That is the reproduction behaving: the pairs that would have been a
red master are now two files.

Canaried both ways on the day of closing, because a guard that stopped distinguishing them would bring
the failure back silently:

- a genuine duplicate is still caught — a second file numbered `0197` fails with
  *"issues/system: duplicate issue numbers: 0197: …, …"*;
- a suffixed neighbour is not — `0197z` beside `0197` fails only the *count* line, which is the
  ordinary bookkeeping check and not the uniqueness one.

**The open question at the end stays open and is not what this issue was about.** Whether the letter
should be the agent's — an issue belongs to the repository rather than its filer — is a naming taste
question; the mechanism needs only that the letter is per-writer-unique. Anybody who wants to change
what the letter means can, without reopening this.

Filing an issue means reading the directory, taking the highest number, and adding one. Three
agents do that concurrently against checkouts that are minutes apart, so two people who file
within one pull of each other pick the same number. `compiler/wacSpec.test.ts` checks uniqueness,
so the result is not a cosmetic clash — it is **master red for everybody** until somebody notices
and renumbers.

## The rate, measured rather than felt

One session, 2026-08-17:

| mine | collided with | became |
| --- | --- | --- |
| `system/0174` | the native-share test running out of subjects | 0176 |
| `lang/0147` | a `trap` message discarded by wacc | 0148 |
| `system/0180` | a coverage driver that cannot call a wac test | 0181 |
| `system/0181` | `Cli.exec` passing no environment | 0182 |
| `system/0182` | the same agent renumbering *into* 0182 beside me | 0190 |
| `system/0183` | mutation scoring and `deno test` | 0191 |

Six, and this issue collided on its own first number while describing the problem. The last three are the same issue colliding three times running — each time because I renumbered to the
next free number, which is precisely what the other agent was doing at the same moment. Two
renumbers can collide with each other; that is the part I did not expect and it is the strongest
argument here.

This pair is now at 0190 and 0191, taken well clear of the highest rather than adjacent to it,
which is a per-agent stride done once by hand.

Each costs a rename, an INDEX edit, a count fix, and whatever time passes before someone notices
master is red for a reason unrelated to their change. That last part is the expensive one: the
failure names two issue files and says nothing about who should move.

## A second session, and the answer — 2026-08-19

Four more, one of them twice:

| mine | collided with | became |
| --- | --- | --- |
| `system/0206` | an issue another agent *closed* while I was writing | 0207 |
| `system/0207` | another agent filing 0207 while I renumbered | 0208 |
| `system/0212` | the mutation recall floor, arriving in a 23-commit merge | 0213 |
| `system/0213` | two-host tests moved to wac — **the renumber collided too** | **0213a** |

The last row is the case this issue calls the strongest argument, happening again: a renumber
colliding with the number it renumbered into. It is also where the answer came from.

**The fix is a one-letter suffix — `0213a` for `agent-a`.** It needs *no coordination at all*: two
agents both take "highest + 1" and produce different identifiers. Compared with the three options
below, the sequence stays dense rather than gapped, a fourth agent needs no new stride to be agreed,
and nothing has to be pushed early. `0213a` above is the first one, filed exactly this way, against a
collision that had already happened twice.

**One place changed**, `compiler/wacSpec.test.ts`: the filename match, the heading match and the
`INDEX.md` row match were all `\d{4}`, and the duplicate check keys on that capture — so as written it
would have called `0213` and `0213a` a collision, which is the opposite of the point. All three take
`\d{4}[a-z]?` now and the key is the whole stem. Nothing else in the repository parses an issue
number; the other tools that read `issues/` handle whole paths. Canaried both ways: a genuine
duplicate is still caught, and `0208` beside `0208z` is not.

**Two costs, both real.** *"Issue 213" stops being unique in conversation*, so naming the issue before
its number has to become the rule rather than a habit. And *the numbering is mixed forever* — the
existing 163 lang and 220 system issues keep bare numbers — which is a reader seeing two shapes, not
a correctness problem, since the old ones are already unique.

**One question left open on purpose:** the suffix puts *who filed it* into the permanent identifier,
and an issue belongs to the repository rather than to its filer — `Reported by:` already records
that. The mechanism only needs the letter to be per-writer-unique, so it does not have to be the
agent's if that reads wrong to somebody.

### And a related failure this turned up

A collision conflicts `INDEX.md` too, since both sides add a row and both rewrite the count line. I
had scripted the resolution as *union the rows keyed by issue number* — correct for two agents
editing different rows, and **it drops one when the collision is genuine**, which is the case it most
needs to survive. That is how another agent's `0212` row vanished from the index.

The guard *does* catch a missing row — I first wrote here that nothing would have, and that was
wrong. It was masked: the duplicate-number check throws first, so the row check never ran. Fixing the
number revealed it, which is the ordinary way a second fault surfaces behind a first.

## What would actually stop it

The numbers are useful — they are how everything here cross-references — so the answer is not to
drop them. Three that would work, in increasing order of how much convention they change:

- **A per-agent stride.** `agent-a` files 0184, 0187, 0190…, `agent-b` 0185, 0188… Collisions become
  impossible without any coordination, the sequence stays readable, and the cost is gaps. It also
  needs each agent to know its own name, which `tools/suiteGate.ts`'s `agentName()` already derives
  from the workspace path.
- **Allocate by pushing first.** Create the file with the number, push it immediately, and only
  then write the contents. Turns the race into a fast-forward rejection that git already reports.
  Costs a push per issue and a moment where an empty issue is on master.
- **A `deno task issue:new` that fetches first.** Narrows the window to seconds without closing it.
  Cheapest, and it does not fix the case above where two agents file in the same minute.

The first of those removes the failure mode rather than shrinking it, but at the cost of gaps and a
stride every agent has to know and re-agree when a fourth appears. **The suffix above removes it with
none of that**, which is why it is the one taken — see the 2026-08-19 section. The three below are
kept because each was a reasonable answer and the argument against each is the reason the suffix
wins.

**Not this:** relaxing the uniqueness check. Two files claiming one number is a real problem — the
references between issues stop meaning one thing — and a check that tolerated it would hide the
duplication instead of the pain.
