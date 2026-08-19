# 0168a — `@/` fails unless the entry is absolute or you run from the project root

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** a compile error on a correct program

## Reproduction

A project with a manifest at its root:

    proj/wac.json5           {}
    proj/src/util/math.wac   export i32 twice(i32 x) { return x * 2; }
    proj/src/main.wac        import { twice } from "@/src/util/math.wac";
                             … return twice(21);

Four ways to run the same program, from a shell:

| where | entry | result |
|---|---|---|
| `proj/` | `src/main.wac` | **42** |
| `proj/src/util/` | `/abs/path/proj/src/main.wac` | **42** |
| `proj/src/` | `main.wac` | `@/src/util/math.wac needs a project: no wac.json5 above main.wac` |
| `proj/src/` | `./main.wac` | the same |
| `proj/src/util/` | `../main.wac` | the same |

`proj/wac.json5` exists in every one of them.

## Why — and it is not that the upward search is missing

**The upward walk exists and works.** `candidateRoots` in `packages/wacpkg/src/root.wac` is a proper
loop from the file's directory to the boundary, with a fixed-point exit and a `..` guard. It climbs
as many levels as it is given: a file at `a/b/c/main.wac` with the manifest at the root resolves
`@/lib.wac` correctly, walking `a/b/c` → `a/b` → `a` → `.`.

**The walk is lexical.** It walks the components of the path string it was handed, and the working
directory is never consulted. `projectRootOf` sets `boundary` to `/` for an absolute path and `.` for
a relative one, so a relative path can climb only as far as the path *as typed* spells out.

That is the whole of it: `wac run src/main.wac` from `proj/` and `wac run main.wac` from `proj/src/`
name the same file, and the first spells one parent component while the second spells none. So the
first climbs to `.` and finds the manifest; the second is already at its boundary before it starts.

Two spellings fail for two different reasons, which is worth knowing before changing anything:

- `main.wac`, `./main.wac` — `dirOf` is `.`, which is also the boundary, so the chain is exactly
  `["."]` and only the working directory is examined.
- `../main.wac` — `candidateRoots` returns **empty** by an explicit check. The comment there says
  why: `..` and an ordinary directory name look identical to a lexical walk, so a file that climbed
  out of the project would otherwise be reported as inside it. That guard is correct for what it can
  see; it is only wrong because the path never became absolute.

From `proj/` the relative spelling happens to work because `.` *is* the project root. That is why
nothing caught it: every test in the suite runs from a directory where the walk lands on the answer
in one step.

## Why it matters

It is the first thing an outside user does. `cd src && wac run main.wac` is an ordinary way to run a
program, and the error names the manifest they are looking straight at.

## The decision, which is why this is filed rather than fixed

The obvious fix — resolve the entry to an absolute path before searching — changes what the found
root *is*, and therefore what a `@/` specifier joins to. A `@/` import would resolve to an absolute
path while the entry's own relative imports stay relative, and **one file would have two keys**. That
is `issues/lang/0163` exactly: the reference reads it twice and runs, wacc's checker stays clean and
the engine rejects the module. So this cannot be fixed by making one call absolute.

Three ways out, and the third is the recommendation:

1. **Absolutise everything.** Make the entry absolute at the top of `gather` and let every path in
   the program map be absolute. One key per file, and D8 holds — but every diagnostic, every program
   map and every `wac.manifest` then carries machine-specific paths, and the corpus differentials
   compare them.
2. **Search absolutely, answer relatively.** Walk upward from the absolute directory, then express
   the root back as a path relative to the working directory. Keys stay as they are and nothing else
   moves. The cost is that `candidateRoots` stops being the whole of the rule: the caller now does
   part of it, and the part it does is the part that needs a filesystem.
3. **Give `candidateRoots` the working directory.** It stays pure — the cwd is data, passed in — and
   it can then yield the real chain for a relative path, and tell `..` from a directory name instead
   of refusing. The boundary argument already exists to say where to stop, so this is one more input
   of the same kind, and D7's order and stopping rule stay in the one tested place. This looks right.

Whichever is taken, the case to add is a fixture run from a subdirectory: everything here passes
today because the suite runs at a root.

## Workaround

Run from the project root, or pass the entry as an absolute path.
