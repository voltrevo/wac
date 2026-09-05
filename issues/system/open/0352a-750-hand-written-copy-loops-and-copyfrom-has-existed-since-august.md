# 0352a — 750 hand-written copy loops, and `copyFrom` has existed since August

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none — a language primitive that 178 files do not use

`spec/spec/arrays.md`:

> `copyFrom` moves a range between arrays of the same element type … The receiver is the destination.
> `copyFrom(src, srcStart, dstStart, count)`

Swept `packages/*/src` and `tools/` for a `for` loop whose entire body is `dst[…] = src[…];` with two
different array names — exactly what that call does:

**750 sites in 178 files.** Against **58 files** that call `copyFrom`.

```
24  packages/crypto/src/mlkem.wac      18  packages/crypto/src/ed25519.wac
23  packages/quic/src/initial.wac      18  packages/tor/src/relay.wac
22  packages/webrtc/src/dtls.wac       18  packages/tor/src/relaycircuit.wac
18  packages/tls/src/client.wac        17  packages/tor/src/hsblind.wac
```

The concentration is byte-buffer assembly — building a handshake message, a cell, a packet — which is
`copyFrom`'s exact case.

## Why, and it is the cheapest of today's four

`copyFrom` landed **2026-08-02**, from `issues/lang/0056`, and most of this tree predates it. So this
is not a case of nobody looking: it is a primitive added after the code was written and never swept
back through. `README.md`'s *a design justified by a limitation outlives the limitation, silently* at
its largest scale — 750 sites, one month.

That matters because it separates this from the three others found today, which look the same and are
not:

| the shared answer | why the callers do not use it |
|---|---|
| `core`'s `bytesEq`, `Buf.pushDecimal` | nobody looked — they were there all along |
| `fmt`'s `atoi` | **wrong shape** — takes a string, cannot say where it stopped (`0351a`) |
| **`copyFrom`** | **post-dates the code** — nothing swept |

Only the last is mechanical. `bytesEq` and `pushDecimal` need a reader per site to check the
semantics match; `atoi` needs a new signature; **`copyFrom` needs a rewrite rule and a review of the
argument order.**

## What has to be checked before sweeping

- **Element types must match.** `copyFrom` is same-type; a loop widening `u8` into `i32[]` is not one
  of these and the regex cannot tell. That is the one thing a mechanical pass must not assume.
- **The argument order is easy to get wrong.** `copyFrom(src, srcStart, dstStart, count)` puts the
  destination offset third, and the loops it replaces read `out[p + i] = data[i]`, which is
  destination-first. A sweep that transposes two arguments produces a program that runs and is wrong
  — so the pass wants a test per file, not per call.
- **Overlapping ranges.** The spec says nothing here that this issue found; a hand-written ascending
  loop and a bulk move can differ when source and destination are the same array. The 750 all have
  *different* array names, so none of them is that case — worth stating because a broader sweep would
  hit it.

## Notes

Method: a `for` with an `i32` counter whose whole body is one indexed assignment between two
differently-named arrays. Multi-statement bodies, transforms and same-array shuffles are excluded, so
750 is a floor for the pattern and an over-count for what is safely rewritable — the element-type
question is unresolved by the regex and is the reason this is filed rather than done.

Fifth thing found by asking *what method was this loop standing in for*, after `issues/lang/0347a`,
`0350a`, `0351a` and `issues/system/0349a`. It is the largest and the least interesting, which is
worth saying: the instrument's yield is not correlated with how much it finds.
