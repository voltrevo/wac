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
    // why: one line, in the language of the rule rather than the bug
    // from: issues/lang/0092        (optional — where it came from)
    // spec: §tag                    (optional — the clause this case holds)

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

### There was a marker for a case only one compiler was asked

`// only: wacc` said the reference was not expected to meet a case, because the specification
targets wacc as of
[design/lang/0003](../../design/lang/0003-the-spec-targets-wacc-and-the-reference-becomes-a-seed.md)
— the reference was a subset kept to build the first `wacc.wasm`, so a feature it did not have was
deliberate rather than a gap. Without the marker the first such case turned the reference's suite
red, and the fix somebody reaches for is an exception list nobody maintains.

**It is gone as of 2026-08-28, with the reference.** 37 cases carried it and nothing had read it
since the deletion: the header parser does not recognise the line, so it fell through into the
program body as an ordinary comment. Inert, and documented here as meaningful, which is the worse
half — a reader would have reached for it.

What went with it is the reason it was worth having, and it is worth writing down because nothing
replaces it: **a case two implementations meet is a rule with two witnesses.** The reference
disagreeing was the fastest way this project found a defect, in both directions, and the advice
attached to this marker was to reach for it last for exactly that reason. There is one witness now
for every case here. `bootstrap/`'s ladder is a second implementation of the *compiler*, so the
nearest thing to the old arrangement is a case run through it as well — which is
`packages/wacc/test/wac/bootstrapemit_test.wac`'s subject rather than this directory's.

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
