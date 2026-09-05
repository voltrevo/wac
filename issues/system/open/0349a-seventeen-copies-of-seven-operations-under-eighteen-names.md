# 0349a — seventeen copies of seven operations, under eighteen names, invisible to any name check

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none — duplicated code that no existing check can see

Hashed every function body under `packages/*/src` and grouped by hash rather than by name. **Eight
bodies are identical across two or more packages; 25 declarations, so 17 of them are redundant.**

The point is the naming. These are invisible to a duplicate-*name* sweep because **almost every copy
was given a different name**:

| operation | copies | names |
|---|---:|---|
| concatenate two `u8[]` | **9** | `joined`, `join`, `joinBytes`, `concat`, `append` |
| byte equality | 4 | `equal`, `bytesEq`, `oidEquals` — **and `core`'s** |
| hex digit → value | 4 | `hexDigitValue`, `hexDigit`, `digitValue` |
| length-prefixed concat | 3 | `concat`, `derConcat` |
| `utoa64` | 2 | `utoa64` |
| the bytes after a name | 2 | `afterName`, `bytesAfter` |
| byte/string equality | 2 | `eqBytes`, `eqStr` |

## Concatenating two byte arrays is written nine times

```wac
packages/quic/src/keys.wac:54          export u8[] joined(u8[] a, u8[] b)
packages/webrtc/src/dtlskeys.wac:58           u8[] joined(…)
packages/tor/src/hsconnect.wac:301            u8[] join(…)
packages/tor/src/dird.wac:235                 u8[] joinBytes(…)
packages/tor/src/relayd.wac:1952              u8[] concat(…)
packages/tor/src/relayd.wac:2050              u8[] joinBytes(…)      // twice in one file
packages/ssh/src/ssh.wac:252                  u8[] joinBytes(…)
packages/http/src/client.wac:110              u8[] append(…)
packages/git/src/transport.wac:196            u8[] concat(…)
```

Four lines each — allocate `a.len() + b.len()`, copy, copy. Two distinct bodies among the nine and
the difference is loop style. `core` has no byte concatenation; `packages/bytes`' `Buf` has
`pushAll`, which 60 files use, so the builder route exists and these nine wanted the one-shot form.

## And `bytesEq` is already in `core`, under that name

```wac
core/hash.wac:32                  export bool bytesEq(u8[] a, u8[] b)
packages/bytes/src/slice.wac:76   export bool equal(u8[] a, u8[] b)
packages/ssh/src/kex.wac:131             bool bytesEq(u8[] a, const u8[] b)
packages/tls/src/asn1.wac:218            bool oidEquals(…)
```

Six identical lines. `ssh` wrote a private one **with the same name as the one in `core`**, and
`bytes` exported a second public one under a different name.

## What to add and where

- **`core`**: a byte concatenation (nine callers) and nothing else — `bytesEq` is there and the
  three copies just have to import it.
- **`packages/fmt`**: `utoa64` is `fmt`'s and `wactest` copied it.
- **`packages/codec`**: `digitValue` is `codec/src/hex.wac`'s and three files copied it.

The rest are two-copy pairs inside one concern and are not obviously worth a home.

## Why it is filed rather than fixed

Adding to `core` needs `wac task gen:core` and a `./bootstrap.sh`, because those nine files are
carried inside the compiler as `packages/wacc/src/coretext.wac`. That is not hard and it is not a
thing to do without saying so, since a stale embedding refuses the build.

And the seventeen conversions touch eight packages. The concat family alone is nine sites in five
packages, and two of them are in `tor/src/relayd.wac`, which declares the same helper twice under
two names in one file — worth looking at before assuming a mechanical rewrite is safe.

## Notes

**The method is the finding as much as the count is.** `issues/system/0343a` swept duplicate *type*
names and `0348a` swept duplicate bodies under `tools/`; this is the same hash over `packages/`, and
it found what a name sweep structurally cannot: **one operation under eight names.** A check that
hashes bodies is about fifty lines and nothing in `tools/wac/` does it.

Bodies under four lines are ignored, so every count here is a floor.

**Within-package duplicates were excluded above, and measured since: the total is 39 redundant
bodies, of which 22 are inside a single package.** So the cross-package 17 is under half of it.

```
ssh          5 groups     atoi twice (ssh.wac:259, sshd.wac:1031) and four more
tor          4 groups     fields (directory.wac:92) / splitSpaces (consensus.wac:423) — 13 lines, two names
box          2 groups     wrapped, in the base32 and base64 applets
wacc         2 groups     planDecimal (asyncplan.wac:400) / synthDecimal (asyncsynth.wac:192)
tls          1            result, in server.wac and client.wac
bls          1            frob12C1_3 (fp12.wac:214) / psiY (g2.wac:158) — 9 lines
lightclient, http, git, webrtc   1 each
```

