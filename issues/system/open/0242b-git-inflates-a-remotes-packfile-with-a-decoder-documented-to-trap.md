# 0242b — git inflates a remote's packfile with a decoder that is documented to trap

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-24
- **Kind:** bug
- **Symptom:** trap

## What is true

`packages/gzip`'s decoder has a deliberate, documented, well-tested contract. `fuzz_test.wac` states
it plainly:

> Its contract is *either*: for any byte sequence, `gunzipBytes` produces the original bytes or it
> fails — never a wrong answer quietly.

"It fails" means it **traps**, and the package knows exactly what that costs: its corruption sweep
runs each case in a subprocess *"where a trap is an exit status the caller can read"* — 2,700 cases
in `fuzzcorruption_test.wac`, plus hand-crafted streams in `inflateadversarial_test.wac`. This is not
an oversight and `issues/system/0175` records the reasoning. **Nothing below is an argument against
that contract.**

The problem is who is paired with it.

`packages/git/src/pack.wac:204` inflates object data straight out of a packfile a remote sent:

```wac
  if (upto <= from) { return Raw.Damaged("compressed data is too short to be a zlib stream"); }
  u8[] slice = u8[upto - from]();
  for (i32 i = 0; i < slice.len(); i++) { slice[i] = p.bytes[from + i]; }
  u8[] data = inflate(slice);
```

Three call sites — `pack.wac:204`, `pack.wac:412`, `zlib.wac:95` — all on bytes from the network, and
none of them is in a subprocess. So a packfile with one damaged object ends the process, and
`git clone` and `git fetch` both reach it.

**Nothing checks those bytes first, and that is also correct.** The zlib Adler-32 is skipped by
design, and `pack.wac` says why: *"the index carries a CRC-32 of these same bytes, which is the check
this format actually offers, and the object's own name is a hash of what comes out."* Both come
*after* inflation.

**The surrounding code shows what `pack.wac` meant to do.** Every other malformation in the same
function returns a value — `Raw.Damaged("a base name runs off the end")`, `Raw.Damaged("no room for
the compressed data")`, `Raw.Damaged("compressed data is too short to be a zlib stream")`, and
immediately after the inflate, `Raw.Damaged("header says N bytes and M inflated")`. The inflate is the
one step in that sequence that cannot say `Damaged`.

## Reproduction

Through `packages/git`'s own API, no network needed — an intact pack indexes, and the same pack with
one byte of an object's compressed data flipped ends the process:

```wac
i32[] kinds = i32[](3);                       // one blob
Vec<u8[]> contents = Vec.create();
u8[] blob = u8[600]();
for (i32 i = 0; i < 600; i++) { blob[i] = (i * 11 + 5) & 0xFF; }
contents.push(blob);

u8[] pack = writePack(kinds, contents);
match (indexPack(pack)) { ... }               // indexes

u8[] bad = /* pack with bad[40] ^= 0xFF */;
match (indexPack(bad)) { ... }                // never returns
```

```
built a pack of 333 bytes
  intact pack indexed
flipping byte 40 of the compressed data, then indexing...
wac: trapped
RuntimeError: unreachable
```

At the layer below, a single flipped byte anywhere in a DEFLATE stream is enough — the first byte of
a 275-byte stream traps on its own.

## Why this is not `0102` and not `0175`

`0102` is closed and is about `gunzipStream`'s *return value* — that it ended
`return br.broken == "" ? 0 : 1` and the `1` was unreachable, so a caller could not tell a source
failure from a corrupt archive. That is about **which** failure a caller hears about.

`0175` is about a test not being able to assert "either of two outcomes", which is why the corruption
sweep spawns.

Neither is about a *caller in another package* being unable to survive the contract at all.

## The decision

1. **A non-trapping entry point beside the trapping one.** `inflate` keeps its contract and gains a
   sibling that answers rather than aborts. The cost is the one `inflate.wac:815` already names —
   *"not trapping means threading a status back through every symbol read, and a decoder that keeps
   going after a failed read with a status nobody checked is how silent corruption is written"* — and
   that argument is against a *half* fix rather than a whole one. `BitReader` already carries a
   `broken` field it sets before trapping, so the machinery half-exists.
2. **git inflates in a subprocess**, the way `gzip`'s own corruption sweep does. Honest, and about
   seven milliseconds per object, which for a clone of any size is not affordable.
3. **git accepts it and says so** — document that a corrupt pack ends the process, and treat that as
   the same class as running out of memory. Cheapest, and it means `git fetch` against a hostile
   remote is a denial of service on the client.

The blast radius of (1) is small: three callers, all in `packages/git`, and each already has a
`Raw.Damaged` or `Opened.Refused` path to return into.

## How this was found, and the correction it went through

Enumerating the class rather than by luck. Six abort-class bugs during `issues/system/0205`'s sweep
shared one shape — *a correct check, enforced by a trap, on input a stranger chose* — so every
`trap;` in the peer-facing packages was listed and each asked whether a caller feeds it something a
stranger picked.

**The first draft of this issue said `packages/gzip` had the bug, and it does not.** Reading
`fuzz_test.wac` showed the trapping is a stated contract with a fuzz corpus behind it. The defect is
the pairing of that contract with a caller that cannot survive it, which is a different issue with a
different fix — and worth recording, because "this decoder traps" read as a bug right up until the
file that owns it explained why it does not.

`packages/ssh` is the model that got the pairing right: it traps on the caller's key width and
returns a value for every byte the peer sent, and says so in its comments. `packages/quic` and
`packages/webrtc` have no `trap;` in `src/` at all.
