# 0279a — the emitter links source *text*, so wapy cannot reach it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-27
- **Kind:** decision
- **Symptom:** not implemented

## What

`packages/wacc/src/wapyparse.wac` reads wapy into wac's AST and agrees with wac's own frontend on
**395 of 400** files of the repository rendered through `compiler/wapyPrint.ts`. It is not wired to
`wac build`, and this is why.

`emitLinkedWith2` does not compile a graph of programs. It **concatenates the graph into one string**
and compiles that:

```wac
string blob = linkFiles(paths, sources, res, entry, starts, edges, names, filePaths);
if (blob == "") { return bareModule(); }
return emitModuleOfWith(blob.toBytes(), …);
```

and `frontOfRaw` then lexes and parses the blob. So a file reaches the emitter as **text**, and a
`.wapy` file's text is not wac.

The same shape is everywhere below the API: `emit.wac` calls `lex(src)` in four places, and the
phases re-read the source rather than sharing one parse. The checker is the exception — it takes a
`Lexed?[]`/`Program?[]` cache, added by `issues/lang/0133` for speed — and that cache is the seam a
second surface would use, if the emitter had one too.

**So this is not a wiring job.** A `frontendOf(path, src)` that dispatches on the extension was
written and reverted: it makes `wacc` *parse* wapy in the phases that take a cache, and changes
nothing about the phase that concatenates.

## The two ways out

**A — transpile at the link boundary.** `linkFiles` prints a `.wapy` file's AST as wac with
`print.wac` and puts that in the blob. Small, local, and every phase after it is untouched.

The cost is positions. `starts`/`edges` map blob offsets back to files, so a diagnostic would still
name the right *file*, but its line and column inside a wapy file would be the generated wac's.
Parse-time diagnostics stay correct — those come from the wapy frontend, and syntax is the only place
the surfaces differ — so what degrades is checker and emitter messages, on wapy files only.

**B — link programs rather than text.** `linkFiles` produces the parsed graph, and `emitModuleOf`
takes programs and a per-file token array instead of one blob. Correct positions everywhere and no
second surface special-cased. It is a real change to the emitter's front, and `starts`/`edges` and
everything keyed on blob offsets moves with it.

## Recommendation

**B, and not soon.** A is the shape this repository keeps writing issues about — `0277a` and `0278a`
were both filed today for defects whose whole character was a diagnostic pointing at text the reader
did not write. Adding a third deliberately, in the compiler that is meant to *replace* the one with
that problem, buys a feature nobody is waiting for: **there are zero `.wapy` files in the tree.**

The frontend is worth having landed anyway, because it is what lets the reference stop being wapy's
only implementation — `design/lang/0003`'s standing *"the bootstrap and wapy"* clause. What it does
not yet let us do is delete `wapyPrint.ts`, because the site's playground still routes `.wapy` to the
reference and would need wacc's emitter to accept it.

**So the order is:** decide B, do it when the emitter is being touched for another reason, and until
then keep the reference's wapy for the playground alone.
