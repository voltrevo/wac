# 0110 — a local `wacBind` accepts two things the suite refuses, so local verification is weaker than it looks

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** diagnostic
- **Symptom:** compile error

## Reproduction

Two of them, found the same way on the same day: a file compiled by `deno test` locally, then failed
to compile in a gate run of the same commit. Both cost a full suite (about ten minutes of a shared
machine) to discover.

**One — a same-type cast.**

```wac
if (v < (4611686018427387904 as i64)) { return 8; }
```

```
packages/quic/src/varint.wac:56:32 [typecheck] cast from 'i64' to 'i64' is redundant
```

The literal is past 2³¹ so it is already `i64`, and the diagnostic is right. Locally this compiled
and its tests passed, repeatedly, including after `rm -rf .cache/bind .cache/gen` and deleting the
generated artefact.

**Two — importing a name a module imported but did not export.**

```wac
import { expandLabel, hkdfExtract } from "../../tls/src/keyschedule.wac";
```

```
packages/quic/src/initial.wac:21:23 [resolve] 'hkdfExtract' is not exported from
  'packages/tls/src/keyschedule.wac'
```

Also right: `keyschedule.wac` imports `hkdfExtract` from `packages/crypto/src/hkdf.wac` and does not
export it, and wac has no re-export
([0073](0073-named-re-export-so-a-library-can-have-one-entry-point.md)). Locally the import resolved
and the module ran — it derived RFC 9001's Initial keys correctly and decrypted a real QUIC packet,
so the wrong import was not merely tolerated, it worked.

## Why this is worth a number

Not for either diagnostic — both are correct and both fixes are one line. The problem is the
**asymmetry**: a fresh local compile is more permissive than the one the gate performs, so
`deno test <file>` is not evidence that a file compiles. Every agent's local verification is weaker
than it appears, and the only thing that reveals it is a ten-minute suite.

The second case is the sharper one. A resolver that accepts an unexported name is not just lenient —
it silently gives a module access to another package's *private* surface, which is the property
`export` exists to control. That the code then ran correctly is what makes it dangerous: nothing about
the behaviour said anything was wrong.

## What I know and what I do not

Both errors carry a phase prefix — `[typecheck]` and `[resolve]` — which the reference compiler's own
messages do not obviously use, so the likeliest explanation is that the two paths run **different
compilers**: `wacc` for the suite and the reference locally, or the reverse. `packages/wacc` is a
port, so a divergence between them is expected during the port and is exactly what
[0105](0105-callers-still-compiling-with-the-reference.md) is about.

What I could not do is reproduce either locally, which is why this is filed rather than fixed. I
cleared every cache I could find and a fresh compile still accepted both. So the next step is to find
out *which* path each takes — `harness/wacBind.ts` and whatever the suite does differently — and
then either make the local path as strict, or say plainly in the harness that it is not.

**The cheap half, if the whole is a project:** have `wacBind` say which compiler it used. One line in
a log would have turned two ten-minute discoveries into two immediate ones.
