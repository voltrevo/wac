# 0205 — fifteen of nineteen coverage tasks cannot fail, and the summary said "19/19 passed"

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-18
- **Kind:** missing feature
- **Symptom:** no error

## What is true

`deno task coverage:all` ran nineteen drivers when this was filed; it runs twenty-one now and the split
has changed — see the section at the end, dated 2026-08-20. As filed, sorted by what each one holds you
to:

- **two hold a coverage floor** — a branch point nothing reaches must carry an entry saying why, and an
  entry that names a line it no longer matches, or a point it claims is unreached while something
  covers it, fails the run. `packages/crypto/test/cov_ledger.wac` is the worked example.
- **two only check their own exemptions have not drifted.** They fail when an entry points at the wrong
  line; they say nothing about coverage falling. zstd's `cov.ts` ended `if (stale) Deno.exit(1)` — and
  it is `packages/zstd/test/cov_ledger.wac` now, which holds a floor as well (`issues/system/0222`).
- **fifteen report and cannot fail.** They end with `report(...)` and exit 0 whatever they measured.

The summary line said `19/19 passed`, and `tools/push.sh` prints underneath it that "a package above is
below its recorded coverage" — a sentence true of two of them. So a package that lost half its coverage
was reported as passing, in a block that reads like a gate.

Fixed as far as it can be without deciding anything: the line now reads

    19/19 ran in 11s (35s of work at 4 workers) — 2 hold a coverage floor, 2 only check their own
    exemptions have not drifted, 15 report and cannot fail

counted from the drivers rather than hardcoded, so it follows them.

## The decision

Should the fifteen hold floors? It is not obviously yes, which is why this is an issue rather than a
commit.

- **For.** A number nobody is held to drifts, and this repository's whole argument for the ledger is that
  a measurement with no consequence is decoration. `crypto` was red for days and the gate printed
  "pushing anyway, and this is not fine" every run — but that at least *said something*; fifteen silent
  reports say nothing at all.
- **Against.** A floor is only meaningful where the driver can reach what the tests reach. `crypto`'s
  could not — all five `mlkem_test.wac` tests take `(Core core, Cli cli)` and it can supply neither, so
  its floor needed `MEASURED_BY_THE_BINARY` to be honest (`issues/system/0200`). Any package whose tests
  need a host has the same problem, and a floor recorded against a driver that cannot run them is a
  number that means "what the probes happened to reach".

So the order that makes sense is: **give the drivers a way to see what the binary sees, then add floors.**
`prog.cov` already holds the per-point table and `native/v8/src/main.rs` reads it out of a temp directory
it then deletes; a flag that wrote it out would let a driver union the binary's measurement with its own.
`0200` records that.

## The first floor added, and there is no blocker left for the other fourteen — 2026-08-20

`packages/datetime/test/cov_ledger.wac`, and the split reads **6 hold a coverage floor, 0 only check
their own exemptions have not drifted, 15 report and cannot fail.**

**The "Against" argument no longer applies to any of them.** It was that a floor is only honest where
the driver can reach what the tests reach — and the check that matters is not whether a package's tests
need a host, it is whether its *exercise* is wac. `wac covdump` runs the ordinary program path
(`issues/system/0221`), so a wac exercise's `main` has a real `Core` and `Cli`.

Counted: **all fourteen remaining report-only packages already have a `test/cov_exercise.wac`** —
`bignum`, `bytes`, `codec`, `fmt`, `http`, `json`, `raster`, `regex`, `server`, `stream`, `unicode`,
`url`, `wacpkg`, and `datetime` which now has the ledger. Not one is blocked. There is no
`test/cov.ts` left in `packages/` at all.

`datetime` went first because it reads **123 of 123**, so both lists in its ledger are empty — which is
the strongest form of this ratchet rather than a placeholder: every branch point is expected to be
covered, and the first one that is not fails by name. It also means the first floor needed no arguments
to be written, so what is being tested here is the machinery and not somebody's prose.

**Both directions canaried**, because with empty lists it would be easy to ship something that cannot
fail:

