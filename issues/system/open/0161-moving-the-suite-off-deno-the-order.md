# 0161 — moving the suite off Deno: the order, and what blocks each step

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

The goal is no Deno or TypeScript after bootstrapping, except where a JS interaction is wanted.
This is the measured shape of that, and the order the steps have to happen in — recorded because I
got the order wrong twice from reasoning about it.

## Where this stands, and what is actually blocking — 2026-08-17, second pass

The native lane is **125 files, 115 ok**, from 77/23 when this began and 104/94 this morning.
`deno task seed` and `deno task map` are wac; `deno task docs` is five wac files and two Deno
checks; fifty-six seam wrappers are one driver.

**Four packages have no `.test.ts` left at all**: `gzip` (15 wac files), `codec`, `datetime`,
`unicode`, `tty`. That is the first evidence that a package can go all the way rather than most of
the way, and what it took was not new language features — it was `Cli.exec` and a change of
direction in how an oracle is used.

### The shape that made it work: send the answers, not fetch them

A host-side test called its oracle per case, because a host call is free. Through `Cli.exec` a
process is milliseconds, so the same test written the same way is one spawn per case and unusable.
The shape that works is the opposite one: **compute everything, hand it over once, and let the
oracle report only what it rejects.**

`packages/wactest/src/oracle.wac` is the caller's half — `Lines` and `check` — and it is shared
rather than copied because the two things that make it correct are easy to leave out:

- **the `DONE <n>` count.** An oracle that read half the batch and stopped reports no failures,
  which is indistinguishable from agreement.
- **the `Buf`.** A sweep is megabytes of lines and `s = s + line` in a loop is quadratic.

And where the function being checked agrees with the identity almost everywhere — case mapping, case
folding, printability — only the *differences* travel and the oracle rebuilds the whole function
before sweeping it itself. That turns a 1.1-million-line transport into about three thousand, and it
makes a missing entry and a wrong entry the same kind of failure.

### The oracle scripts stay, and are not part of this

`packages/gzip/test/fuzz/oracle.py`, `packages/datetime/test/oracle.ts`,
`packages/unicode/test/oracle.ts`, `packages/tty/tools/discipline.py`. These are the *references* —
the thing compared against, invoked the way `gunzip` is invoked. Two are TypeScript because
JavaScript is the only implementation with the range: `Date` reaches ±275 760 where python's
`datetime` stops at year 9999, and there is no `String.prototype.foldCase` anywhere else.

### A test whose subject is the host stays too

`packages/stream/test/stream.test.ts` drives `packages/stream/host/bridge.ts` — the
`ReadableStream`/`WritableStream` integration. Its subject *is* TypeScript, so moving it would mean
not testing it. It belongs beside `harness/wac/hostless.test.ts` in "what stays".

### Later the same day: ten packages, and what the last two found

The native lane is **135 files, 125 ok**. Twelve packages have no `.test.ts` at all — `bytes`,
`codec`, `datetime`, `ens`, `fmt`, `gzip`, `regex`, `rlp`, `std`, `tty`, `unicode`, `url` — of which
ten moved today.

Two things came out of the last two that are worth more than the ports:

**`Cli.exec` deadlocked on every host, and had never executed on one.** All three wrote the whole of
stdin before reading either output pipe, so any child that answers while it is being fed — `cat`,
`grep`, any filter — wedged past the 64 KiB pipe buffer. Nothing had found it because python and
`deno run` read to EOF before answering, so every oracle written before `packages/regex` was safe by
accident. And on the wasmtime host the capability had never run at all: `run` was added to `Grants`,
to the capability and to `binary.ts`, and to none of the seams between. `issues/system/0165`.

**A grant that is free on the host is not free here, and the difference can hide a differential.**
`packages/abi`'s `cast` comparison finds Foundry in `~/tools/foundry`, reachable only through `HOME`.
`Deno.env.get` needs no permission; `cli.env` does. A lane with `--allow-run` and no `--allow-env`
found nothing on `PATH`, warned that the second oracle was not running, and passed — twenty-four
comparisons replaced by a green tick. The port separates "could not look" from "is not there" and
fails on the first, and `tools/runTests.ts` now grants `--allow-env`. That is the concrete cost of
`issues/system/0173`: it is not only that a lane must over-grant, it is that under-granting is
silent.

### End of 2026-08-17: fourteen packages, 142 native files

The native lane is **142 files, 132 ok**. Fourteen packages have no `.test.ts` at all — `abi`,
`bignum`, `bytes`, `codec`, `datetime`, `ens`, `fmt`, `gzip`, `regex`, `rlp`, `std`, `tty`,
`unicode`, `url`. Twelve of those moved today.

Three more findings from the second half of the day, all of the same family — *a check that was not
being made*:

- **`ethers`' errors are deferred.** `AbiCoder.decode` returns a `Result` that throws when a value is
  *read*, so an oracle that only calls `decode` reports acceptance for a dirty address. That is how
  the first version of `packages/abi/test/toolsOracle.ts` reported the strictness table wrong. The
  host-side test had never run `ethers` at all, though its header said it did — four of the table's
  eight cells were assertions about a tool nothing asked.
- **`divmod`'s quotient clamp can be deleted and nothing fails**, in the port and in the host-side
  version it replaces. The branch is not unvisited — corrupting its body fails three tests — the
  refinement loop below simply recovers from an unclamped estimate on every case either corpus has.
- **`packages/mpt`'s malformed-node tests see one of two defences.** Reintroducing upstream #43 in
  `rlp.bytesOf` fails nothing, because every call site asks `isList` first; removing a call-site check
  *is* caught, but by `bytesOf`'s trap rather than by the message the check exists to produce.

None of the three is a bug. All three are places where a green suite says less than it appears to,
and each is now written where the next person to touch that code will read it.

### The remaining work, sorted by what is in the way

**Nothing in the way — just work.**

    ~76 files   harness-driven tests with no host oracle
    ~40 files   deterministic oracles → capture, as `packages/crypto/tools/capture-hkdfcap.wac` does
     13 files   reactive oracles → a live one through `Cli.exec`
    ~44 files   tools/, minus the four already moved

**Blocked on a decision, and each is filed.**

- `issues/system/0164` — one trap per test means one export per value. Costed: **≈136 exports** for
  the seven remaining "only the refusals" files. `aes` was ported anyway so the shape is visible;
  `aead` was ported because its eleven are eleven *attacks* rather than eleven lengths, which is the
  distinction that decides whether the expansion is worth it. The gzip ports since then are the
  other side of that line: fourteen corrupt-stream refusals read *better* as fourteen exports,
  because each is a different malformation with a different reason.
- `issues/system/0175` — a `test_traps_*` case can observe nothing about the trap except that it
  happened. Cost one assertion so far, and the workaround where it mattered was a whole process:
  `packages/gzip/test/wac/fuzzprobe.wac` runs one corrupted stream per spawn so a trap becomes an
  exit status, which is the only way to say "decodes correctly *or* fails, never a wrong answer".
- `issues/system/0173` — a wac test cannot say *which* grant it needs, so a lane grants everything.
- `issues/system/0165` — `Cli.exec` is buffered only. The fifteen server-interop files want
  start-and-leave-running, which has a process-lifetime question buffered does not.

**Blocked on something that has to be built first.**

