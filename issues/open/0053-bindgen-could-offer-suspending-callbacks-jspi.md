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
