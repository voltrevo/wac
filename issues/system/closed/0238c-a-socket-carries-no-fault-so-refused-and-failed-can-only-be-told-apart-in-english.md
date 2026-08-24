# 0238c — a `Socket` carries no fault, so refused and failed can only be told apart in English

- **Status:** closed
- **Closed by:** agent-c, 2026-08-24
- **Fixed in:** `Socket.fault`, filled by all four hosts; `probe.wac` reads it and its
  substring workaround is deleted -- see *"Fixed"* at the end
- **Reported by:** agent-c
- **Date:** 2026-08-21
- **Kind:** missing feature
- **Symptom:** wrong answer

`FileResult` and `Change` both carry a `fault` field, and `FileResult.fault`'s own docstring says why:

> The message cannot be branched on: "No such file or directory (os error 2)" from Deno, "ENOENT: no
> such file or directory" from Node and a `NotFoundError` from the Origin Private File System are
> three spellings of one fact.

`Socket` does not have one. Its fields are `handle`, `error`, `peer`, `port`, and a negative handle
means *something* went wrong — so a program that has to tell "the network was not granted" from
"nothing is listening on that port" has only the host's sentence to go on. That is exactly the
distinction the grants tests are about, and the four hosts spell it two ways.

## Reproduction

`packages/platform/example/probe.wac` is the program that needs it, and it is in the repository
because two spawn tests read its answer:

```wac
Socket s = cli.connect("127.0.0.1", 1).wait();
string net = s.handle < 0 ? s.error : "ok";
// ...and then the only thing available:
return contains(outcome, "ot granted") ? "denied" : "failed";
```

The first letter is dropped on purpose. Measured 2026-08-21, one refused `connect` across the hosts:

| host | what a refused `connect` says |
|---|---|
| Deno (`host/deno.ts`) | `network access not granted to this application` |
| Node (`host/node.ts`) | the same — one implementation |
| `wacland` (`native/src/main.rs:2387`) | `network access not granted to this application` |
| `wac` (`native/v8/src/main.rs:4764`) | **`Not granted to this application`** |

Expected: a program reads a category and gets the same answer from every host.
Actual: it matches a substring, and `"ot granted"` is the longest one all four share.

## Notes

**The read side had the same bug and it was invisible for the same reason.** `probe.wac` used to
branch on `FileResult.error` with `contains(outcome, "not granted")`, so under both *native* hosts —
which say `Not granted to this application`, capital N — it printed `read=failed` when the read had
been refused. Nothing caught it because the only tests that ran `probe` ran it under Deno and Node:
`packages/platform/test/wac/spawn_test.wac` asserts on the Deno and Node output and never ran it
natively. Fixed on 2026-08-21 by reading `f.fault == FAULT_NOT_GRANTED()`, which is what the field is
for; the network half of the same function cannot be fixed that way because there is no field.

So this is a `fault` on `Socket`, and it is not free: `Socket.of` is positional and its field order is
in every manifest, so it is the four hosts, `provider.ts`, and `order_test.wac`. `Datagram` should be
looked at in the same change — it has an `error` string and no category either.

Worth doing with `issues/system/0169`'s conclusion in hand: that issue made `wacland` say what
`platform.wac`'s own `reasonOf` says, which is where `Not granted to this application` comes from. The
JavaScript hosts were not changed to match, so **the canonical wording exists and two of four hosts do
not use it** — either finishing that or adding the field would fix `probe`; only the field fixes the
class.

## Fixed — agent-c, 2026-08-24

`Socket` carries `i32 fault` now, appended last as `Stat` does, and every host fills it:

- `packages/platform/host/provider.ts` — the socket resolver's catch uses
  `e instanceof HostCallError ? e.fault : FAULT_OTHER`, which is the line `Change`'s catch seventeen
  lines above had and this one did not. That was the whole of the JavaScript half.
- `native/v8/src/main.rs` and `native/src/main.rs` — eleven construction sites each, in four groups:
  success is `FAULT_NONE`, an `Err(e)` from the OS goes through the `fault_of` each host already had,
  the "not granted" sites are `FAULT_NOT_GRANTED`, and `accept` on a handle that is not a listener is
  `FAULT_OTHER`. Both `tickets.rs` variants and `build_socket`/`make_socket` carry it through.
- `std/platform.wac`'s `Socket.of` takes it, and `packages/box/src/applets/nc.wac`'s two local
  sentinels — a usage error and an already-reported failure, neither of which reached a host — say
  `FAULT_OTHER`.

**The workaround is gone, which is the better completion condition than "the field exists".**
`probe.wac` matched `"ot granted"` with the leading letter dropped so that both spellings hit; it now
reads `s.fault == FAULT_NOT_GRANTED()`, the same line it already used for the file, and its private
`contains` helper is deleted.

### What proves it, and it was already in the suite

`spawn_test.wac` asserts probe's output across all four hosts and happens to contain both halves of
the distinction: `net=denied` where the network was not granted, and `read=ok net=failed` where it was
granted and the connect failed anyway. A fault that answered `FAULT_NOT_GRANTED` for every failure
would pass the first four rows and fail the last two, so the two are held apart rather than merely
reported. Ten tests, unchanged, green.

### The siblings, not fixed here

`Datagram` and `Child` have the same shape — an `error` string and no category — while `FileResult`,
`Change` and `Stat` all carry one. Left alone because this issue names `Socket` and because one struct
at a time is a reviewable change.

**Neither is as strong a case as this one was, and it is worth saying why rather than leaving them
looking equivalent.** `Socket` had a caller getting a wrong answer. `Child`'s failures are "that is
not a wasm module", "that module has no manifest section", and a catch-all; `packages/sh` turns all of
them into 126 with a comment conceding that "one integer cannot say both", but 126 — *found and would
not run* — is defensible for each. There is no refused-for-want-of-a-grant case behind it: `spawn`
starts a wasm module and is not gated on `--allow-run`, which gates `exec`, and a spawned child gets
`run: false` unconditionally. The one outcome that genuinely differs, "this world has no `spawn` at
all", is already told apart by the `-2` sentinel and `unavailable()`.

So the argument for `Child.fault` is consistency and the `FAULT_*` codes it would need — "not a wasm
module", "no manifest" — do not exist either. Worth doing when something asks for it.

### One thing this does not fix

The hosts still spell the same condition differently in `error` — `wacland` says "network access not
granted to this application" where the V8 host says "Not granted to this application", and `accept` on
a non-listener is "not a listening socket" against "no such listener". That no longer matters for a
program *deciding* something, which is the point. Nothing compares those sentences:
`commandparity_test.wac` has no networking row at all.