- `tools/designClaims.test.ts` needs three numbers from `packages/sh/test/corpus.ts` — 842 scripts,
  109 of them multi-line, interleaved with 265 comments that explain why each case exists. No cheap
  data format survives all three, so it moves when `packages/sh`'s own tests do.
- `tools/docSignatures.test.ts` is portable — `bindTypesFiles` exposes struct fields and method
  signatures — but it swaps the oracle from the reference compiler to wacc. That is arguably better
  and it is a change in what is claimed, so it wants the side-by-side treatment.
- `packages/crypto/test/constanttime.test.ts` needs the compiler's **trace mode**, through
  `harness/ctTrace.ts`. wacc has no equivalent, so this is a compiler feature rather than a port.

**And what stays.** `compiler/` and the 21 `packages/wacc` tests that measure wacc against it are
the bootstrap. `harness/wac/hostless.test.ts` is the alternative-host check and is the point rather
than a leftover. `packages/stream/test/stream.test.ts` tests the host bridge. `site/tools/syncMap.ts`
writes a TypeScript artefact in an npm subtree. Each package's `cov.ts` is a TypeScript instrument
and is its own tier — which is why `packages/gzip/test/fuzz/corpus.ts` and
`packages/gzip/test/streams.ts` still exist beside their wac ports, and why those two now exist
twice with nothing comparing them.

## The surface

628 TypeScript files outside `site/`. **446 are tests.**

| | files | what it needs |
|---|---:|---|
| `wacTestRun` wrappers, registration and nothing else | **81** | the suite to run `wac test` — **done** |
| `wacTestRun` wrappers that also declare a host test | 2 | the same, then those tests moved |
| bind a wac module and assert from TS | 182 | **63** rewritable; 72 can never be — see below |
| spawn a real process | 120 | **decided yes** — see step 4; file access comes first |
| drive `compiler/` directly | 32 | stays until the reference seed retires |
| `harness/` | 27 | mostly evaporates with the above |

**Do not classify these files by text scan.** I tried four times and got four different wrong
answers, each confidently derived:

| attempt | said | wrong because |
|---|---|---|
| "asserts a trap" by the word `trap` | 72 | matches comments, and a filename (`i31Trap.test.ts`) |
| "convertible" by absence of markers | 63 | `itoa64.test.ts` has no markers and its oracle is JS BigInt |
| "uses a JS oracle" by `BigInt\|JSON.` | 55 of 61 | mostly `JSON.stringify(got)` in each file's own assert helper |
| files defining `assertTraps` | **4 remaining** | this one is reliable — it is the helper, not a word |

The verifiable facts, and they are the only ones worth planning against:

