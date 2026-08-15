# Development

Everything except the website is Deno and Rust; the website is the one npm subtree.

```sh
deno task test                    # the suite — four to eleven minutes, see below
deno task test packages/json      # one subtree, same concurrency cap
deno task test:heavy              # the ten files a whole-suite run skips, see below
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

**A third declaration takes a file out of the whole-suite run entirely.** Ten files declare
`// test-lane: heavy`, and `deno task test` skips them — they are 4m24s of work on their own, and each
holds around a gigabyte, against a suite that already peaks at 7.5 GB on a machine with 11.9. The run
prints how many it skipped and when the lane last passed, because a saving nobody is told about is
indistinguishable from a suite that quietly stopped testing something.

They still run in three cases: `deno task test:heavy`, `deno task test <path>` naming one (so
`test:changed` covers a heavy file whenever its package changed), and `WAC_HEAVY=1 deno task test`
for one command that runs everything.

**Heavy means resident, not slow.** The two look alike in a log and come apart under measurement:
`packages/webrtc/test/dtlsserver.test.ts` takes 58 seconds and was fourth on a duration ranking, but
sampling its process tree gives 370 MB and 2.1 CPU-seconds — 0.04 of a core, spent waiting on DTLS
retransmission timers. It costs a worker *slot*, not the memory that actually bounds this suite, so it
stays in. Sample before adding a file rather than reading the durations off a suite log.

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
- **`packages/webrtc` needs three, and none is in the base image**: a STUN/TURN server, a WebRTC
  implementation to answer ours, and Chromium for the SDP a real browser writes.

      sudo apt-get install -y coturn
      pip install --break-system-packages aiortc
      mkdir -p ~/pw && cd ~/pw && npm install playwright     # Chromium is already cached

  These **fail** rather than skip when absent, deliberately: neither runtime has any WebRTC —
  `RTCPeerConnection` is `undefined` in Deno and in Node — so without them that package has no oracle
  at all and every test in it would be comparing our encoder against our decoder. A green
  `packages/webrtc` that never started coturn would be the most misleading result in the repository.
  Two things about driving a browser's WebRTC, both of which cost time: **a page with no media
  permission is shown no local network interfaces**, so ICE gathers nothing and it looks like a
  container without a network — a successful `getUserMedia` with `--use-fake-device-for-media-stream`
  is the fix. And the test scripts run from `~/pw` because `NODE_PATH` does not apply to ESM
  `import`, so a script elsewhere fails with "Cannot find package 'playwright'" however the
  environment is set. See `design/system/0008`.

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

**Its own retry is the one exception, and it is narrow.** `push.sh` runs the suite, pushes, and on a
lost race merges and runs again — six minutes later by construction, which the twenty-minute rule
refused, so losing a race meant not being able to push at all. Attempts 2 and 3 set
`WAC_SUITE_RETRY=1`, which skips *only* the cooldown: a retry still waits for the lock and still
respects memory and load, because overlapping suites are what the kills come from.

**And the gate pushes the revision it tested.** The clean-tree check runs once, at the start; a
commit made during the five to eleven minutes that follow used to be carried by the push, so the
gate reported a pass for a commit the suite never saw. It pushes that captured revision now, and
says so when HEAD has moved:

    == pushed 74556d9b — HEAD moved during the suite, so
       2 later commit(s) wait for the next run ==

`tools/push.sh` is refused like anything else — it does not wait. What to do when the machine is busy
is yours to decide: keep working locally, come back later, or override with a reason. A script that
queues quietly for ninety minutes takes that decision away and looks like a hang while it does.

**A full run sweeps `/tmp/wac-*` older than a day** before it starts, and says what it removed and
what it could not. 2,300 of those accumulated by 2026-08-11 and filled the disk, which failed three
pushes that evening (`issues/system/0136`); the ones that survive a sweep are directories a test
fixtured to be unremovable, and the sweep widens permissions before giving up on them.

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
