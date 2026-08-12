# 0109 — sixteen callback slots per signature is not "far past what a callback-taking API asks for"

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-12
- **Kind:** missing feature
- **Symptom:** trap

## Reproduction

Add one capability to `Cli` whose answer is a new `Pending<T>` — `packages/platform`'s datagram
work (design/system 0007) added `Pending<Datagram>` — build any program that uses it, and run it on
the host with no JavaScript in it:

```
$ native/target/release/wacland /tmp/wac-udpecho-*/udpecho.json
Error: at most 16 distinct functions of signature 23 can be passed
```

Expected: the program runs, as it does on the Deno host.
Actual: it refuses at startup, before `main`.

The JavaScript hosts do not hit it because the same limit is spelled as a `RangeError` per signature
that nothing has reached there yet — the wac side of the same module carries
`throw new RangeError("at most 16 distinct fn[Pending<i64>()] functions can be passed to this
module")`, which is the same cap counted the same way.

## Where

**Two places, and they have to agree.**

- `compiler/wasmBuildBin.ts`: `const CALLBACK_SLOTS = 16`, whose comment is the thing this issue is
  named after — *"Sixteen per signature is far past what a callback-taking API asks for, and the host
  is told plainly when it runs out rather than silently reusing a slot."* The second half is exactly
  right and is why this is a clean error rather than a corruption.
- `packages/wacc/src/emit.wac`: `i32 callbackSlots() { return 16; }`, whose comment says why the two
  cannot drift — *"the reference offers sixteen, and glue is generated against that number."*

`native/src/main.rs` reads it from the manifest (`m.callbacks[sig].slots`) rather than duplicating
it, which is right and means the native host needs no change.

## What I measured, and what I did not

Raising `CALLBACK_SLOTS` to 32 in the reference compiler alone changes nothing, because **the build
uses `wacc`**: a rebuilt `packages/platform/example/wc.wac` still carries `at most 16 distinct` in
its glue, byte-identical at 319,235 bytes, after clearing `.cache/bind`. So a measurement of the cost
needs both constants moved together, and I have not made one — the number below is what I could
establish without touching the port.

I did not change `packages/wacc/src/emit.wac`. `CLAUDE.md` says that file is being actively ported
and to prefer a precise reproduction over patching underneath; `git log` shows three commits in it
today, the most recent about an hour before this was written.

## The decision in it

Sixteen is a code-size trade: each signature emits that many trampolines whether a program uses them
or not, and every module pays. So this is not "raise it to 64 and move on" — the useful next step is
to **measure a build with both constants at 32** and see what a module actually grows by. If the
answer is a few kilobytes on a 300 KiB floor
([issues/system 0129](../../system/open/0129-every-built-executable-carries-a-floor-that-has-grown-seven-fold.md)),
raising it is obvious. If a signature's trampolines are emitted per *use* rather than per slot, it
may cost nothing at all and the constant is simply stale.

A second shape worth weighing: the cap is **per signature**, and `Pending<T>` monomorphises, so every
new capability return type consumes a slot in the same signature class. That is why a system with 35
`Cli` fields hit it now and would hit it again at the next capability, whatever the number is. A
count that grows with the *world* rather than with any one API is the part that will not stay fixed
by making it bigger once.

## Why it matters

It blocks design/system 0007 step 1 at its last step. Every host answers datagrams —
Deno, Node, both native ones, and the browser refuses — and a wac program echoes one correctly on
the JavaScript hosts. `packages/platform/test/datagram_hosts.test.ts` is written to run that same
program on both and compare, which is what turns the conformance ledger's `gap` entry into a `where`,
and it cannot until this is lifted. The test pins the current behaviour so that whoever lifts it is
told to enable the comparison rather than having to remember.
