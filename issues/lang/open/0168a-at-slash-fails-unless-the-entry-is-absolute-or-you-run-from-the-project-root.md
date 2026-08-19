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

## Why

`projectRootOf` in `packages/wacc/example/wacc.wac` asks `candidateRoots(path, boundary)` for the
directories to try, with `boundary` being `/` for an absolute path and `.` for a relative one.
`candidateRoots` is a pure function of the *string* — deliberately, so the resolver does no I/O and
can run in a browser — so for `main.wac` it yields exactly `["."]`. There is no component above `.`
in a relative path, so the walk stops at the working directory and never reaches the real parent.

From `proj/` the relative spelling `src/main.wac` happens to work, because `.` *is* the project root.
That is why nothing caught it: every test in the suite runs from a directory where the relative walk
lands on the answer in one step.

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
   it can then yield the real chain for a relative path. The boundary argument already exists to say
   where to stop, so this is one more input of the same kind, and D7's order and stopping rule stay
   in the one tested place. This looks right.

Whichever is taken, the case to add is a fixture run from a subdirectory: everything here passes
today because the suite runs at a root.

## Workaround

Run from the project root, or pass the entry as an absolute path.
