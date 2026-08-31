# Decisions

Small decisions that are settled but not yet true. One rule each, with just enough reason to revisit
it — a decision without its reason is a rule nobody can revisit, which is how a design becomes scar
tissue.

**Not open questions.** Those are `issues/`, and a decision that is still being argued belongs there
rather than here.

**Not directions.** Those are `design/`, one numbered document each, for something too big to be an
issue.

**Not what the language does.** That is `spec/`, and an entry here is **deleted** the day the spec
states it — not marked done. One rule written in two places is one that drifts.

See [README.md](README.md) for what this directory is and why nothing checks it.

---

## `_` is a binding that cannot be read

`_` may be written wherever a name is bound — a pattern, a local, a parameter — and may repeat,
because it names nothing. **Reading it is an error.**

Today it is two different things depending on where it appears. Inside a pattern the spec carves it
out: *"`_` may repeat within a pattern; any other duplicate binding name is an error."* Everywhere
else it is an ordinary name you can declare and read back — `i32 _ = 5; return _;` compiles. One
rule replaces both.

It also gives `i32 _ = f();` a meaning it does not have now: call it, discard the answer, and say so
where a reader can see it.

The part that makes it *explicitly ignored* rather than merely conventional is that reading it
fails. Without that, `_` is a name like any other, and anything that relies on it not being one —
a match arm's catch-all, for instance — is relying on nobody having written it.
