# 0303 — a lambda assigned to a struct field is not typed by the walk

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-31
- **Kind:** bug
- **Symptom:** the emitter declines the whole module, and the message names a count rather than a line

## Reproduction

`Cli` is a struct of function fields, and replacing one of them is the natural way to hand a child a
narrower capability than its parent has. Written directly, it does not compile:

```wac
Cli c = childCli(f, cli);
c.readFile = (string p) => ready(FileResult(false, u8[0](), "Not granted to this application",
                                            FAULT_NOT_GRANTED()));
```

    wacc: cannot emit probe_test.wac — the exported function `test_a_cli_field_can_be_replaced` is
    not in the module the emitter produced — a lambda (this module has 90, 1 in a position the walk
    does not type yet, 0 sharing a position key)

**Bound to a typed local first, the same lambda compiles and runs:**

```wac
fn[Pending<FileResult>(string)] refuse =
  (string p) => ready(FileResult(false, u8[0](), "Not granted to this application",
                                 FAULT_NOT_GRANTED()));
c.readFile = refuse;
```

So it is the *position* that is untyped, not the lambda. A `let` binding with an explicit function
type reaches the walk; an assignment to a field of a struct does not.

## Corrected 2026-08-31 — it is two gaps, and the two build paths disagree about it

**I fixed the wrong half first, and the attempt is what found the real shape.** Recorded because the
next person will otherwise repeat it.

The emitter's pre-pass at `emit.wac:9587` types only `LIdent` as an assignment target — a field target
falls to `else` with no type, and `env.lambdaSigs[n] = isFuncrefType(want) ? want : ""` records the
empty string, which *is* the decline. Adding an `LField` case there (resolve the base with
`env.walkTypeOf`, then `env.fieldType(owner, field)`) makes `wac build` compile the reproduction and
run it. Verified: a lambda straight into a `Cli` field, no typed local, compiles and answers.

**And that is not enough, because `wac build` was never the strict path.** With the emitter fixed, the
same source compiled by `packages/platform/build.ts` — which goes through `harness/waccBuild.ts` and a
ladder-built wacc — is refused by the *checker*:

    packages/platform/src/frame.wac:292:18 [check] nothing here wants a function, so this lambda has no type

Six of them, one per field assignment. Not a stale cache: clearing `.cache/waccapi` and rebuilding the
asset from the ladder reproduces it exactly.

**So the two paths disagree, and that is the larger finding.** The same file is accepted by `wac build`
and refused by the app builder, and the disagreement is about a *check* error rather than an emit one.
`issues/system/0298c` is the neighbouring shape — the ladder not asking for diagnostics — and this is
the mirror of it: one path asks the checker and the other does not.

**What is odd and unexplained**, and is the thread to pull: the same assignment in an *entry* file
compiles under both. `Holder h; h.f = (i32 x) => x + 2;` is fine, and so is `Cli c = childCli(f, cli);
c.readFile = …` written directly in a program. Only the same shape *inside an imported module* is
refused. So it may not be the position at all — it may be how an import's locals are typed on that
path. `typeOfLvalue` in `check.wac:3227` handles `LField` correctly on its face, and
`check.wac:8675` sets `c.expected` from it before checking the right-hand side, so on a plain reading
the checker should already have the type.

Both changes were reverted rather than left in: the emitter half alone is a fix with no caller, since
the code that wanted it (`childCliGranted`) has to keep its typed locals to satisfy the other path.
The typed-local workaround is three lines and works everywhere, so nothing is blocked — what is worth
someone's time is the disagreement, not the workaround.

## Why it matters

The workaround is one extra line and works, so nothing is blocked. What it costs is the shape of the
code at the site that wants it most: `issues/system/0302c` wants a helper that hands a frame's child
fewer grants than its parent, and the natural spelling is a run of field assignments. Every one of
them needs a named local whose type restates the field's, which is the declaration the field already
carries.

**The diagnostic is the other half of this.** It names a count — *90 lambdas, 1 in a position the walk
does not type yet* — and no line, no column and no file position for the one that failed. Everything
needed to point at it is in the emitter's hand at that moment: it knows which lambda, since it counted
it. Finding this took bisecting a 15-line file by deletion.

## Where to look

`packages/wacc/src/check.wac`'s typing walk over assignment targets. The `let`-with-explicit-type path
already types a lambda against a declared function type; the field-assignment path needs the field's
declared type used the same way. `spec/spec/lambdas.md` does not distinguish the two positions, so the
spec is on the side of this working.
