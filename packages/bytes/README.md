# bytes

`Buf` — a growable byte buffer.

```wac
import { Buf } from "../../bytes/src/buf.wac";

Buf b = Buf.create();
b.push('h');
b.pushAll(u8[]('i'));
string s = b.toStr();     // "hi"
```

## Why it is a package

`gzip` and `json` had each written this type, independently and almost
identically. wac has no generics, so a container cannot be written once over its
element type — but it can be written once over `u8`, and that is what this is.

The merge was not free of consequence, in a good way: `gzip`'s `pushBytes` had
appended through `push` one byte at a time, paying a capacity check and a
bounds-checked store per byte. The shared version reserves once and writes
directly, which took `stored` throughput from ~155 MB/s to ~215 MB/s. Two
implementations of the same thing means one of them is slower and nobody notices.

## Shape

Three details are load-bearing rather than stylistic, and changing them will show
up in `deno task bench`:

- **`len` is a public field, not a method.** It is read once per pushed byte in
  gzip's inner loops.
- **`reserve()` takes no argument** and only makes room for one byte, keeping the
  common `push` path to a single comparison. Bulk appends use `reserveFor(n)` so
  they grow once instead of doubling repeatedly.
- **`take()` returns the buffer's own storage** when the buffer is exactly full, and
  empties the buffer to enforce it. Continuing to use a taken `Buf` is safe — pushes
  land in fresh storage rather than writing through the array it handed away.
  `bytes()` always copies, for callers that keep appending.

## API

| | |
|---|---|
| `create()` / `withCapacity(n)` | `withCapacity` skips the doubling when the final size is known, and lets `take()` avoid its copy |
| `len` | field, byte count |
| `push(v)` | truncates to 8 bits, as the array store does |
| `pushBytes(src, start, count)` / `pushAll(src)` | bulk, one growth |
| `pushU16(v)` / `pushU32(v)` | little-endian, for gzip's headers |
| `pushCodepoint(cp)` | UTF-8; surrogate pairs must already be resolved |
| `get(i)` | bounds-checked, traps |
| `bytes()` | exact-length copy |
| `take()` | hands over the storage when exactly full, else copies |
| `toStr()` | contents as a `string`, taken to be UTF-8 |

Bytes are `u8`, so a byte with the high bit set reads back as 128–255 rather than
negative. That distinction is why `i8[]` is the wrong type for byte data.

## `slice`, `clamped` and `equal` — the other half of the package

`src/slice.wac`. Not part of `Buf`, and here for the same reason `Buf` is: nine packages had each
written a private `u8[] slice(u8[], i32, i32)`, and they had drifted into **three different answers
for a range that is not valid**. The same call with the same arguments trapped in `ens`, returned
empty in `x509` and returned a short array in `ssz`, with nothing at the call site to say which
(wac-mono 0093).

Both meanings exist, each with a name:

| | |
|---|---|
| `slice(s, from, to)` | requires `0 <= from <= to <= s.len()`, and **traps** otherwise |
| `clamped(s, from, to)` | takes any two integers and answers with whatever part exists |
| `equal(a, b)` | length then bytes; empty equals empty |

`slice` checks *before* the read rather than trapping during it. The naive copies trapped by
accident, which is not the same thing: a caller could not tell a stated precondition from an
overlooked one, and an inverted range died on a negative allocation rather than on its own range.

Which one a call site gets was decided by reading its callers, not by rewriting them — a caller that
already validates its range takes `slice`, and the trap is an assertion on the check above it;
`tls/x509` and `tor/hsdesc` take `clamped`, because a certificate and a hidden-service descriptor are
attacker-supplied and refusing beats aborting. **No behaviour changed anywhere**: each site kept its
own semantics and gained a name for them.

`equal` replaced thirty-eight copies, spelled `same` in twenty-four files and `sameBytes` in sixteen,
and two of those had drifted too. One had dropped the length check, so a shorter first argument
answered *true* for a prefix; one answered false for two empty arrays, which is not equality. Both
were harmless where they stood and would have been inherited by the next caller. A caller that means
"present and equal" writes `a.len() > 0 && equal(...)`, where a reader can see it.

Thirty-four of those thirty-eight were in test `.wac` files, which is where a helper is least looked
at and most pasted from.

## Coverage

`deno task coverage:bytes` reports branch coverage, driven by `cov.ts` in this
package. `buf.wac` is at 97.7%.

**`slice.wac` reads 0.0%, and that is a gap in the measurement rather than in the testing.**
`cov.ts` never calls it — it was written when this package was only `Buf` and nothing added the new
file to it — so all eighteen of its points are compiled into the run and never driven. The code is
tested: `test/bounds.wac` and `test/bounds.test.ts` cover both meanings and every refusal, the
latter host-side because a trap ends the module and no wac test can assert one. But a probe that
silently measures nothing is exactly the shape this repo keeps finding (`crypto`'s `sha1.wac` read
0.0% the same way), so the number is written down here rather than left to be discovered.

How coverage works here, and the two ways `cov.ts` can be wrong about it, are in
[`packages/README.md`](../README.md#coverage-and-why-it-belongs-here-rather-than-in-each-package) —
these paragraphs were in three packages word for word.

## `Read` moved to `core`

It used to be `src/read.wac`, here rather than in `packages/platform`, because of who has to name
it: the streaming transforms in `gzip` and `stream` take their source as a funcref and `platform`
hands `cli.readChunk` to them directly, so a capability world and two pure algorithm packages all
had to name one type — and `bytes` was the only package below all of them.

That reasoning still holds and now points somewhere else. wac has no closures, so two declarations
of `Read` can never be converted into each other, and a funcref signature names it by *type* — which
means one identity everywhere or no interoperation at all. So `Read` is in `core`, the module the
compiler ships. (This was argued from a second repo for the capability layer, which is
[not happening](../../issues/system/closed/0092-the-capability-layer-should-be-its-own-repo.md); the
identity argument is the one that never needed it.)

```wac
import { Read } from core;
```

Nothing here re-exports it — a re-export would leave two spellings, and someone would write new code
against the old one. See wac's `design/0001` for the admission rule, which is narrow: a type belongs
in `core` only if it must cross a repository boundary through a funcref signature.
