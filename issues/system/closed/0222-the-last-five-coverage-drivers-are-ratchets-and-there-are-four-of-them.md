# 0222 — the last five coverage drivers are exemption ratchets, and the ratchet is written four times

- **Status:** closed
- **Claimed by:** agent-b
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
| ~~`crypto`~~ | ~~1,101~~ | 28 → 32 | done 2026-08-20 — six of its entries were covered |
| ~~`zstd`~~ | ~~1,022~~ | 8 → 17 | done 2026-08-20 — the staleness check was hiding sixteen |
| ~~`ssh`~~ | ~~794~~ | 0 → 1 + 1 rule | done 2026-08-20 — and it did not go red |
| ~~`gzip`~~ | ~~605~~ | 3 | done 2026-08-20 — the contract this generalised |
| ~~`fs`~~ | ~~582~~ | 33 → 31 + 8 rules | done 2026-08-20 — two pins were one entry twice, about a covered branch |
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

## Both open questions have an answer already written in the tree — 2026-08-20

I filed this saying two things had to be settled. Reading the five ledgers rather than counting them,
both are already decided somewhere, and the strongest statement is gzip's `cov.ts`'s:

> Named rather than tolerated as a percentage below 100: a report that sits at 99.6% forever teaches
> everyone to ignore the last line, and then a genuinely new gap arrives and looks like the one that
> was always there. **Anything not listed here is expected to be covered and the run fails if it is
> not — and anything listed that *does* get covered fails too, since the reason has stopped holding.**

That is a **two-way ratchet** and it is the answer to question 1, not `fs`'s. `fs`'s category rules are
a *softening* — a way to speak for a group of points without naming each — which is a reasonable
convenience and a weaker guarantee. Generalise gzip's contract; keep categories, if at all, as sugar
over it rather than as the definition.

Question 2 answers itself the same way: a stale pin has to fail, because the point of the snippet is
that a line number alone is fragile. gzip says why, from experience — *"this list started out pointing
at line 306 and the comment explaining why moved the code to 322"*.

**And there is a third constraint I had not noticed: the output phrasing is an API.**
`tools/coverageAll.ts:168` matches on

    /no longer holds|is listed as unreached but was covered|branch point\(s\) uncovered|^error/

and line 153 decides whether a package "holds a coverage floor" by whether its output says
`branch point(s) uncovered`. So a shared ledger has to emit those exact strings, and the twenty-producer
convention `0161` mentions is narrower than it sounds: three phrases and a leading `error`.

## What is left to decide is therefore only the shape

The contract is settled; where the code lives is not. `covreport.wac` computes the missed set already,
so either it grows an optional pins input, or it splits into a library the per-package ledger programs
import. The second is better — a package's ledger wants to *be* a wac program holding its own pins as
data — but it means refactoring a file twelve packages now depend on, which is the part worth doing
deliberately.

Suggested order: extract the library, port **`gzip`** first because its ledger is three pins and its
contract is the one being generalised, and let the remaining four follow the template. `ssh` last,
since it has never had a ratchet and is the one most likely to go red.

## Done: the library, and `gzip` on it — 2026-08-20

`tools/wac/covledger.wac` holds `Point`, `Pin`, `uncoveredLines`, `ratchet`, and — because a ledger
needs the numbers as well as a verdict over them — `measure` and `report`, both lifted out of
`covreport.wac`'s `main`. That file is 400 lines to 90 and its output on `packages/codec` is
byte-identical.

`packages/gzip` is the first package on it: **449 of 452 points, the same three left, the same figures
the TypeScript reported**, in a 5.4s run. `packages/gzip/cov.ts` and `packages/gzip/test/streams.ts`
are deleted — the second because gzip's `cov.ts` was the last thing importing it, so the stream builder
exists once again instead of twice with nothing comparing the two.

Three things the port turned up that the remaining four will hit:

1. **A trap has to be an export, and that is a real bound.** The TypeScript wrapped about 2,500 calls
   in `ignoringTraps`, mostly sweeps — every byte of a valid stream flipped, every truncation of it.
   `wac covdump` catches one trap per named export, so 2,500 exports would be the transcription and is
   not a file anybody reads. The sweeps are *sampled at the boundaries between checks* instead: 36
   exports, one per refusal, each named for the rule its stream breaks. That reaches every point the
   sweep reached, because a sweep's value was never its density.
