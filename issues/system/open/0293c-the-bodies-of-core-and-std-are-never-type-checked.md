# 0293 — the bodies of `core/*.wac` and `std/platform.wac` are never type-checked

- **Status:** open
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — a file with a plain type error is reported as having no diagnostics

## Reproduction

Put an obvious error in a built-in and ask the compiler about it:

    $ printf '\ni32 boomxx() { i32 b = "nope"; return b; }\n' >> core/hash.wac
    $ wac check core/hash.wac
    core/hash.wac: 1 file(s), no diagnostics

The control is the same bytes under another name:

    $ cp core/hash.wac .cache/hash.wac
    $ wac check .cache/hash.wac
    error: initialiser does not match the declared type
      --> .cache/hash.wac:86:24
       |
     86 | i32 boomxx() { i32 b = "nope"; return b; }
       |                        ^^^^^^ expected i32, found string

Same for `std/platform.wac`, both as the entry and through an importer:

    $ wac check std/platform.wac          # with `i32 boom = "not an i32";` in `isDone`
    std/platform.wac: 2 file(s), no diagnostics

## This is not `0291b`

That is the first thing to rule out, and it is ruled out: **the same silence happens with a freshly
regenerated embedding.**

    $ wac task gen:core --check
    1 generated file(s) do not match `core/`: …          # the staleness guard works
    $ wac task gen:core
    core/: the embedding written
    $ wac check std/platform.wac
    std/platform.wac: 2 file(s), no diagnostics           # the error is now in *both* copies

So the embedded copy carries the error too and is still not checked. `0291b` is about a build step
that has not been run, and its diagnostic — `errStaleBuiltinEmbedding`, 210 — fires on an import
naming an export the embedded copy lacks. A body error changes no export list, so nothing there
applies.

Nor is it a general "only the entry file is checked" rule. An ordinary imported file **is** checked:

    $ cat a.wac
    import { helper } from "./b.wac";
    export i32 main() { return helper(); }
    $ wac check a.wac
    error: initialiser does not match the declared type
      --> b.wac:1:31                                      # the import's body, reported

Built-ins are the exception, and `wac check <builtin>` with the file as the *entry* is silent as
well, which is the part that is hard to explain to a reader: the path they named is the file they
edited, and the answer is about neither.

## Why it matters

These are the nine most-imported files in the tree — `Pending`, `Vec`, `Map`, `Option`, `Result`,
`string`, `Read`, `jsx` and every capability. Nothing type-checks them. The only thing that notices
an error in one is the **engine refusing the finished module**, at the end of a full
`./bootstrap.sh`, which reports no line, no column and nothing about the program:

    wac: the module compiled from packages/wac/src/wac.wac was rejected by the engine —
    this is a compiler bug rather than a fault in the program.

That message is also wrong in this case, and confidently so: it says the compiler is at fault when
the fault is in the source it was given.

## What it already cost

`issues/lang/0292c` is this. It reads as a compiler bug about generic host-bound structs; it was a
**duplicate member** — a second `cancel` added to a `Pending<T>` that already had one at
`std/platform.wac:391`. wacc diagnoses that perfectly, everywhere else:

    error: duplicate member in this struct
     |   bool cancel(const this) { … }
     |   ^
     = help: rename one of them

Verified to fire for a plain struct, a generic struct, an exported generic struct, two members
separated by others, and two differing in return type. It cannot fire for `Pending<T>` because
nothing checks the file. Three full bootstraps went into narrowing a table of shapes that were never
the variable.

## Notes

Not chased to the site. `isBuiltinSpec` in `packages/wacc/src/coretext.wac` is what marks these paths,
and `api.wac`, `path.wac` and `check.wac` each import it — the graph walk presumably takes the
embedded text as already-good and collects its types without checking its bodies, which is a
reasonable thing to want for speed and a bad thing to do silently.

Two ends worth separating, as in `0291b`:

1. **Check them.** Whatever the graph does for an ordinary import, do for a built-in. If the cost is
   the reason, it is a cost paid once per build against nine files.
2. **Failing that, say so.** `wac check core/hash.wac` answering *"no diagnostics"* about bytes it
   did not read is the fault that turns a five-minute fix into three bootstraps. A sentence naming
   the embedding would have ended `0292c` immediately.
