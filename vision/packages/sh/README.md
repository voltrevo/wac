# sh — one path, not a rewrite

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/sh`: 7,506 lines. Only `exec.wac`'s spawn path is here. A shell's
lexer, parser and arithmetic are a shell's, and rewriting them would say what `json` and `http`
already said.

---

## Why this path

It is the only place in the tree where authority is **handed on** rather than held. Ten packages
have taken a capability and used it; none has given a narrower one to somebody else, which is the half of
*no ambient capabilities* that has not been exercised.

## What the platform already does, which is right

`std/platform.wac` takes grants as bit flags and states the property:

> The host intersects them with its own grants, so these are a request rather than an instruction
> and a parent can never widen what it was given.

That is capability attenuation, enforced, today. Nothing here improves on it — and it is worth
saying plainly, because *authority narrows* is a `SHOWCASE.md` entry and it reads as a proposal.

## The finding: a capability cannot cross a spawn

Within one instance, authority being a value does real work — a function handed fewer capabilities
cannot reach past it, and that is the type rather than a host check.

**Across a spawn it cannot be a value at all.** `std/platform.wac` again: *"A spawned child is a
separate instance with its own memory."* A reference does not cross an instance boundary, so a capability
cannot be handed to a child. What crosses is a *description* of one.

So the bitfield is not a compromise anybody made. It is the **serialised form of a capability**, and
a model in which authority is a value needs a second thing that is the wire format of that value —
with its own rules about what may appear in it, what a host does with it, and how the two stay in
step when one gains a member.

`SHOWCASE.md` already writes the second thing:

```wac
auto child = try await sys.spawn(wasm, [], [Grant.Read]);
```

`sys` on that line is a capability. `[Grant.Read]` is a description of one. They sit two words apart
and nothing says they are different kinds of thing, which is the gap — a reader takes the second for
a lighter spelling of the first, and it is the only one that can be sent.

This is the same boundary `design/lang/0015` is about from the other side: that note asks what a
*type* may cross into a module loaded at runtime, and this asks what an *authority* may. Both answers
are "not a reference", and neither is written down where a program author would meet it.

## What changed in the small

**Grants are an enum, not bit flags.** A caller writes what it means, a `match` over it is checked,
and adding a member does not need a `GRANT_ALL` kept in step by hand — which `std/platform.wac`
names as the cost of the fourth spelling: *"a hand-written `GRANT_READ | GRANT_WRITE | GRANT_NET |
GRANT_ENV` is a fourth thing to keep in step every time a bit is added."*

What the bits buy and an enum list does not is more than the intersection, and reading the host
says how much.

`native/src/main.rs` decodes the grants argument as **`Val::I32`** — `match arg(2) { Val::I32(n) =>
n, _ => 0 }` — one word across the boundary. A `Vec<Grant>` is a WasmGC reference and cannot cross
that way. The host *can* read a GC array, `read_bytes_array` does it for argv two lines up, so the
enum could be lowered to bytes — at the cost of an allocation and a decode where an integer is a
register.

So **the enum is a source spelling and the wire format stays an integer**, which is the same
distinction this file draws about capabilities themselves one section up, now applying to the
*description* of one. The proposal does not remove the bitmask; it puts a conversion in front of it.

That leaves the case where the `Slice` one ended up: on legibility rather than representation. A
caller writes what it means, a `match` is checked, and nobody hand-maintains a `GRANT_ALL` — which
`std/platform.wac` names as a real cost. Worth having, and not for the reason it first looked like.

## A fault that cannot render itself

[`src/arith.wac`](src/arith.wac) was added later, from the 264 shipped sources nobody predicted
anything about. `$((…))` is a small evaluator with the shell's own rules switched off inside it, and
what changes is the error channel — but **not for the reason [`@/packages/rlp`](../rlp/) gave.**

The shipped `Arith` is a cursor with a sticky error, the shape rlp removed. rlp's argument was that
`try` turns a dropped check into a type error rather than a discipline. That holds here. What this
file adds is a constraint rlp had not, and the shipped code states it:

> this is recorded at the failure rather than derived from `at` afterwards — by then the divisor has
> been consumed.

Bash reports a division by zero at the position the **divisor** started, and by the time the division
is attempted the parser is past it. **A sticky field plus a code has to be written in the right
order; a payload cannot be written in the wrong one**, because there is nowhere to put it later.
`Err(DivisionByZero(At(divisorStart)))` is built where the information exists or not at all — which
is the argument for errors being *values* rather than *codes*, made by a case where the information
is a position about to be lost.

### And then the fault needs the input back

Bash's error token is *"the rest of the input from where the offending thing began"*, so rendering
one needs the expression. `ArithFault` carries an offset, so a caller that kept the fault and dropped
the input has a fault it cannot print — and every caller keeps the fault, because that is what a
`Result` is for.

Three shapes, all three now in this directory: carry the offset (here, and `rlp`), carry the text
(self-sufficient, copies input into a value that outlives it), carry a rendered message
([`@/packages/wac`](../wac/)'s *nine reasons, one empty string*, which is self-sufficient and has
given up on being matched). `../../QUESTIONS.md` has the question that decides them: **is a fault a
value that describes what happened, or one that can be shown to a person?**

## What could not be written

**Nothing about how a grant list crosses.** Whether the enum is serialised by the compiler, by
`bindgen`, or by hand; whether a host that does not know a member refuses or drops it; and what
happens when parent and child were built against different versions of the enum. The bitfield
answers all three by being a number. An enum answers none of them yet, and *dropping an unknown
member* is the answer that silently widens nothing and silently narrows something — which is the
failure mode worth naming before anybody picks it.
