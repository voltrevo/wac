# url — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/url`: 1,227 lines over three files. The parsing is a state machine
transcribed from the WHATWG standard and none of it is rewritten — the standard did not move because
the language did.

---

## The finding: this is the first real `T??`

`vision/GRAMMAR.md` said `T??` was written only in `TECHNICAL.md` and that no package had needed
one. `query.wac` needs one, for a reason that was in the standard the whole time.

A query has three states per name:

    ?a=1        there, with a value
    ?a=         there, with an empty value
    ?a          there, with no value at all
    (absent)    not there

`a=` and `a` are different and the standard keeps them apart. So a parameter's value is `u8[]?`, and
looking one up answers **`u8[]??`** — outer absence is *no such parameter*, inner is *no value*.
Under a flattening `?` those arrive as one null and no API on top can separate them.

**The cost of not having it is measurable in this repository today.**
`packages/server`'s `queryToJson` emits `"a": ""` for both spellings, so a round trip through it
loses the distinction the URL parser was careful to keep. And that function lives in `packages/server`
— three packages away from the thing it is about — because the type it wanted to answer could not
be written. The rewrite moves it to `url` where it belongs.

This is worth recording precisely because the decision was made without it. `T??` was argued for on
the grounds that a generic `T? pop()` is only honest at a nullable `T`, and I wrote at the time that
nothing needed the nesting directly. Four packages later something does, and it is a format everyone
uses.

## What else changed

**`i32 port` with `-1` meaning none became `i32? port`.** The header already explained that
`query`/`fragment` are null for none and that none differs from empty; `port` said the same thing in
a different language, using a value outside the range of ports because there was nothing else to
write. A caller sorting on `a.port < b.port` puts *no port* before every real one.

**`effectivePort` becomes writable.** The port used is the one written, or the scheme's default, or
none — two absences of different meaning. Both were `-1` before, so the answer was `-1` and a caller
could not tell *this URL has no port* from *this scheme has no default*, which is the difference
between `mailto:` and a bug. The original does not have this method, and this is why.

**`Url? parseUrl` became `Result<Url, UrlFault>`.** One null for eight distinct failures, in a parser
transcribed from a standard that names every one of them. The test suite has to assert *not a URL*
where the standard says *the host is not a valid IPv6 address*.

## What could not be written

**Nothing new.** Every gap this package hit — elided bodies, a match arm without `case` — is
already filed from the earlier four. Two others it hit, `static` and module constants, turned out
not to be gaps at all. That is worth saying: the fifth package
produced one large positive finding and no new holes, which is the first sign of the language
settling rather than of the exercise running out.

**One near-miss.** `effectivePort` wants `this.port ?? defaultPort(this.scheme)` and wac has no `??`.
Written out with `is not null` it is one line and perfectly clear, so this is a note rather than a
question — and `vision/QUESTIONS.md` already asks whether optional chaining exists, which is the same
family and the same answer either way.
