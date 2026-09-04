# http — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/http`: 1,238 lines over seven files. Only the parts the redesign
changes are written out — `headers.wac`, `outgoing.wac`, `response.wac` and `proxy.wac` are the same
code with a different error type, and copying them here would say nothing.

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

**A parsed request allocates nothing.** Every field of `Request` is a `Bytes` view into the
connection buffer rather than a copy — the request is read while that buffer is in hand and gone
before the next one, so the lifetime is a call. `requestLine` went from `(input, lo, hi)` to one
argument, and a caller can no longer pass the bounds of one buffer with another, which is the reason
the type exists rather than a tidiness argument for it.

`json` makes the opposite call for the opposite reason: a tree is what a caller keeps, so
`JsonValue.Str` owns. A slice cannot dangle — the collector holds the array for as long as any view
— so both are retention decisions rather than safety ones, and getting one backwards is a program
that holds ten megabytes to remember a hostname.

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