| perturbation | what it says |
|---|---|
| pin a line that *is* covered | `civil.wac:1 is listed as unreached but was covered. That reason no longer holds — drop the entry.` |
| gut the exercise's `main` | `123 / 0 / 0.0%`, and `59 reachable branch point(s) uncovered` |

And one attempt that was **not** a valid canary, which is worth recording: deleting the exercise's
far-date loop left coverage at 123 of 123, because the day-by-day loop below it already reaches those
branches. A perturbation that removes redundant work proves nothing, and it looked like a passing
canary for a moment.

### `codec` second, and three of its four gaps were closed rather than blessed

**7 hold a coverage floor, 0 only check their own exemptions have not drifted, 14 report and cannot
fail.**

It read 186 of 190, and writing four pins would have been the quick way. Three were not exemptions:

- `hex.wac:73` was `decoded`'s **entry**. That file offers two decodes — `decode` answering `null` for
  a caller that must handle malformed input, and `decoded` trapping for one asserting there is none —
  and `test/probe.wac` wrapped only the first, so nothing in this package's coverage had ever called
  the trapping one;
- `hex.wac:75`'s two arms follow. The `else` is an ordinary call now; the `then` is a named trap case.

**An uncovered *entry* is the strongest form of a lead**: not a branch nobody took but a function
nobody called, which means nothing was asserting anything about it. Pinning one is how a ledger becomes
a list of things nobody looked at — which is the failure this issue is about, one level in.

189 of 190 now, with one pin: `base32.wac`'s `digitsFor(0)`, whose two call sites both guard `> 0` and
which is private to its file, so the argument is closed rather than probable. Kept because the function
is total over its documented domain.

Canaried both ways: breaking the pin's snippet reports "no longer holds", and dropping the trap case
from `cases()` reports "1 reachable branch point(s) uncovered".

### `unicode` third, and it found the thing this issue was arguing about

**8 hold a coverage floor, 0 only check their own exemptions have not drifted, 13 report and cannot
fail.**

Its three gaps were not the code's testing but **the driver's reach**, and that is the "Against"
argument in this issue, live: nine of `unicode`'s thirteen tests take `(Core, Cli)`, so before
`issues/system/0221` the exercise could not call them and was written as hand-built probes instead.
`wac covdump` runs the ordinary program path, so `main` gets a real `Core` and `Cli` and calls all
thirteen. The ledger passes the grants they need — read, write, run, env, and deliberately not net.

**Only three of nineteen exercises had been rewired when this was written**: `crypto` with 288 test
calls, `ssh` with 32, `wacpkg` with 2. Sixteen were still measuring their probes. That is the number
worth knowing before anyone sets the remaining floors, because a floor over a probe corpus records what
the probes happened to reach — the exact sentence this issue used to argue against floors, and now a
fixable one.

What it recovered, and what it did not:

- **`encodedLength` refusing a surrogate** was a real gap, and a small one: the exercise's main loop
  *skips* surrogates and its edge list had none. Closed by adding `0xd800` and `0xdfff` to the list;
- **`utf8.wac:45`, the over-long two-byte check, is unreachable** — and it reads like the opposite. An
  uncovered over-long check looks exactly like the classic UTF-8 attack going untested, and `0xC0 0x80`
  *is* in `unicode_test.wac`'s rejection table. It is rejected sixteen lines earlier, by
  `if (b0 < 0xC2)`, so a two-byte sequence reaching line 45 has `code >= 0x80` and the condition cannot
  hold. Pinned with that argument rather than with "no test covers it";
- **`encode`'s fall-through** past all four arms needs `encodedLength` to answer 0, which only a caller
  ignoring that same answer can arrange. Pinned as the defensive arm it is.

106 of 108. The lesson for the remaining thirteen: **rewire the exercise to call the tests first, then
read what is left.** Doing it the other way round would have written three pins here, one of them
claiming a security-relevant check was untested when it was unreachable.

### `bytes` fourth, and the trap tests are the trap in this work

**9 hold a coverage floor, 0 only check their own exemptions have not drifted, 12 report and cannot
fail.**

