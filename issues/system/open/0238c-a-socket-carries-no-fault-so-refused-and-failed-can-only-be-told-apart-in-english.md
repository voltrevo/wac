# 0238c — a `Socket` carries no fault, so refused and failed can only be told apart in English

- **Status:** open
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
