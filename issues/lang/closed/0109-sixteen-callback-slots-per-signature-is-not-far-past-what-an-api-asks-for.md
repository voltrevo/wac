# 0109 — sixteen callback slots per signature is not "far past what a callback-taking API asks for"

- **Status:** closed
- **Claimed by:** agent-b
- **Closed:** 2026-08-13
- **Fixed in:** the commit closing this
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

**Corrected 2026-08-12, later the same day: it is much worse than the first draft of this section
said.** I wrote that it blocks one step of one design note. In fact **adding a capability to `Cli`
at all breaks every program on the native host**, whether or not the program uses it: the funcrefs
are registered per capability at startup, so the seventeenth pushes every native run past the cap.
A full suite run with the three datagram fields declared failed **21 tests** — `arrival`,
`native_examples`, `native_hostfs`, `native_shell`, `sealed`, all of them — with

```
Error: at most 16 distinct functions of signature 24 can be passed
```

(signature 24 there rather than 23, because the count moves with the world). None of those tests
touches a datagram. So this is not a blocker for one feature; it is a hard ceiling on the capability
surface, and it is reached *now* rather than at some future capability.

That is why the datagram fields are not landed: they are correct, every host answers them, and
declaring them turns the native half of the suite red for everyone. The work sits behind this issue
rather than in front of it.

**It does not need writing again.** The declaration was committed and then unwound, so it is in
history: `7cce2dc7` adds the `Cli` fields, the `Datagram` struct with its `of`, the provider decoder
and `sh`'s probe fakes; `344b5b88` adds `packages/platform/example/udpecho.wac` and
`packages/platform/test/datagram_hosts.test.ts`, a program that echoes a datagram to the peer it came
from and a test that runs it on both hosts. `1259712a` is the unwind and says what it removed.
Reapplying those two and raising the cap is the whole of what is left.

The original text follows, and it is still true as far as it goes.

It blocks design/system 0007 step 1 at its last step. Every host answers datagrams —
Deno, Node, both native ones, and the browser refuses — and a wac program echoes one correctly on
the JavaScript hosts. `packages/platform/test/datagram_hosts.test.ts` is written to run that same
program on both and compare, which is what turns the conformance ledger's `gap` entry into a `where`,
and it cannot until this is lifted. The test pins the current behaviour so that whoever lifts it is
told to enable the comparison rather than having to remember.


## 2026-08-13, agent-b: measured with both constants at 32, and the answer is no

The issue asked for exactly this measurement — *"if the answer is a few kilobytes on a 300 KiB floor,
raising it is obvious"* — so here it is. Every copy of the number moved together: `CALLBACK_SLOTS` in
`compiler/wasmBuildBin.ts`, `callbackSlots()` in `packages/wacc/src/emit.wac`, the `slot >= 16` guard
and its message in **both** bindgens, and the `slots: 16` the manifest and the site's shim carry.
Six places, which is itself part of the answer.

```
packages/platform/example/wc.wac      16 slots      32 slots      delta
  module                             156,153      186,041      +29,888  (+19.1%)
  built application                  286,279      326,127      +39,848  (+13.9%)
```

**Not a few kilobytes. Thirty, on the smallest program in the repository** — one that reads standard
input and prints three numbers.

### Why it is that expensive, and why the shape is wrong

`wc` has **42 callback signatures**, and the trampolines are emitted per signature per slot. Doubling
the slots emits 16 more trampolines for all 42, so the cost scales with the number of signatures in
the program while the benefit lands on the *one* signature class that happened to fill up. Every
program pays for a limit only the capability surface reaches.

That is the same asymmetry the issue already identified from the other side — *"a count that grows
with the world rather than with any one API"* — and it means the constant is not the thing to change.
Raising it to 32 buys one more capability generation at 19% of every module, and the next capability
asks again.

### What I would look at instead, in order

1. **Emit trampolines per signature the program can actually receive.** 42 signatures at 16 slots is
   672 trampolines in a program that registers a couple of dozen host functions in total. The slot
   count is uniform because the module cannot know which signature a host will crowd; the *manifest*
   could say, since it is written after the boundary is known.
2. **Find out where a seventeenth function of one signature comes from**, because the manifest does
   not obviously contain one. Counted on `wc`:

   ```
   42 callback signatures in the manifest, each distinct
   Cli has 32 fields; the most repeated shape appears 3 times
     x3  fn[Pending<Change>(string,bool)]
     x2  fn[bool(u8[])]   x2  fn[Pending<Stat>(string)]   x2  fn[Pending<Change>(string)]
   ```

   So capability *fields* do not crowd a signature class — three is the worst. The failure above says
   seventeen distinct functions of signature 24, which means they are coming from somewhere else:
   either the native host registers a fresh function per *ticket* rather than per field, or its
   dispatchers collapse several wac signatures onto one of its own. Whichever it is, that is the
   thing to fix, and it is not the constant.

   **Correcting my own first draft of this line**, which said `Pending<T>`'s monomorphisation lands
   every capability in one family. It does the opposite — that is what monomorphisation is for — and
   the count above is what shows it.
3. **Only then** consider the constant, and if it moves, move it with a measurement per program
   rather than per repository — `wc` is the floor, and `box` at 42 signatures is not the worst case.

The experiment is reverted; nothing in the tree carries 32.


## Fixed — one slot per capability, not one per `Pending<T>`

The seventeenth function of one signature is not a capability field, and it is not the constant. It
is the **same capability registered fifteen times**.

`Pending<T>`'s hooks are `resolve`, `settled` and `drop`. Only `resolve` depends on `T`; `settled` and
`drop` are `Cap::Settled` and `Cap::Discard` whatever the type is — and both hosts registered a fresh
slot for each instantiation. Counted on `packages/platform/example/wc.wac`:

```
15 Pending<T> instantiations
16 registrations of fn[bool(i32)] — against a cap of 16
```

**Already at the limit.** Not "would be reached at some future capability" — the next one to answer
through a new `Pending<T>` fills it, which is precisely the datagram work, and then every program on
the native host refuses at startup whether or not it touches a datagram. That is what agent-a
measured as 21 failing tests, and the cause was one line in each host.

`register` now reuses a slot when the same capability is already registered under that signature, in
both `native/src/main.rs` and `native/v8/src/main.rs`. `fn[bool(i32)]` goes from **16 of 16 to 1**.
Reuse is not an economy, it is the truth: the same capability reached through the same signature is
the same function, and the slot is only what the module calls it by.

`packages/platform` 166 tests pass, box's shell runs on both hosts, and `wc` answers identically.

### Why not the constant, kept for the record

Measured before deciding: with `CALLBACK_SLOTS` and `callbackSlots()` both at 32, `wc`'s module grows
**+19.1%** (156,153 → 186,041 bytes) and its built application +13.9%. The cost is per *signature*
— `wc` has 42 of them — while the benefit lands on the one class that filled. Doubling buys one
generation and asks again; this fix removes the growth term entirely, since a fourteenth or fiftieth
`Pending<T>` now costs nothing in that class.

**The datagram work in `design/system/0007` is unblocked**: the fields it adds contribute one
`resolve` shape and no `settled`/`drop` pressure at all.
