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

Bodies under four lines are ignored, so 17 is a floor. Within-package duplicates are excluded too —
`relayd.wac`'s pair is counted once here and there will be more.