2. **Coverage caught a mislabelled export.** `trap_a_stored_length_and_its_complement_disagree` was
   carried over as `FF 00 00 FF` — which is a *correct* complement pair (0x00FF and 0xFF00), so it was
   refused for running past the end of the input and the complement check stayed uncovered while an
   export named for it passed. A refusal test cannot tell which check refused it; the counter can.
3. **`tools/coverageAll.ts` classified every wac driver as "reports and cannot fail"**, on the
   grounds that a coverage floor had no wac spelling. It has one now, so the classifier reads the
   `ratchet(` call — and gzip is counted among the floors rather than among the seventeen that exit 0
   whatever they measured.

**And a second instance of the bug that prompted this issue.** `covreport` prefixed its own failures
with `covreport: `, which matches none of the four phrases `coverageAll.ts` greps for — so an exercise
that did not build, or a table and a dump that did not describe the same module, exited 1 with its
reason filtered out and only "(nothing matched the known failure shapes)" on screen. `measure` says
`error:` now.

`tools/wac/covledger_test.wac` is the test none of the four ratchets had: six cases over synthetic
points driving all three failure modes plus the unreadable-file case.

## Done: `zstd`, and what a staleness-only ledger was hiding — 2026-08-20

**739 of 758 points against the TypeScript's 733**, and this ledger holds seventeen lines where that one
held eight. The eight were not a smaller problem — the old check was **staleness only**. It read the
source at each entry's line and failed if the snippet had moved; it never asked whether a listed point
was still uncovered, nor whether an unlisted one had appeared. Sixteen uncovered points were therefore
unlisted and unmentioned, which is the thing this issue was filed about, and `tools/coverageAll.ts`
classified the package as "only checks its own exemptions" rather than as holding a floor. It holds one
now.

Of those sixteen: **eleven were reachable and are now covered** — the streamed frame-header
cross-product (`headerLength` exists only for a reader that cannot look ahead, so driving those headers
through the buffered decoder reached `readHeader` and not it), the xxh64 range bounds that were never
ported at all, a not-single-segment frame declaring no content size, and the reference's many-block
frame for treeless literals and repeat-mode tables. **Five are new pins** with reasons written.

**And one of the old eight pointed at a line with no branch point on it.** The entry for
`encode.wac:367` named `} else {`, the three-byte sequence-count form. The instrumentation puts that
edge on the `} else if` at line 364 — verified against the `.cov` table, which has points at `364:10`
and none anywhere on 367. So the entry described nothing, its snippet matched, the check passed, and the
real uncovered point at 364 was one of the sixteen nobody had written down. A staleness check cannot
catch that. A two-way one fails it as *listed but covered*, because a point that does not exist is never
in the uncovered set.

`covdump` grew a **sweep** for this package (`[§wac-cli-covdump-sweep-4tn8mr6]`): `name:<n>` calls
`name(0)`…`name(n-1)` with each trap caught. Damaging six real frames at every byte under three masks is
thousands of calls and the old driver's own comment recorded that sampling reaches about half, "because
the checks are close enough together that stepping over bytes steps over whole branches". A name per
case was not an option.

Two constraints the remaining three will hit:

1. **A sweep export is handed its index and nothing else.** No capability, and wac has no module-level
   mutable state — `const` is deep-const — so a case cannot read what `main` set up and cannot ask an
   oracle. It has to recompute, which bounds how big its inputs can be. The frames zstd damages are
   built by its own encoder inside each case for exactly this reason; the reference's frames are driven
   from `main`, where a `Cli` exists.
2. **`main` is one call and a trap ends it.** Anything that might be refused belongs in a sweep. The
   refusing-sink calls sat in the middle of `main` at one point and took eight of `xxh64`'s branches with
   them — the drop from 46 covered to 40 is what said so, since a trapped `main` still prints its
   counters and reports the rest as simply unreached. What needs a `Cli` *and* might trap has to be last,
   and say so.

