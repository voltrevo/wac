# 0253a — one non-ASCII character in a comment breaks the self-host fixpoint

- **Status:** open — **but it does not reproduce as of 2026-08-25**; see the section at the end before spending time on it
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-24
- **Kind:** bug
- **Symptom:** `test_rung_5_wacc_compiled_by_wacc_compiles_wacc_to_the_same_bytes` fails

## Reproduction

Add one non-ASCII character to a **comment** in any file wacc is built from, regenerate and reseed:

```
$ python3 - <<'PY'
p = "packages/wacc/src/check.wac"; s = open(p).read()
a = "/** Whether `sub` inherits from `super`, which is what makes a cast between them a downcast. */"
open(p, "w").write(s.replace(a, a[:-3] + " é */"))
PY
$ deno task seed          # "fixed point after 1 round(s)" — the seed's own check passes
$ wac test packages/wacc/test/wac/selfhostemit_test.wac
FAIL test_rung_5_… — wacc compiled by wacc does not reproduce wacc:
  stage B=-572839077, stage A=-200838132
```

`std/platform.wac` does it too, by way of `coretext.wac`, which embeds that file's text as string
literals — that is how it was found, adding two em dashes to a doc comment.

## What it is not

- **Not the size of the change.** 600 characters of ASCII padding added to the same comment: passes.
  Two characters of ASCII: passes. One `é`: fails. One `—`: fails.
- **Not the stage-A cache.** `.cache/_selfhost.wac` and `.cache/_selfhost_stageA.txt` deleted, so both
  halves are recomputed: still fails.
- **Not a stale seed.** `deno task seed` reports "fixed point after 1 round(s)" on the broken tree —
  its own round-1-against-round-2 comparison is satisfied. Only rung 5, which seeds stage A from the
  **reference**, disagrees.
- **Not one file.** `packages/wacc/src/check.wac` and `std/platform.wac` both do it.

## Why it is strange

**A comment does not reach the emitted module.** Whatever the two compilers disagree about, they
disagree about it while compiling text that changes no code — so the difference is in something
derived from the source *bytes* rather than from the program. The obvious suspect is a length counted
in bytes by one compiler and in characters or UTF-16 units by the other, landing somewhere that
reaches the output; a `é` moves those two counts apart by one and 600 ASCII characters move them
together.

That is a guess and is written as one. What is measured is the table above.

## Why it matters

`spec/tour.wac` and every source in this repository use em dashes freely — this file has several — so
the trigger is ordinary prose in a house style that encourages it. The failure appears in the *suite*
rather than at the edit, and `deno task seed`'s own fixpoint check does **not** catch it, so the first
sign is a red rung 5 some minutes later with no obvious connection to what was typed.

It also means the reference and wacc do not agree about wacc's own source in general, which is the
claim rung 5 exists to make. Whether the divergence is confined to comments is unknown: a comment is
simply the cheapest place to see it, because a change there cannot be excused by a change in the
program.

## Workaround, and where it is already applied

Keep the text ASCII. `std/platform.wac`'s `Captured.truncated` comment says "capped at 8 MiB" rather
than "capped — 8 MiB —" for exactly this reason; the em-dash version of that sentence is what turned
rung 5 red, and the hyphen version is green. That is a workaround and not a fix, and it will be
forgotten the next time somebody writes a sentence the way the rest of the repository writes them.

## The stated suspect is ruled out, and here is where the bytes actually travel — agent-c, 2026-08-25

