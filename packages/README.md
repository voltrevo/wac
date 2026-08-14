# packages

Programs and libraries written in [wac](../spec/), the C-family language for WebAssembly GC that
lives in this same repository — which is what lets a package import another and the compiler be
changed by whoever needs it changed.

Deliberately separate from the wac repo: that one is the language and its
compiler, this one is things built with it.

## The map

**[MAP.md](../MAP.md)** is the bird's-eye view: every package with its size, its tests and what
it builds on, and every program and page you can build, each with a line on what it does. It
is generated from the tree by `deno task map` and checked by the suite, so it cannot drift.

Today, give or take whatever landed this morning: **37 packages, 112,234 lines of wac, 1,980
tests written in wac, 66 command-line programs and 9 browser pages.** Those are MAP.md's own
figures, copied on 2026-08-14 — the previous set said 32 packages and ~1,300 tests, which was
not "give or take this morning" but a repository two thirds this size. MAP.md has them live, and the
suite checks its *structure* — packages, dependencies, programs — rather than its counts, since
three agents share this repo and a guard that fails on somebody else's new test is a guard
everyone learns to ignore.

## What is actually in here

The libraries are the boring half and the reason the rest exists — `bytes`, `std`, `fmt`,
`unicode`, `codec`, `json`, `url`, `regex`, `datetime`, `http`, `bignum`. Each is checked
against something outside itself: JSON against the host's own parser, `fmt` over 500k doubles
in both directions, `url` against WHATWG's test suite, `bignum` against `BigInt`.

What they add up to is more interesting:

**`box` — a busybox.** 65 applets in one program, chosen by the first argument, each
differential-tested against the real tool where one exists. `cat`, `grep`, `sort`, `gzip`,
`sha256sum`, `tar`, `diff`, `httpd`, `nc`. It streams: 300MB through `wc` peaks at 94MB of RSS.

```sh
deno task app:build packages/box/src/box.wac --allow-read --allow-write --allow-net -o box
./box tar somedir | ./box gzip > out.tgz     # and GNU tar extracts it
```

**`sh` — a shell**, checked against GNU bash script for script: quoting, expansion, command
substitution, arithmetic, pipelines, redirection, `if`/`while`/`for`/`case`, functions,
subshells, globbing.

**`ssh` — both ends.** `ssh` runs commands on a real OpenSSH server; `sshd` serves OpenSSH's
own client, hosting the shell above. Curve25519, Ed25519, chacha20-poly1305, `known_hosts`,
encrypted private keys.

**`tls` — TLS 1.3**, interoperating with OpenSSL and rustls. **`tor`** is a Tor client on top
of it, with a SOCKS5 proxy, and by now the other side too: a relay, a directory authority, and
a launcher that stands a whole network up with no C tor in it. It reaches onion services.
**It should not be pointed at the real Tor network** — it is unaudited, nothing under it is
constant-time, and `packages/tor/README.md` enumerates the anonymity properties it does not
have yet.
**`crypto`** is what they stand on: SHA-2, SHA-3, keccak256, HMAC, HKDF, AES-GCM,
ChaCha20-Poly1305, X25519, Ed25519, P-256, P-384, RSA verification, ML-KEM-768 — all in wac,
all against published vectors.

**`gzip` and `zstd`** compress at or under the reference tools. **`wacc`** is the wac compiler
being ported to wac, so it can eventually compile itself.

**Ethereum, checked rather than trusted.** `bls` verifies BLS12-381 signatures against
Ethereum's own fixtures, `ssz` is its serialization and Merkle proofs, and `lightclient` runs
the Altair sync protocol through all four of Ethereum's `light_client/sync` cases. On top of
those, the execution side: `rlp`, `abi`, `ens`, and `mpt` — Merkle-Patricia proofs, which is
what turns "a provider told me" into "the state root I already verified commits to this". See
[design/0003](../design/system/0003-an-ethereum-centric-reference-distribution.md) for where that is going.

**`fs` — a filesystem that belongs to the program**, in memory or mounted on the host's, so a
session can be sealed off from the machine that started it.

**`platform` — a capability world**, and the reason a wac program can be an *application*
rather than a library. Two structs say everything a program may do, because wac has no ambient
access and there is nowhere else to reach. Files, sockets, spawning other wac programs with
grants narrower than your own, deadlines, and a browser target.

## In a browser

The same compiled wac runs in a page: a worker for the program, the page's own thread for the
capabilities, and `SharedArrayBuffer` between them.

```sh
deno task app:build packages/box/example/term.wac --target browser --allow-read --allow-write -o page/index.html
./box httpd -8080 page -x        # -x sends the two isolation headers a page needs
```