`packages/zstd/cov.ts` is deleted, and with it `test/frames.ts` and `test/reference.ts` — it was the last
importer of both. `test/writer.ts` stays: `test/oracle.ts` uses it, and it is deliberately a second
reading of RFC 8878 rather than the decoder's, so it is a structured fuzzer rather than an oracle.

## Done: `fs`, and the categories keep their place — 2026-08-20

**806 points and 679 covered, unchanged**, because the workload was unchanged: `test/wac/cov_probe.wac`
has been the whole of it since the probe existed, and the TypeScript instrumented it, called its
thirteen exports and held the ledger. So `cov_exercise.wac` here is the calling and nothing else.

**The open question is answered: category rules survive as sugar over the two-way contract.** They are
not a weaker alternative to it. 94 of this package's 127 uncovered points are one fact repeated — an arm
needing a `Cli` only a built program has, or a peer only a real parent process can be — and 94 pins
would each carry the same sentence. `Rule` states it once and says which points it covers, with three
scopes (the point's own line, its enclosing declaration, its enclosing `struct`) and the same staleness
property a pin has: a rule that matches nothing fails.

Two defects found on the way, both invisible to a staleness-only check:

1. **Its principal failure could not be reported, and it was mis-classified.** The message was "N
   uncovered branch point(s) are not accounted for" — the same words `tools/coverageAll.ts` greps for,
   in the other order — so an unaccounted point exited 1 with nothing on screen but "(nothing matched
   the known failure shapes)". That same phrase is how `coverageAll.ts` decides a package holds a
   coverage floor, so the strictest ledger of the five was counted among the ones that only check their
   own exemptions. Fixed in the TypeScript before the port, so the fix stands on its own.
2. **Two of its 33 pins were the same entry twice, about a branch that is covered.** Both named
   `image.wac:336`, reason "one of the two `r.bad` checks … reachable, and not constructed"; all five
   `r.bad` checks in that file are covered. Line 336 still holds that text, so the snippet matched both
   times and the check passed. The two-way ratchet fails it as listed-but-covered. 31 pins remain.

That is the **third** vacuous entry this issue has turned up — after zstd's pin on a line with no branch
point at all — and they share a shape: a staleness check can only ask whether a line still says what it
said, never whether the claim about it is still true.

## Done: `crypto`, and the driver could not call its own tests — 2026-08-20

**1140 of 1173 points, against the TypeScript's 974 of 1053.** More points seen *and* fewer missed, and
one thing explains it: `harness/wacCoverage.ts`'s `runTestExports` skips any test whose `fn.length > 0`,
because `instrument` and `wacBind` cannot supply a capability. **64 of this package's 152 returning tests
were unreachable from its own coverage driver**, and it made up the difference with about six hundred
lines of hand-built probe calls. `wac covdump` runs the ordinary program path (`issues/system/0221`), so
the exercise's `main` has a real `Core` and `Cli` and calls them.

Measured on the way: the tests *alone* reach 1100 of 1173. The probe half still earns its place — the
tests leave 73 points, concentrated in `sha1.wac` (15), `weierstrass.wac` (14), `rsa.wac` (11) — because
a test asserts an answer at one or two lengths where coverage wants every arm. But five sixths of those
six hundred lines were driving what the tests already drive.

**`MEASURED_BY_THE_BINARY` is gone.** That list existed for one entry, and it was a good answer to a
real problem: all five of `mlkem_test.wac`'s tests take `(Core core, Cli cli)`, so the driver called none
of them and reported fifty of `mlkem.wac`'s points uncovered, while `wac test --coverage` read 125 of
132. So it spawned the binary, took that measurement every run, and required the figure in both
directions. `mlkem.wac` reads **131 of 132** here, in the same counter array as everything else. A
measurement in one place beats a measurement asserted from another — `issues/system/0200` is updated.

**And six of its 28 entries were covered** — `ed25519.wac` lines 70, 75, 107, 113, 153 and 394, which the
expanded-key and prop228 tests reach. The old check only asked whether the snippet had moved, so it would
have kept printing their reasons for ever.

