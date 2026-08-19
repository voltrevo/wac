# 0165 — wac cannot run a host program, and the strongest oracles this repository has are host programs

- **Status:** open — the buffered half is built; `start`/`stop` is not
- **Claimed by:** agent-b (buffered `exec`, landed 2026-08-17)
- **Reported by:** agent-b
- **Date:** 2026-08-16
- **Kind:** missing feature
- **Symptom:** not implemented

## What is built, and what is not

**`Cli.exec` exists as of 2026-08-17.** Buffered:

    fn[Pending<Exec>(string, string[], u8[])] exec;
    struct Exec { i32 status; u8[] stdout; u8[] stderr; string error; }

Granted by `--allow-run`, its own grant and its own bit (16) — not `write`'s and not `spawn`'s, so a
world that may start a confined wasm module can refuse a host binary without refusing both. A page
refuses it with no option to turn it on. Implemented on all four hosts: `native/v8` (Rust),
`native` (wasmtime), `deno.ts`, `node.ts`; `browser.ts` answers "a page cannot run a host program".

`args` is an argument **vector**, never a shell line. `status` is an exit code and `error` is why it
could not be started, and they are separate for the reason the rest of this issue gives.

Six cases in `packages/platform/test/wac/exec_test.wac`, run twice: with `--allow-run` all six pass,
without it all six fail. Four canaries on the Rust — stdin never written, stderr a copy of stdout,
the exit code forced to zero, the arguments put through a shell — fail one, one, one and four.

**Not built: `start`/`stop`**, the fifteen cases that keep a child alive as a server and then talk to
it over `connect`. Staged deliberately: buffered has no process-lifetime question, and start/stop
does — what happens to a live child when the program traps, exits, or the container stops — which is
a decision that is not on the path to the capture tools.

**And it is one host short of covered.** `packages/platform/test/wac/exec_test.wac` takes
`(Core, Cli)`, so it runs under `wac test` on the V8 host and is registered `ignore: true` in the
Deno lane. The two-lane comparison every row of `conformance_test.wac`'s ledger relies on has no form
for a capability test yet; `EXEC`'s entry there says so rather than claiming coverage it lacks.

## Re-measured 2026-08-18, against what is actually left

The counts above were taken when 294 host-side files remained. `issues/system/0161` has since
converted a large part of the suite, so the interesting number is what the *remainder* needs:

| | lines |
|---|---:|
| remaining `.test.ts` under `packages/` | 45,873 |
| of which need a live child — this issue | **12,029** |
| of which need a browser | 3,336 |
| of which need a live TLS or QUIC **peer** wac cannot be | 3,425 |
| **convertible with what exists today** | **~27,000** |

**The third row was missing when this was first written, and the number above it was too kind.** The
first split asked only whether a file spawns a child or drives a browser, so
`packages/quic/test/stream.test.ts` counted as convertible — and its oracle is `Deno.QuicEndpoint`,
an in-process QUIC server. wac has UDP and no QUIC peer, so there is nothing on the other end of that
socket to be. Sixteen files are in that position, mostly `quic` and `webrtc`.

`crypto.subtle` is *not* in it, which is the distinction worth keeping: WebCrypto is reachable as an
oracle *process* — `packages/crypto/tools/capture-hkdfcap.wac` asks it through `deno eval` — because
the question is a computation and not a conversation. A TLS peer is a conversation.

So this blocks a quarter of what is left, and is not the reason the other ~59% is still TypeScript. That is worth knowing before anyone builds `start`/`stop` to unblock the conversion: it
would unblock 25% of it, and the remaining 67% is waiting on nothing but the work.

The files it does block are the ones where a server is the subject — `tor/dird.test.ts` stands
`dird` up and talks to it over a socket, `tor/network.test.ts` starts and kills launcher children,
and `tor/ctor_live.test.ts` needs a **C** tor, which no amount of `spawn` reaches: that one wants
this capability specifically and cannot be rewritten around it.

## What was missing

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

## Why it matters, measured

The best tests here are differentials against an independent implementation, and those
implementations are host programs. **107 of the 294 host-side test files spawn one** — 31,469 lines,
the largest block of TypeScript in this repository outside the reference compiler.

But not all of it is oracle. Counted once per file, by what is spawned:

    44  a binary this repository built     — the `wac` binary, a cargo artefact: build-and-run tests
    18  git            13  bash            — the differential tier proper
    12  python3        11  cargo
    10  node            9  openssl
     5  ssh-keygen      3  ssh

So the tier where the external program *is* the second implementation is roughly sixty files, and
the other forty-four run something we built, which is a different argument for the same capability.

## What it would actually take, measured

The buffered-or-streaming question below was filed as open. It is answered, and the answer is
smaller than the question assumed. Classified by how each file uses the child:

    61  runs it to completion and reads its output
    31  writes its stdin, then reads its output
    15  starts it as a *server*, then talks to it over a **socket**
     0  reads the child's output while still writing to it

**Nothing in this repository streams through a child's pipes.** The zero is the finding. It was
checked against the three files most likely to break it — `ssh/test/server.test.ts`,
`tls/test/client.test.ts`, `sh/test/differential.test.ts` — and the first two spawn their peer with
`stdout: "null"` and then `Deno.connect` to a port. The third pipes stdin and reads the output once.

That splits the work in two, and neither half is the streaming pipe surface:

- `exec(path, args, stdin) -> { status, stdout, stderr }` covers **92 of the 107**.
- The other 15 need only *start and leave running*, plus a way to stop it. The talking is done by
  `connect`, which wac already has. `spawnSelf` already returns a `Pending<Child>`, so the handle
  type exists — this is the same shape pointed at a host path rather than at ourselves.

## The decision, which is why this is filed rather than done

**One capability or two?** `spawn` (a wac module) and running a host program are different acts with
different failure modes, and the browser has to be able to say "no" to the second while keeping the
first. Overloading `spawn` would make that "no" ambiguous. A separate `Cli.exec` keeps them apart at
the cost of a name that reads similarly.

**Buffered or streaming? — settled by the count above, and this section had it wrong.** It said
streaming was "what `packages/tls` and `packages/ssh` need, because a live peer's next byte depends
on ours". Their next byte does depend on ours, but it arrives over a **TCP socket**: both spawn their
peer with its stdout discarded and then `Deno.connect` to a port. They need the process *started*,
not streamed. No file in the repository interleaves reads and writes on a child's pipes.

So: buffered `exec`, plus a start/stop pair for the fifteen server cases. No pipe streaming.

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
