# 0191 — issue numbers are a read-modify-write with three writers, and every collision reds master

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** process
- **Symptom:** the shared suite goes red on a clash between two people filing at the same time

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

The first is the one that removes the failure mode rather than shrinking it. It is a convention
change across two trees and everybody's habits, which is why this is filed rather than done.

**Not this:** relaxing the uniqueness check. Two files claiming one number is a real problem — the
references between issues stop meaning one thing — and a check that tolerated it would hide the
duplication instead of the pain.
