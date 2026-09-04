# Decisions

Small decisions already taken. One rule each, with enough of the reason that it can be revisited — a
rule without its reason is one nobody can argue with.

A decision is here because it is settled and small: too small to be worth arguing at length, and
settled enough that the next person should follow it rather than re-open it.

An entry is **deleted once it reaches `spec/`**, rather than marked done. A rule written twice is a
rule that drifts, and the spec is the better copy — an implementation can have a bug, so landing the
code is not the test.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## `_` is a binding that cannot be read

`_` may be written wherever a name is bound — a pattern, a local, a parameter — and may repeat,
because it names nothing. **Reading it is an error.**

Discarding a value is a decision, and a reader should be able to see it: `i32 _ = f();` says call
this and throw the answer away, in the place where the answer would otherwise have gone.

The half that matters is that reading fails. A name that cannot be read cannot be mistaken for one
that can, so `_` stays unambiguous in the places a bare name would not be — a payload position, where
a word could otherwise be a variant to match or a name to bind.

**Checked 2026-09-04: this is one landed clause and three that nothing has ever written.** The entry
reads as one settled rule and is four claims with four different statuses:

    a pattern      `spec/spec/enums.md`: "name a binding `_` to ignore one", "`_` may repeat
                   within a pattern" — landed, and 68 uses across 16 shipped files
    a parameter    not in the spec, and **zero** uses in the tree or in `vision/`
    a local        not in the spec, and zero uses — `i32 _ = f();`, the example this entry
                   leads with, had never been written anywhere
    reading fails  not in the spec at all, and it is the half this entry says matters

**The local form got its first ten users the same week, and the case is exactly the one above.**
`Out.write` now answers `Result<void, WriteStopped>` — a closed pipe is not a failure and a full disk
is, so the distinction had to be in the return — and ten call sites in `@/packages/box` and
`@/packages/sh` do not act on it, because a filter writing to a closed pipe is `yes | head -1` and
should exit 0. They are written `_ = out.write(chunk);`.

That is *"call this and throw the answer away, in the place where the answer would otherwise have
gone"* — this entry's own sentence, arriving from a capability that had to grow a `Result` for an
unrelated reason. A discarded `bool` needed no mark; a discarded `Result` does, and the construct was
waiting.

So the lifecycle rule at the top of this file — *deleted once it reaches `spec/`* — has no way to
fire on an entry like this, because a quarter of it landed. That is worth more than the audit: **the
unit of the lifecycle is an entry and the unit of landing is a clause**, and an entry that bundles
four clauses can never be deleted and never be current.

(A first pass counted 14 parameter uses. The pattern matched `case Number(value, _)` — a comma, then
a binding read as a type, then `_` — so every one of the fourteen was a match arm. Counted again by
position, from a declaration's parameter list rather than by shape.)

## `default` is the arm that names no shape

A match arm is a shape and a consequence. `default` is the arm for the shapes not named above.

Not `_`. `_` means *a value I am not naming*, and an arm does not name a value — it names a shape, and
in a payload the two sit one bracket apart:

```wac
Err(_):  { … }        // the fault is a value I am not naming
default: { … }        // there is no shape here at all
```

Reusing `_` for both would be a pun on the payload wildcard rather than a generalisation of it, and
the two mean different things in the same arm.

**What it costs, which this entry did not say.** Today's spelling is `else:`, and the count is in
`vision/GRAMMAR.md`'s rename table with the method beside it. It is a mechanical sweep and nothing is
ambiguous in between, since a grammar can accept both spellings while it happens. Worth having beside
the rule: a decision whose cost is unwritten is one nobody can weigh against the next.

**The number was here and is not, for this file's own reason.** It said *572 arms in 101 files*; the
table says 623 in 102, which is what the stated method reproduces, and 572 is not reproducible. Two
numbers for one measurement in two files is exactly the *"a rule written twice is a rule that
drifts"* this file opens with, applied to a count rather than a rule. So the count lives in one place
and this entry points at it.

## References are comparable but not hashable

`is` on two references is `ref.eq` and costs nothing. Identity hashing is not free, and the language
does not give it to every reference.

A moving collector invalidates anything derived from an address, and wasm GC exposes no object header
to stash a lazy hash in — so the only portable implementation is a field assigned at allocation.
Universal would put a word on every object, which is half again the size of a `Point { i32 x, i32 y }`.

A type that wants to be a hash key carries the field itself.

