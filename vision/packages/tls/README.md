# tls — the key schedule, as the `secret` consumer the proposal never had

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/tls`: 4,423 lines. One file is written out —
[`src/keyschedule.wac`](src/keyschedule.wac), 140 lines in the original — because it is eleven
functions that hand a secret to each other, and that is the thing nothing had tried.

---

## Why this one

`vision/packages/crypto/src/secret.wac` proposes a qualifier that propagates like `const`. It has two
uses and **both are inside the file that proposes it** — `chachaBlock` and `aesEncrypt`. So the whole
case for it, that a taint *propagates*, has never been tested by anything receiving a propagated
taint.

The TLS 1.3 key schedule is that consumer. Its own diagram is a chain of ten arrows and every arrow
is *secret in, secret out*:

    PSK ------> HKDF-Extract  = Early Secret
                Derive-Secret("derived", "")
    (EC)DHE --> HKDF-Extract  = Handshake Secret  --> "c hs traffic", "s hs traffic"
                Derive-Secret("derived", "")
    0 --------> HKDF-Extract  = Master Secret     --> "c ap traffic", "s ap traffic", "res master"

## The proposal does not survive it, and the parser said so first

Every signature in the rewrite was written `export secret u8[] deriveSecret(…)` and
`tools/specparse.ts` refused the file:

    keyschedule.wac:49: no rule reaches '['

`GRAMMAR.ebnf` has `param = [ "const" ] , [ "secret" ] , type , IDENT`. A return type is not a
parameter. The grammar was derived from the proposal, so **the refusal is the proposal's own answer**
— and it is the first time the parser has settled a design question rather than a spelling.

Three findings follow, and the first is close to fatal.

**1. A parameter qualifier cannot say what a function returns.** `secret` is modelled on `const`, and
`const` is a flag on a name in the checker's scope table — which is exactly why `QUESTIONS.md`
records that constness is not part of the type and why `issues/lang/open/0315a`'s five leaks are one
fact. Inheriting the machinery inherits the shape, and the shape has no return position. So
`deriveSecret` takes a `secret` and hands back an ordinary `u8[]`: the taint survives one call and
the chain is ten.

The obvious patch is not obviously available. `secret` in return position makes it a property of the
*value*, and a property of a value is a property of the type — and the entire argument for `secret`
was that it costs nothing because the machinery for it already exists. It costs nothing *because* it
is a name flag, and being a name flag is what stops it working here.

**2. Half an array is secret and the other half is public.** `trafficKeyIv` returns key ++ iv in one
`u8[]`, and the shipped file says why: *"wac has no tuples and a struct here would be a type crossing
the bindgen boundary for no benefit."* A key is secret; an IV is not — it is XORed with a visible
sequence number and goes in a record header. One array cannot be half-tainted, so the concatenation
forces a choice between an IV that can never be sent and a key that is loose.

Splitting them is the fix, and the interesting part is the reason: the shipped code's reason for
concatenating was *tuples*, and the reason it would need now is *taint*. **A qualifier that cannot
describe part of a value pushes back on the data layout**, which is a cost the proposal never
mentions because its two examples take a key and write bytes.

**3. There is no way to declassify, and TLS declassifies on purpose.** `finishedVerify` takes a
secret and produces sixteen bytes that go **on the wire** — that is what a Finished message is.
`secret.wac` says *"a laundered `secret` is a key in a log line"* and treats laundering as the
failure. Here it is the feature.

With no declassification form there are two outcomes and both are bad: `finishedVerify` is written
without the qualifier, so the taint never enters the function that most needs it; or it is written
with one and the most security-critical line in the handshake needs an escape hatch. **A taint system
without a declassification form is one nobody can finish using**, and the reason the proposal does
not have one is that `chachaBlock` and `aesEncrypt` are the two functions in cryptography that
genuinely never declassify.

## What survives

`expandLabel` — a secret in, a public label, a length, a secret out. The proposal describes it
exactly, and it is the same shape as the two examples it was written from. Eleven functions later it
is right about one of them, which is a fair summary: `secret` is a good description of a *leaf*
cryptographic primitive and not yet a description of a key schedule.

None of this says drop it. It says the proposal is one third of a design — it has the taint and it
has neither the propagation nor the release — and the two missing thirds are where every taint system
that has ever existed spent its complexity.

## What could not be written

**A return-position `secret`,** which is finding 1 and is in
[`../../QUESTIONS.md`](../../QUESTIONS.md) rather than here, because it is a language question and
not a `tls` one.

**A partially-tainted value.** `TrafficKeys` above has `u8[] key` and `u8[] iv` and *neither* is
marked, because `secret` is not a field qualifier either — the grammar has it only on a parameter.
So the struct that exists to separate the two cannot say which of them is which, and the split buys
type-checking only if the qualifier reaches fields. Not attempted; it is the same question as 1 with
a different position.

**The rest of the package.** The record layer, the handshake state machine and the certificate
verification are 4,283 of the 4,423 lines and none of them would have said anything about `secret`
that the key schedule does not. Choosing the one file that stresses the proposal, rather than the
package that contains it, is the same choice `tor` made and for the same reason.
