# Decisions

Small decisions already taken. One rule each, with enough of the reason that it can be revisited — a
rule without its reason is one nobody can argue with.

A decision is here because it is settled and small: too small to be worth arguing at length, and
settled enough that the next person should follow it rather than re-open it.

An entry is **deleted once it is true**, rather than marked done. A rule written twice is a rule that
drifts, and the language itself is the better copy.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## `_` is a binding that cannot be read

`_` may be written wherever a name is bound — a pattern, a local, a parameter — and may repeat,
because it names nothing. **Reading it is an error.**

Discarding a value is a decision, and a reader should be able to see it: `i32 _ = f();` says call
this and throw the answer away, in the place where the answer would otherwise have gone.

The half that matters is that reading fails. A name that cannot be read cannot be mistaken for one
that can, so `_` is unambiguous anywhere a bare name would not be — a match arm meaning "any variant
I have not listed" is spelled `_` and needs no keyword of its own.
