# 0277 — a spawned child's `openOutput` is ignored on two hosts of three

- **Status:** open — the hosts disagree and each has a comment defending itself
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — the bytes go somewhere else and the exit status is 0

## Reproduction

One program, one grant set, one command line. The only difference is which host runs it.

```
$ wac app packages/box/src/box.wac -o box-app --allow-read --allow-write
$ deno run -A -e 'buildApp("packages/box/src/box.wac", "box-deno", {read:true, write:true})'

$ ./box-deno cp README.md /tmp/out      exit 0   stdout 0 bytes      /tmp/out 11394 bytes
$ ./box-app  cp README.md /tmp/out      exit 0   stdout 11394 bytes  /tmp/out 0 bytes
```

Expected: the file is copied.
Actual: on `box-app` the bytes are printed to standard output and the destination is left **empty**,
with **exit 0**. Nothing is said.

`wac run --allow-read --allow-write packages/box/src/box.wac -- cp README.md /tmp/out` does the same,
so this is not about the artefact format: it is about the program being a **spawned child**, which is
what `wac app-run` and `wac run` both make it (`runBytes` calls `cli.spawn`). `box-deno` is the
launcher's own worker and not a child of anything, which is why it works.

## The disagreement

`cp` writes its output through `Cli.openOutput`, which redirects this program's standard output to a
file. Every host then decides, on each write, where the bytes go. They do not decide the same way.

**`packages/platform/host/deno.ts:620` — the file wins**, and the comment is emphatic:

> **`openOutput`'s file first, and the caller's `write` second.** These were the other way round, so
> a caller that supplies `write` — every spawned child, and `harness/appRun.ts` — silently lost the
> redirection: `openOutput` truncated the file and every byte still went to the caller's sink.
> Nothing noticed because nothing had asked a *child* to redirect its own output until `sh` began
> streaming into `> file` (wac-mono 0070); `box wget url out` run as a child wrote an empty file.
>
> The order is not arbitrary. `write` in the options says where *standard output* goes; `openOutput`
> is the program saying its output is a file now, which is not standard output.

**`native/v8/src/main.rs`'s `emit_bytes` — the parent wins.** Frames, then `child_out`, then
`s.output`. A child returns at the second and never reaches the third.

**`native/src/main.rs` — the parent wins**, and this one argues for it:

> A spawned child writes to its parent's queues, never to the terminal. **Before** the redirected
> output below, because a child that was told to write to a file was told so by its own `openOutput`
> and this is about where its streams go when it was not.

That last sentence does not hold together. The case it describes — *told so by its own `openOutput`*
— is exactly the case it then skips: the redirect is set, and the branch above returns before
anything looks at it.

## Recommendation

Deno's order, on all three. `openOutput` is the program saying *my output is a file now*, and
whether something spawned it is a fact about its standard output rather than about the file. The
evidence is one-sided: Deno's comment cites a bug this order fixed (wac-mono 0070, `box wget url out`
writing an empty file), and the reproduction above is the same failure on the other two hosts.

Filed rather than changed because it is a decision across three hosts with comments on both sides,
and because the order also governs `writeErr`, where the wasmtime host makes a *separate* and
convincing point — a redirected output belongs to standard output alone, since sending diagnostics
into the file being written would hide them. Whatever is decided has to keep that.

## Why it went unnoticed

Nothing asks a spawned child to redirect its own output except a shell doing `> file` and box's
file-writing applets, and those are tested through `packages/box/test/`, which builds every program
with `packages/platform/build.ts` — the Deno target, the one host that is right.

That is the same shape as `issues/system/0275c`, closed the same day: a capability tested only on the
host that implements it correctly. The pattern is worth a look on its own — `conformance_test.wac`
records where each opcode is exercised, and "on which hosts" is not part of what it records.

## Notes

Found by migrating `packages/box/test/` from `build.ts` to `wac app` for `design/system/0009`, which
is blocked on this: eleven files moved, four tests failed and one hung. This is at least the `cp` and
`tee` failures. Whether it explains the network applets and the hang is not yet established.