Six of its seven uncovered points were one function — `slice.wac`'s `equal`, whose **entry** was
uncovered. It had **no test at all**, in its own package, while `packages/ssz`, `packages/ens` and
`packages/tls` all import from that file. One is written now, pinning among other things the
"empty equals empty" its doc comment argues for.

And **none of this package's 39 tests takes a capability**, so its exercise could have called them
since the day it was written. `0221` removed the blocker for packages whose tests need one; this was
never in that set. It was simply never wired — which is the more common case, and worth knowing before
attributing the other thirteen to `0221`.

**The mistake to avoid, because it looks exactly like success.** Wiring all 39 into `main` changed the
number *not at all* — 73 of 80 before and after, no failure printed. Twelve of `bounds_test.wac`'s
seventeen tests **expect a trap**, and a trap in `main` ends the run: the third call killed the process
after the probes had already covered their 73. A report identical to the one before the change reads as
"the wiring did nothing" and meant "the wiring stopped the run".

So the wiring is a split: the tests that return are called from `main`, and the ones that trap go into
a `trapCase(i32)` sweep named in `cases()`, which `covdump` calls one at a time with the trap caught.
**Every package left here will need that split**, and the tell is `test_traps_` in the name — `crypto`
already does it as `trapCase:130`.

79 of 80, with one pin: `buf.wac`'s clamp of the capacity doubling at `i32.MAX`. `proven: false`, not
`true` — reaching it needs a real two-gigabyte allocation on every `coverage:all`, which is a line
whose *input* costs too much, not a line no input reaches. Calling it unreachable would be a false
claim about the code: the clamp is the only thing between `cap * 2` overflowing and
`u8[cap as! i32]()` being handed the result.

### `stream` fifth, and it is the one package that cannot be rewired

**10 hold a coverage floor, 0 only check their own exemptions have not drifted, 11 report and cannot
fail.** 32 of 32, with both lists empty.

`packages/stream` has **no wac tests at all** — its subject is `host/bridge.ts`, a WHATWG
`TransformStream`, which `issues/system/0161` records as staying TypeScript for that reason. So the
"rewire the exercise to call the tests" step does not apply, and reading the exercise's gaps was the
only way to find anything.

It found something. All four uncovered points were two pairs of one thing: `case Failed(why)` in both
`passthrough` and `upperCase`, and the `broke ? -2 : total` each returns because of it. `Read` has
three variants and the exercise's `Feeder` only ever answered two — so **the failure path of both
transforms was measured by nothing**, and what those points defend is what `transform.wac`'s comment
says: "a broken input is its own answer, not a smaller total". A caller that could not tell -2 from a
short count would treat a failed read as a successful short one.

Closed rather than pinned: `Feeder` gained a `feedFailing`, and the exercise fails on the first read
and on two later ones — later matters, because by then bytes have been written and `upperCase` is
holding a partial scalar. Canaried by removing the failing reads again: 28 of 32, four uncovered.

**The general shape, after five packages**: an uncovered point in one of these drivers is more often a
hole in the driver than a fact about the code. Five for five so far — a function nobody called
(`codec`, `bytes`), a code point the loop skipped (`unicode`), a variant nobody produced (`stream`) —
and only four genuine exemptions among them.

### `server` sixth: 117 → 123 of 126, and one entry that says "I do not know"

**11 hold a coverage floor, 0 only check their own exemptions have not drifted, 10 report and cannot
fail.**

All nine gaps were in `routes.wac`, and six closed by writing requests nobody had written:

- an **unparseable request target** (the `400`), and an **empty path segment** (`/echo//a//b`);
- a **regex match that does not start at byte 0.** `writeInt` writes the `"start"` field of the match
  route's JSON, and every `/match/` request in the corpus matched at the first byte — so the integer
  writer had only ever been handed **zero**, leaving both its loops and its `v == 0` else uncovered.
  One request fixed three points;
- **control bytes JSON must escape**, which took two attempts: a literal control character in the
  request target does not survive the request parser, so the first version covered nothing. `%1A` and
  `%1F` percent-encoded do, because `pctDecode` produces them.

