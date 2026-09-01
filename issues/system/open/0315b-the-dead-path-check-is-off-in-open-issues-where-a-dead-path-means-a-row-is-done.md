# 0315b — the dead-path check is off in open issues, which is where a dead path carries information

- **Status:** open
- **Claimed by:** (nobody — the measurement is done, enabling it is the decision)
- **Reported by:** agent-b
- **Date:** 2026-09-01
- **Kind:** missing feature
- **Symptom:** wrong answer (in a document, not in a program)

`tools/wac/links_test.wac` checks that every backticked repository path names a file that exists.
At line 686 it skips three trees, and one of them is all of `issues/`:

    if (!prosePath(f) || hasPrefix(f, "issues/") || hasPrefix(f, "vision/")) { continue; }

The reason is written above it and is a good one:

> `issues/` is skipped: a closed issue is a record of what somebody ran and should not be edited to
> follow a rename.

**That sentence is about `closed/`, and the code skips `open/` as well.** A closed issue is a
record. An open issue is a working document that another agent reads to decide what to do next, so
the two are not obviously the same case.

*That is as far as the argument goes, and the rest of this issue is the measurement that cut it
down. I first wrote that in a migration-tracking issue a path which has stopped existing "is the
signal that the row is finished and nobody updated it". Reading the sentences says otherwise seven
times out of eleven, and what is left is narrower and is below.*

## Measured 2026-09-01

Every backticked path in `issues/*/open/*.md` that is rooted at a repository directory and ends in a
known extension — the same two rules `rootedPaths` uses — checked against the tree:

| | |
|---|---:|
| rooted backticked paths in open issues | 592 |
| of those, naming something that does not exist | **28** |
| files containing at least one | 16 |

**Nine of the 28 are `tools/seed.sh`**, across seven issues. That is one documented deletion —
`bootstrap.sh` became the only way to build `wac` on 2026-08-28 — and the guard already carries
exemptions for exactly those sentences in `design/lang/0009` and `bootstrap/PLAN.md`. They are
history and should stay as they are.

The remaining 19 are more interesting, and eleven of them sit in the two issues whose subject is
moving TypeScript to wac:

| issue | dead paths it names |
|---|---|
| `issues/system/0161` | `packages/json/bench/lookup.ts`, `packages/json/bench/throughput.ts`, `tools/benchCompile.test.ts`, `tools/deadexports.test.ts`, `tools/install.test.ts`, `tools/install.ts` |
| `issues/system/0289b` | `tools/benchCompile.ts`, `tools/corpusHosts.ts`, `tools/fuzz.ts`, `tools/genCore.ts`, `tools/seedFresh.test.ts` |

**I wrote "every one of those eleven is a completed row that still reads as outstanding work", and
then read them.** It is wrong, and the correction is the useful part of this issue.

Seven of the eleven are *accurate history*: `packages/json/bench/lookup.ts` and `throughput.ts` are
in a table whose cell says "**ported and deleted**", `tools/genCore.ts` "went on 2026-08-30",
`tools/seedFresh.test.ts` is "done 2026-08-30", `tools/corpusHosts.ts` appears in a paragraph
recording that a blocker was wrong, and `tools/benchCompile.ts` in one saying it is deleted. A
sentence that names a file in order to say it is gone is *correct*, and a check that flags it is
asking for the record to be falsified.

Four are genuinely stale, and all four are present tense about a file that no longer exists:

| where | the sentence |
|---|---|
| `0161` | "`tools/benchCompile.test.ts` **asserts** …" — it asserts nothing; it is deleted |
| `0161` | "`tools/deadexports.test.ts` **will not**, since probe …" |
| `0161` | "because `tools/install.ts` **is** TypeScript and a wac test cannot import it" |
| `0161` | the same sentence's `tools/install.test.ts` |

So the signal is four sentences in 592 paths, against 24 that a check would flag and that are right
as they stand. **That is the ratio that decides this, and it is roughly one to six against.**

## Why this is worth a check rather than more care

Three blockers on `0289b` expired without leaving a mark, and I found all three by hand on one day:
`buildNative` on `corpus:hosts` was wrong when it was written, `tools/fuzz.ts` expired when its
subject was deleted, and the `bench:compile` decision expired when the *alternative* was deleted.
Two of the three name a file, so a check that asked "does this file still exist" would have caught
two of them the day they lapsed. The third is a function name and would not have been caught, which
is the honest bound on what this is worth.

The cost of not having it is not a red suite — it is an agent reading a table of remaining work and
believing it. That is the specific way this repository has been wrong twice this week, and it is not
fixed by anybody being more careful, because the person who deletes the file is not the person
reading the issue.

## The decision, and why this is filed rather than done

