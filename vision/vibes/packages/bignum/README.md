# bignum — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/bignum`: 627 lines over two files, arbitrary-precision integers with
`BigInt` as an exact oracle. Chosen because it is the first package here whose subject is
*arithmetic* rather than bytes or a protocol.

---

## The claim, checked

Every other package in this directory got its public surface from a design decision. This one got
its from a sentence about the language, in the README and again in the file header:

> **Free functions, not methods.** `add(a, b)`, not `a.add(b)`. This is forced, not preferred: wac's
> deep-const rule makes the method form impossible to write. A `const this` method cannot use a
> value returned by another `const this` method — even one that was freshly allocated — because the
> result of a call through a const receiver is itself const.

Eight such claims have been checked in this exercise and seven were wrong. This is the ninth, and it
is the first that is **stale rather than mistaken**: it was true when it was written, and stopped
being true on 2026-08-11.

`issues/lang/0060` — *a value returned from a `const this` method stays const* — is that exact rule.
Filed 2026-08-02, closed nine days later, and the resolution replaced the blanket taint:

> The taint was at the call: `exprIsConst` said a call through a const receiver yields a const
> result, full stop, and its own comment admitted the approximation — *"a const accessor returning a
> fresh object is also treated as const"*. … A call through a const receiver is const unless every
> `return` in the method is fresh.

It ends: *"`packages/crypto/src/sha1.wac` can have its `clone` back, which is where this was
found."* One beneficiary named, and the package that had written the rule into its **public
surface** is not it.

## Why it survived the fix that was made to retire it

Measured through `bootstrap/ts/ask_wacc.ts`, which is the instrument that answers *type errors* —
the first attempt used `harness/ladderRun.ts`, which answers whether a module came out, and
`bootstrap/drivers/spec_cases.wac` says why that is a different question: *"`emit` neither parses
for errors nor type-checks — a program wac would reject still comes out the other side as a module,
which is why asking `emit` whether something was refused answered 'no' sixty-one times."* A direct
field write through `const this` is one type error under `ask_wacc` and zero under `ladderRun`,
which is the known answer that told the two apart.

| spelling of *a const method handing back something the caller may mutate* | type errors |
|---|---|
| a **static** taking `const Big`, returning a value built from a fresh `u32[]` | **0** |
| an instance `const this` method whose `return` is a **construction** | **0** |
| the same construction **named as a local**, then returned | **1** |
| an instance `const this` method returning a local built by a nested call | **1** |

Rows two and three are the same program:

```wac
C mk(const this) { return C(this.n); }        // 0 type errors
C mk(const this) { C r = C(this.n); return r; }  // 1 type error
```

Both answer `6` when run. **Freshness is decided by looking at the return expression**, so naming
the value loses it. `sha1`'s `clone` returns a construction, which is why the fix reached it. Every
constructor in `bignum` allocates an array and fills it before it knows what it holds, so it *must*
name the value — the one shape this package needs is the one the fix did not reach, and the sentence
in its README stayed true for the only spelling anybody tried.

The escape is row one: a **static** has no receiver, so there is nothing to taint. Which is to say
the supported way to write a method that hands back a fresh value is to not make it a method.
Promoted to [../../QUESTIONS.md](../../QUESTIONS.md), and filed as `issues/lang/0331a` with the spec
half — `spec/spec/structs.md` still states the pre-`0060` rule in its prose, *"a reference obtained
through a const reference is itself const, however it was obtained"*, and the word *fresh* does not
appear in that file.

Two things that are **not** findings here, both already filed and both reproduced by the same
probes: deep const is escapable by passing the reference to a function with a non-`const` parameter
(`issues/lang/0052`, `0315a` — `escape(this.inner)` from a `const this` mutates, zero type errors),
and the same hole applies to a `const` *parameter*.

## What changed

**`Big` is a `const struct`.** The original maintains a documented canonical form — *"Every
constructor and operation restores it, and comparison depends on it"* — which is a promise thirteen
functions keep by remembering to call `trim()`. Here `Big.of(mag, upto, neg)` is the only
constructor, so there is one place the invariant is established and no window in which a `Big` is
not canonical. The const costs nothing, because the original's own header says every operation
allocates its result exactly: the mutability is only ever used to fill a value on the way out.