### And one of them is two 384-bit cryptographic constants that must stay equal

```wac
packages/bls/src/fp12.wac:214   /** ξ^((p^3−1)/6), the Fp12 Frobenius coefficient on w. */
                                Fp2 frob12C1_3()
packages/bls/src/g2.wac:158     /** 1/ξ^((p−1)/2), its y-coefficient. */
                                Fp2 psiY()
```

Twenty-four hand-written `u32` limbs each — two 384-bit values — and **every limb is identical**.
The two doc comments describe different quantities, and in BLS12-381 those quantities coincide; that
is an identity rather than a coincidence, and **neither file says so.**

So there are two independently transcribed copies of one constant, on the signature-verification
path, with nothing stating they must agree and nothing checking that they do. Correcting one leaves
the other silently different. This is the strongest single item in the sweep and the cheapest to act
on: one of the two becomes a call to the other, or a test asserts `frob12C1_3() == psiY()` and says
which identity makes it true.

### The rest are a different problem from the cross-package ones and a smaller one: a package sharing a
helper with itself needs no `core` change, no `gen:core` and no bootstrap — it is one file importing
another, or one function moved next to its sibling. **Only the `bls` pair is a name that lies**, and the `tor` one was overstated when this was first
written: `directory.wac:92`'s `fields` and `consensus.wac:423`'s `splitSpaces` are thirteen identical
lines and do not claim different operations — they are two names for one, and the clearer of the two
is the **undocumented** one. `fields` carries the comment (*"Split `doc[from..to]` on single
spaces"*) and `splitSpaces` has none, so a reader looking for the shared helper finds the vaguer name
described and the precise name bare. Both take `(u8[] doc, i32 from, i32 to)`, which is the
byte-view-plus-two-loose-integers shape, written twice.

## Addendum 2026-09-05 — the `bls` pair verified by reading, and why it should be first

The pair above was found by **hashing bodies**, so the claim rested on a hash. Read directly, limb by
limb, and it holds exactly:

    packages/bls/src/fp12.wac:214   frob12C1_3()   a[0]=0xa55c9ad1 a[1]=0x3e2f585d …  b[0]=0x5aa30fda …
    packages/bls/src/g2.wac:158     psiY()         a[0]=0xa55c9ad1 a[1]=0x3e2f585d …  b[0]=0x5aa30fda …

All twelve limbs of each coefficient, identical. So the recommendation above — one becomes a call to
the other, or a test asserts they are equal and names the identity — is safe to act on without
re-deriving anything.

**And it is not a copy-paste mistake, which changes which fix is right.** The doc comments describe
different expressions: *"ξ^((p^3−1)/6), the Fp12 Frobenius coefficient on w"* and *"1/ξ^((p−1)/2), its
y-coefficient"*. They are the same element by an identity in the tower, and **neither comment mentions
the other**. So each file is naming the value by the role it plays there, which is a good reason to
keep both names — deleting one would put a name from the wrong layer into a reader's way. The call
form plus a doc comment stating the identity is the fix; the deletion is not.

### Retracted, same day: I said this pair has no oracle and it has a good one

The paragraph here argued the pair should be fixed first because a hand-transcribed constant has no
independent derivation, so a wrong digit would only surface as a broken pairing. **That is wrong and
the package is better tested than I said.**

`packages/bls/test/tower.py` is *"the BLS12-381 field tower in plain Python integers — the oracle for
fp2/fp6/fp12. No Montgomery form, no limbs, no carries: everything is `int` and `%`. That is the
point. The implementation under test holds twelve 32-bit limbs in Montgomery form, so a bug in its
representation cannot also be a bug here."*

And it does not transcribe the constants — it **computes** them:

    # Frobenius, from constants — and validated against actual exponentiation
    FROB12_C1 = [f2pow(XI, (P**i - 1) // 6) for i in range(12)]

`vectors.py` imports from `tower` and generates the vectors the wac tests consume, so a wrong limb in
either `frob12C1_3` or `psiY` makes the wac Frobenius disagree with a value derived from the field
definition. The oracle I said was missing is the strongest kind there is.

**So the ranking argument is withdrawn and the finding is not.** The pair is still one value under
two names with nothing relating them, a corrected transcription in one file still would not propagate
to the other, and the fix in the paragraph above is still the right one. What is no longer true is
that it is urgent, or that this package's testing is thin.

Recorded rather than deleted because the error is instructive: I checked whether the *source files*
mentioned an oracle, found nothing, and concluded there was none — without looking in `test/`. The
directory listing that would have corrected me was one `ls` away.
