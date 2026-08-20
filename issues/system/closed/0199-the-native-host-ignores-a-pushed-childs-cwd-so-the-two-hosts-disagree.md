# 0199 — the native host ignores a pushed child's `cwd`, so the two hosts disagree about the same program

- **Status:** closed
- **Fixed in:** this commit
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-18
- **Kind:** bug
- **Symptom:** wrong answer — a child is told there is no such file, in a directory that has it

`Cli.pushChild(argv, stdin, cwd, …)` takes the directory a child's relative paths resolve from. The
Deno host applies it. The `wac` binary does not, and the same program therefore gives two different
answers depending on which host runs it.

## Reproduction

`packages/platform/example/inside.wac` already is one. It writes `note.txt` into the directory it is
given, pushes a child with that directory as its `cwd`, and the child opens `note.txt` by that
relative name — the example exists to demonstrate exactly this.

    $ d=$PWD/.cache/probe && mkdir -p $d

    # The Deno host, through `buildApp` — the child finds it.
    status 0
    out   FROM STDIN\nFROM THE FILE\nread 14 bytes\n
    err   shout: nothing wrong, just talking\n

    # The wac binary, same program, same absolute directory.
    $ wac run --allow-read --allow-write packages/platform/example/inside.wac -- $d
    status 1
    out   FROM STDIN\n
    err   shout: note.txt: No such file or directory (os error 2)\n

Both leave `note.txt` in the directory afterwards, so the *parent's* write lands where it should. It
is the child's read that resolves somewhere else — against the process working directory, which is
wherever `wac` was invoked from.

## Not `issues/system/0194`

That one is `packages/platform/src/frame.wac`'s `Frame.cwd`, it is about a **relative** cwd, and an
absolute one works around it. This is `Cli.pushChild`, it is the **native host** rather than the
frame, and an absolute cwd fails too — both spellings above were tried and both failed. They may
share a cause once someone looks; they are not the same report.

## How it was found, which is the part worth keeping

Converting the TypeScript `frame.test.ts` for `issues/system/0161`. That test is a
**differential**: `example/inside.wac` uses the host frame and `example/insideValue.wac` uses a
substitute built from lambdas, the child function is copied between them unchanged, and their output
must be identical. Under `deno test` it passes and has for as long as it has existed. Ported to run
the two programs with `wac run` instead, the halves disagree — the substitute frame reads the file
and the host frame does not.

So the divergence was invisible while both sides were run by the same host, and it is exactly what a
differential is for. It also means the property that test asserts — *a child cannot tell which of the
two frames ran it* — **is false on the binary**, which is now the host most things use.

## What this blocks — narrowed 2026-08-19

**Not the conversion.** `test/frame.test.ts` moved to `test/wac/frame_test.wac` on 2026-08-19 and is
green: it builds both examples through `packages/platform/build.ts` and runs them on the Deno host,
which is exactly what the TypeScript did. Driving that from wac rather than from `deno test` changes
who runs the test, not who runs the programs.

What is blocked is the **stronger** test, which nobody had written: the same differential with both
halves run by the binary. That is the one that goes red, and it is the one worth having — the
property is *a child cannot tell which of the two frames ran it*, and on the host most things now use
it can. Adding a second pair of runs to `frame_test.wac` is a few minutes on the day this closes.

The original note said the conversion stayed TypeScript until this was fixed. That conflated the two:
it was written while the wac version was being run under `wac run`, and the conclusion "porting it
would mean shipping a red test" was true of that version and not of the port.

## Fixed — 2026-08-20

`Cap::PushChild` already stored the `cwd` on the frame, and `Cap::Cwd` already answered from it — so the
program was **told where it was** and then had its paths resolved somewhere else, which is the worse of
the two possible halves to have. The path-taking capabilities used their argument verbatim:
`std::fs::File::open(&path)`.

`framed_path` joins it, with semantics copied from `packages/platform/host/child.ts`'s `joinPath`
including what that deliberately does *not* do — `.` and `..` are left for the host below, because
reimplementing them would be a second opinion about what a path means. Applied at the eleven
capabilities the Deno host frames, which the native host groups into seven arms: `readFile`, `readDir`,
`writeFile`, `stat`/`linkStat`, `openInput`, `openOutput`, and the `rename`/`remove`/`mkdir`/
`setExecutable` block. **Not `exec`** — `frame.wac` says why: remapping the program path would make a
redirected shell unable to name `/bin/sh`.

`example/inside.wac` and `example/insideValue.wac` now print identical output on the binary, which is the
property this was breaking.

## What I got wrong first, because it matters for whoever does the next one

The Deno host's `P` is `joinPath(opts.cwd ?? "", kids.path(path))` — it folds in the **world's own cwd**
as well as the frame's. Mirroring that broke
`packages/platform/test/wac/v8host_test.wac`'s image differential: a spawned `imaged` child stopped being
able to read the image its parent served, and the lane went from 34 files to 33. Isolated by removing one
half at a time.

So this fix is **frame-only**, and the two hosts still differ about a *spawned* child's `cwd`. That is a
separate question from this issue's and it has a test that says so — worth its own report by whoever wants
it, rather than being folded in here where it broke something real.

## The stronger test the issue asked for

`frame_test.wac` gained `test_the_two_frames_agree_on_the_binary_as_well` — the same differential with
both halves run by the binary, which is what was missing and what made this invisible: while both halves
were served by the same host, a host bug could not show. Canaried by disabling the join, which fails it
with *"the child did not read the file the parent left it — the frame's cwd was ignored"*.

Verified: `packages/platform/test/wac/` 34 of 34, `packages/box` and `packages/sh` 19 of 19 together.