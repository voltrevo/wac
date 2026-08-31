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