That one is **`packages/sh` in a browser tab** — pipelines, loops, redirection into a
filesystem that survives a reload — with the shell unchanged. `box/example/hash.wac` hashes and
compresses as you type, with `crypto` and `gzip` unchanged. `platform/example/pixels.wac` is a
Mandelbrot set recomputed on every zoom, with the escape count under the pointer and a dropped
file handed straight back.

## Layout

```
deno.json          import map + tasks; the only config
MAP.md             generated: every package, program and page — `deno task map`
harness/           TypeScript for driving the compiler
  wacFiles.ts        read an entry file and its transitive imports
  wacBind.ts         compile -> bindgen -> importable JS module
  wacTestRun.ts      run wac-written tests as Deno tests
  wacCoverage.ts     instrument an entry point and report branch coverage
tools/             check.ts, validate.ts, coverage.ts, mutate.ts, map.ts, push.sh
design/            directions too big to be issues, one numbered document each; see design/README.md
issues/            bug reports and cross-cutting tasks; see issues/README.md
packages/<name>/
  src/               wac source
  src/bin/           optional: applets built as standalone programs
  example/           optional: runnable programs and browser pages
  test/              host-side tests (.test.ts)
  test/wac/          tests written in wac (*_test.wac)
  cov.ts             optional: drives this package's branch coverage
```

`deno.json` maps `wac/` to `./compiler/`. It mapped it to a *sibling checkout* until
2026-08-09, when the two repositories became one — see [MERGE.md](../MERGE.md) if a
document or a comment still tells you to clone two things next to each other.

## Cross-package imports

A package reaches a sibling by relative path:

```wac
import { T } from "../../../wactest/src/assert.wac";
```

There is no module-alias mechanism in the language yet, so this is what it looks
like. Keeping the tree at `packages/<name>/src` bounds the depth. One import is
*not* a path — `import { Read } from core;` names the module the compiler ships —
and a prefix that maps to a directory is the next step of wac's
`design/0001` — which had [issue 0092](../issues/system/closed/0092-the-capability-layer-should-be-its-own-repo.md)
waiting on it until 2026-08-11, when the capability layer stopped being destined for a repo of its
own. Nothing in this tree waits on it now; the caller left is a package service outside it.

## Commands

Everything runs from the repo root, so one command covers every package.

```sh
deno task test            # all tests, host-side and wac-written (4-11 min; see below)
deno task test:changed    # ...only the packages you have touched, for the loop before that
deno task check           # type-check every .ts, including the drivers no test imports (~1s)
deno task app <entry.wac> --allow-read -- args   # run a wac application
deno task app:build <entry.wac> --allow-read -o wc   # ...or build one JavaScript file; ./wc needs Deno
deno task app:binary <entry.wac> --allow-read -o wc  # ...or a standalone executable, runtime inside
deno task app:build <entry.wac> --target node -o wc  # ...for Node instead of Deno
deno task app:build <entry.wac> --target browser -o page/index.html  # ...or a browser page
deno task app:build <entry.wac> --worker -o child.worker.js  # ...or something `spawn` can run
deno task map             # regenerate MAP.md; the suite fails if it is stale
deno task coverage        # branch coverage of every package, from its wac-native tests
deno task coverage:bignum # ...and the host-driven exercises, per package
deno task coverage:bytes
deno task coverage:codec
deno task coverage:crypto
deno task coverage:datetime
deno task coverage:fmt
deno task coverage:fs
deno task coverage:gzip
deno task coverage:http
deno task coverage:json
deno task coverage:regex
deno task coverage:server
deno task coverage:sh
deno task coverage:ssh
deno task coverage:std
deno task coverage:stream
deno task coverage:unicode
deno task coverage:url
deno task coverage:zstd
deno task coverage:all    # every one of them in turn, and says which are red
                          # (2026-08-12: crypto only, 57 points — issue 0101)
deno task mutate          # mutation testing, curated defects
deno task mutate:operators # ...plus generated ones (removed guards, gutted functions)
deno task mutate:diff     # ...only for .wac files changed against origin/master
deno task bench           # gzip throughput
deno task bench:json      # json throughput, by document shape
deno task bench:json-lookup # json object lookup: scan vs hash index, and index build cost
deno task verify:fmt      # fmt exactness over 500k doubles, both directions

deno run --allow-read tools/check.ts <entry.wac>    # type-check one file, no run
deno run -A tools/validate.ts <entry.wac>          # ...and check the wasm validates
tools/push.sh             # run the suite, then push only if it passed
```

`deno task test` skips one test: the browser target running in an actual browser, which needs
Chromium installed and `deno test -A`. `packages/platform/test/browser_live.test.ts` says how
in three commands, and skips in milliseconds without them.

### What the suite costs, and where

