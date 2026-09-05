# http — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/http`: 1,238 lines over seven files. Only the parts the redesign
changes were written out at first — *"`headers.wac`, `outgoing.wac`, `response.wac` and `proxy.wac`
are the same code with a different error type, and copying them here would say nothing."*

**`headers.wac` was written on 2026-09-04 and that sentence was wrong about it.** It is the one file
in this directory where the flat shape is the design and the richer type would be a *security* bug —
see below. The prediction failed in the useful direction: the file expected to say nothing produced
the counterexample to the method.

---

## The reason this package was chosen

**It is the first one where the error design meets more than one failing callee**, and the original
shows exactly what that costs today. Faults are exported functions returning literals, and the
numbering is *shared across two files by hand*: `request.wac` uses 1 to 10, and `incoming.wac`
opens with `export i32 ERR_STATUS() { return 11; }`. Nothing enforces it. Nothing would notice a
collision. A third module parsing a third kind of message has to read both files to find out where
its numbers may start.

`fault.wac` is what replaces that. Each fault is a struct that exists on its own terms; a function
says which it can produce by naming a union; and the response parser's set is

```wac
export union<RequestFault, BadStatus> ResponseFault;
```

— one line that says *everything a request can be wrong about, plus the one thing only a response
can*. No wrapper enum, no conversion at the boundary, and adding a fault to `RequestFault` reaches
here without this file being edited. That is the case unions were argued for, found in code that
was already written rather than invented for the argument.

## What changed

**One `Bad` arm instead of eleven decisions.** Every failure site in the original picks the right
`ERR_` number by hand. Here the helpers answer `Result`s with their own narrow sets —
`requestLine` fails with `union<BadRequestLine, BadMethod, BadTarget, BadVersion>` and nothing
else — and `parseRequest` has a single `Bad(why)`.

**`Parsed` stays three named cases, and that is the interesting part.** The obvious collapse is
`Result<Request?, RequestFault>` with a null meaning *keep reading*. It is one type instead of two
and it is wrong: two of the three outcomes would share a constructor, so a caller could handle the
failure, forget the null, and treat a partial request as a complete one. `vision/README.md` refuses
exactly that. **A redesign that collapsed everything into `Result` would be the cute code, not the
clean one** — worth recording, because three packages in, the pull to do it is strong.

**`TooLarge` carries what was wanted and what the limit was.** It was a bare `10`. A server that
wants to log the refusal had nothing to log.

**`findCrlf` and `isDigit` stop being written twice.** Both are duplicated verbatim between
`request.wac` and `incoming.wac` in the original, both private. That is not a language finding and
`bytes.wac` says so in its header — the rewrite gets no credit for it.

**`maxBody` is an `i64`.** `Content-Length: 999999999999` is the case the parameter exists for and
it does not fit in the type that was measuring it.

**A parsed request copies nothing**, which is weaker than the *allocates nothing* an earlier draft
claimed — a struct is heap-allocated, so each field is one `struct.new` rather than one copy. Every
field of `Request` is a `Bytes` view into the connection buffer rather than a copy — the request is read while that buffer is in hand and gone
before the next one, so the lifetime is a call. `requestLine` went from `(input, lo, hi)` to one
argument, and a caller can no longer pass the bounds of one buffer with another, which is the reason
the type exists rather than a tidiness argument for it.

`json` makes the opposite call for the opposite reason: a tree is what a caller keeps, so
`JsonValue.Str` owns. A slice cannot dangle — the collector holds the array for as long as any view
— so both are retention decisions rather than safety ones, and getting one backwards is a program
that holds ten megabytes to remember a hostname.

## The counterexample: where a `Map` would be the wrong type

Every other rewrite here turned a table into a type. [`src/headers.wac`](src/headers.wac) is two
parallel arrays and a count in the shipped tree, and its header gives three reasons that are all
still true:

> Names and values are kept as parallel arrays of byte slices, **in the order they arrived and with
> duplicates intact** … `Set-Cookie` cannot be folded into one value, the order of `Via` and
> `Forwarded` is the record of the path a message took, and a duplicate `Content-Length` is the
> thing a framing check has to notice rather than the thing a map would silently drop.

