# 0165 — wac cannot run a host program, and the strongest oracles this repository has are host programs

- **Status:** open
- **Claimed by:** (nobody yet — the shape below is a decision, not just work)
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

## What is missing

`Cli` offers thirty-five capabilities and none of them runs a program on the host:

    argCount arg write writeErr readFile env cwd openInput openOutput outputError
    readChunk writeFile stat linkStat readDir readStdin spawn spawnSelf exitCode
    closeFeed pushChild popChild connect listen accept recv send closeSocket
    bindDatagram receiveFrom sendTo rename remove mkdir setExecutable

`Cli.spawn` is the one that looks like it. It is not: it starts another **wasm module**, reading
bytes and wanting a `wac.manifest` section — *"this runtime starts wasm modules, and that is not
one; spawnSelf works"*. `spawnSelf` runs an applet of the *same* program in a worker, which is what
`packages/box` and `packages/sh` do. Neither runs `/usr/bin/gunzip`.

**Worth stating plainly because the wrong version is easy to believe**: this issue exists because
`issues/system/0161` asserted "`packages/box` spawns processes from wac, so the capability exists",
and I repeated it in an answer before reading `Cap::SpawnOther`.

## Why it matters

The best tests here are differentials against an independent implementation, and those
implementations are host programs: the system `gunzip` catching a wrong bit order that a
self-round-trip cannot, OpenSSL and rustls and curl on the TLS handshake, a real `sshd`, quinn,
C tor. **42 of the 260 files that bind or register wac spawn a process**, and every one of them is
pinned to TypeScript by this gap alone.

It is not the largest tier — 77 read a file, which `issues/system/0161` step 4 answered — but it is
the one where the host-side test is *better* than any wac test could be, rather than merely
incumbent.

## The decision, which is why this is filed rather than done

**One capability or two?** `spawn` (a wac module) and running a host program are different acts with
different failure modes, and the browser has to be able to say "no" to the second while keeping the
first. Overloading `spawn` would make that "no" ambiguous. A separate `Cli.exec` keeps them apart at
the cost of a name that reads similarly.

**Buffered or streaming?** They serve different tests and the simpler one covers more:

- *buffered* — `exec(path, args, stdin) -> { status, stdout, stderr }`. Covers `gunzip`, `openssl`,
  `python3 -c`, `git`: everything whose oracle is a pure function of its input. Simple to grant,
  simple to reason about, and a run is reproducible.
- *streaming* — what `packages/tls` and `packages/ssh` need, because a live peer's next byte depends
  on ours. Much larger, and it is the same shape as `connect`/`accept`, which already exist.

Starting buffered is the recommendation: it takes the whole differential-oracle tier, and the
streaming tests already have a working host-side home.

**And the grant.** `--allow-run`, following `--allow-read` and friends, with the same rule as step 4:
the program names the capability and gets it only if the run was granted. A test that shells out
says so in its signature.

## What not to do with it

Not everything that *can* move should. Two of this session's conversions were worth doing because a
wac test is **deterministic** where the host-side one sampled: `packages/quic`'s short-header test
guards a bug that passed 5 of 8 runs against a real server and now fails every run, and its
connection test checks accounting a real server cannot observe at all. Reaching for a subprocess
where an in-process check exists trades that away. The category this is for is the one where the
external program *is* the independent implementation.
