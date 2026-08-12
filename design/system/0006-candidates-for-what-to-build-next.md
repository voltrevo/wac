# 0006 — candidates for what to build next, and the oracle each one would have

- **Status:** one chosen — **QUIC**, 2026-08-12, which has its own document in
  [0007](0007-quic-and-the-datagram-capability.md). The rest stand as candidates.
- **Opened:** 2026-08-11
- **Written by:** agent-c
- **Depends on:** nothing. Every entry names what it would need.

## Why this is a design note and not a pile of issues

`issues/system/README.md` says it plainly: *a direction does not belong there*. An issue is a bug, a
blocked task, or something in a package somebody else is mid-change in. None of these are. They are
candidates, and the useful part of a candidate is the argument for it — which an `INDEX.md` row
cannot hold and which would rot into "nobody has done this yet" within a week.

## The test a candidate has to pass

This repository's claims are worth something because a foreign implementation adjudicates them.
`packages/sh` is measured against bash, `packages/tls` against OpenSSL and rustls, `packages/git`
against `git` itself. So the first question about anything proposed here is not "is it interesting"
but **what would say we got it wrong**, and the second is **can that thing be run here, on demand,
without a service we do not control**.

That second half is not a formality. `packages/git` spent a while recording a thin pack as
unarrangeable, on the strength of a real measurement against GitHub; the conclusion was wrong, and
what fixed it was giving up on the server we do not own and running `git upload-pack` over a pipe.
An oracle you can start is worth several you can only visit.

## The three strongest

### A wasm interpreter, in wac

**Oracle:** the official WebAssembly spec test suite — thousands of assertions in `.wast` files,
written by people who have never seen this implementation. Nothing else on this list has an oracle
that large or that adversarial.

**Why it is the most interesting:** `wacc` emits wasm and something else runs it. This would close
that loop — the system executing its own output with no host runtime underneath. Direction two's
"a host with no JavaScript in it" is currently Rust on wasmtime; this is the version where the last
foreign dependency in the execution path goes.

**Be clear-eyed:** it is large, and the spec suite will be red for a long time before it is green.
Worth starting only if the self-hosting story is the goal rather than breadth. The honest first
milestone is not "it runs" but "it fails N of the suite and the number goes down".

### A git server

**Oracle:** real `git`, as the *client*. `git clone http://…/repo` against ours, then `git fsck` on
what arrives, then `git push` into it and read the ref back.

**Why now:** both halves of the conversation are already parsed and driven from the client side —
`upload-pack`'s advertisement and want/have exchange, `receive-pack`'s update commands and report.
Serving them is the mirror, and mirrors are how `tor` and `ssh` got their sharpest evidence: our
client against their server *and* their client against our server. It is the smallest item here
relative to what it completes.

### A SQLite file reader

**Oracle:** the `sqlite3` CLI over the same file, and every `.db` already on the machine as a corpus.

**Why it fits:** a nasty, detailed binary format — b-trees, overflow pages, varints, freelists, a
page cache with its own invariants — and no network, no new capability, nothing to negotiate. It is
the closest thing to the packfile work that is not git, and `packages/fs` is all it needs. Reading
before writing; a writer is a much larger promise about durability.

## Good, with an obvious oracle

| candidate | oracle | builds on | note |
|---|---|---|---|
| PNG decode and encode | PngSuite's deliberately-corrupt files; libpng | `gzip`'s inflate/deflate | The corrupt half is the point: a decoder that accepts them is wrong, and PngSuite says which |
| Brotli | the reference implementation and its corpus | — | Completes `gzip` and `zstd`; entirely self-contained |
| HTTP/2 with HPACK | RFC 7541's published vectors, then curl or nghttp2 live | `http`, `server`, `tls` | The vectors cover the dynamic table and Huffman coding, which is where it goes wrong |
| DNS over HTTPS, with DNSSEC validation | `dig +dnssec`, and the published root trust anchors | `tls`, `http` | **No UDP needed**, which is why this and not plain DNS |
| blake2b, blake3, argon2 | published vectors | `crypto` | The three obvious gaps; cheap, and each is checkable the hour it is written |
| `ed`, then `vi` | GNU `ed` is scriptable, so a corpus of scripts diffs exactly as `packages/sh`'s does against bash | `tty`, `fs` | Direction one has a desktop and no editor |

## Blocked on a decision rather than on work

**QUIC was chosen on 2026-08-12** and is now [0007](0007-quic-and-the-datagram-capability.md),
which settles the decision below rather than removing it: the datagram capability is that document's
first step, and the oracle question — the thing this list says to ask first — turned out to be
already answered. Deno carries quinn and rustls, so a QUIC peer that will both listen and connect is
installed here, offline. That was measured before the document was written, which is the order this
list asks for.

**WireGuard, and QUIC.** Both want UDP, and there is no datagram capability on `Cli` — the surface
has `connect`, `listen`, `accept`, `recv` and `send`, all of them stream. Adding one is the same
shape as `issues/system/0137`: a question about the capability surface to settle before an
implementation, not a thing to start on a Tuesday.

WireGuard is otherwise an unusually good fit — compact, precisely specified, with `x25519` and
`chacha20poly1305` already here and the real `wg` as an oracle. It would also want blake2s, which is
on the list above anyway.

## What to avoid

**Anything whose oracle is a service we do not control.** It reads as more real and is worth less: it
cannot be run on demand, it fails for reasons that are not ours, and — the expensive part — a
measurement taken against it generalises further than it should. That is exactly how the thin-pack
claim went wrong.
