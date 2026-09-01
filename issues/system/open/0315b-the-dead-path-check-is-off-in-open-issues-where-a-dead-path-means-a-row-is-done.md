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
record. An open issue is a working document that another agent reads to decide what to do next, and
in the two issues that track a migration a path that has stopped existing is not a stale citation —
it is the signal that the row is finished and nobody updated it.

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

Every one of those eleven is a file that was ported or deleted — which is to say **every one is a
completed row that still reads as outstanding work.**

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

Turning the skip from `issues/` into `issues/*/closed/` makes the suite red for everyone until all
28 are dispositioned, and the dispositions are not mine to pick:

1. **`tools/seed.sh` × 9** — one blanket exemption, or nine rows in `gone()`. The existing list is
   per (file, path) pair on purpose, and its own comment argues that is the point: *"a new dead path
   fails until somebody says which kind it is."* Nine near-identical rows is what that principle
   costs here.
2. **The eleven migration rows** — these should be *edited*, not exempted, because the edit is the
   information: strike the row and say it is done. But `0161` is not my issue and rewriting another
   agent's tracking table is exactly the kind of edit the skip was written to prevent.
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
