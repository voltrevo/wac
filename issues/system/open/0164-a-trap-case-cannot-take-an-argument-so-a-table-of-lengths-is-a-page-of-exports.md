# 0164 — a `test_traps_*` case cannot take an argument, so a table of lengths is a page of exports

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

## What is wanted

A wac test that asserts a trap says so in its name — `test_traps_*` — and the runner inverts the
verdict: trapping passes, returning is `FAIL … returned instead of trapping`. That works, and twelve
host-side files moved across on it (`issues/system/0161`).

It allows **one trap per test**, necessarily: the first one ends the call, so two in a function only
ever check the first. For a file whose refusals are already distinct — one call, one guard, one
reason — that is exactly right and reads better than the host-side version did.

For a **table-driven** refusal test it is wrong. The host-side shape is

```ts
for (const n of [0, 63, 65, 128]) {
  if (!traps(() => offer(bytes(n), cPriv))) throw new Error(`offer accepted a ${n}-byte seed`);
}
```

and every row of that table becomes its own export. The hybrid key exchange's refusals are 21 rows
across eight guards — 21 exports plus a control — and `packages/tls/src/record.wac`'s are the same
shape.

## Why it is filed rather than done

**The naming is a decision with more than one reasonable answer**, and the runner works from the
export list — it knows a test by its name and signature and nothing else, which is what makes
`test_traps_*` work at all. Two shapes that would fit:

- **A count beside the case.** `export i32 test_traps_seed_length_count()` alongside
  `export string test_traps_seed_length(i32 i)`, the runner reading the count and calling the case
  once per index. Explicit, and adds a second naming rule.
- **A declared range in the name**, which keeps one export but puts data in an identifier.

Both change what `wac test` promises about an export, and the wrong choice is cheap to make and
awkward to undo — which is what `CLAUDE.md` says to file rather than guess at.

## What it is worth

Two files today, and it is the reason they were left rather than converted badly. The count is small
but the shape is not rare: a refusal test over a *dimension* — lengths, offsets, byte values — is how
most guards are worth driving, and `issues/lang/0112`'s argument is that a guard nothing exercises is
a guard nobody has checked.

Not urgent. `packages/wactest/README.md` says the same thing beside the convention, so somebody
starting a conversion meets it before they have written twenty-five exports.

## What it costs, measured 2026-08-17

Eight host-side test files stayed where they are for one reason, and each says so in its own header:
*"Only the refusals"* — a trap ends the call, so a returning test cannot observe one. `test_traps_*`
answered that, and this is what porting them under the one-trap-per-export rule comes to:

    crypto/aead      3 values             tls/hybrid     ~24 exports
    crypto/aes       8 values →  8 exports    tls/record   ~28 exports
    crypto/aesctr    3 values →  6 exports    tls/wire     ~24 exports
    crypto/ed25519  20 values → ~28 exports
    crypto/mlkem    16 values → ~18 exports

**≈136 exports for what is currently 8 files and about 30 tests.** Every one of them is the same
three lines with a different length in the middle, and the name has to carry the value because
nothing else can — `test_traps_one_byte_below_aes256`.

`packages/crypto/test/wac/aes_test.wac` has the first eight, ported deliberately so the cost is
visible rather than argued about. They are correct, they canary — a length check widened to
`>= 16` fails six of them — and they are eight copies of one sentence.

So this is not a tidiness issue any more, it is the gate on a tier: the other seven files are worth
more as tests than as 128 near-identical exports, and porting them before this is settled would be
writing the thing everyone then has to unpick.

## The tables were converted anyway — 2026-08-17

Both files named above are in wac now (`packages/tls/test/wac/hybrid_test.wac` and
`record_test.wac`), so this issue is no longer blocking anything. It stays open because the cost is
real: 21 near-identical exports where the host had four lines.

What changed is the argument. Writing the rows out is what showed that **four of the hybrid's 21
were not asking what they appeared to**. A wrong-length share built from `pattern(n)` is nonsense as
well as wrong-length, and ML-KEM's coefficient validation refuses it long before anything looks at
its length — so relaxing the guard from `!=` to `<` left the loop green. The off-by-one cases are
built from the genuine value now. Three of `record.wac`'s four framing guards were masked the same
way, by the AEAD downstream, and the case that does distinguish them — a byte *after* the announced
length — did not exist in the table at all.

So the feature is still worth having, and the reason to want it is compactness rather than fidelity.
A table of rows hides which guard the code actually decides with; whatever shape this ends up taking
should keep each row separately nameable and separately canaryable.
