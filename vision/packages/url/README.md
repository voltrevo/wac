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

(An earlier draft of this file said parsing a query *"allocates nothing at all"* with slices. It
does not: a struct is heap-allocated in WasmGC, so each name and value is one `struct.new`. The
trade is an O(1) allocation for an O(n) allocation and a copy — see `core/slice.wac`.)

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

**A length in the array type.** Added with [`src/host.wac`](src/host.wac), whose IPv6 arm is
`i32[] pieces` — *"held in an `i32[]` because wac has no u16 and the values are small"* — two
invariants in a comment and neither in a declaration. Swept: **322 `.len()` comparisons against a
literal across 89 files**, 169 of them against 32, and **five different answers to a violation** —
a trap, a null, an empty array, a false, and a struct with a flag in it. Promoted to
[`../../QUESTIONS.md`](../../QUESTIONS.md).

**The host parser's faults were declared in the file that calls it.** `UrlFault` listed `BadHost`,
`BadIpv4` and `BadIpv6` among eight payload-free arms, so `host.wac` could not return them without a
cycle. They move to `host.wac` as structs carrying evidence, grouped as `HostFault`, and `UrlFault`
becomes `union<NoScheme, BadScheme, BadPort, NoBase, HostFault>` — four members and a nested one.
The dependency always ran one way; only the declarations were on the wrong side. And nesting is what
makes it worth doing: `Err(is HostFault):` is one arm, which a flattened seven-member union could
not offer.

**`Named` merging three parse-time kinds is right, and this is the counterexample.** *"They differ
in how they are parsed and validated, but all three serialize as their own bytes, so keeping them
apart afterwards would be a distinction nothing reads."* Every other entry here argues the other
way. The discipline that makes those arguments good — *name a caller and say what it would do
differently* — is what makes this merge good, and here nobody can name one. Same ruling as
`unicode`'s `bool isPrintable`.

**A doc comment describing a design that was replaced.** `/** One dot-separated part, as a number,
or -1 for a syntax error. */` sits above `struct Part { i64 value; bool ok; bool overflow; }`. There
is no `-1`. Worse than a missing comment: a reader who believes it tests `value == -1` and accepts a
syntax error as negative one.

**`Part` is four representable states for three meanings**, and the unreachable fourth — not ok, but
overflowed — is unmarked. The three-way split has to survive, and the shipped comment is why: a
number too wide for an address is *still a number*, so it selects the IPv4 path which then rejects
it, and failing it here would send `http://0x100000000/` down the domain path and accept it as a
name. `Part(0, false, false)` is written four times, and the `0` is a payload nobody reads.

**A closed set of seven named by bare integers, and a defence against the wrong alternative.** Added
with [`src/percent.wac`](src/percent.wac). The header rejects a funcref-keyed `Map` — which nobody
proposed — on criteria an `enum` meets better than either candidate. `inEncodeSet(c, 99)` compiles
and falls through into the component-set tail, so an unknown set silently answers as the most
aggressive one. Promoted.

**The header says five sets and a chain; there are seven and it is a tree — and the package's own
test says so.** `Query` does not contain `Fragment` (the backtick) and `Path` does not contain
`SpecialQuery` (the apostrophe). `test_fragment_and_query_are_incomparable` in
`packages/url/test/wac/url_test.wac` pins exactly that, over all 256 bytes, with a note that the
first version of the test *"passes for the wrong reason"*. Someone found this, got it right, and
wrote it in the file that executes; the comment it corrects was never touched. The vision file makes
the relation a function so the claim can be wrong out loud.

**Seven constants spelled as function calls, and 658 tree-wide.** `packages/wacc/src/kinds.wac` says
why — *"because wac has no module-level constants"* — and that stopped being true on 2026-07-31.
[`../../bench/constcall.wac`](../../bench/constcall.wac) says the three spellings tie to the
millisecond on v8, so the case is readability and not speed; it also says the compiler has no
function inliner, so **v8 is what erased the call**, and the host with no JavaScript in it was not
asked. Filed as `issues/lang/0354a`.
