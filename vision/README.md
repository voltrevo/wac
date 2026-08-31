# Vision

What wac is for, what it should read like, and the small decisions already taken. Nothing on these
pages describes the language as it is today — `spec/` does that.

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

**`DECISIONS.md`** — small decisions that are settled but not yet true. One rule each, with just
enough reason to revisit it. Not open questions, which are `issues/`; not directions, which are
`design/`, one document each; not what the language does, which is `spec/`.

The two have opposite lifecycles, and the difference is not an oversight. **An examples entry is kept
and marked `done` when it lands** — it is a picture of how the language reads, and that stays true
afterwards. **A decisions entry is deleted when `spec/` states it** — it is a rule, and one rule
written in two places is one that drifts.

## Nothing here is checked by anything

No guard walks this directory. `links_test.wac` skips it, `duplicatedline_test.wac` skips it, and
`rootfiles_test.wac` stopped naming it when it moved. That is deliberate rather than an omission: the
paths and names on these pages are mostly ones nobody has written yet, so a guard here would be
checking imaginary code against a real tree, and an edit would fail a build for being early rather
than for being wrong.

It is maintained by hand. Rewrite, reorder or delete anything on these pages without running
anything.
