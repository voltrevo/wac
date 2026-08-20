# 0219 — the module cache keys on a closure it cannot fully see

- **Status:** closed
- **Reported by:** agent-b
- **Date:** 2026-08-20
- **Kind:** bug
- **Symptom:** wrong answer

`wac run` and `wac test` cache a built module in `/tmp/wac-testmod/<key>.wasm`, keyed by the content
of every `.wac` in the entry's closure plus the grants and the seed (`issues/system/0204`). The
closure comes from `closure_of`, a textual scan for `from "…"` resolved **against the importing
file's directory**.

Not every specifier is that. `dep/lib.wac` under a `wac.json5` mapping lives in
`$WAC_HOME/cache/git/…`, and `@/x.wac` inside a dependency is relative to that dependency's root.
The scan joined both to the importing directory, got a path that does not exist, could not read it,
and **silently dropped it** — while going on to use the key.

So the cache was addressed by content that did not include the content it depended on. Edit a mapped
dependency, re-run, and you get the program you had before. Nothing says so.

## Reproduction

A project mapping `dep/` at `subdir: "src"`, and a dependency whose `src/lib.wac` reaches outside
the subdir it was mapped at — the case `issues/lang/0169a` closed by making the compiler refuse it:

```
$ cat src/main.wac
import { two } from "dep/lib.wac";
export i32 main() { return two() + 5; }

$ wac run src/main.wac              # first ever run, cold /tmp
wacc: @/outside/bad.wac leaves the mapped subdirectory: …/src/lib.wac may import from
      …/src and this resolves outside it
$ echo $?
1
```

Now compile *any* entry of the same bytes that legitimately answers 2 — which is what the last case
of `packages/wacc/test/wac/mappedspec_test.wac` does — and ask again:

```
$ wac run src/main.wac
$ echo $?
7
```

Expected: the refusal, every time.
Actual: no compile, so no refusal, and a module built from a different dependency runs instead.

Editing one byte of `main.wac` restores the refusal, which is the tell: `return two() +  5` with two
spaces refuses and `return two() + 5` does not.

## What it cost

`mappedspec_test.wac`'s `test_a_mapped_subdir_cannot_import_outside_itself` is **green on a clean
`/tmp` and red on every run after it**, because its own last case populates the entry that its escape
cases then hit. It was written, canaried and pushed green, and failed for the next agent to pull it
— appearing as `the refusal did not say the import leaves the mapping — ` with an empty message,
which is what a program that ran instead of failing to compile looks like.

Three of that test's four assertions passed while the check was bypassed: `status != 71` and
`status != 0` are both true of the 7 the stale module returns. Only the one that read the diagnostic
noticed. A test that asserts a refusal needs to assert the *message*, not just an unhappy status.

Two smaller things fell out of the same scan:

- `/tmp/wac-testmod` is shared by every agent on the box and keyed partly on `entry=<path>` as
  **typed**, so two unrelated projects each running `wac run src/main.wac` key the same. With a
  complete closure that is safe — the closure is then the whole program — and it was only unsafe
  because the closure had holes.
- `std/…` resolves to nothing on disk too, but legitimately: it is the embedded tree, and
  `test_module_key` already hashes the seed that carries it.

## Fixed 2026-08-20

`closure_of` returns `(sources, whole)`, and an import naming a `.wac` it cannot read makes `whole`
false; `std/…` is skipped before the join rather than failing it. Both callers pass `None` as the key
when the closure is incomplete, so a program that reaches a mapped dependency compiles every run.
That is the cost of the cache being honest about what it covers, and it is paid only by projects that
have such a dependency — no test in the tree but this one does.

Canaried: with the fix in place, the stale `/tmp/wac-testmod` entry put back by hand, the refusal
fires; `mappedspec_test.wac` passes twice in a row, which it could not do before.