Seventeen of the 32 pins are `proven: false`. That is the highest proportion of any package here and it is
the right answer: an ECDSA verification landing on the identity is *constructible by an attacker* choosing
r and s together, which is exactly why the check exists. The flag is set from what each reason actually
claims — "no input reaches it" against "reachable with the right scalar" — rather than from which list it
lived in, because `UNREACHED` had no such field and calling all 28 unreachable would have buried thirteen
gaps among the exemptions.

`packages/crypto/cov.ts` is deleted, and `test/rsaOracle.ts` with it — the driver was its only importer.

## Done: `ssh`, the one with no ledger — and it did not go red — 2026-08-20

**605 of 672, against the TypeScript's 561**, and the 67 left are two claims rather than sixty-seven:
`conn.wac`'s `struct Conn`, which is the whole client session, and one line in `privatekey.wac`. The
other eleven source files are at 100%.

This was the package with no ledger *at all*: it measured 561, printed the 111 it missed and exited 0, so
an uncovered branch arriving was indistinguishable from the hundred and eleven that were always there.
Of the five drivers named above this was the one most likely to go red on being given a ratchet.

The 44 points came from two things the old driver could not do. The **tests** — 29 of the 32
non-exclusive ones take a capability, and `runTestExports` skips any test whose `fn.length > 0`. And
**five parsers the probe does not wrap**: `requestName`, `requestWantsReply`, `readOpenChannel`,
`readPtyReq` and `readWindowChange` need no capability and no port, so 24 of `server.wac`'s 26 uncovered
points were reachable by calling them. Pinning those would have been a ledger entry for something a call
reaches.

`struct Conn` is the one place a rule does what only a rule can: 46 lines, one sentence. Its methods are
the version exchange, the key exchange, NEWKEYS, the service request, authentication, the channel and the
exit status — all of it needing a peer, and the peer that matters is a real OpenSSH server.
`live_test.wac` and `cli_test.wac` drive it and both declare `test-lane: exclusive`, because they bind a
real port and start a real `sshd`. A coverage driver that ran them would race that lane, and two runs
binding one port do not fail cleanly — they interleave, and the loser reports a protocol error about the
wrong thing.

## Closed — 2026-08-20

All five have moved. `tools/coverageAll.ts` reads **5 hold a coverage floor, 0 only check their own
exemptions have not drifted**, where it read 2 and 2 when this was filed.

| package | before | after |
|---|---|---|
| `gzip` | 449/452, 3 pins | 449/452, 3 pins |
| `zstd` | 733/758, 8 pins, staleness only | **739/758**, 17 pins, two-way |
| `fs` | 679/806, 33 pins + 8 categories | 679/806, 31 pins + 8 rules |
| `crypto` | 974/1053, 28 pins | **1140/1173**, 32 pins |
| `ssh` | 561/672, **no ledger** | **605/672**, 1 pin + 1 rule |

Four vacuous entries turned up, all invisible to a staleness-only check: zstd's pin on a line with **no
branch point on it**, fs's **same entry twice** about a covered branch, and six of crypto's 28 that were
already covered. They share a shape — a staleness check can only ask whether a line still says what it
said, never whether the claim about it is still true.

And three instances of the phrasing defect that prompted this issue: gzip's `unreachable` for
`unreached`, `covreport`'s own failures prefixed `covreport: `, and fs's principal failure saying the
right words in the wrong order — which also had it classified as holding no floor when it is the
strictest of the five.

`packages/sh/cov.ts` is the sixth driver and belongs to another agent; it is out of scope here, and
`tools/coverageAll.ts` counts it among the sixteen that report and cannot fail.

## Notes

Nothing here blocks anything. The fourteen converted packages are all green and
`deno task coverage:all` is 21/21; these five keep working exactly as they did. The cost of leaving it
is that five packages' coverage stays on Deno and one of them has an unchecked ledger.

Measured while porting the fourteen: `packages/bytes` gained **nineteen** branches purely because the
wac exercise derives its trap-probe names from the file instead of listing seven by hand, and
`packages/fmt` gained three because its second entry point turned out to cover none of what it existed
for. A ledger nobody re-derives drifts the same way a probe list does.
