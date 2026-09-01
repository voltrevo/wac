# Vision

What wac is for, what it should read like, and the small decisions already taken.

---

## What wac is for

Systems programming where **authority is a value**: a program does exactly what it was handed and
nothing more, and that is a fact about its type rather than a sandbox around it.

The same module runs in a browser, on Node, on Deno, on wasmtime and natively, without being
rebuilt — so where a program runs stops being something the program knows.

Enough language to write the stack in rather than a program on top of one: the compiler that
compiles it, the shell that runs it, the cryptography that carries it.

---

---

## What is in here

**`EXAMPLES.md`** — the examples. Each is a program somebody would want to write, marked **done** or
**not yet**.

**`DECISIONS.md`** — small decisions already taken. One rule each, with enough of the reason that it
can be revisited; a rule without its reason is one nobody can argue with.

The two have opposite lifecycles, and the difference is not an oversight. **An examples entry is kept
and marked `done` when it lands** — it is a picture of how the language reads, and that stays true
afterwards. **A decisions entry is deleted once it is true** — it is a rule, and a rule written twice
is a rule that drifts.

## Nothing here is checked by anything

No test reads these pages. Nothing here is a fixture, a list some guard walks, or a promise a suite
holds anybody to — an entry can be rewritten, reordered or deleted without running anything, and a
guard that made an edit here fail a build would be the wrong guard.

These pages describe a language rather than a tree. They say nothing about how far along it is,
except to mark an entry **done**.
