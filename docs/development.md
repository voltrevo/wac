# Development

Everything except the website is Deno and Rust; the website is the one npm subtree.

```sh
deno task test                    # the suite — four to eleven minutes, see below
deno task test packages/json      # one subtree, same concurrency cap
deno task map --check             # MAP.md is generated; staleness is a failure
```

**How long it takes depends on what else is running**, which matters here because several agents
share one container. Sixty-four gate runs on 2026-08-11: **236s fastest, 378s median, 683s slowest**
— a mean of 345s at load below 5 and 476s at load 8 or more. So a run that takes eleven minutes is
usually a busy machine rather than a broken suite, and the gate prints the load average beside its
own time for exactly that reason.

The suite runs in two lanes: a parallel pass capped at four workers, then the files that declare
`// test-lane: exclusive` run alone, because they want a real port or a real external binary. The cap
is measured rather than guessed — see the table in [`tools/runTests.ts`](../tools/runTests.ts).

## The website

```sh
cd site
npm ci
npm run dev                       # dev server
npm run build                     # production build
./node_modules/.bin/tsc -b        # the checker that agrees with the bundler
```

```sh
deno test -A --unstable-sloppy-imports --no-check site/tools/site.test.ts
deno run -A site/tools/syncMap.ts # refresh the derived figures in site/src/data
```

`site/src` is a vite project whose extensionless imports Deno's resolver refuses, which is why those
two flags exist and why `site/` is excluded from the repo-wide Deno walks.

## Tests that need something installed

Some tests skip themselves rather than fail when a tool is absent, and **say so on standard error**,
because a silent skip reads as coverage.

- The live browser tests need Chromium:
  `mkdir -p ~/pw && cd ~/pw && npm install playwright && ./node_modules/.bin/playwright install chromium`.
  They also need `deno test -A` specifically — `deno task test` withholds `--allow-sys`, so under the
  gate they are the one ignored file.
- The differential suites need the real tools they compare against: `bash`, GNU coreutils, `grep`,
  OpenSSH, and a C `tor` for the two-way Tor tests.

## Before pushing

**The suite refuses to start on a busy machine, or twice in twenty minutes.** Three agents share
five cores, 11.9 GB and 4 GB of swap; a suite peaks over 3 GB, so two at once is tight and three get
killed at about 70% having reported no failure at all. `deno task test` checks first and says what to
run instead — `tools/suiteGate.ts` holds the thresholds and the reasoning:

    another agent is running one     a lock in /tmp, released when their pid dies
    the machine cannot take it       under 3 GB available, or load over 8
    you ran one under 20m ago        per agent, from the workspace path

A **targeted** run is not gated and never will be: `deno test -A packages/git/test/` is the
encouraged thing and stays instant. `WAC_SUITE_ANYWAY=1` goes through and records that it did.

`tools/push.sh` is refused like anything else — it does not wait. What to do when the machine is busy
is yours to decide: keep working locally, come back later, or override with a reason. A script that
queues quietly for ninety minutes takes that decision away and looks like a hang while it does.

**A docs-only change does not need the suite.** Documents are changed optimistically here: the checks
over them — links, README figures, design-document counts, `MAP.md`, README signatures, the front
page's transcript — **warn and do not fail**. A broken link stopping everybody's push costs far more
than the link does, and the suite is four to eleven minutes on a machine three agents share.

    deno task docs      the same checks, strict, when you want them to fail

A run prints how many doc warnings it produced in its footer, so they are not lost eight hundred
lines above where you are looking when it finishes. The risk in this trade is real and worth naming:
a warning nobody reads is the same as no check, which is why there is a strict mode and a footer
rather than only a shrug.


`bash tools/push.sh` is the gate: it refuses a dirty tree, runs the whole suite, merges whatever
arrived while it ran, and pushes. Run it **detached** — `setsid nohup bash tools/push.sh &` — because
a foreground run dies with the shell that started it, and do not edit the tree while it is running:
it builds from the working directory rather than from a snapshot, so an edit half-way through fails
the run.

**A push can be rejected after a green suite**, and on a busy day it can happen three times in a row —
that is what "still being beaten to the push after three tries" means. The suite takes minutes and
another agent's push takes none, so the race is lost in the gap between the last test and the push.
Nothing is wrong when this happens: pull, and run it again.

Work on the primary branch and push only complete changes. A rejected push means somebody got there
first: pull, merge, check the result still holds together, and push again. Never force-push — the
bare repos reject non-fast-forwards, so an attempt fails loudly rather than quietly discarding
somebody else's commits.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) before touching `compiler/`.