**3,114 tests in the parallel pass and 61 in the exclusive lane**, and the wall-clock depends on
what else is running: 236s fastest, 378s median, 683s slowest over sixty-four gate runs on
2026-08-11 — a mean of 345s below load 5 and 476s at load 8 or more.
[`docs/development.md`](../docs/development.md) has that distribution and keeps it; this page
states the counts and points there, because two documents with two single-run stopwatch figures is
how a reader learns to trust neither.

The figure before this one was ~50 seconds for 910 tests, and it stood while the suite grew to
three and a half times that. One
file at a time in its own process is 6.5 minutes, and most of that is a hundred and forty deno
startups; the heaviest single files are `packages/box` (25s, three hundred subprocesses comparing
applets against the GNU tools) and `packages/regex` (17s, differential fuzzing against `RegExp`).
Nothing hangs and nothing is pathological — it is a lot of tests, most of them differential against
something real.

If a run takes *many* multiples of that, the cause is almost certainly *load* rather than the suite: several
agents share this machine, and five cores between three of them turns fifty seconds into whatever
you like. `nproc` and `/proc/loadavg` answer that question before a bisect does.

**Builds are cached by content** in `.cache/`, which is what took the suite's CPU down by a sixth and
`packages/box` from 38 seconds to 26. A wac program compiled with a given compiler, or bundled into an
application with given grants, is produced once and then copied: the key is a SHA-256 over every
reachable `.wac` file, every `.ts` file of the compiler, the harness, `packages/platform`'s host, the
Deno version and the build's arguments — never a timestamp, because `git checkout` of an older file is
a new input with an older mtime. `harness/buildCache.ts` has the reasoning and
`harness/buildCache.test.ts` pins the parts of the key that would be silently wrong if dropped.
Deleting `.cache` is always safe and is the whole of the invalidation story.

## There was a compiler pin, and what it was for

There is no pin now. `deno.json` maps `wac/` to `./compiler/`, so the compiler is whatever
is in the tree at the commit you have, and the three files that held the pin — a version json, a
tool that wrote it and a harness check that read it — went with the merge ([MERGE.md](../MERGE.md),
which names them). `deno task wac:pin`
does not exist; a document that still names it is describing the repository as it was
before 2026-08-09.

The reasoning is kept because the shape of the mistake is not specific to compilers, and
this repo still records floors — a version in a lockfile, a figure in a README, a "known
to work with" in a comment. **A recorded floor is a claim, and a claim nobody re-checks
goes stale silently while looking exactly as it did when it was true.**

The pin recorded the oldest compiler this repo was known to work with, and the harness
checked it before compiling anything, so a too-old checkout failed with *"wac-mono needs a
newer compiler"* naming the commit and the reason rather than a `CompileError` in whichever
package used the new feature — which is what used to happen, four times, to three different
agents (`issues/system/closed/0001`, `0008`). Being ahead of a floor is normal and is never
an error.

The rule that failed was **"bump it only when you adopt a feature that did not exist
before"**. The pin sat at a 2026-08-03 commit while wac went 52 commits ahead, and nothing
about that drift told anyone whether the claim was still true. It was — every package still
built against that commit when somebody eventually tested it — but nobody had, for two days,
and the note the harness printed had become something three agents scrolled past. What
replaced it was **update it whenever the suite has just passed and the thing it names has
moved**: a floor that names something the suite passed against *this week* is a useful
claim, and one that names the oldest commit that happens to still work is an
archaeological fact nobody maintains.

The order mattered, and still does wherever a floor is written down: recording it is a
claim that the suite passes against it, and the tool that records it cannot check that for
you. `wac:pin` refused a dirty tree and refused to move the floor backwards, and took your
word on the rest.

## Dependencies: none, and the one exception

Nothing here imports a third-party package. Every test file writes its own `assertEquals`
for that reason, which is why you will see the same eight lines in thirty files, and it is
deliberate: a repo whose only input is Deno can be checked out and run in five years.

`deno.lock` exists for exactly one exception, and names it: `npm:playwright`, imported
*dynamically inside* `packages/platform/test/browser_live.test.ts`, which runs the browser
target in a real browser. That test is ignored unless a browser is installed and the run has
`--allow-sys`, so `deno task test` skips it in milliseconds and fetches nothing. The lockfile
is there to pin the version and its integrity hash rather than resolve whatever is newest at
the moment somebody happens to run it — an unpinned dynamic import would be the worse
position to be in, not the purer one.

No package's own code imports it, and nothing else in the suite needs the network.

## Two kinds of test

**Host-side (`test/*.test.ts`)** for anything needing an external oracle or the
outside world — differential testing against python's zlib, interop with the
system `gunzip`, corpus generation, subprocesses. This is where most of the
confidence in `gzip` comes from and it cannot move into wac.

