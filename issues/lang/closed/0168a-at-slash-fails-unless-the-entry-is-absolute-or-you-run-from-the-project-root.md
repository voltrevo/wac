# 0168a — `@/` fails unless the entry is absolute or you run from the project root

- **Status:** closed — the search is absolute and the answer comes back into the graph's key space
- **Fixed in:** the commit this line arrived in
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

## The rule, stated from the behaviour

Every case below was run. The fixture is `proj/` with `wac.json5` and `lib.wac` at its root,
`src/main.wac` importing `@/lib.wac`, `src/util/deep.wac` importing the same, and a nested project
`sub/` with its own manifest and `inner.wac` importing `@/lib2.wac`.

| cwd | entry | result |
|---|---|---|
| `proj/` | `src/main.wac` | 9 |
| `proj/` | `./src/main.wac` | 9 |
| `proj/` | `<abs>/src/main.wac` | 9 |
| `proj/src/` | `main.wac` | **fails** |
| `proj/src/` | `./main.wac` | **fails** |
| `proj/src/` | `<abs>/src/main.wac` | 9 |
| `proj/src/util/` | `../main.wac` | **fails** |
| `proj/src/util/` | `<abs>/src/main.wac` | 9 |
| `m/` (above the project) | `proj/src/main.wac` | 9 |
| `proj/` | `src/util/deep.wac` | 9 |
| `proj/src/` | `util/deep.wac` | **fails** |
| `proj/src/util/` | `deep.wac` | **fails** |
| `proj/` | `sub/inner.wac` | 4 |
| `proj/sub/` | `inner.wac` | **4** — works, because the manifest is in the cwd |
| `m/` | `proj/sub/inner.wac` | 4 |

**The rule the table describes.** The directories searched are the file's own directory *as spelled*,
climbing to the boundary — and for a relative entry the boundary is the working directory. So `@/`
resolves exactly when a manifest sits somewhere in the path you typed, or in the directory you are
standing in. `proj/sub/inner.wac` from `proj/sub/` works for that reason and not by luck.

**It never picks the wrong project, only no project.** Every directory in the chain is a genuine
ancestor of the file, because the chain is built from the file's path under the cwd. So the failure
is always "not found" and never a silent resolution against someone else's manifest — which is worth
knowing, because it means no program compiles against the wrong `@/` today.

Adding a manifest to `proj/src/` makes the failing case pass and changes what `@/lib.wac` means —
`src/lib.wac`, answering 77, rather than `proj/lib.wac` answering 9. That is D7 working correctly:
the nearest manifest at or above the importing file wins. It is included because it shows the search
itself is sound; what is missing is only the ability to climb past where you happen to be standing.

## Why it matters

It is the first thing an outside user does. `cd src && wac run main.wac` is an ordinary way to run a
program, and the error names the manifest they are looking straight at.

## What the behaviour should be

`spec/spec/imports.md` `§wac-import-project-4hq7mnv` already says it, and says it in the words this
violates:

> `@/` is the root of the **project containing the importing file** — the nearest directory at or
> above it holding a `wac.json5`. **Not the directory the compiler was started in**, and not the
> entry's project.

So:

1. Resolve the **importing file** to an absolute path, then search upward from its own directory.
2. Stop at the provider boundary. D7 lists four — the embedded package root, the Git checkout root,
   the mapped `subdir`, and the local-filesystem boundary. **The working directory is not one of
   them.**
3. The nearest `wac.json5` at or above the file wins.
4. No manifest inside the boundary is a compile error naming the specifier — never a fallback.

The property that makes this checkable, and the one to write the test against: **where you were
standing and how you spelled the entry cannot change what a program means.** Every row of the table
above should give the same answer as the absolute spelling of the same file — 9 for `src/main.wac`
and `src/util/deep.wac`, 4 for `sub/inner.wac` — and today six of them do not.

## Both compilers have it, so the differential cannot see it

`@/` is one rule implemented twice, and `projectspec_test.wac` exists to compare them. It cannot
catch this: the reference fails the same way, in nearly the same words.

    $ cd proj/src && deno run -A harness/referenceRun.ts main.wac main
    error: `@/lib.wac` needs a project: no `wac.json5` above main.wac

Two implementations cannot see a mistake they share. Whatever is done here has to be done to both,
and the case that guards it has to assert an *answer* rather than agreement — the two agreeing is
exactly the state we are in.

## One thing the fix has to decide

With the boundary at the filesystem root, a stray `wac.json5` anywhere above a file — in `$HOME`, in
`/tmp`, in a directory somebody made years ago — becomes that file's project root. D7 says the
local-filesystem boundary and that is the reading, but it is worth taking deliberately rather than
inheriting: it is the failure mode where a program compiles, silently, against a `@/` nobody meant.
The alternatives are a checkout root or an explicit stop, and neither is written down anywhere yet.

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

## Fixed, in both compilers

**Option 3 as recommended, and then the part the options list had not seen.** The search now starts
from an absolute path — `projectRootAbs` in `wacc.wac`, `Deno.cwd()` in `harness/wacFiles.ts` — so it
climbs past where you were standing. Every row of the table now gives the answer the absolute
spelling gives, including `../main.wac`, which the `..` guard used to refuse outright.

**That alone gives one file two keys, and two existing cases caught it.** An absolute root makes the
join absolute while the rest of a relatively-keyed graph is not, so `relativeTo` brings the result
back — the *result*, not the root, which is the whole trick: it makes `@/src/util/math.wac` and
`./util/math.wac` land on the same key from either direction.

**And relativising unconditionally breaks two things**, which is the second half and was found the
same way. A file reached through a mapping lives under its checkout, and a file whose entry was given
absolutely is absolutely keyed; converting either gives it a second key, and for a mapped file it
also walks the answer out of the subdirectory it is confined to. So the conversion applies only when
the importing file is itself relatively keyed. `one_file_reached_two_ways_is_one_module` and the
in-subdir half of `a_mapped_subdir_cannot_import_outside_itself` are what said so, both of which went
red on the first attempt.

The guard is `test_a_project_specifier_does_not_depend_on_the_working_directory`: one file, three
directories, four spellings, **both compilers, asserting the answer 9 rather than agreement** —
because agreement is what the old behaviour had. Canaried by putting both walks back to lexical: six
assertions fail, three per compiler.
