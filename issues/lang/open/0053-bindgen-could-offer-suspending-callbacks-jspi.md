# 0053 — bindgen could offer suspending callbacks, and the engine already does

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-01
- **Kind:** missing feature
- **Symptom:** not implemented

A wac module can already be suspended across an asynchronous host call. **No compiler change is
needed** — the module compiles as it does today and the engine does the work. What is missing is a
way to ask for it from the generated bindings.

## It works now

Verified against an unmodified module from the current compiler:

```wac
export i32 pump(fn[i32()] read) {
  i32 total = 0;
  while (true) {
    i32 n = read();
    if (n == 0) { break; }
    total = total + n;
  }
  return total;
}
```

The module imports one dispatcher, `wac.cb0`. Wrapping *that* in `WebAssembly.Suspending` and
calling the export through `WebAssembly.promising` is all it takes:

```ts
const instance = await WebAssembly.instantiate(module, {
  wac: { cb0: new WebAssembly.Suspending(async (_slot) => {
    await new Promise(r => setTimeout(r, 1));      // a real await
    return queue[i++];
  }) },
});
const pump = WebAssembly.promising(instance.exports.pump);
await pump(instance.exports.__bind_fnref_0(0));    // → 12, suspended three times on the way
```

The wac side is an ordinary loop. It does not know it was suspended, and nothing about it changed.

## Why it matters

`wac-mono/issues/0006` is about streaming gzip, and it is the same shape as every other codec,
parser and protocol that wants to consume input as it arrives. There are two ways to write one
without this:

- **the host pushes into a held object** — works, but forces the whole decoder into explicit state
  so it can resume mid-symbol. For DEFLATE that is block loop, symbol loop, extra bits and copy
  loop all turned into saved fields. A rewrite, not an addition;
- **wac pulls through a callback** — the natural nested loop, but the host must supply input
  *synchronously*, which rules out a socket.

With a suspending callback the second one works for sockets too, and the state machine is never
written. That is the difference between a rewrite and a parameter.

## What bindgen would need

Both halves are host-side, which is why this is a bindgen issue and not a codegen one:

1. wrap the dispatcher for a chosen signature in `WebAssembly.Suspending`;
2. generate a promising variant of any export that can reach it, returning `Promise<T>`.

One wrinkle worth designing around rather than discovering: **a dispatcher is per signature, not
per parameter.** Marking `fn[i32()]` suspending marks every `fn[i32()]` callback in the module. If
opt-in should be finer than that, bindgen needs a second dispatcher for the suspending case, or
the choice has to be made per module.

## Caveats, all checked

- **Availability is uneven, and this has to be additive because of it.** What was measured here,
  rather than recalled:

  | runtime | result |
  |---|---|
  | Deno 2.9 / V8 14.9 | `WebAssembly.Suspending` and `promising` present; **verified end to end** |
  | Node 22.23 / V8 12.4 | current names absent. `--experimental-wasm-jspi` makes `WebAssembly.Function` and `WebAssembly.Suspender` appear, but `Suspender` has only a constructor and no methods, and the suspending import does not link. **Not usable.** |
  | Node 24+, browsers | **not measured** — no other runtime is reachable from this container |

  For browsers the recollection is that Chrome shipped JSPI in 2025 and that Firefox and Safari
  had not; that is exactly the kind of fact that moves, and nobody should act on it without
  checking. The check is three lines: `typeof WebAssembly.Suspending`.

  The design consequence does not depend on any of it: **generate the synchronous bindings as
  now, and offer suspension as an addition**, so a module keeps working where JSPI is missing.
- **Misuse is loud.** Calling a suspending import from a non-promising export throws
  `trying to suspend without WebAssembly.promising` — a clear message, not corruption.
- **The synchronous path is unaffected.** The same module instantiated with a plain function
  behaves exactly as before.
- Each suspended call needs its own stack, so this scales to a handful of concurrent streams
  rather than thousands. Worth saying in the docs.

## What this does *not* give

Suspension **inside** wac, with no host in the loop — generators, an iterator protocol, coroutines
between two wac functions. JSPI suspends at the boundary and nowhere else.

That is worth knowing because `packages/std`'s README already names the gap: "no iterator protocol
and no closures, so `keys()` and `values()` allocate an array". Closing *that* needs a real
compiler transform — a state machine per coroutine, in the shape C# and Rust generate for `async`
— or core wasm stack switching if V8 ships it outside JSPI, which I did not check. Either is a
much larger piece of work than this issue, and this issue does not depend on it.

## Decision (agent-a, 2026-08-01, from the operator)

**Not building this.** The standing constraint is not to rely on a wasm feature that is not broadly
supported, and JSPI is not: it ships in Chrome 137+ and is behind a flag or absent elsewhere. That
rules it out as something bindgen offers, however cheap it looks.

**Nothing is lost by waiting, and this issue stays open rather than closed.** The finding above is
still true and still valuable: both halves are host-side, the emitted module is byte-identical
whether or not a host suspends it, and a caller who has already decided their engine supports JSPI
can do exactly what this issue describes today, by hand, against the dispatcher import. What is
declined is *bindgen generating it*, which would put the feature in the supported surface of every
module we produce.

Revisit when JSPI is in two or more of Firefox, Safari and Node without a flag.

### What a wac module actually requires

Recorded here because it is the general form of the constraint, and because the next feature that
crosses this line should be visible as a decision rather than discovered by a user. As emitted
today:

| proposal | why | status |
|---|---|---|
| MVP, incl. mutable globals | everything | universal |
| non-trapping float→int (`0xFC 0x00`–`0x07`) | `as~` from a float | finished, shipped ~2020 |
| reference types | funcrefs, `ref.null` | finished |
| typed function references | `call_ref`, `ref.func` at a concrete type | part of GC |
| garbage collection (`0xFB …`) | structs, arrays, strings, enums, i31 | finished Dec 2023 |

That is Chrome 119+, Firefox 120+, Safari 18.2+, Node 22+ and Deno — all shipped, none behind a
flag. Verified by enumerating the opcodes the emitter can produce, not by recollection: there are no
bulk-memory (`0xFC 0x08`+), exception-handling, tail-call or SIMD opcodes anywhere in it.

### For the streaming case that motivated this

`wac-mono/issues/0006` still needs an answer, and the two given above are the ones available: the
host pushes into a held object, or wac pulls through a synchronous callback. The first is a rewrite
into explicit state; the second works wherever the input can be produced synchronously, which is a
file or a buffer but not a socket. Neither needs anything the engines do not already have.

## Blocked on a decision, not on work, 2026-08-03 (agent-a)

This conflicts with the engine floor the project has settled on: MVP, non-trapping float-to-int,
reference types, typed function references, and GC. Nothing above that, on the stated grounds of
not depending on a feature that is not broadly supported yet — which is also why the whole
capability world is built on `Atomics.wait` and a `SharedArrayBuffer` rather than on suspending.

So the accurate status is not "nobody has done it" but "somebody would have to widen the floor
first". Left open rather than closed because the finding — that it works today with no compiler
change — is worth keeping, and because widening the floor for *optional* bindings that fall back to
blocking is a defensible position somebody may want to argue. It should not be picked up as
ordinary work.
