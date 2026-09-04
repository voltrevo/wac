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

Reject cute code that hides bad edge cases. A convenience that does the right thing in the common
case does the wrong thing silently in the rest: `async` does not adopt a ticket the body returned,
`await` does not take a non-ticket, `T?` does not flatten. Each of those is another language being
helpful, and each one turns a mistake into a program that runs.

---

---

## What is in here

Three tiers of examples, and one page of rules.

**`SHOWCASE.md`** — the examples worth showing first. Each is the best possible spelling of its
behaviour, and each one is a reason to use the language.

**`IDIOMS.md`** — ordinary wac, spelled the way wac spells it. Also the best possible spelling of its
behaviour; none of them is on its own a reason to use the language.

**`TECHNICAL.md`** — one detail of the language per entry, with the outcome shown. Not always the
best way to write the thing: an entry here is written to pin the detail down. Read together these are
meant to be enough to implement the language from.

Add to that one freely. A technical entry is scrutinised for being correct rather than for being
worth showing; the other two tiers are selective and this one is not.

Correct means intended to be correct: that the entry can be implemented sensibly, and that it does
the thing wanted.

**`DECISIONS.md`** — small decisions already taken. One rule each, with enough of the reason that it
can be revisited; a rule without its reason is one nobody can argue with.

**`QUESTIONS.md`** — what is still open. Deliberately loose: no numbering, no fixed shape, nothing
for a guard to walk.

**`GRAMMAR.md`** — where this syntax stops being parseable by the syntax that exists. The odd one
out: it is **generated** rather than agreed. `tools/visiongrammar.sh` runs today's compiler over
every `.wac` under `vision/` and reports where the parser refuses, so it is a diff of two grammars
derived from the code. Delete it and re-run the tool rather than editing it.

**`GRAMMAR.ebnf`** — the same additions as *productions*, patched over `spec/spec/grammar.md`, and
the only thing here that a machine can act on. `tools/specparse.ts` applies it and parses every file
under `vision/` with the result; every one of them does. That is the opposite claim from `GRAMMAR.md`'s,
which is a list of what today's parser refuses: **a list of absences cannot say it is complete, and a
grammar that accepts everything can.** Where the two disagree, this one is checkable and the prose is
the argument for it.

**`bench/`** — the other odd one out, and odd in the opposite direction: it is written in **today's**
language and it runs. A proposal with a runtime cost should have a number rather than an argument,
and where a proposed type compiles to something writable today — `Slice<u8>` to a three-field struct,
`i32?` to a synthesised one-field box that already exists — today's compiler can supply it. Run by
hand; `tools/visiongrammar.sh` skips the directory, since asking where the parser refuses vision
syntax has nothing to say about a file that deliberately does not use any.

An example belongs to one tier at a time and moves between them freely. The line between the first
two is worth showing rather than defining: a server, and an import written from the project root, are
both the best spelling of what they do.

The examples and the decisions have opposite lifecycles, and the difference is not an oversight. **An
example is kept and marked `done` when it lands** — it is a picture of how the language reads, and
that stays true afterwards. **A decisions entry is deleted once it reaches `spec/`** — the
spec is the test, since an implementation can have a bug, and a rule written twice is a rule that
drifts. **A question is deleted once it is answered**, and the answer has to land somewhere first.

## Nothing here is checked by anything

No test reads these pages. Nothing here is a fixture, a list some guard walks, or a promise a suite
holds anybody to — an entry can be rewritten, reordered or deleted without running anything, and a
guard that made an edit here fail a build would be the wrong guard.

These pages describe a language rather than a tree. They say nothing about how far along it is,
except to mark an entry **done**.
