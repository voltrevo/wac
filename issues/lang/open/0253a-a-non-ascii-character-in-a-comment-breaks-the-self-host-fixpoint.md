# 0253a — one non-ASCII character in a comment breaks the self-host fixpoint

- **Status:** open
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