Two of the three left are provably unreachable — the *high* nibble of a character below 0x20 is never
ten or more, and `writeInt`'s one caller is inside `if (start != NO_MATCH())` where `NO_MATCH()` is the
only negative the regex returns.

**The third entry says it is unresolved, and that is deliberate.** `segments`' one-slot allocation
wants a path of only slashes; `//`, `///`, `////` and `//?x=1` all failed to reach it, most likely
because the URL parse normalises the path before routing sees it. I did not establish which, so it is
`proven: false` with the four failed inputs and the one hypothesis written down — rather than
`proven: true`, which would be a claim about the code I have not earned. **A ledger that cannot say "I
do not know" collects false confidence**, which is the failure this issue is about wearing a different
hat.

### `url` improved and **not** given a floor, which is the other honest answer

Still 11/0/10. `packages/url` is at 716 of 727 with its own 27 tests now in the measurement, and it is
not getting a ledger yet. Two reasons, and the second is a finding.

**Its driver was already as good as its tests.** Rewiring the exercise to call all 27 — eighteen of
which take `(Core, Cli)` and so were unreachable before `issues/system/0221` — changed the number by
*zero*. Canaried: a deliberate `t.fail` in one of them prints `error: FAILED url_test …`, so they do
run and they cover nothing the probes did not. That is the first package of seven where the driver was
not the problem, and it is worth knowing that the streak ends somewhere.

**Its corpus is a *randomly sampled* cross product.** `cov_exercise.wac` builds scheme × separator ×
userinfo × host × port × path × query × fragment and draws **4000 of them** with a fixed-seed `Rng`. So
adding one entry to any of those lists re-rolls every draw — which is `issues/system/0212`'s defect
exactly, one directory over: a coverage figure that moves when an unrelated input is added.

Demonstrated while trying to close the gaps. Thirteen hosts added to the sampled list took it from 712
to 717; the *same* inputs written as complete URLs in the hand-written list took it to 716. The extra
point in the first version came from the re-roll, not from the inputs. So the inputs went in the
deterministic list, and a floor over the sampled number would be a floor over a lottery.

**What was closed, deterministically:** the `A`–`F` arm of `hexVal` — only lowercase hex had ever been
parsed — a non-hex digit inside a `0x` part, an embedded IPv4 piece with a leading zero, and a trailing
single colon in IPv6.

**What resists:** eleven points, including `parseOpaqueHost`'s bracket check, which `foo://[::AB]/`
does not reach. Eleven pins where several would have to say "I could not reach it" is worse than no
floor — that is a list of low-confidence prose, which is the failure this issue is about. The
sampled-corpus problem wants fixing first, and then the eleven want reading one at a time.

### `bignum` seventh: 226 → **230 of 230**, and a seed test worth doing before each floor

**12 hold a coverage floor, 0 only check their own exemptions have not drifted, 9 report and cannot
fail.**

All four gaps were the `bits == -2147483648` handling in `shl` and `shr` — the guards that stop
`-i32::MIN` being `i32::MIN` from recursing for ever, GitHub wac-mono#4. **Both are tested**, by
`test_shifts_the_most_negative_count` and
`test_traps_shifting_right_by_the_most_negative_count`, each with a paragraph explaining itself. What
could not reach them was this driver: 25 of the package's 46 tests take `(Core, Cli)`. Four pins saying
"no test covers this" would each have been false.

**What the grants are worth, measured:** dropping them from the ledger takes this package from 230 of
230 to **126 of 230**, because every host-comparing test then fails. That is the size of what
`issues/system/0221` unlocked, in one package.

### The seed test, and which packages fail it

`packages/url` is report-only because its corpus is a *sampled* cross product, so its number moves when
an unrelated input is added. That raised a fair question about the floors already set, since seven
exercises seed an `Rng`. Answered by changing the seed and re-running:

| package | covered before | after a different seed |
|---|---:|---:|
| `datetime` | 123 / 123 | 123 / 123 |
| `unicode` | 106 / 108 | 106 / 108 |
| `bignum` | 226 / 230 | 226 / 230 |
| `http` | 404 / 447 | 404 / 447 |
| `regex` | 573 / 649 | 573 / 649 |
| **`fmt`** | **383 / 429** | **382 / 429** |