The note above names its own guess: *"a length counted in bytes by one compiler and in characters or
UTF-16 units by the other"*. **Measured, and it is not that** — at least not for a string literal. One
source, compiled by both compilers, each module instantiated and its exports called:

    literal "aébc"      reference   wacc
      len()                 5          5
      toBytes().len()       5          5
      indexOf("b")          3          3
      slice(0, 2).len()     2          2
      toBytes()[1]        195        195      (0xC3, é's first byte)

So both model a string as bytes, both slice by bytes, and both agree on the raw bytes of a non-ASCII
literal. `tools/` has no probe for this; it is twenty lines of Deno over `wacCompile` and
`waccArtifacts`, worth keeping if this is picked up.

**Where the bytes do travel is the driver.** `selfhostemit_test.wac` generates `.cache/_selfhost.wac`,
1.4 MB of wac that carries every one of wacc's sources as string literals — so a byte in a *comment*
becomes literal *content*, which is how a comment can reach the output at all. Two details of that
generation are worth the next experiment:

- `literalOf` (`source_probe.wac:118`) escapes `\\`, `"`, `\n` and `\t` and passes **every other byte
  through raw**, so the driver contains raw UTF-8.
- The text is **chunked at 3,000** — *"a literal is one `array.new_fixed` and an engine caps how many
  elements that may have"* — and each chunk is a separate literal joined by `+`.

If a chunk boundary lands inside a multi-byte sequence, the driver is **invalid UTF-8**: one literal
ends with a lead byte and the next begins with a continuation. wacc reads bytes and concatenates to the
right answer; anything that reads the file as UTF-8 *text* cannot, and `harness/referenceRun.ts` is what
compiles the driver for stage A.

**The experiment that would settle it**, and it needs no reseed: run rung 5 once so the driver is
written, then ask whether `.cache/_selfhost.wac` is valid UTF-8, and whether the invalid sequence is at a
multiple of 3,000. If it is, the fix is to chunk on a character boundary rather than a count — and the
chunker is the one place to change.

**What does not fit, stated because it is the reason to run it rather than believe it:** a single `é`
should only be split if a boundary happens to land on it, which is about one chance in three thousand,
and the report above says any `é` fails. So either the boundary is not the mechanism or the chunking is
not where I think it is. That is a question for the driver on disk, not for more reading.

### ...and that hypothesis is refuted too — same day, fifteen lines

`chunkedLiteral` does slice at multiples of 3,000 **bytes** with no character-boundary check, so a split
is possible. It also already happens. On the tree as it stands:

    bindgen.wac   1 boundary split   [24000]
    check.wac     1                  [63000]
    emit.wac      2                  [450000, 519000]
    lex.wac       1                  [3000]

Five boundaries land on a UTF-8 continuation byte, over 18 files carrying 14,761 non-ASCII bytes — and
**rung 5 passes on this tree**, measured immediately before. So a character split across two literals is
not what breaks it, and whatever compiles the driver for stage A copes with the driver already being
invalid UTF-8.

Which also disposes of the objection I raised against my own guess: it was the right objection, and the
answer is that the mechanism is not boundary-shifting at all. "Two characters of ASCII passes, one `é`
fails" still wants explaining, and it is not the boundary.

**What is now ruled out, each by measurement rather than reading:**

- byte-versus-UTF-16 length in a string literal — both compilers agree on `len`, `toBytes().len`,
  `indexOf`, `slice` and the raw bytes of `"aébc"`;
- a multi-byte character split across two of the driver's literals — already present, five times, green.

**What is not yet looked at**, and is where I would go next: the `é` in the reproduction is in a
*comment*, and a comment is the one place a byte can change without changing the program. Both
compilers' **lexers** must skip it. If one advances by a byte and the other by a character, every
subsequent token's recorded position differs — and positions do not reach a module's bytes, but they do
reach `fileOf(line)`, which is how the emitter decides which *file* a declaration belongs to when many
are linked. The driver is one file, so that specific path is out; what is worth checking is whether any
`line` or `col` recorded by the lexer reaches the emitted output, and the cheapest way is to compile a
two-line source with and without a comment `é` and diff the modules byte for byte.

### And neither compiler is comment-sensitive on its own — so it needs the driver

The cheapest version of the last paragraph's experiment, run rather than proposed. Two sources differing
only by an `é` inside a `//` comment:

    wacc        both 1075 bytes, sha256 71b62f7732efabb9…   identical
    reference   both 1979 bytes, sha256 9ad4ed299627615e…   identical

So a comment `é` changes neither compiler's output for a small file, and any lexer position that differs
does not reach the module. Whatever rung 5 sees needs the driver: 1.4 MB, every wacc source as literals,
and a checksum computed over them at run time.

**Four things ruled out, each measured:**

1. byte-versus-UTF-16 length in a string literal — both agree on `len`, `toBytes().len`, `indexOf`,
   `slice` and the raw bytes of `"aébc"`;
2. a character split across two of the driver's literals — five such boundaries exist on the green tree;
3. wacc being sensitive to a comment `é` — byte-identical;
4. the reference being sensitive to a comment `é` — byte-identical.

**I did not find it.** What I would do next, in this order: reproduce (add the `é`, reseed, run rung 5),
then keep the driver — the test deletes it, and the one-line change to leave it behind is the difference
between guessing and diffing. With the failing driver on disk, compile it with each compiler and diff the
two modules; the first differing section says which part of a 1.4 MB literal-carrying file the two
disagree about. Everything above is an attempt to avoid that reseed, and the attempt failed.

## It does not reproduce — agent-c, 2026-08-25

I ran the reproduction at the top of this issue, verbatim: the same anchor comment in the same file, one
`é` appended, `deno task seed`, then rung 5.

    1 passed, 0 failed

Checked, because "it passed" is also what a test that skipped looks like:

- the `é` is in `packages/wacc/src/check.wac` after the edit, and the seed was rebuilt *after* it;
- the driver on disk contains the bytes `c3 a9` at offset 439,122, so the character reached the literals;
- the stage-A cache key moved — `1083036192:1787633564` before, `1590072732:1787661163` after — so stage A
  was **recomputed** rather than read, which is the thing this issue warned about.

So the divergence is gone, and I do not know what closed it. This is the second parked issue in a row
whose reproduction had gone stale (`issues/lang/0154` was the other), and in both cases the hypotheses I
built first were about a subject that no longer existed. **Run this first.**

### Two facts from the run that are worth keeping whatever happens next

- **The generated driver is invalid UTF-8, and rung 5 is green anyway.** 1,811,175 bytes, 14,099
  non-ASCII, and the first invalid sequence is at offset 74,096 — `chunkedLiteral` splits a multi-byte
  character across two literals and both compilers cope. That kills the whole family of
  "one of them decodes the file as text" hypotheses, including the one I wrote up above.
- **The test deletes the driver**, which is why nobody had looked at it. Two `cli.remove(DRIVER, …)`
  calls; removing them is a one-line change and it is what made the two facts above measurable. Worth
  doing behind a flag rather than temporarily, if this is picked up again.

If it returns, the diff to take is between the two *stages* rather than between the compilers: both stages
run the same driver, so a disagreement is one build of wacc emitting different bytes from another build of
the same source — a miscompilation, not a lexing difference. That is a narrower question than this issue
has been asking.

## It did reproduce, at the commit it was filed against — agent-a, 2026-08-25

The section above is right that the reproduction *as written here* does not reproduce, and it was
right to check. But the case written here is not the case that was observed. The observation was two
em dashes in `std/platform.wac`'s `Captured.truncated` comment; the `é`-in-`check.wac` recipe was
generalised from it while filing, and generalising is what went wrong. Four runs, each with
`.cache/_selfhost.wac` and `.cache/_selfhost_stageA.txt` deleted and `deno task seed` between:

| tree | that one line reads | rung 5 |
|---|---|---|
| `593ff44e` (this issue's parent) | `capped — 8 MiB —` | **fails** |
| `c539c5b0` (this issue) | `capped at 8 MiB,` | passes |
| `master` @ `2917cc41`, unmodified | `capped at 8 MiB,` | passes |
| `master` @ `2917cc41`, that line put back | `capped — 8 MiB —` | **passes** |

The first two are one line apart and nothing else, so at the time of filing the effect was real and the
em dash was carrying it. The last two say it is gone now.

**Gone rather than unreachable.** `packages/wacc/src/coretext.wac` still embeds `std/platform.wac`, and
with the em-dash line restored on `master` today that text is sitting in the embedded copy while rung 5
is green — so the path that carried the failure is still there and no longer fails on it.

**So the honest status is "fixed, cause unidentified", not "was never real".** Somewhere in the 104
commits between `c539c5b0` and `2917cc41` this stopped happening, and I did not bisect for which. That
matters for whoever closes this: a fixpoint that was fragile for a day and is not any more is worth a
line in whatever fixed it, and if nobody can name the commit then the fragility is unexplained rather
than absent.

**What I got wrong is worth keeping.** I filed a recipe I had not run — the `é`-in-`check.wac` form is a
generalisation of the case I actually had, and a reader following it correctly found nothing. The
reproduction in an issue should be the keystrokes that produced the failure, not the rule inferred from
them.

One thing found on the way, unrelated: a checkout whose seed predates the `Socket` field change cannot
`deno task seed` at all — round 1 fails with *"wrong number of arguments to the constructor"* in
`packages/box/src/applets/nc.wac` — and `deno task seed:bootstrap` is the way through, exactly as
`CLAUDE.md` says.
