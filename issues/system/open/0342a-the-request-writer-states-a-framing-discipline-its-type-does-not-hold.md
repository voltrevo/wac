# 0342a — the request writer states a framing discipline its type does not hold

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** bug
- **Symptom:** none today — `Outgoing` has no production caller. The type permits what the file's own header forbids.

## The claim and the code

`packages/http/src/outgoing.wac`, first paragraph:

> the caller supplies a method, a target, headers and a body, and **this decides the framing**. A
> client that lets a caller set `Content-Length` by hand is a client that can be made to disagree
> with its own body length, which is the request-smuggling primitive from the other side.

`Outgoing.set` accepts any name:

```wac
void set(this, string name, string value) {
  this.headers.push(name.toBytes(), value.toBytes());
}
```

and `write` emits every header the caller pushed, then adds its own:

```wac
for (i32 i = 0; i < req.headers.len(); i++) { … emit … }

if (req.body.len() > 0) {
  out.pushAll("Content-Length: ".toBytes());
  out.pushDecimal(req.body.len());
  …
}
```

## Reproduction

```wac
Outgoing o = Outgoing.create("POST", "/x", "example.com");
o.set("Content-Length", "0");
u8[] wire = write(o, true);       // body is 5 bytes
```

Expected, per the file's own rule: a refusal, or the caller's header dropped.
Actual: two `Content-Length` fields on the wire, `0` and `5`.

That is the input this package's **own** request parser refuses — `ERR_FRAMING`, and
`packages/http/src/incoming.wac`'s header calls the same shape *the client-side version of
smuggling*. So the writer can emit a message the reader in the same package rejects.

`Transfer-Encoding` is the same and worse: nothing in `write` emits one, so a caller-set
`Transfer-Encoding: chunked` goes out beside a `Content-Length` the writer adds, which is the
canonical disagreement.

## Why this is latent rather than live

`Outgoing` has no production caller. `rg -l Outgoing packages tools` finds `src/outgoing.wac`, three
test files and `test/client_probe.wac`. Nothing takes a header name from input and passes it to
`set`, so there is no path today.

It is filed for the reason `issues/system/0337a` is: **the guard is a sentence, the enumeration is
complete by accident, and the next caller is the case.** A `box` applet that forwards a user's
`-H name:value` is the obvious one and does not exist yet.

## The fix

One classifier and one loop. Name the headers the writer owns, refuse them or drop them:

```wac
Owned? ownedBy(u8[] name)     // Content-Length, Transfer-Encoding, Connection, Host
```

Then either `set` answers a `Result` — a `try` at every header a caller adds, for a mistake that is
a typo in a constant — or `write` skips them, which is silent, or a `seal` step between building and
writing refuses once. The third is what `vision/packages/http/src/outgoing.wac` does, and its notes
argue the trade: the late refusal says *this will be checked* rather than *this cannot happen*, which
is one weaker than the reading side manages.

## Notes

**The list of what a caller may not set and the list of what the writer emits are two lists that
agree by inspection.** `write` emits `Content-Length`, `Connection` and `Host`; a complete refusal
list also needs `Transfer-Encoding`, which `write` never emits because this client does not chunk.
So the fourth entry is correct and in only one of the two lists, and nothing can check that — which
is the part most likely to rot when chunked sending is added.

Found while writing the vision counterpart of this file, which is the last of `packages/http`'s
sources that nothing in `vision/` had predicted anything about.