It also lets `negated()` and `abs()` **share the limbs instead of copying them**. The original
copies because two mutable values over one array are one value with two names; nothing here can
write a limb. First place in this exercise where making something immutable removed work rather
than adding a copy.

**A shift count is a `u32`, which deletes two bug fixes.** `shl` and `shr` each take an `i32` and
handle a negative count by calling the other, so each needs a case for `i32::MIN`, whose negation is
itself. Both cases are in the shipped source with their comments, and each records a measured
failure: *"used to bounce between here and `shr` until the stack ran out"*, and *"that allocation
succeeds and the zeroing loop then runs for minutes, so a stack overflow in a second became a
hang — measured, not guessed."* Neither function has a negative case here, so neither has the
pathological one. Second time this exercise has found a class of defect in the gap between a value's
type and its domain, and the first where the shipped code carries the *fixes* rather than the bug.

**Division answers a `Result`.** `divmod` traps on a zero divisor, and a divisor arrives from
`parseDecimal` as readily as from a literal. Worth noting separately: the trap is written `trap;`,
and `spec/spec/grammar.md` has `trap_stmt = "trap" , [ expr ] , ";"` — the message was free and not
taken. That is a line for `packages/bignum` rather than a change here.

**`Big? parseDecimal` became `Result<Big, NumberFault>`,** with `Empty`, `LoneSign` and
`BadDigit(at, byte)`. One `null` for three things the parser can distinguish, in a numeral that a
person retypes — *column 31* is the difference between finding the typo and rereading the line.
Third package in a row where the redesign's first move was to stop collapsing distinguishable
failures.

**One parser instead of two.** `parseDecimal` and `parseHex` are 28 and 38 lines differing in three
things: the radix, the chunk width and a `0x` prefix. The sign handling, the rejections, the chunk
accumulator, the fold and its comment are written twice character for character. The original's
README lists *"Parsing other bases … Base 2 and 8 are the same loop with a different chunk size"*
under **Not here yet**, which is the observation one step short of taking it. Nothing about the
language caused this or fixes it; it is here because a 164-line file with 66 copied lines is worth
saying out loud.

**`divSmall` is out of the barrel.** Its remainder is an unsigned magnitude, which the original
calls *"the one deliberate departure"* and justifies with *"its only callers are the text
conversions"* — a sentence a barrel can make true rather than intended.

## What could not be written

**A number that reads like a number.** `a.mul(b).add(c)` for `a * b + c`, and `q.cmp(r) < 0` for
`q < r`. wac has no operator overloading, [../../GRAMMAR.md](../../GRAMMAR.md) does not propose it,
and no issue asks for it. This is the first package here whose subject is arithmetic, so it is the
first to want it — which is also the argument for *not* proposing it from
here. Recorded as a want with one witness. What makes it more than an ergonomics complaint is
`fmt`'s `FixedBig`, a second bignum in the same repository: two types that both mean *number*, and
neither can be spelled like one.

**Checked arithmetic at 64 bits.** The one real defect this package has ever had is a `u64` wrapping
at exactly 2^64 in the quotient-digit refinement, which cost 2^32 off a quotient and which the
README says four hundred random operand pairs never reached. `spec/spec/types.md` documents two ways
to detect overflow and says of the first — widen, then narrow with `as!` — *"for 64-bit types there
is no wider one"*. So the defect is at the one width where the documented mitigation does not exist.
`issues/lang/0033` asked for a checked operator and was closed **documented, not built**, and its
notes say why it stopped there: *"No reproduction from the original shipped bug — the friction log
records the cost without the case. Whoever picks this up should ask wac-json for it, since a real
example would settle which of the three shapes is wanted."* This is that example. Filed as
`issues/lang/0332a`.

**Nothing about generics.** The original claims *"this is the one non-trivial data structure in the
repo that the absence of generics costs nothing"* and is right: every result size is known before
the work starts, so a `Vec<u32>` would be a length that is always correct and a capacity check that
is never taken. Fourth time the answer was to leave something alone, after `json`'s lazy object
index, `Buf`'s field layout and `regex`'s flat class arrays.
