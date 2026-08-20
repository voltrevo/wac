# 0169a — a mapped `subdir` does not confine what its code can import

- **Status:** closed — every specifier from a mapped file is checked against its subdirectory
- **Fixed in:** the commit this line arrived in
- **Reported by:** agent-a
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer — you get more of a repository than you asked for

## What `subdir` is supposed to mean

`design/lang/0009` D6/D9 let a mapping take one directory of a larger repository:

```json5
{ imports: { 'dep/': { git: 'https://example.invalid/mono', ref: 'main', subdir: 'a/b' } } }
```

You depended on `a/b`. The rest of that repository is not part of what you took, and code inside
`a/b` must not be able to reach it. D7, as settled on 2026-08-19: a file at `a/b/c.wac` may import
`@/a/b/d.wac` and may **not** import `@/elsewhere/bad.wac`.

## Reproduction

A checkout under the cache, with a manifest at the *repository* root so `@/` means that root:

    $WAC_HOME/cache/git/https%3A%2F%2Fexample.invalid%2Fmono/<commit>/
      wac.json5
      a/b/c.wac          import { bad } from "@/elsewhere/bad.wac";
                         export i32 reach() { return bad(); }
      a/b/d.wac          export i32 good() { return 5; }
      elsewhere/bad.wac  export i32 bad() { return 66; }

and a project that maps only `a/b`, with a lock naming that commit:

    src/main.wac         import { reach } from "dep/c.wac";
                         export i32 main() { return reach(); }

```
$ wac run src/main.wac
exit 66
```

It reached `elsewhere/bad.wac`, which the project never took. With `c.wac` importing `@/a/b/d.wac`
instead the answer is `5`, which is correct and has to keep working.

## Why it happens

`@/` inside a dependency resolves against the **fetched dependency's root** — the checkout, which is
right, and which D7 keeps as a boundary. What is missing is the second half: nothing checks that the
*resolved path* is inside the mapped `subdir`.

`wacc.wac` computes `checkout = cachePath(home, git, commit)` and `file = checkout + "/" + at.path`,
where `at.path` already carries the subdir, then passes `checkout` as the boundary to
`projectRootIn`. So the search correctly stops at the repository root, `@/` correctly means that
root — and `@/elsewhere/bad.wac` is a path inside the checkout, so nothing objects.

## Why it is not the boundary's job

The obvious-looking fix is to make the `subdir` the search boundary, which is what D7 used to say.
That is the wrong shape and was dropped for it: a dependency's code was written as part of its own
repository, and its `@/` means that repository's root. A subdirectory is where *somebody else* chose
to mount it, and stopping the search there breaks a dependency that uses `@/` correctly — the case
answering `5` above.

The rule wanted is about the resolved path, not the search: **resolve `@/` against the repository
root as now, then refuse a result outside the mapped subdir.** Those are two different questions and
the boundary was standing in badly for the second.

## Where a fix goes

Beside the existing containment check rather than in a new place. `packages/wacpkg/src/manifest.wac`
already has `M_SUBDIR_ESCAPE` for a mapped *specifier* whose suffix climbs out (`dep/../../x`), and
`Located` carries the code — so the concept, the error and the tests exist. This is the same rule
applied to a `@/` resolved inside the dependency, which today does not go through it.

**It is not a `@/` problem.** Checked: the same file doing

```wac
import { bad } from "../../elsewhere/bad.wac";
```

also answers `66`. So `@/` is one of at least two ways out and fixing it alone would leave the
feature exactly as unconfined as it is now, with a fix that looks like it worked. The check belongs
where a mapped file's imports meet the filesystem — every specifier form at once — rather than in the
`@/` resolution path.

That also settles what the test has to be: a case per specifier form reaching for the same file
outside the subdir, all refused, plus the in-subdir case still answering `5`. A single `@/` case
would go green over a hole.

## Note on severity

This is our own code and a confinement rule that has never been enforced, not a way in from outside:
you have to have written the `subdir` mapping yourself, and the code it reaches is code you already
fetched. It matters because `subdir` is the feature you reach for to take *less* of a repository —
so the one property it exists to provide is the one it does not have.

## Fixed

`Mapped` gained a `confine` field — the checkout plus the mapping's `subdir` — and `gather` carries a
`confine[]` parallel to `paths`. A file that arrived through a mapping records it; a file it imports
inherits it; and **every resolved specifier passes one check**, which is the single point all forms
meet:

    wacc: @/elsewhere/bad.wac leaves the mapped subdirectory: <file> may import from <dir>
          and this resolves outside it
    wacc: ../../elsewhere/bad.wac leaves the mapped subdirectory: …

and `@/a/b/d.wac` from inside `a/b` still answers 5.

**`confine` is deliberately not `checkout`.** They answer different questions and the issue turned on
not confusing them: `roots[i]` bounds the *search* for a `@/` root, and has to reach the repository
root because that is what the dependency's author wrote against; `confine[i]` bounds the *answer*.
Making the subdir the search boundary — the obvious fix — breaks the case that must keep working.

Canaried: with `withinDir` forced to `true` and the seed rebuilt, all four assertions fail.
