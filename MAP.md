# The map

Every package, what it is, and every program you can build. **Generated — do not edit.**
Run `deno task map` after adding a package or an entry point; `deno task map -- --check`
runs in the suite, so a stale map is a failing test rather than a document nobody trusts.

34 packages, 73,026 lines of wac, 1480 tests,
47 command-line programs and 4 browser pages.

## Packages

In dependency order: nothing here imports anything below it.

| package | what it is | wac lines | tests | builds on |
|---|---|---|---|---|
| [`bytes`](packages/bytes/) | `Buf` — a growable byte buffer. | 339 | 28 | — |
| [`std`](packages/std/) | Containers and the two sum types every program ends up wanting. | 586 | 42 | — |
| [`unicode`](packages/unicode/) | UTF-8 as code points, and simple case mapping. | 222 | 11 | — |
| [`bignum`](packages/bignum/) | Arbitrary-precision integers. | 629 | 42 | `bytes` |
| [`codec`](packages/codec/) | Base16, base32 and base64, from RFC 4648. | 368 | 10 | `bytes` |
| [`datetime`](packages/datetime/) | The proleptic Gregorian calendar, and RFC 3339 timestamps. | 272 | 15 | `bytes` |
| [`fmt`](packages/fmt/) | Numbers to and from text. | 1,199 | 27 | `bytes` |
| [`gzip`](packages/gzip/) | gzip (RFC 1952) and DEFLATE (RFC 1951) written in wac. | 1,985 | 83 | `bytes` |
| [`platform`](packages/platform/) | A capability world for wac applications, so a program can be written **entirely in wac** — no TypeScript of its own — and still read files, tell… | 3,370 | 114 | `bytes` |
| [`regex`](packages/regex/) | A backtracking regular expression engine, with JavaScript's semantics. | 1,515 | 21 | `bytes` |
| [`stream`](packages/stream/) | Run a wac transform as a `ReadableStream`/`WritableStream` pair, so it consumes input as it arrives instead of taking the whole thing at once. | 97 | 14 | `bytes` `unicode` |
| [`url`](packages/url/) | A WHATWG URL parser: parse, serialize, and resolve a reference against a base. | 1,219 | 27 | `bytes` `std` |
| [`wacc`](packages/wacc/) | Porting the wac compiler to wac, so it can eventually compile itself. | 4,711 | 30 | `bytes` |
| [`zstd`](packages/zstd/) | Zstandard (RFC 8878) in wac. | 3,032 | 48 | `bytes` |
| [`abi`](packages/abi/) | The contract ABI, in wac: how a call's arguments become calldata and how returned bytes become values. | 560 | 6 | `fmt` |
| [`crypto`](packages/crypto/) | SHA-256, SHA-512/384, SHA-3, SHAKE, keccak256, HMAC, HKDF, bcrypt_pbkdf, ChaCha20-Poly1305, AES-CTR, AES-GCM, X25519, Ed25519, NIST P-256 and… | 5,790 | 150 | `bignum` |
| [`fs`](packages/fs/) | A filesystem that belongs to the system rather than to the host. | 1,740 | 27 | `bytes` `fmt` `gzip` `platform` `std` |
| [`http`](packages/http/) | HTTP/1.1: parsing requests and responses, and writing both. | 1,003 | 29 | `bytes` `codec` `fmt` `platform` |
| [`json`](packages/json/) | JSON (RFC 8259) parsing and serialization, written in wac. | 955 | 51 | `bytes` `fmt` `std` |
| [`rlp`](packages/rlp/) | Recursive Length Prefix — the Ethereum execution layer's serialisation, in wac. | 317 | 8 | `fmt` |
| [`tty`](packages/tty/) | What a terminal does to your keystrokes before a program sees them: echo, erase, kill, word erase, `^C`, `^D`. | 312 | 2 | `bytes` `platform` |
| [`wactest`](packages/wactest/) | Assertions for tests written in wac. | 222 | 16 | `fmt` |
| [`bls`](packages/bls/) | BLS signature verification on BLS12-381 — the Ethereum parameters and encodings. | 4,049 | 45 | `crypto` |
| [`mpt`](packages/mpt/) | Merkle-Patricia proofs, verified — the piece that turns "a provider told me" into "the state root I already verified commits to this". | 489 | 27 | `codec` `crypto` `fmt` `rlp` `std` |
| [`server`](packages/server/) | An HTTP server written in wac. | 328 | 20 | `bytes` `codec` `datetime` `http` `json` `regex` `url` |
| [`sh`](packages/sh/) | A shell, in wac. | 5,023 | 24 | `bytes` `codec` `fmt` `fs` `platform` `std` |
| [`ssz`](packages/ssz/) | **Everything an Altair light client needs is done and checked against Ethereum's vectors. | 802 | 26 | `bytes` `crypto` |
| [`tls`](packages/tls/) | TLS 1.3 (RFC 8446) in wac. | 3,792 | 96 | `bytes` `crypto` |
| [`box`](packages/box/) | 61 applets in one program, chosen by the first argument — 60 tools and `help`, which prints the list. | 6,708 | 69 | `bytes` `codec` `crypto` `datetime` `fmt` `fs` `gzip` `http` `json` `platform` `regex` `server` `sh` `std` `tls` `unicode` `url` `zstd` |
| [`ens`](packages/ens/) | The name a person types, turned into the node a contract is asked about. | 389 | 13 | `bytes` `crypto` `mpt` |
| [`lightclient`](packages/lightclient/) | **The Altair sync protocol works. | 642 | 12 | `bls` `ssz` |
| [`tor`](packages/tor/) | Tor in wac, both ends: a client and SOCKS5 proxy, a relay, a directory authority, an onion-service client, and a test network with no C tor in it. | 15,999 | 294 | `bytes` `codec` `crypto` `datetime` `fmt` `http` `platform` `std` `tls` `wactest` |
| [`ethrpc`](packages/ethrpc/) | Asking an Ethereum node a question, so the packages that *verify* answers have something to verify. | 721 | 3 | `codec` `crypto` `ens` `fmt` `http` `json` `mpt` `platform` `rlp` |
| [`ssh`](packages/ssh/) | An SSH-2 client and server, in wac, **and `ssh` and `sshd` programs built from them. | 3,641 | 50 | `box` `bytes` `codec` `crypto` `fmt` `fs` `platform` `sh` `std` |

