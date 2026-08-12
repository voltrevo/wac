# cases — the smallest program that shows each thing

A compiler is easiest to fix when the failure is four lines long. Everything here is a
whole program, its expectation written at the top, and nothing else: no reference
compiler to agree with, no package graph to stand up, no corpus to load, no timing.

The point is what a *next* compiler needs. `spec/spec` says what the language is;
these say what an implementation got wrong on the way to it, reduced until nothing can
be removed. Most of them cost a slot or two to find through an expensive oracle — the
342-file corpus, a package's own suite, a differential against the reference — and cost
nothing to run once found.

## The format

A case is one `.wac` file. Its first lines are comments:

    // expect: emits | refused | traps <fn> | answers <fn> = <value>
    // only:   wacc                          (optional — see below)
    // why: one line, in the language of the rule rather than the bug
    // from: issues/lang/0092        (optional — where it came from)

`emits` means it compiles. `refused` means it does not, at any phase — which phase is
not the language's business. `answers f = 42` means it compiles, `f()` runs, and the
result is 42. `traps f` means it compiles and `f()` traps — and only a wasm trap counts,
because a host-side error is the runner being wrong about the program rather than the
program doing what the case says.

`traps` was added for `issues/lang/0085`, where the rule is that a checked cast traps on a
value that does not fit. Half of what `spec/spec/casts.md` promises has that shape, as do the
bounds checks and `!` on a null, and a corpus with only the other three expectations could
state none of it — the nearest a case could get was an answer, which is exactly the wrong
answer the bug produced.

More than one file, for anything about imports:

    // ---- lib.wac ----
    export i32 twice(i32 x) { return x * 2; }
    // ---- main.wac ----
    import { twice } from "./lib.wac";

The entry is `main.wac`, or the only file when there is one.

### A case only one compiler is asked

`// only: wacc` says the reference is not expected to meet this one. Leave the line off and both are
asked, which is the answer to want: a case two implementations meet is a rule with two witnesses.

It exists because the specification targets wacc as of
[design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
— the reference is a subset kept to build the first `wacc.wasm`, so a feature it does not have is
deliberate rather than a gap. Without the marker the first such case turns
`compiler/wacCases.test.ts` red, and the fix somebody reaches for is an exception list nobody
maintains.

**Reach for it last.** A case marked this way has one witness, and one witness is how a wrong
expectation survives: the reference disagreeing has been the fastest way this project finds a defect,
in both directions. Mark a case `wacc` because the feature genuinely is not in the reference, never
because the reference disagrees and it is late.

## The rule

**A failing case comes before the fix, always.**

When a compiler fails anything here, or anywhere else — the corpus, a package's suite, a
differential, a bug someone reports — the order is:

1. **Diagnose** it far enough to say what the rule is, in the language of the rule rather
   than of the bug.
2. **Write the smallest program that shows it**, add it here with its expectation, and
   watch it fail. A case that has never failed is a case you have not checked.
3. **Then** go and fix it.

Not the other way round, and not both at once. A fix written first is a fix aimed at
whatever you happened to be looking at, and the thing that told you it worked is gone the
moment the slot ends. A case written first survives the fix, the refactor after it, and
the compiler after that.

The reduction is the expensive part and the part worth keeping. The 342-file corpus tells
you *that* something is wrong somewhere; it never tells you what the smallest wrong thing
is. `issues/lang/0092` cost two slots to locate and is five lines here.

**The negative cases matter as much as the positive ones.** Four programs that *emit* are
what showed 0092 was about inference from the slot rather than about generics — they ruled
out the wrong explanations, and they were living in an issue's prose where nothing could
run them.