- **182 `.test.ts` files call `wacBind`.**
- **Ten of them defined `assertTraps`, and all ten are converted** — that grep now finds nothing.
  But it was never the whole set: `packages/tls/test/keyschedule.test.ts` asserted traps with a
  three-line local `traps(f)` closure and no helper to grep for. Its header said it stayed because
  "a trap unwinds the module rather than returning, so wac cannot assert one", which is the same
  belief the other ten were written under. Converted too — its two cases went into the existing
  `test/wac/keyschedule_test.wac`, where the rest of that file had already moved.

  **A third seam: binds a `src/` module directly, no host import — 2026-08-16.** Two converted,
  `gzip/inflateAt` and `fs/stream`. The rest of that list are host-bound for reasons no filter
  catches, and they are worth naming because each is a different shape:

  - **The host is one import away.** `gzip/gzip_fixed.test.ts` looks clean and imports `gunzip` from
    `./util.ts`, which spawns the system gunzip — the right oracle, since a self-round-trip cannot
    catch a wrong bit order.
  - **New TypeScript arrives while this runs.** On 2026-08-17 alone, seventeen `.test.ts` files were
    added by other agents — 1,908 lines still present — against roughly 800 lines converted away the
    same day. Some of it is genuinely host-side (`packages/wacpkg`'s transport and cache), and some
    is not (`wacc/interiordotdot_test.wac` is a compiler test). This is not an argument for stopping
    anyone; it is the reason a line count of what remains moves in both directions, and why "how much
    is left" cannot be read as "how much has been done".

  - **The test runs what it compiles.** `wacc/i31Trap.test.ts` emitted a module and instantiated it
    with `WebAssembly.Module`. **26 of `packages/wacc`'s 61 tests do this**, which makes it the
    largest single shape left — but it needs no new capability. `spec/cli/wac.md` says a first
    argument ending in `.wasm` is a program to run, `emitFilesSelfDescribing` writes a module with
    its manifest inside it, and `run`'s exit status is the program's own answer. So the route is
    emit, write, run: `packages/wacc/test/wac/artifacts_probe.wac`'s `runEmitted`, proved by
    `runemitted_test.wac`.

    Two things a caller has to know. The export must be **`main`, returning `i32`** — a program
    written to answer through `f()` has to be rewritten to answer through `main()`. And a refusal
    must be read off **stderr** rather than the status, because a trap, a `main` returning 1 and a
    module that never compiled all exit 1 (`issues/system/0184`).

    `i31Trap` itself needed none of it: the values are literals, so the casts are written in
    `test/wac/i31trap_test.wac` directly and `wac test` inverts a `test_traps_*` verdict. The corpus
    sweeps do need `runEmitted`, and they want one program folding its cases into a single answer
    rather than a process each — the shape `selfdrive.wac` already uses.
  - **The oracle is named in the header.** `fmt/ftoa.test.ts` is judged against `Number::toString`.
  - **The fixture is not reproducible.** `gzip/gzip_best.test.ts` generates incompressible data with
    `(s * 1103515245 + 12345) & 0x7fffffff` in JavaScript, and for `s` near 2^31 that product
    exceeds 2^53 — **1993 of 2000 steps round** before the mask. Exact integer arithmetic in wac
    gives a different sequence. Its property test would survive that; its second test asserts an
    outcome for one particular input, and re-tuning the seed until that passed would be choosing the
    answer.

  **And the probe-backed ones — 2026-08-16.** A `*_probe.wac` paired with a thin `.test.ts` usually
  means the boundary is the only reason either file exists, so both go together. Four converted:
  `quic/tamper`, `quic/short`, `quic/connection`, `platform/ripple`. Two do not, and their reasons
  are the shape of what is genuinely host-side:

  - `platform/faults_agree.test.ts` compares `host/faults.ts`'s numbering against `platform.wac`'s.
    It is a *cross-language parity* check; moving it into wac would delete the half it exists to
    compare.
  - `raster/raster.test.ts` reads `tools/unscii-16.hex` from disk as its oracle — the font the
    rasteriser was generated from.

  Two of the four were worth converting for **determinism** rather than for removing TypeScript.
  `quic/short` guards a bug that passed 5 of 8 runs against a real server, because a short header is
  protected across five bits and a long header across four; sealed sixteen times with no network in
  the way it now fails every run. `quic/connection` checks accounting a real server is blind to —
  a reused packet number looks identical from the far end of a socket until the day it loses the
  key, and the canary for it fails four of eight tests. A probe-backed test that samples against a
  live peer is a better candidate than its line count suggests.

  **The cheaply-convertible refusal files are done — 2026-08-16.** Thirteen moved across. What is
  left of that kind is blocked on one of two things, and both are known rather than guessed:

  | file | why it stayed |
  |---|---|
  | `tls/hybrid.test.ts` | 25 rows over five guards — `issues/system/0164`; **converted 2026-08-17** |
  | `tls/record.test.ts` | same shape; **converted 2026-08-17** |
  | `tls/wire.test.ts` | table over `[op, need]` pairs; **converted 2026-08-17** |
  | `crypto/ed25519.test.ts` | five loops over four lengths each; **converted 2026-08-17** |
  | `crypto/mlkem.test.ts` | table-driven *and* takes WebCrypto vectors; **converted 2026-08-17** |
  | `tls/x509_path.test.ts` | reads `/etc/ssl` — **converted 2026-08-17**, `Cli.readFile` can |

  The way to find these was not a grep. Each says in its **header** why it is host-side, and in
  every case but the last that reason was "a trap unwinds the module so wac cannot assert one" —
  which is wrong, and is what `test_traps_*` answers. Read the first paragraph; it is both the way
  to find the file and the claim to check.

  **A table of lengths is a poor fit, and 2026-08-17 says convert it anyway.** `test_traps_*`
  allows one trap per test, so a host-side `for (const n of [0, 63, 65, 128]) assertTraps(...)`
  becomes one export per row: the hybrid refusals are 21 exports plus a control, and `record.test.ts`
  and `wire.test.ts` are the same shape. All three were left host-side on that reasoning and all
  three are converted now, because writing the rows out is what showed four of the hybrid's 21 were
  not asking what they appeared to — an over-long share of arbitrary bytes is refused by ML-KEM's
  coefficient check long before anything looks at its length, so the guard could be weakened from
  `!=` to `<` with the loop still green. Three of `record.wac`'s four framing guards were masked the
  same way, by the AEAD downstream. The page of near-identical functions is a real cost and
  `issues/system/0164` is still the clean fix; what is no longer true is that the loop was the better
  test.

  **So there is no grep for this.** A file asserting a trap can spell it any way its author liked,
  and the only reliable signal was the sentence in the header — which is the sentence that turned
  out to be wrong. Expect a few more to surface the same way, by being read.

  Converting them keeps finding that they prove less than they claim, which is the argument for
  doing it by hand rather than mechanically. `wire_traps` is the sharpest so far: its header is about
  a length prefix trusted against the bytes present, and **removing `take`'s bound left every one of
  its cases green** — the overruns promise more than the whole buffer, so the array read traps first
  and the check is never what refuses. It needed a new case, a `take` past the end of a *slice* with
  bytes behind it, where the missing bound answers a short read with somebody else's bytes.
- The rest need **reading**, one at a time, and a minute each is the right minute to spend. A file
  that binds a module and compares numbers may still have JavaScript as its oracle, and no marker
  distinguishes that from arithmetic the language can do itself.

So `test_traps_*` unlocked ten files rather than the seventy-two I claimed for it when I found the
trap behaviour. It is still the right feature — those ten include the framing guards on the side of
TLS that accepts connections from strangers — but the tier it belongs to is small, and the large tier
is the one nobody can count without reading.

**One is done, as the shape for the rest.** `packages/gzip/test/crc32_incremental.test.ts` became
`test/wac/crc32_incremental_test.wac` plus a nine-line wrapper. It built an array, called two
functions and compared two integers; the TypeScript was doing nothing the language cannot. The gzip
suite is 87 tests before and after.

It also deleted a file that existed only to serve the boundary: `crcprobe.wac` was a *probe*
— a wac file exporting `whole` and `chunked` so a TypeScript test could drive them — and with the
test in wac it had no callers at all. That is worth expecting for the other 62: a probe exists to be
reached from the host, and the conversion removes the reason for it.

**The first two rows were 37 and 48 and are measured now — 2026-08-16.** The old split counted a
wrapper with *any* other content as mixed: an import, a comment, a helper. The question step 3
actually asks is narrower — does deleting this file take a test with it — and the predicate for it
is `countTestsDeclaredHere(source) === 0` alongside a resolvable `wacTestRun(`, both from
`harness/testRegistrars.ts`. By that measure **81 files are pure registration and 2 also declare a
host test**, out of 83. So step 3 deletes 81 files rather than 37, and the "extra content to move"
is two files' worth rather than forty-eight.
| `tools/` | 48 | separate track; several are natural `wac` subcommands |

## Where the native lane stands — measured 2026-08-16

    wac test packages/

    before   83 files: 52 ok, 31 needing a host oracle      355 tests
    mid     100 files: 69 ok, 31 needing a host oracle      510 tests
    after   100 files: 82 ok, 18 needing a host oracle      611 tests

Seventeen more files run with no host, and for most of the session **the host-needing count did not
move** — every conversion up to that point was of something that never needed one.

Then step 4 landed and it fell: `tls/x509_path` and `ens` both took a `fn[…]` from a wrapper that
was **not an oracle but a loader** — it read a file and handed the bytes over. Neither supplied an
answer. With `Cli` those tests read their own fixtures: seventeen PEM files decoded by `pemBundle`,
and a vendored JSON corpus parsed by `packages/json`. Two wrappers and a dependence on `pemToDer`
retired.

**All twelve loader-shaped wrappers are done** — `hsntor`, `introrelay`, `hsblind`, `votestatus`,
`hsintroduce`, `hsdescbuild`, `blind`, `hsstore`, `introduce`, `dirstep`, `hsdir`, `hsdescgen`. Each
read JSON vectors and handed them over; none supplied an answer.

**But that list was a classification, not a sweep, and a sweep finds more.** `grep -l readTextFile
packages/*/test/*_wac.test.ts` returns 28 files, 11 of them still in `packages/tor` and none of them
on the list above. They are not all loaders, which is why they were not on it — `dirserve_wac` reads
three fixtures *and* computes the descriptor digest with the host's own SHA-1, deliberately, "so the
wac side is not asked to trust its own span twice". That is an independent implementation and
converting it would weaken the test.

So the remaining ones need reading one at a time rather than counting, and the question for each is
the one this issue started with: does the wrapper *supply an answer*, or only carry bytes? The
distribution outside `tor` is `bls` 7, `ssz` 5, `lightclient` 2, `tls` 1, `ens` 1, `abi` 1. `hsntor` is the worked example for this cluster: the wrapper reached its vectors through
a `ref(what, a, b)` dispatch, which existed only because a callback cannot be overloaded — one
`caseBytes(cli, i)` and one `caseCount(cli)` replaced it, and `arg1`/`none`, the two helpers that
existed to shape that dispatch, went with it.

`introrelay` adds the other half of the pattern: a wrapper that **also validated the fixtures**
before running anything — the INTRODUCE1 must come from tor's own builder, and the two files must not
share an auth key or the unknown-id case proves nothing. Those became a test, which is where they can
be read beside what depends on them. Expect one or two of these per wrapper; they are easy to drop on
the floor, because they look like wrapper scaffolding rather than assertions.

`hsblind` adds the third thing to expect: a wrapper doing **arithmetic**, not just decoding. It
packed two JSON numbers into big-endian u64s because the wac side reads them with `be64`. Rewriting
that by hand is where a conversion can go wrong silently — the canary for it is to flip the byte
order, which fails two of seven. And its signatures are worth a glance before a bulk edit: one spans
two lines, which a single-line regex over `fn[u8[](i32, u8[], u8[])] ref` misses, leaving a test
still asking for a callback nobody passes.

**And the index helper is named differently per file** — `arg1(i)` in some, `at(i)` in others, both
wrapping an `i32` into the `u8[]` the dispatch took. Match `ref(CONST, <anything>(…), <anything>())`
rather than either name. Getting this wrong reports "this is not something that can be called",
which says nothing about vectors and sends you to the wrong place; it is the second time in this
cluster that listing spellings instead of matching the call cost a build.

**And a wrapper can *build* its inputs, not only load them.** `hsstore` computed each control by
editing the descriptor — one byte replaced, or truncated, or left whole under a wrong name — and
asserted while doing so that a replace changes something and keeps the length. Port the construction
*and* those assertions: without them, breaking the edit so it changes nothing leaves every test
green, because nothing else compares a control against the descriptor it came from. The canary said
so before the commit, which is the only reason they are there.

**Canary the index, not only the decode.** `introduce` loops over three captured cells and reads
every field of a case *from that case*, so a loader pinned to index zero serves one self-consistent
cell three times and all six tests pass — which the canary showed and the host-side wrapper had
never checked either. A fixture with several rows needs one assertion that the rows differ, or it is
a fixture with one row.

## The host-oracle tier, split by what the oracle is asked to do

Measured 2026-08-17, and the split is what decides the treatment. Of the tests that use host crypto
or `BigInt` as a second implementation:

    44 files  8,925L   deterministic — the oracle produces an expected value from fixed inputs
    13 files  1,490L   reactive      — the oracle judges something *we* produced

**The deterministic half is capture.** Ask the oracle once, commit the answer, read it from wac.
`packages/crypto/tools/capture-hkdfcap.wac` is the worked example: it runs `deno eval` for
WebCrypto's HKDF at the 255-block cap, and the committed vector discriminates exactly as the live
call did — three canaries say so. It is lossless because the inputs are fixed, and **63 of the 64
tests in this tier use no unseeded randomness**, so that generalises.

**The reactive half cannot be captured and does not need to be.** `packages/crypto/test/rsaOracle.ts`
is the clearest: node signs and we verify, *and* we sign and node verifies. The second direction has
no expected value to commit — our PSS signature carries fresh salt each run, so the oracle has to be
there to judge it. That is a live oracle, which is what `Cli.exec` is for: `openssl dgst -verify` or
`deno eval` at run time rather than at capture time.

So neither half is blocked. The distinction is only which of the two shapes to reach for, and
getting it wrong is expensive in one direction — a captured "expected signature" for a randomised
scheme pins the randomness and stops being a check.

**Two wrappers over one fixture become one module, not two copies.** `dirstep` reads the same
`hspublish.json` and `hsdesc_generated.json` as `hsstore` and needs the same control builder, so the
loading lives in `packages/tor/test/wac/hspublish_fixture.wac` — a plain wac file, not discovered as
a test, since `wac test` walks `*_test.wac`. Extract it *before* writing the second conversion: the
first file's existing tests are what tell you the extraction was faithful, and they cannot do that
once you are also changing them.

**A packed byte layout is a property of the seam, so delete it with the seam.** `hsdir`'s wrapper
concatenated each case into eighty bytes and the directories into a count followed by pairs, because
everything crossed one `fn[u8[](i32, u8[], u8[])]`. The tests then re-derived the fields with
`slice(meta, 32, 64)` and two identical hand-written big-endian readers. Named accessors replace all
of it: the mechanical part is per-site and a wrong field fails loudly, because these are
differentials against values tor logged. It also turned up a constant the wrapper packed and the wac
side never read.

**Six copies of one JSON reader is the cost of doing this file by file.** After five conversions the
same `strOf`/`numOf`/`objectOf`/`arrayOf` existed three times, so they are in
`packages/tor/test/wac/jsonfile.wac` now and every fixture module imports them. They all **trap** on
an unexpected shape rather than defaulting: a regenerated vector that lost a field is not a test
failure to interpret, and a zero substituted for a missing number reads as tor's answer.

They are one cluster with one shape — `packages/tor/test/data/` holds twenty JSON files — so the
work is a `caseBytes(cli, i)` helper per file: read, `parse` from `packages/json`, `decoded` from
`packages/codec` for the hex, and concatenate. `packages/ens`'s conversion is the closest worked
example; `tls/x509_path`'s is the one for fixtures that are already bytes.

Worth doing as a batch by whoever picks it up, because the helper is nearly the same each time and
the twelfth will be much faster than the first. Watch for the ones whose host argument *also* does
something else — `tls/fuzz_wac` reads two PEM fixtures **and** calls `crypto.getRandomValues` for
real entropy, which is not a loader and does not convert.

**The distinction to look for is loader versus oracle**, and the wrappers say which they are — the
x509 one called itself "a fourth shape for the boundary" and spelled out that nothing there supplied
an answer. A loader is a file capability wearing a callback. An oracle is an independent
implementation, and no capability replaces it.

The 510 is not 155 new tests written; it is mostly the same assertions, re-expressed. What is new is
that they run in both lanes, and that a `test_traps_*` case now runs natively where its host-side
form could not.

## How to convert one — the recipe, from doing three

Two conversions found four things that cost time and are not obvious. Written down so the next
person does not pay for them again.

**Pick from the list, not by eye.** A file qualifies if it binds a wac module and only compares
values, or if its assertions are traps (`test_traps_*` handles those now). It does *not* qualify if
it spawns a process, opens a socket or wants `node:crypto` — that tier is waiting on the oracle
decision below.

**Write the wac test, then watch it fail.** Mutate the thing under test and confirm the new file goes
red for the reason it exists. This is the step that pays: `packages/json/test/bounds.test.ts`
converted cleanly and *neither* form could distinguish the guard it claimed to be about — removing
both explicit bounds checks left it green, because `items[i]!` traps on the null slot anyway.
`packages/std`'s did keep its discrimination, and only canarying told them apart.

**The probe usually dies with it.** A `test/wac/*probe.wac` exists to be reached from the host —
`crcprobe.wac` exported `whole` and `chunked` so a TypeScript test could drive them. With the test in
wac it had no callers at all. Check and delete; `tools/deadexports.test.ts` will not, since probe
files are exempt from it.

**Deleting the file breaks its citations.** Both conversions were cited elsewhere as *the shape* for
that kind of test — five files across `ens`, `crypto` and `rlp` pointed at `packages/std/test/traps.*`
alone. `deno task docs` catches every one through the backticked-path check, so run it before
pushing rather than after.

**`deno task docs` finds backticked paths, not paths passed as arguments.** It caught the citations
in all six conversions and missed one: `packages/crypto/cov.ts` instruments the trap fixture through
`instrument("packages/crypto/test/wac/traps.wac")`, which is a string argument rather than a
backticked path in prose. So `grep -rn <basename>` as well, and run the package's `coverage:` task if
it has one — a `cov.ts` naming a file that no longer exists fails at run time, not at check time.

Then: a nine-line wrapper so both lanes run it, `deno task seed` if `packages/wacc/src` moved under
you, and the package's own suite plus `deno task docs`.

## The order, and why it is not the obvious one

**1. The suite runs `wac test`.** Done — `tools/runTests.ts`. This had to be first and I twice wrote
that deleting wrappers was "free". It is not: `runTests.ts` ran `deno test` and nothing else, so the
wrappers *are* how 83 wac test files enter the suite. Deleting them first removes the tests.

**2. `tools/mutate.ts` learns to run a wac test.** This blocks step 3, and that is the correction
worth keeping. Mutation testing selects tests from a coverage profile and runs them with
`deno test --filter <name>`; delete a wrapper and the test it named cannot be run at all, so the
mutant is scored against a suite that no longer contains its test. `wac test` now writes the
per-test profile the tool reads (verified 16 of 16 against the Deno path over `map_test.wac`), so
the selection half is ready and the *running* half is not.

**3. Delete the 37 pure wrappers**, verifying mutation scores unchanged either side.

**4. The oracle question**, which is a decision rather than work — see below.

**5. Tier 2, package by package.** **6. `tools/`.**

## The two paths agree, measured over every wrapper

Before any wrapper is deleted, the native profile has to say what the Deno one says. Comparing them
file by file across all 85 wrappers — same test, same set of `file:line` it reached:

    51 files compared: 51 identical, 0 differing
    17 of those are mixed: some tests run natively, some need a host
     1 all[] table differs: packages/tls/test/wac/fuzz_test.wac — explained below
    32 wrote no native profile at all

So attribution is not the risk. Two other things are, and neither was visible before this ran.

**"Runs natively" is per test, not per file.** 17 files have both kinds — `rsa_test.wac` runs 3 of
its 12 tests here, `hash_test.wac` 3 of 8. Deleting one of those wrappers would drop the
oracle-taking tests from the suite while the rest kept passing, and the file would still look green.
The check for step 3 is therefore *"does every test in this file run natively"*, not *"does this
file run"* — which is a different and smaller set than the 52 that report `ok`.

**The one differing `all[]` is the mixed case, not a fault.** `tls/test/wac/fuzz_test.wac` runs 4
tests natively and 8 through Deno, and Deno's table carries 203 lines native's does not — from
`tls/src/client.wac`, `handshake.wac`, `x509.wac`, `crypto/ed25519.wac` and `test/wac/probe.wac`.
Those are reached by the four oracle-taking tests, which the host supplies by binding further
modules; their coverage lands in the same profile. Native never runs those tests, so it never binds
those modules and never learns their lines exist.

That is worth understanding rather than filing: it means a mixed file's native `all` is not the
module's full extent, it is the extent of *what could run*. A reader comparing the two must not
treat native's smaller table as the truth about the file.

**A profile now says whether it is complete — done 2026-08-16.** Two halves of the same gap. A file
whose tests all need a host wrote no profile at all, so *nothing ran here* and *this file was never
asked* were the same observation; it writes one with an empty `tests` map now. And a **mixed** file's
profile listed only what ran, which reads exactly like a complete one — `rsa_test.wac` would have
looked like a file with 3 tests rather than a file with 12 of which 3 ran. `write_profile` records a
`skipped` list, and an empty list is the positive statement that the profile is the truth about the
file. `harness/nativeTestProfile.test.ts` holds all three shapes.

That is the precondition for step 2 rather than step 2: it does not make `mutate` read native
profiles, it makes a native profile safe to read. **The rule step 2 must follow is `skipped` empty,
not `tests` non-empty** — a mixed file's profile is a correct answer to a different question, and
taking it as the file's coverage narrows a sweep to tests that cannot notice the mutant.

## What step 2 actually needs

- **The two profiles name the same test differently.** Native is the export name, `test_basics`;
  the Deno path is the wrapper's prefix plus the stripped name, `map: basics`. Comparing them at all
  meant normalising. The native names are the durable ones — the Deno spelling is a function of an
  argument that stops existing at step 3 — so `mutate` should learn the native names rather than
  either path being made to match.
- **A narrow plan's files can be mixed.** `runDirs` comes from `profile.home`, and a line covered by
  both a wac test and a TypeScript one yields both kinds in one set. `testCommand` returns a single
  `Deno.Command`; a mixed set needs two and their results merged. This is the part that makes step 2
  a change to a thousand-line tool rather than a dispatch on a file extension.
- Both profiles will exist during the transition, so the reader has to merge them.

## What step 2 costs to verify, which is why it is still open

`deno task mutate --package gzip` did not finish in **15 minutes** — it was still compiling the 40
mutants to find the equivalent ones, with 0 of 40 run. `--package std` selects no mutants at all, so
there is no smaller scope to iterate on.

That is the whole reason this step keeps being deferred rather than done at the end of a session. A
change to test *selection* cannot be checked by reasoning: the failure mode is under-selection,
which shows up as a mutant scored against a suite that no longer contains its test — silently, and
as a *better* score. Confirming it needs a baseline, a run per iteration, and a run after deleting
wrappers, at a quarter-hour each and against a box three agents share.

**Three wrong answers about the cost here, and this is the measured one — 2026-08-16.**

Not the mutant compile: 66 ms each, about 3 seconds for 40.

Then I wrote that it was `buildProfile` — reasoning from its sequential loop, without a clock.
Then I "corrected" that by timing `buildProfile` per package, 9.0s for `packages/gzip` and 23.2s for
`packages/crypto`, and concluded it was small. **That correction was the wrong one, and it was wrong
for the reason the first version was: I measured a narrower thing than the one that runs.**
`buildProfile`'s input is not a package. It is the union of `testDirs` over every mutant, and
`testDirs` gives a mutant every package that imports the file it edits. For `--package gzip` that is
**380 test files across 32 scopes** — `packages/bytes/src/buf.wac` alone has 31 dependents.

Measured end to end, profile only, no baselines and no mutants run:

    deno task mutate --package gzip --explain-selection
    profiling 380 test file(s) across 32 scope(s)…
      profile: 1783 test(s) across 380 file(s), 24853 covered line(s)
    selection: 20 narrowed, 20 widened, 0 unhit, of 40 mutant(s)
                                                        26m45s

So the profile is the dominant cost, it is essentially *the whole repository's suite run one file at
a time*, and it has to be sequential — the profiler diffs one global counter array, so two tests
moving it at once would each be credited with the other's lines.

The per-scope baseline is the second cost and `issues/system/0139` owns it: 4m53s for gzip's scope,
and there are two of them in that run.

**Which puts step 2 back where the first version of this section had it.** `wac test --coverage
packages/` profiles all 83 wac test files in **53s**; those files are 83 of the 380, and the rest are
TypeScript that still needs Deno. So sourcing wac profiles natively is not a rounding error on a
26-minute pass, and the share it removes grows with every test that moves across — which is steps 3
to 5. It is worth doing for speed *and* for what it lets step 3 delete.

**There is no cheap scope, and that part stands.** The whole curated set is `gzip` 40 and `bytes` 3
— `crypto`'s single mutant is gone since this was written — so mutation testing here speaks about two
packages out of thirty. `--package bytes` is no cheaper: `--package` filters *mutants*, and `bytes`
is under 31 packages, so the profile and the baselines are the same size either way.

**`--explain-selection` exists now**, for exactly this. It builds the profile and prints what each
mutant would run — narrowed to which tests, widened to which scope, or unhit — then exits. No
baselines, no mutants, no score. It is how a change to selection logic gets looked at, and it is what
produced every number above. It also surfaced `issues/system/0163`: nine of the 380 files fail under
`WAC_PROFILE`, seven of them the whole of `packages/zstd`, because the profiling path compiles with
the reference compiler and zstd uses a wacc-only method.

## Where the cut falls, for whoever does step 2

`buildProfile` is a loop: for each test file, run `deno test <file>` with `WAC_PROFILE` set to a
temp directory, then read every JSON in it. Sequential, because the profiler diffs one global
counter array. So the change has two halves and they are separable.

**Profiling — done 2026-08-16.** `buildProfile` takes a wrapper's coverage from
`wac test --coverage` when it can prove that is not narrower than the Deno path's, and spawns
`deno test` otherwise. Names are translated to the spelling the wrapper registers, because execution
is still Deno's; a native profile holding `test_basics` against a suite that calls it `map: basics`
filters to nothing, exits 0, and scores the mutant as survived.

Over `--package bytes`, 368 files: **34 taken natively**, 1752 tests either way, selection identical
at 3 narrowed / 0 widened / 0 unhit. Not 81, and that is the `skipped` rule working: 31 wac test
files need a host oracle for every test and 17 more are mixed, and a partial native profile is
refused outright rather than merged.

Two things this cost, both worth knowing before doing the running half:

- **The binary is a tool, not a subject.** `buildProfile` looked for it at `${work}/${WAC_BIN}` —
  inside the staged copy, which does not carry `native/v8/target/release/`. All 368 files fell back
  to Deno and nothing said so, because a missing binary is a case the code deliberately tolerates.
  Forty minutes to notice. And the first guard against it passed the path in by hand, so it kept
  passing while the runner looked elsewhere; the canary only fired once the test asked the question
  the same way the runner asks it.
- **`all` is a subset, not an equal.** A wrapper's Deno profile accumulates every point instrumented
  in that process; the native run knows the entry's closure alone.
  `packages/tls/test/fuzz_wac.test.ts` is 8151 points through Deno and 1077 natively, with zero
  points the Deno side lacks. Over a scope that is 23,749 lines against 23,710, because other
  wrappers contribute the same lines. Subset is the safe direction — a line the profile has never
  heard of **widens** to the whole scope, where a line it knows can be narrowed — and
  `tools/mutate/nativeShare.test.ts` pins that it can never be wider.

**Profiling.** `wac test --coverage` writes the same JSON into the same directory, so for a wac test
file the native command can stand in for `deno test` inside that loop with nothing else altered. The
whole corpus takes 53 seconds against a loop that does not finish in fifteen minutes, and 85 of the
files in that loop are wrappers around wac tests.

**Running — the exit codes are written down and pinned now, 2026-08-16.** `tools/mutate/native.ts`
builds the argv and maps the codes; `tools/mutate/native.test.ts` checks every mapping against the
binary, including a fixture that fails on purpose, because `killed` is the verdict a score is made
of and nothing here fails by itself.

| code | meaning | verdict |
|---:|---|---|
| 0 | the selected tests ran and passed | survived |
| 3 | they ran and one failed | killed |
| 1 | nothing matched the filter, or a file did not run | **abort — score nothing** |
| 4 | every test in the file wants a host oracle | nothing ran here |

**1 is the trap, and it is the opposite of Deno's.** A filter matching nothing is a tooling failure —
a misspelling, or the profile and the runner disagreeing about which spelling a test has — and it
exits *non-zero*, so a runner reading "non-zero means killed" records a kill for a mutant nothing
ran. `deno test --filter nonsense` exits **0** and the same mutant reads as survived. Both are wrong,
in opposite directions, and neither shows up as a red anything. That is why `classify` returns a
verdict rather than a boolean.

`--filter` matches by substring, as Deno's plain filter does, so it over-selects — `test_remove` also
matches `test_remove_keeps_probe_runs_contiguous`. That is the safe direction: extra tests can only
make a mutant more likely to be killed. It costs time, not correctness.

**Running.** This is the half that is not a substitution. `mutate` runs a selected test with
`deno test --filter <name>`, and the names in a native profile are the export names — `test_basics`
where the wrapper produced `map: basics`. So selection and execution have to agree about which
spelling they are in, and a mixed set needs `wac test --filter` and `deno test --filter` both, their
results combined. `testCommand` returns one `Deno.Command`; that is the piece to write.

**They are not separable, and I had this wrong.** I first wrote that the profiling half could land
alone because it changes what the profile costs rather than what it says. It also changes the
*names* in it, and that breaks execution silently. A profile built natively holds `test_basics`;
`mutate` then runs `deno test --filter test_basics`, Deno matches substrings, and `test_basics` is
not one of `map: basics`. Checked rather than reasoned:

    deno test --filter "test_basics" packages/std/test/map.test.ts
    ok | 0 passed | 0 failed | 16 filtered out     exit 0

    deno test --filter "map: basics" packages/std/test/map.test.ts
    ok | 1 passed | 0 failed | 15 filtered out

Nothing runs, the command exits 0, and the mutant is recorded as **survived** — a score that goes up because the tests stopped running. That is the exact failure this
issue exists to prevent, and taking my advice would have caused it.

So both halves land together, or the profiling half lands with a name translation: the wrapper knows
its own prefix — `wacTestRun("…/map_test.wac", "map")` — so a native `test_basics` maps to
`map: basics` mechanically, while the wrappers still exist. That is a third option and it is
probably the cheapest, because it keeps execution on the path that is known to work while making
the profile fast enough to iterate against.

The predicate for "this file declares only wac tests" already exists and is worth using rather than
re-deriving: `countTestsDeclaredHere(source) === 0` together with a `wacTestRun(` in the text, from
`harness/testRegistrars.ts` — which exists because two tools once answered that question
differently and 28 tests went invisible.

## The decision in step 4

31 of the 83 wac test files cannot run under `wac test` at all: every test in them takes the oracle
as a *parameter*, supplied by a host. Same for tier 3's 120 TypeScript files, which spawn `bash`,
GNU `tar`, `openssl`, a real TLS server, C tor.

`wac test` already passes `--allow-*` through. The question is whether a test **should** be a program
with grants — and it is a language-shaped question, not a tooling one, because the answer decides
whether "a test" and "a program" are the same kind of thing here.

**This paragraph used to say "`packages/box` spawns processes from wac, so the capability exists".
That is wrong, and I repeated it before checking.** `Cli.spawn` starts another **wasm module** — it
reads bytes and wants a `wac.manifest` section, answering *"this runtime starts wasm modules, and
that is not one"* otherwise — and `spawnSelf` runs an applet of the same program in a worker, which
is what box and `packages/sh` use. The `Deno.Command` calls under `packages/platform/` are build
tooling, not a capability. `Cli`'s whole surface is thirty-five capabilities and none of them runs a
host program:

    argCount arg write writeErr readFile env cwd openInput openOutput outputError
    readChunk writeFile stat linkStat readDir readStdin spawn spawnSelf exitCode
    closeFeed pushChild popChild connect listen accept recv send closeSocket
    bindDatagram receiveFrom sendTo rename remove mkdir setExecutable

So **wac cannot call an external command at all**, and the tier that wants one is blocked on a new
capability rather than on a grant — `issues/system/0165`.

Answering it "no" is coherent and costs the 151 files a permanent host-side home, which is a smaller
goal than the one at the top of this issue but an honest one.

### Answered "yes", 2026-08-16, by the operator

A test may be a program with grants. Two things follow, and the second is the surprise.

**A test declares what it needs, and that is the existing mechanism rather than a new one.** A wac
test is `export string test_*()`; a test wanting a capability takes it as a parameter, exactly as the
oracle-taking tests already do. So "no ambient capabilities" holds without inventing anything: a file
that spawns says so in its signature, `wac test` supplies it only to tests that ask, and the Deno
lane's `hostArgs` already works this way — the two lanes agree by construction. The flag is
`wac test --allow-…`, matching `wac sh`.

**Reading a file unlocks more than spawning.** Counting what the 260 files that bind or register wac
actually use — indicative rather than exact, since a text scan over these has been wrong repeatedly:

| | files |
|---|---:|
| read a file | **77** |
| need a JavaScript *value* — `crypto.subtle`, `BigInt`, `node:` | 64 |
| spawn a process | 42 (16 of which also read a file) |
| instantiate wasm | 14 |

So the order is **file first, then spawn**, and re-measure rather than assume the third tier follows.
`x509_path` reads `/etc/ssl`, `raster` reads the font it was generated from; neither wants a
subprocess, and the file capability has no determinism cost.

**And spawning makes a test worse wherever an in-process oracle exists.** Two of this session's best
conversions were worth doing *for determinism*: `quic/short` guards a bug that passed 5 of 8 runs
against a real QUIC server and now fails every run, and `quic/connection` checks accounting a real
server cannot see at all. A subprocess oracle reintroduces exactly what those escaped. The category
worth moving is the one where the external program **is** the independent implementation — system
gunzip catching a wrong bit order, OpenSSL and rustls and curl on the handshake, C tor — not where it
is a convenience.

**What this does not reach**, so nobody expects it to: the 64 files needing a JavaScript value.
`fmt/ftoa` is judged against `Number::toString` over thousands of doubles, and shelling out per case
is both a worse oracle and far slower. `platform/faults_agree` compares a TypeScript table against a
wac one and would lose the half it exists to compare.

### `ssz` — 2026-08-17, and the shared fixture loader

Seventeen packages have no `.test.ts` left; the native lane is **152 files, 142 ok, 10 needing a host
oracle**. `ssz` is the first fixture-driven package to go over, and what it needed was
`harness/fixtures.ts` in wac.

**`packages/wactest/src/fixtures.wac`** is that loader, and it keeps the contract the TypeScript one
states verbatim — *a fixture that cannot be produced is an error, never a skip*. It reads
`.cache/fixtures/<pkg>-<name>-<sha16>.json`, verifies the full SHA-256 with `packages/crypto`, and
otherwise runs `python3 packages/<pkg>/tools/vendor.py` through `Cli.exec` and re-verifies before
writing the cache. The generator stays python for the reason the oracle scripts stay: it is the thing
that knows how to fetch and decompress a consensus-spec release.

The hash moving from Web Crypto to `packages/crypto` is a real change and the issue is worth naming:
the cache-integrity check is now made by code this repository also tests. It is not weaker for what
it guards — a truncated download or a substituted file does not survive any hash — and
`packages/crypto/test` compares that implementation against published vectors before anything here
runs. It **was** canaried: editing the manifest's sha256 produced a rebuild and then a refusal naming
both hashes.

Three accessors came with it — `member`, `memberText`, `memberI32`, `memberArray` — because every
fixture test reads the same three shapes out of a `JsonValue`, and `T.eqBool` was added for the
tables where `want` varies per row (`isTrue(got == want, …)` can only say "expected true").

**48 MB of JSON parses in about a second.** `ssz_generic_valid` is 1,217 cases and the whole
`merkle_test.wac` run — parse, hash-verify, merkleize 754 cases — is 1.5s wall including compilation.
That was the risk in this package and it did not materialise.

### What the branch tests had to become, and the operation `hashpair` cannot do

Three of `ssz`'s files verified merkle branches against a tree the **host** built with Web Crypto,
deliberately: folding with `packages/ssz` and then verifying with `packages/ssz` is a symmetric
oracle. Under the send-the-answers shape the tree cannot be fetched, so it is sent —
`packages/ssz/test/oracle.ts` recomputes and reports disagreements.

The first version sent `hashpair <a> <b> <claimed>` per internal node, which certifies the *digest*
and nothing else. **A fold with the side bits reversed sends its operands in the order it used, and
`sha256(a ‖ b)` agrees with it.** So `fold <leaf> <gindex> <branch> <claimed-root>` exists as well:
the oracle walks the branch itself and decides which side each sibling goes on. Reversing the
side-bit rule in `proof_test.wac`'s fold was watched to fail against it, and the per-node check alone
would have passed.

That is the general lesson for this tier, and it is the same one as `DONE <n>`: **a batched oracle
checks exactly the decision the line format makes it re-take.** Ask what the caller decided that the
line does not carry, and carry it.

### `lightclient`, `mpt`, `raster`, `server` — 2026-08-17, and three canaries that did not fire

Twenty-two packages have no `.test.ts`. Three of these ports found something the host-side version
had claimed and did not have, and all three were found the same way: by mutating the thing the file
said it was checking and watching the test stay green.

**`packages/lightclient`: the sync-committee bit selection was never exercised.** Every one of the
sixteen `LightClientUpdate`s in Ethereum's sync vectors has `sync_committee_bits` of `ffffffff`, so
`participants` returns all 32 keys under any bit-order convention — and `FastAggregateVerify`
aggregates, so the order is unobservable too. Reversing the mask to `1 << (7 - i % 8)` changed
nothing. Not fixable with this corpus: a subset signature has to come from a beacon node. The file
now says so and names what *is* pinned instead.

**`packages/raster`: a one-column shift in the text blit passed 25 tests.** The file said "a shift
by one column would keep the count and move the pixels, so both are asserted"; only the first half
was true, because the rightmost column of `w`, `a` and `c` is blank in unscii, so the shift had
nothing to push past the stray-pixel boundary. Fixed by asking the same oracle a question about
*position* — `leftmostBit`/`rightmostBit` from the `.hex`, compared against the surface's own first
and last inked columns.

**`packages/wactest`: `Answers.find` matched on a prefix.** New code rather than an inherited claim,
but the same shape: `find("proof", "dogs 646f")` returned the line for key `646f67`, and the proof
that came back *verified* — against a key it was not asked about. Whole-word matching now.

### `ask` — the read-the-output half of the batching convention

`check` covers the usual direction: the test computes the answers and the oracle reports what it
rejects. Some oracles are the other way round, and `packages/mpt` is the clearest case — a Merkle
proof has to be produced by an implementation that is not the one verifying it. So
`packages/wactest/src/oracle.wac` grew `Answers`, `ask`, `askDeno` and `word`, with both of `check`'s
guards intact: a `FAIL` line fails the test, and `DONE <n>` is compared against what was sent.

`packages/mpt/test/oracle.ts` is a trie **service** rather than a fixed corpus — `trie <id> <pairs>`,
`proof <id> <key>`, `hash <hex>` — so what to prove stays in the test that cares. The second file's
subject is composition, which is a statement about which tries exist and what they carry; a corpus
would have moved that decision into TypeScript.

It also stopped borrowing keccak256 from wac. `proof_wac.test.ts` had said the two halves share it
and "could not be otherwise, since a trie root *is* a keccak256" — true of a builder running
in-process, false of one that is a subprocess and can carry forty lines of permutation.
`test/keccak.ts` does, and `proof_test.wac` pins it against two published digests *and* against
`packages/crypto`'s answer for the same inputs.

### What stays, restated

`packages/raster/test/{hosts,live}.test.ts` and `packages/server/test/live.test.ts` join
`packages/stream/test/stream.test.ts` in the list. Each has a **host** for a subject: two hosts
compared byte for byte, pixels read back out of chromium, three independent HTTP clients against a
real socket. Moving any of them would mean not testing the thing they exist for.

### `packages/http` — 2026-08-17, and what two of its files are blocked on

Six of eight moved. `nodeoracle.wac` and `responseoracle.wac` drive `oracle_node.mjs` and
`response_oracle.mjs`, which needed almost no rethinking: both were *already* one subprocess for a
whole batch — JSON of base64 cases in, JSON of outcomes out — arrived at independently and for the
same reason as `packages/wactest/src/oracle.wac`. `oracle_node.mjs` opens a socket per case, and one
process per case on top of that would have been unusable.

**Two oracles, two files, and not a preference.** An enum's variant names live in the file's scope,
so a second `Ok`/`Refused`/`Incomplete`/`Broken` cannot sit beside the first. `response_test.wac`
needs both and imports two names.

**`Cli.exec` passes no environment**, which is a deliberate limit — an inherited environment is a
capability nobody declared — so `oracle_node.mjs` grew `--nudge-ms=` beside
`WAC_HTTP_ORACLE_NUDGE_MS`. That flag was canaried before being trusted: a patient run that is
secretly the hurried run passes `oracle_test.wac` for nothing.

**What is left, and why.** `interop.test.ts` is the 2×2 — wac client against a Node server, `fetch`
against the wac server — and its diagonal is the whole point. It is blocked on the same gap as
`packages/ethrpc`: `issues/system/0165`'s **start a process and leave it running**. `Cli.exec` waits
for exit, and a server that has exited is not one a client can talk to. `tunnel.test.ts` builds
`example/tunnel.wac` and runs it against this container's Squid; that one is only blocked on wanting
a build step, and is smaller.

### `zstd` — 2026-08-17, and two shared helpers that were quadratic

Five of eight. `test/oracle.ts` is the reference zstd as a batch subprocess, `test/frames.wac` is the
header arithmetic that walks a real frame, and `test/writer.ts` travels through the oracle without
being one — it is an FSE description writer built from the same RFC section as the decoder and
deliberately not from it.

**`hex` in `packages/wactest/src/oracle.wac` built its string by concatenation**, which is fine for a
digest and ruinous for a corpus: zstd's decoder cases are two megabytes each and the first run did
not finish inside ten minutes. `Lines` carries that warning in its own header and `hex` sat beside it
without one. Both are `Buf`-backed now.

**The zstd oracle runs under Node rather than Deno.** Deno's `node:zlib` shim accepts zstd's
`dictionary` option and ignores it, so a frame compressed against a dictionary is byte-for-byte a
frame compressed without one — and two refusal tests were asserting something about an ordinary
frame. `node --experimental-strip-types` runs the same TypeScript. Worth generalising: **a shim is
not the implementation**, and an oracle reached through one can agree for the wrong reason.

### This issue was renamed under me, and an append went missing

Another agent shortened the filename while I was appending to the old one, so the merge resolved as
"deleted by them" and two sections went with it. Recovered from `git show` of the commits that added
them. Nothing was lost permanently, but the shape is worth naming: **appending to a file another
agent may rename is not a conflict git will show you** — it is a clean delete, and the merge summary
says `delete mode` rather than anything about content.

### The registrar tier is gone — 2026-08-17

`grep -rl wacTestRun packages/*/test/*.ts` now returns two files, and neither is a package handing
its subject a callback: `packages/wactest/test/assert.test.ts` tests the harness, and
`packages/wacc/test/nativeBinary.test.ts` tests the binary. Every `*_wac.test.ts` in the repository
is deleted. Sixteen of them went in one day — four in `crypto`, three in `tls`, nine in `tor` — and
what they had in common is worth writing down, because the same shapes will come up in the 232
`.test.ts` files that remain.

**Most of a registrar was never an oracle.** The callback was the only channel, so everything
travelled down it: JSON already committed under `test/data`, arithmetic, base64, string formatting.
`directory_wac.test.ts` had no host in it at all — it built a consensus, four microdescriptors and
two expectation tables in TypeScript and passed them over. Separating "what only the host can
answer" from "what merely arrived through the host" is the first thing to do with each one, and it
usually removes three quarters of the file.

**The stateful oracle needs its state named.** `packages/crypto`'s RSA ops and the consensus
fixtures both pick keys on one line that later lines use. Each batch is a fresh process, so a test
that signs with a key from one round and wants a verdict in the next must *name* the key it means —
`rsapub <n> <e>` exists because `rsakeygen` in the second round silently generates a different one,
and three tests failed on that before it did. Where the key cannot be named, every digest the test
wants signed has to be known before the batch goes out; `fixtures(t, cli, digests)` in
`consensus_test.wac` takes them as an argument for exactly that reason.

**Registrars did their own fixture validation at load time, and it should be a test.** Four of them
threw before any test ran — the mutation list must be all-refused, both sign bits must occur, tor
must have parsed the whole cell. Those are real checks and a stack trace is a bad way to deliver
them. They are `test_the_fixture_can_discriminate` and `test_the_fixture_covers_both_sign_bits` now.

**Some callbacks were restating their own argument.** `rsagen`'s `V_KEY_BITS` answered "how many
bits is this modulus" by dividing its length by 256. That assertion could not fail. It reads
openssl's `Private-Key: (1024 bit)` line now, and openssl is reached directly from wac — the test
assembles the PKCS#1 key, CRT parameters and all, and pipes the PEM to `openssl rsa -check`.

**Where the host is a *program* rather than a library, wac can usually drive it.** `crypto`'s
openssl call and `ntor`'s `test-ntor-cl` both go through `Cli.exec` with no JavaScript in between.
The exception is a program that insists on a file and wants the same one twice: `openssl verify
-trusted <self> <self>` is why `tls`'s `cert` op is still in Node.

**Regeneration living inside a test is a smell.** `ntor_wac.test.ts` re-recorded its own vectors
under `TOR_NTOR_REGEN=1`. That is `packages/tor/tools/capture-ntor.wac` now, beside its siblings —
and it builds its cases from the same `fill` the test does, because a recorded answer is only useful
for the exact question it answers.

**Deno is still the right host for exactly one oracle.** ML-KEM: node 22's WebCrypto refuses
`encapsulateBits` and the OpenSSL here is 3.0, which has no ML-KEM at all. Even 3.5 would not do,
because its CLI will not export a key's *seed*, and the seed is what makes that comparison
byte-for-byte rather than merely interoperable.

**A canary can fail to fire because the mutation did not happen.** Replacing
`Tor TLS RSA/Ed25519 cross-certificate` in `relaycert.wac` hit the occurrence in a comment eight
lines above the code, since that one comes first in the file. The test stayed green, which reads as
the oracle not being consulted. Assert the anchor, or mutate by line number.

**What the batch shape catches.** `tls/test/oracle.mjs` read the cipher suite as the string `"1301"`
where wac writes it in decimal, so every AES record went down the ChaCha path — and since the tag
then failed, it read as our sealing being wrong rather than as the oracle mistaking the suite. The
five ChaCha records passing beside the five AES ones is what named it. An oracle that had answered
one record at a time would have looked like a broken record layer.