## Programs

Every `export i32 main` in the tree. Build one with:

```sh
deno task app:build <path> --allow-read -o name && ./name
```

Grants are chosen at build time and the shebang of the result states exactly what it may
reach — see `packages/platform/README.md`.

| program | what it does |
|---|---|
| `packages/platform/example/crowd.wac` | How many host calls a program may have in flight, measured rather than quoted. |
| `packages/platform/example/greet.wac` | Listen, take one connection, and say who it came from. |
| `packages/platform/example/hexdump.wac` | A filter: bytes in, bytes out. `hexdump < file` or `hexdump file`. |
| `packages/platform/example/inetd.wac` | A network service whose handler is another wac program. |
| `packages/platform/example/inside.wac` | Running a program inside another one, with a world of its own. |
| `packages/platform/example/overlap.wac` | Two reads in flight at once — what the ticket surface is actually for. |
| `packages/platform/example/patience.wac` | Bounding how long a call may take. |
| `packages/platform/example/pipe.wac` | Two programs, piped together, with no shell involved. |
| `packages/platform/example/probe.wac` | A program that reports what it is allowed to do, for testing what a child is granted. |
| `packages/platform/example/roundtrip.wac` | The filesystem, wherever it happens to be. |
| `packages/platform/example/runner.wac` | Run another wac program as a worker, feed it, and read what it says. |
| `packages/platform/example/stages.wac` | A process that becomes ready twice, which is the shape `tor/src/network.wac`'s `wait` exists for. |
| `packages/platform/example/twin.wac` | A program that runs itself. |
| `packages/platform/example/waiter.wac` | A program that does not end by itself. |
| `packages/platform/example/wc.wac` | A word-count application, entire. There is no TypeScript in this directory. |
| `packages/platform/example/whichever.wac` | Wait on two sockets and report whichever speaks first. |
| `packages/platform/example/writeread.wac` | Can a socket be written to while a read on it is still outstanding? |
| `packages/fs/example/ops.wac` | The same filesystem operations against memory or against the host, so the two can be compared. |
| `packages/fs/example/saveimage.wac` | Save a filesystem that is partly the host's, and say what could not be saved. |
| `packages/tty/example/ttycat.wac` | A terminal and a `cat` behind it, so the line discipline can be compared with the kernel's. |
| `packages/sh/src/sh.wac` | `sh` — the shell as a program, entire, in wac. |
| `packages/box/example/boxsh.wac` | `box` and the shell in one command-line program — the twin of `term.wac`, without a browser. |
| `packages/box/example/term.wac` | A shell, in a browser tab. |
| `packages/box/src/bin/cp.wac` | `cp` on its own: the same applet, built as its own program. |
| `packages/box/src/bin/grep.wac` | `grep` on its own: the same applet, built as its own program. |
| `packages/box/src/bin/imaged.wac` | A shell whose filesystem is a file, **with the applets**: the session ends, the filesystem does not. |
| `packages/box/src/bin/sealedsh.wac` | A sealed shell **with the applets**: an in-memory world, and sixty commands over it. |
| `packages/box/src/bin/sh.wac` | The shell, with every applet in this package as a command. |
| `packages/box/src/bin/sha256sum.wac` | `sha256sum` on its own: the same applet, built as its own program. |
| `packages/box/src/bin/wc.wac` | `wc` on its own: the same applet, built as its own program. |
| `packages/box/src/box.wac` | A busybox-shaped application: one program, many applets, chosen by the first argument. |
| `packages/tor/src/app.wac` | A Tor client, entire. |
| `packages/tor/src/dird.wac` | A directory authority's HTTP port: serve the consensus, the certificate and the descriptor. |
| `packages/tor/src/gendesc.wac` | Generate a router descriptor and write it to a file, so tor's own parser can judge it. |
| `packages/tor/src/genhsdesc.wac` | Write an onion service descriptor to a file, so tor's own decoder can judge it. |
| `packages/tor/src/genintro.wac` | Write an ESTABLISH_INTRO cell to a file, so tor's own parser can judge it. |
| `packages/tor/src/hsconnect.wac` | Connect to a v3 onion service and fetch a page from it. |
| `packages/tor/src/hsfetch.wac` | Fetch a v3 onion service's descriptor from the network, and say what is in it. |
| `packages/tor/src/hsserviced.wac` | Host a v3 onion service. |
| `packages/tor/src/network.wac` | Stand up a Tor network from a description, run something across it, and take it down. |
| `packages/tor/src/relayd.wac` | A Tor relay: accept a connection, prove who we are, and carry circuits. |
| `packages/tor/src/socks.wac` | A SOCKS5 proxy that carries streams over Tor. |
| `packages/ethrpc/example/blocknumber.wac` | The smallest thing that asks a node a question: `eth_blockNumber`, printed. |
| `packages/ethrpc/example/ensowner.wac` | Who owns this ENS name — asked of a node, and believed only because a proof says so. |
| `packages/ethrpc/example/ethbalance.wac` | What an account holds, proved rather than asked. |
| `packages/ssh/src/ssh.wac` | `ssh` — the client as a program, entire. There is no TypeScript in this package's `src/`. |
| `packages/ssh/src/sshd.wac` | `sshd` — an SSH server, entire, in wac. |

## Pages

Every `export i32 page`: an interactive browser application, built with `--target browser`
and served with the two cross-origin isolation headers that `SharedArrayBuffer` needs.

```sh
deno task app:build <path> --target browser -o page/index.html
box httpd -8080 page -x
```

| page | what it does |
|---|---|
| `packages/platform/example/counter.wac` | An interactive page: draw something, then answer what the user does. |
| `packages/platform/example/pixels.wac` | Pixels, a pointer, and a frame you can keep. |
| `packages/box/example/hash.wac` | A page that hashes and compresses what you type, as you type it. |
| `packages/box/example/term.wac` | A shell, in a browser tab. |