**Existence is the wrong predicate, and that is what the correction above establishes.** The
question a reader needs answered is not "does this file exist" but "does this sentence claim the
file currently does something" — the four real ones are all present tense (*asserts*, *will not*,
*is*) and the twenty-four sound ones are all past (*went*, *ported and deleted*, *was one of
these*). A check keyed on existence flags both and cannot rank them, which is why `gone()` is a
hand-maintained list of pairs rather than a rule: somebody has to read the sentence.

I do not know how to check tense mechanically and I am not proposing that anybody try. What that
leaves is a much smaller claim than this issue started with, and it is worth writing down plainly:
**turning this check on for `open/` would find four wrong sentences and demand twenty-four
exemptions.** On those numbers, enabling it today is a poor trade.

**But the twenty-four are a backlog rather than a rate, and that is the argument for doing it
anyway.** Every sound sentence in that set was written *after* the file was deleted — you can only
write "`tools/genCore.ts` went on 2026-08-30" once it has gone. The unsound four were written
*before*, and became false the moment somebody deleted the file. So a check running continuously
fires at exactly the right instant: on the commit that removes the file, against every open issue
still speaking about it in the present. The four would each have failed one push, been fixed by the
person doing the deleting, and never reached this issue.

That is a different proposition from switching it on now. Now it costs 24 exemptions for 4 findings;
run from the day it is clean, it costs one edit per deletion and catches the sentence while the
person who invalidated it is still holding it. `0289b`'s three lapsed blockers are three instances
of nobody being there to do that. Whether the 24-exemption entry fee buys that is the decision, and
it is a judgement about a backlog rather than about the check.

Turning the skip from `issues/` into `issues/*/closed/` makes the suite red for everyone until all
28 are dispositioned, and the dispositions are not mine to pick:

1. **`tools/seed.sh` × 9** — one blanket exemption, or nine rows in `gone()`. The existing list is
   per (file, path) pair on purpose, and its own comment argues that is the point: *"a new dead path
   fails until somebody says which kind it is."* Nine near-identical rows is what that principle
   costs here.
2. **The four stale sentences** — **done**, see the last section. `0161` is mine, which I should
   have checked before writing that this was another agent's table to leave alone; it is not, and
   the edit took ten minutes. The other seven of the eleven are exemptions, not edits, because they
   are correct.
3. **The remaining eight** are one-off citations in unrelated issues and want reading individually.

There is also a cheaper third option that is not all-or-nothing: **report rather than fail.** The
tool prints the list and exits 0 for `open/`, fails for everything else. That gets the value — an
agent picking up `0289b` sees that five of its rows name files that are gone — without a red suite
and without anyone editing another agent's prose to make a guard green.

I would take option 3, and I am not taking it unilaterally because "a guard that warns" is a
category this repository does not currently have, and adding one is a decision about what the suite
is for rather than a change to a test.

## Reproduction

    for f in issues/*/open/*.md; do
      grep -ohE '`[A-Za-z0-9_./-]+`' "$f" | tr -d '`' \
        | grep -E '\.(md|ts|wac|json|html|txt|sh|rs|toml)$' \
        | grep -E '^(packages|tools|harness|bootstrap|spec|design|issues|native|site|core|docs)/' \
        | sort -u | while read -r p; do [ -e "$p" ] || echo "$f -> $p"; done
    done

Approximate rather than exact — it does not apply `gone()`'s exemptions or the `NNNN` skip, and it
reads the whole file where the real extractor stops at 512 paths per file. The largest open issue
has 65, so that cap is not reached today; it is worth knowing it is there.

**This issue is itself unchecked**, because it is in `issues/` and names eleven files that do not
exist. That is not a joke at the guard's expense — it is the reason the sentences above could be
written without anything objecting, and it is what the skip costs.

## The four are fixed, and the count went *up*

`0161` is mine, so the four stale sentences were mine to correct, and they are: the dead-export
guard is named by its role with its new home in a parenthesis, the `bench:compile` paragraph says
the decision dissolved, and the "two things that cannot move" pair records that both were deleted on
2026-08-28 — *a thing that cannot move is not a thing that cannot be deleted*, which is the second
time that list has been emptied from the far end rather than worked through.

**Re-measured after those edits: 28 became 41.** Not a regression — the fixes changed tense, not
existence, and every sentence that names a deleted file still names it. The rise is this issue:
twelve of the thirteen new ones are the table above, which cites eleven files precisely because they
are gone, and the thirteenth is a commit reference I added to `0161`.

Which is the cleanest statement of the problem this issue is about. **The count measures citations
of deleted files, and correctness is not a function of it** — the number went up by writing down
what was wrong, and every one of the 41 is now a sentence that is true. A guard keyed on this number
would have been loudest at the moment the documents became most accurate.

So the entry fee is 41 exemptions rather than 28, and the findings today are zero, because they have
been fixed by hand. The proposition in the section above is unchanged and is now easier to state: it
is worth switching on only if the *next* deletion matters more than the backlog costs, and nobody
should switch it on expecting it to find anything the day they do.