So the test is not "does it use an `Rng`" — it is "does the number move when the seed does". Five are
insensitive because their sampling *adds* to a hand-written set of edge cases; `url` and `fmt` are the
two where the sample is load-bearing, and both want that dealt with before a floor.

### The ordering for the remaining fourteen

By how much argument each needs, which is how many points are uncovered: `unicode` 105/108,
`bytes` 73/80, `stream` 28/32, `regex` 573/649. A package at 88% wants seventy-six arguments, and
writing seventy-six is how a ledger becomes a list nobody reads — so the low ones first, and the high
ones may want their coverage *raised* before their floor is set rather than their gaps blessed. `codec`
is the evidence for that: its report was four gaps and only one of them was a fact about the code.

## One trap for whoever does this, measured

**Do not compare the two instruments on generic code.** `packages/std/src/map.wac` reads `56/56` from its
driver and `138/392` from `wac test --coverage`, and the driver is the one answering the useful question.
`Map<K, V>` is monomorphised, so the binary counts every instantiation's copy of each branch separately —
seven instantiations of a 56-point file is 392 points, and exercising one of them fully leaves the rest
untouched. Per-instantiation counters *understate* whether the source is tested. The driver dedupes by
source position, which is what "is this branch tested" means.

The comparison is valid where both denominators agree, and there it found real gaps: on
`packages/sh/src/exec.wac` the driver reaches 1080 of 1942 where the binary reaches 1113, because
`sh`'s host-needing tests do run there. No *false* ledger entry turned up in the audit — the entries
checked were all trap guards, correctly named.

## The blocker in "Against" is gone, and the trap above was half true — 2026-08-20

**The argument against floors was that a driver cannot reach what the tests reach**, with `crypto` as
the worked example: all five `mlkem_test.wac` tests take `(Core core, Cli cli)`, `instrument` can supply
neither, so its floor needed `MEASURED_BY_THE_BINARY` to be honest.

That is no longer true and the fix was not the one this issue proposed. `wac covdump` runs the ordinary
program path (`issues/system/0221`), so a **wac** exercise's `main` has a real `Core` and `Cli` and
simply calls those tests. `packages/crypto/test/cov_exercise.wac` does; `mlkem.wac` reads 131 of 132 in
the same counter array as everything else, against the 125 the binary was being asked for, and
`MEASURED_BY_THE_BINARY` is deleted. The same sentence in `harness/wacCoverage.ts` was hiding **64 of
`packages/crypto`'s 152 returning tests and 29 of `packages/ssh`'s 32** from their own drivers —
`runTestExports` skips any test whose `fn.length > 0`.

So the ordering this issue sets out — *give the drivers a way to see what the binary sees, then add
floors* — is satisfied for any package whose tests are wac, without the `prog.cov` flag it proposed.
What is left of the decision is whether the sixteen *should* hold floors, which is still not obviously
yes and is still not mine to decide alone.

**And the trap note above was true of one driver and not the other.** "The driver dedupes by source
position, which is what 'is this branch tested' means" was true of `harness/wacCoverage.ts`, which keys
on `(file, line, col, kind)` and unions — and false of `tools/wac/covreport.wac`, which counted raw
points from the day it was written. Every package converted off a `cov.ts` was measured raw. It went
unnoticed because it only shows where one source position is instantiated more than once, and it showed
the moment `core/` moved: 848 points at **159 distinct positions**, reading 35.3% against the
TypeScript's 100%. `Merged` in `tools/wac/covledger.wac` is the rule restated, and none of the
twenty-one already-measured packages moved when it landed — which is what says the fix corrects `core`
without disturbing what was already right.

The counts in this issue are now **5 hold a coverage floor, 0 only check their own exemptions have not
drifted, 16 report and cannot fail**, out of twenty-one. `ssh` is the fifth floor: `issues/system/0222`
gave it a ratchet, which it had never had.
