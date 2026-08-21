# 0175a — `diagnoseGraphIn` accepts a `Res` and never reads it

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** no error — it answers exactly what the root-less variant answers

## Measured

`packages/wacc/src/api.wac`:

```wac
export string diagnoseGraphIn(string[] paths, string[] sources, Res res, string entry) {
```

Its body is 39 lines and mentions `res` **zero** times, comments stripped. So it is `diagnoseGraph`
with a parameter, and a caller that resolves a project root and hands it over gets the same answer it
would get from passing nothing.

Counted across the family: of the **8** `Res`-taking entry points in `api.wac`, six use it and two did
not — this one and `emitFilesCoveredIn`, whose body was character-for-character its root-less sibling's.
The second is fixed (`emitLinkedCoveredIn`); this one is not, because it is not a one-line pass-down.

## Why it is not one line

`diagnoseGraphIn` builds each file's closure with `closureOf(paths, sources, paths[i], seen)` and then
calls `diagnoseFilesWith(...)`, and **neither takes a `Res`**. So honouring the parameter means:

- resolving import specifiers in the closure walk through the same route the linker uses
  (`resolveFromIn`/`resolveVia`) rather than by text, or a mapped specifier is not even in the closure;
- threading a `Res` into `diagnoseFilesWith` and then into `checkFilesWith`, which is the change
  `issues/lang/0157` is still open for and gives the cost of.

So the two issues meet here: 0157's files-based half wants the checker to *report* an unresolved
import, and it cannot resolve one properly until this parameter means something.

## What to do about it meanwhile

**Either implement it or delete it.** A `Res`-taking variant that ignores its `Res` is worse than no
variant: `design/lang/0009` D7 is what these `In` entry points exist for, so a caller reads the name and
reasonably concludes the resolution context is being honoured. `emitFilesCoveredIn` had a doc comment
saying exactly that while dropping it.

Deleting it is cheap and honest if nobody calls it — `diagnoseGraph` is right there. Nothing in this
repository calls `diagnoseGraphIn` today, which is the only reason this has cost nothing yet.

## How it was found

Chasing GitHub issue 21's `@/` failure, which turned out to have a different cause
(`issues/system/0228a` item 5). Looking for "which entry point drops the root" was the wrong question
for that bug and the right one for this file: two of eight, one of them documented as doing the
opposite.
