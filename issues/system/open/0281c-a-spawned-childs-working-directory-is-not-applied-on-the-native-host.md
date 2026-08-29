# 0281 — a spawned child's working directory is not applied on the native host

- **Status:** open — a known divergence, with one failed attempt already measured
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — a relative path resolves against the wrong directory

## Reproduction

```
$ ./sh -c 'cd sub; cat f.txt; pwd'          # build.ts, Deno target
hello from sub
/tmp/box-shell-ceb7a865693fd9ce/sub

$ ./sh -c 'cd sub; cat f.txt; pwd'          # wac app, native host
cat: f.txt: No such file or directory
/tmp/box-shell-ceb7a865693fd9ce/sub
```

`pwd` is right on both, so the shell knows where it stands. What differs is where a **spawned
applet** stands: `cat` resolves `f.txt` against the process's directory rather than the shell's.

`packages/box/test/shell.test.ts`'s *"a spawned applet stands where the shell stands"* is the case.

## It is known, and one fix has already been tried

`framed_path` in `native/v8/src/main.rs` resolves a relative path against the innermost **frame**'s
`cwd` and stops there. Its own comment says so, and says what happened when somebody folded in the
spawned child's directory:

> **The frame's `cwd` only, not `cwd_override`.** The Deno host's `P` also folds in the world's own
> `opts.cwd`, so the two still differ about *that* — but applying it here broke
> `packages/platform/test/wac/v8host_test.wac`'s image differential, where a spawned `imaged` child
> stopped being able to read the image its parent served. Measured by isolating the two halves: with
> the frame alone the lane is 34 of 34, and with the override folded in it is 33. So the
> spawned-child case is a separate question from this issue's, and closing one blind broke something
> real.

**The measurement was re-run on 2026-08-29 and still holds**, which is worth saying because a note
about a failed attempt is only useful while it is current. Folding `cwd_override` into `framed_path`'s
base — one `.or_else(|| s.cwd_override.clone())` — reproduces it exactly:

    FAIL test_an_image_survives_a_process_and_is_readable_by_a_spawned_child
      the two hosts disagree about what the image held: got "", want "5"
      the V8 host could not read an image Deno wrote: got "", want "5"

Reverted. That measurement is the reason this is filed rather than fixed. It is also the reason it is worth a
number: the knowledge exists as a comment on the function that has the bug, so the next person to
meet the symptom re-derives it.

## What the question actually is

Both halves are defensible and they conflict, which is what the failed attempt found:

- **A spawned applet should stand where its parent stood.** That is what a shell means by `cd`, it is
  what the Deno host does, and `shell.test.ts` asserts it.
- **A child served an image by its parent addresses that image, not the machine.** Folding the
  override into every path made `imaged`'s child resolve the image path through the parent's
  directory and lose it.

The two are only in conflict because one function answers for both, and the Deno host shows the shape
of a separation: `P = joinPath(opts.cwd ?? "", kids.path(path))` resolves against the innermost frame
*first* and folds the world's own directory in *after*. The v8 host does only the first half.

What the re-run suggests is that the distinction wanted is not frame-versus-world but **who
constructed the path**. An applet that opens `f.txt` after its shell did `cd sub` built that path
itself and means the shell's directory. A child *handed* an image path by whoever spawned it was
given a path already resolved, and resolving it again is what breaks. One function cannot tell those
apart from the string alone, which is why this needs a decision rather than a patch.

## Why it matters now

`design/system/0009` moves `packages/box/test/` from `packages/platform/build.ts` onto `wac app`,
which changes the host under those tests from Deno's to the native one. Nine of twelve files moved;
this is one of the three that did not.

The other two: `issues/system/0280c` (a grandchild's `spawnSelf` fails, exit 127) and
`unnameable.test.ts`, which is not a bug — it depends on Deno's second permission layer refusing a
path that the wac grant allows, and a `wac app` artefact has only the one layer.

## Notes

Sixth host divergence found on 2026-08-29, all of the shape *implemented one way here and another
way there*. `issues/system/0279c` is about why the instrument meant to catch them did not:
`conformance_test.wac` credits `CWD` to `native_hostfs_test.wac`, which skips wherever the wasmtime
host has not been built.
