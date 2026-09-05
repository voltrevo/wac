# 0358a — "bindgen cannot marshal a struct" is false, and the TLS byte-blob API is built on it

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** two packages serialise a connection on every call to work around a limit that does not exist

`packages/tls/src/server.wac:14`, under the heading *The state is a byte string*:

> **bindgen cannot marshal a struct across the boundary**, so a connection cannot be a handle the
> host holds. The state is serialised instead, and `feed` takes the old state and returns the new one
> alongside whatever should go on the wire. That is a constraint rather than a design…

`packages/tls/src/client.wac:20` inherits it in one clause — *"Like the server, the state is a byte
string and the host owns the socket and the randomness"* — and `packages/ssh/src/channel.wac:142`
reaches the same conclusion for its own flat struct: *"would not survive the bindgen boundary, where
this has to arrive as numbers and byte arrays anyway."*

## What bindgen actually does

`packages/wacc/src/bindgen.wac`, `classFor`:

> **A struct or an enum as a class holding the reference.** Nothing is copied: `$ref` is the WasmGC
> reference itself, and every accessor calls back into the module. That is what makes a wrapper cheap
> enough to hand around — a `Point` returned from one call can go straight into the next.

It emits, per the file header, *"a class per struct and enum"*. For a struct: field accessors and a
`$of` constructor. For an enum: a static constructor per variant and a `tag` typed in TypeScript as a
**string union** of the variant names.

So a struct crosses **by reference, uncopied**, and is designed to be handed straight back into the
next call — which is exactly the usage `tlsClientFeed` has.

## The one real limit, and it is narrow

`usableField` is the predicate that declines a field, and its own comment says the predicate is
deliberately narrow:

```wac
bool usableField(G g, string ft) {
  i32 c = callbackIndex(g, ft);
  if (c < 0) { return true; }
  return usableSig(g, g.cRet[c], g.cParams[c], true);
}
```

> So the predicate is narrow on purpose. **A funcref field whose signature the boundary cannot carry
> is the defect**; a field this generator merely has no opinion about is not.

Everything that is not a funcref returns `true`. The limit is *a funcref field with an uncarryable
signature*, not *a struct*.

## A third comment, and checking its citation changed this issue

`packages/sh/src/entry.wac` looked like the honest version and is not quite:

> this function takes a `Shell` — which, **since it gained a funcref field**, is a struct `bindgen`
> cannot currently express. Exporting it from `sh.wac` made every build of `sh.wac` emit wasm that
> would not compile, and the shell failed all 539 differential scripts at once with
> `Unknown heap type -34`. **wac issue 0062**, filed by agent-b the day before this hit it.

`issues/lang/closed/0062` is **"a module with more than 63 types emits an invalid heap type"** — a
LEB128 encoding bug in the `__bind_e_*` helper, where *"a type index of 64 or more does not fit in
one byte, so it decodes as a negative number and the module is rejected"*, with the sample failure
`Unknown heap type -64`.

So the **symptom matches exactly** — `-34` is a mis-encoded index, not a funcref complaint — and the
citation is right. What is wrong is the **explanation beside it**: the cause was the type-count
encoding bug, and adding a funcref field to `Shell` plausibly pushed the module past 63 types rather
than being the thing bindgen could not express.

**And 0062 is closed, fixed in `9c9e3eb`.** So `entry.wac`'s split — exporting the function from a
separate file so `Shell` never crosses — may be vestigial too. Not asserted: whether the split is
still load-bearing needs someone to try re-exporting it, which is a build away and is not this
issue's claim.

Funcref fields *are* a real and separate limit — `usableField` above is exactly that check — so the
explanation is not absurd. It is just not what the incident was, and not what the issue it cites
says.

## What it costs

`tls`'s connection carries no funcref fields — phase, suite, sequence numbers, key material,
transcript, certificate DER, chain offsets — so it would marshal. Because it does not, every entry
point serialises and deserialises the whole connection:

    export u8[] tlsClientInit(…)
    export u8[] tlsClientFeed(u8[] state, u8[] input)
    export u8[] tlsClientSend(u8[] state, u8[] data)
    export u8[] tlsClientClose(u8[] state)

`tlsClientFeed` calls a private `decodeConn` on entry and `encodeConn` on exit, per call, and a
caller feeding records in a loop pays it per flight. `server.wac` is the same shape. And `u8[]` being
the type of everything means `tlsClientFeed(input, state)` transposed compiles.

There is also a tell that the cost was noticed:
`export i32 tlsClientPhase(u8[] state) { return state[0]; }` reads byte 0 of the blob rather than
calling `decodeConn` — so the serialisation order is load-bearing across a package boundary.

## Against that, one real virtue, which should not be lost

`server.wac` names it: *"a connection's entire state is a byte string that a test can inspect,
corrupt, or replay."* That is genuinely useful and a reference-held struct does not give it. So the
decision is not simply wrong — **the stated reason for it is.** If the blob is kept, it should be
kept for the testing property, and `issues/system/0353a`'s unread `broken` field suggests nobody is
inspecting these blobs today.

## What to do

1. **Fix the sentence in `server.wac`**, and the clause in `client.wac` that inherits it. The true
   statement is that bindgen cannot carry a **funcref field whose signature the boundary cannot
   express** — `usableField`, above — and that is not a property of the TLS connection.
2. **Then decide the API on its merits**, which is a separate change and a larger one. The question
   is whether the inspect-and-replay property is worth an encode and decode per call; nothing has
   measured that, and this issue does not claim it is not.
3. `ssh/channel.wac`'s conclusion survives its reason — bindgen genuinely cannot let a host read
   inside a *variant*, since accessors are emitted inside `if (!isEnum)` — so that file needs its
   reason corrected and its design left alone.

## Related

- `issues/lang/closed/0062` — the >63-types LEB128 bug, **closed**. Cited by `sh/entry.wac` with a
  symptom that matches and an explanation that does not, and possibly leaving a vestigial file split.
- `issues/lang/0354a` — two other comments naming the wrong limitation.
- `issues/system/0356a` — cross-references that are structurally valid and about a different subject.
  **This issue is an instance of that**: `sh/entry.wac`'s `0062` passes every mechanical check and the
  prose beside it disagrees with the issue's title, which is the class 0356a says needs a person.

Together these are **five comments in one day naming the wrong blocker**, and each time the true one
was narrower and already written down somewhere else in the tree.