**wac-written (`test/wac/*_test.wac`)** for unit tests of wac code, especially
internals. A test is an exported function returning `string`: empty means pass,
anything else is the failure report. `wacTestRun` discovers them by enumerating
`test*` exports of the compiled module — no language feature required — and
registers each as a Deno test so both kinds appear in one run.

Writing them in wac removes two frictions. Internals no longer need a probe file
that re-exports them one value at a time just so TypeScript can reach them
(`gzip`'s Huffman tests used to work that way). And values never cross the wasm
boundary, so there is no `i8[]`↔`Uint8Array` marshalling, no `i64`↔`bigint`, and
no worrying about how `-0.0` or NaN survive the trip.

## Coverage, and why it belongs here rather than in each package

`deno task coverage:<package>` reports branch coverage for the nineteen packages that have one, driven
by a `cov.ts` in the package itself. **Coverage needs an exercise, and an exercise only measures the
code it drives**, so each package supplies its own; `harness/wacCoverage.ts` is the shared half. The
repo-level `deno task coverage` covers gzip only, which is
[0002](../issues/system/closed/0002-coverage-and-mutate-only-see-gzip.md).

**The hazard to know about: `cov.ts` is a second workload written by hand, so it drifts from the test
suite it is meant to measure.** Twice it has reported a branch as uncovered that the tests do cover,
and once the reverse. When it disagrees with the suite, the suite is right and `cov.ts` needs the
input adding.

Which is not the same as the number being wrong for a *third* reason: a source file the probe never
calls at all reads **0.0%** and looks untested. `packages/bytes`'s `slice.wac` reads that way and is
covered by `test/bounds.wac`; `packages/regex`'s `basic.wac` and `posix.wac` read that way until
2026-08-11, when driving them from `cov.ts` moved the package from 62% to 86.4%. A file at zero is a
question about the probe before it is a question about the tests.

These two paragraphs were in `packages/bytes`, `packages/fmt` and `packages/json`, word for word, and
in none of the other eighteen packages that have a coverage task. They are facts about the tooling
rather than about any package, so they are here once and each package keeps only its own numbers.

## A README's *what is not here* is a claim, and it rots

Most of these packages end with a section naming what they do not do — and the whole value of it is
that a reader can trust it. It is also the only part of a README that becomes false **by somebody
else's success**: every other sentence describes what the code does and drifts only if the code
changes under it, but "there is no job control" is falsified by the commit that adds job control, and
that commit's author is looking at `exec.wac` rather than here.

Four have been found false, and each had been for a while:

- `packages/tty` said "**No terminal modes.** Canonical with echo, always… **not implemented**" while
  `line.wac` had three, each measured against a pty. What was *actually* missing was a step further
  in — nothing selects a mode, so an editor still cannot have a keystroke at a time.
- `packages/sh` said "**There is no job control**… no `wait`, no `jobs`, no `%1`" two hundred lines
  below a section describing `&`, `jobs`, `wait` and `kill %1` working. The same file contradicted
  itself, and the shell answered `[1]+ Running` when asked.
- The same file said "**`2>` is not implemented, and says so in those words**" — in *two* places, one
  of them inside the section whose first paragraph lists `2>`, `2>>`, `2>&1`, `1>&2`, `>&2` and
  `2>&-` as working. Checked by running all six (2026-08-11). What is still refused is a descriptor
  above 2, which is a different sentence.
- `design/system/0001`'s step 5 asserted both that the `^C` criterion **is met** and, four paragraphs
  later, that it **is still not met**. Both were true when written, and the cell was 1,376 words, so
  nobody had the two sentences in view at once. Splitting it into sections is what made it visible.
  **The split then kept the wrong half.** The state-of-play paragraph the split created said the ssh
  criterion "needs concurrency rather than a poll" — directly above the paragraph naming the poll that
  met it — and `packages/tty` and `packages/ssh` carried the same sentence, each written before the
  fix landed. Three documents, one fact, corrected on 2026-08-11 by running
  `packages/ssh/test/server.test.ts`'s `^C` case: it passes in 2s, with `$?` at 130 on a session that
  is still there. A summary written to end a contradiction is worth no more than the day it was
  written on.

**Length is where these hide.** Three of the four were in files or cells long enough that the two
halves of the contradiction were never on a screen together, and the fourth was the same sentence
written twice. So a document that has grown past reading is not only tiresome — it is where a claim
goes to stop being checked.

So: **closing a gap includes deleting the sentence that denied it.** If the gap only got smaller, say
what is left rather than leaving the old sentence to be right in spirit and wrong in fact — a reader
cannot tell those apart, and the second kind is worse than no section at all.

There is no check for this and there is not going to be a good one: the claims are prose about
absence, and a tool that guessed at them would cry wolf. What there is instead is the habit, and the
two examples above are here so it has teeth.
