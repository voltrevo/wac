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

## Corrected twice on 2026-08-31 — two gaps, and the boundary is coretext

**The first correction was wrong too. Both are recorded, because each wrong guess narrowed it.**

### It is two gaps, not one

**The emitter half is real and the fix is four lines.** `emit.wac`'s pre-pass types only `LIdent` as an
assignment target; a field target falls to `else` with no type, and
`env.lambdaSigs[n] = isFuncrefType(want) ? want : ""` records the empty string, which *is* the decline.
Adding an `LField` case — resolve the base with `env.walkTypeOf`, then `env.fieldType(owner, field)` —
makes it compile **on both build paths**, and the program runs and answers correctly. Verified with an
ordinary struct, both `fn[i32(i32)]` and `fn[Pending<i32>(i32)]` fields, inside an imported module,
through `packages/platform/build.ts`.

**The checker half is separate and only bites on structs from `std/platform.wac`.** With the emitter
fixed, `Core.log = (string s) => { };` — three lines, an entry file, no imports beyond `std` — is still
refused:

    app.wac:5:11 [check] nothing here wants a function, so this lambda has no type

The same shape on a struct declared in an ordinary `.wac` file is accepted. So the boundary is not the
position and not the generic: it is that `Cli` and `Core` are carried *inside* the compiler as
`packages/wacc/src/coretext.wac`, and the checker's field lookup does not answer for them.
`typeOfLvalue` (`check.wac:3227`) handles `LField` correctly on its face and the `Assign` case
(`check.wac:8675`) sets `c.expected` from it, so the thing to look at is what `c.fieldType` knows about
a coretext struct.

### What I claimed in the first correction and got wrong

I wrote that the same assignment "in an *entry* file compiles under both" and that only an imported
module was refused. **That was an artefact of testing the two shapes on two different paths.** Asked
properly — coretext struct, entry file, strict path — it is refused there too. There is no entry/import
distinction; there is a `wac build`/app-builder distinction, which is the next item.

### The disagreement, which stands and is the wider finding

**`wac build` does not surface these check errors at all.** It compiled every one of these cases
"successfully", including ones the checker had rejected. The app builder, through
`harness/waccBuild.ts` and a ladder-built wacc, reports them and refuses. Not a stale cache: clearing
`.cache/waccapi` and rebuilding from the ladder reproduces it exactly.

That is the mirror of `issues/system/0298c` — there the ladder does not ask for diagnostics; here one
path asks the checker and the other does not. Either the check error is real, in which case `wac build`
is emitting artefacts from programs it should refuse, or it is not, in which case the app builder
refuses correct programs. Both are worth more than this issue's original subject.

### Nothing was left in the tree

The emitter fix is correct and was reverted anyway: the code that wanted it — `childCliGranted` on
`Cli` — cannot use it while the coretext half stands, so it would be a compiler change with no caller
and no test the gate runs. The typed-local workaround is three lines and works on both paths.

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