So `Map<string, Bytes>` with case-insensitive keys is not a better type. It is a **wrong** one, and
it loses a security property: `countOf("Content-Length") == 2` is a request that must be refused,
and a map cannot hold the input that says so.

What is left is small and worth doing: `Vec<Field>` instead of two arrays and a count — the fifth
pair of parallel arrays here and the **first that is deliberate** — and `Bytes?` from `first`,
where the shipped one answers an empty slice and its doc says *"use with `countOf`, not instead of
it"*: a sentinel from the value's own range plus a documented pairing of two calls, in a type with
two other methods.

### Which says what the method's failure mode is

Ask of a flat representation *what type should this have been*, and the answer here is **none**. Two
of the three flat descriptors this exercise converted gave a reason — `@/packages/ssz`'s was a JS
boundary that has since gone, `@/packages/ts`'s gave none — and this one's reason is live. **A stated
reason is the difference between a habit and a decision**, and the only way to tell is to read it and
check whether it still holds. Three files, three answers: expired, absent, current.

### Some header names are single-valued and some are not, and the type says neither

`first` is right for `Content-Length` and wrong for `Set-Cookie`; a `values` would be right for
`Set-Cookie` and misleading for `Content-Length`, where a second one is a fault rather than a list.
The shipped API answers with `countOf` plus `first` and a sentence telling the caller to use them
together — a protocol between two methods.

What would say it is a closed set of field names with an arity each, and that is a large ask: the set
is open by design and the arities live in a dozen RFCs. So this is **knowledge about HTTP, not about
headers**, and its place is the code that reads a particular field. The tempting alternative is worse
— an enum of the fifteen names this package cares about with an `Other(Bytes)` arm puts an open set
inside a closed one and makes `Other` the common case.

## A fault cannot be more precise than the capability under it

Found auditing this directory against its own findings. `src/client.wac` declared

```wac
/** The host would not resolve, or the socket would not open. */
export struct NoConnection { string host; string why; }
```

and `std`'s capability is `fn<Ticket<Result<Socket, NotGranted>>(string, i32)> connect;` — so
**`NotGranted` is the only thing `connect` can say.** A client cannot tell *the name did not resolve*
from *the socket was refused* from *this program may not use the network*. Three causes, one answer,
and the fault invented a field to hold a distinction that never arrives.

It is the inverse of everything else here: five days spent making faults more precise than a `bool`,
and this one was more precise than the data. `ReadFailed`'s `why` stays — `Socket.recv`'s `Read` sum
has a `Failed(string)` arm, so there is a real message from the host.

**The rule none of the other entries states:** a fault union is bounded above by what its sources can
distinguish. Five members is right only if five things are separately knowable at the layer that
answers, and `NoConnection`'s `why` was a sixth distinction *inside* one of them, invented at the
layer that wanted it rather than the layer that could see it.

Underneath is a `std` finding: `Net.connect` collapsing DNS failure, refusal and a missing grant into
one `NotGranted` is the shape this directory keeps unpicking, and worse than a package's — a package
can be rewritten, and a capability's answer is what the host gives.

## What could not be written

**A named union declaration has no form on the pages.** `export union<A, B, C> RequestFault;` is
invented here. `union<…>` appears everywhere as a type *expression*; nothing shows giving one a
name, and this package is unwritable without it — the alternative is repeating ten members at every
signature that mentions them. Whether the name is a distinct type or an alias also matters, and
`vision/QUESTIONS.md` already asks a related thing under *whether a named union can be a match arm*.

**Nothing says a union may contain a union.** `union<RequestFault, BadStatus>` relies on the members
of the first being flattened into the second. Set semantics say they should be, and it is the whole
value of the line, but it is stated nowhere.

**Where a fault's *message* lives is unresolved.** Eleven structs with no fields need eleven strings
somewhere for a server to log or return. A method on each is eleven declarations; a `match` in one
place is a function that must be updated whenever a fault is added, with nothing to catch a miss
unless the match is exhaustive over a named union — which is the match-arm question again, now with
a use.
