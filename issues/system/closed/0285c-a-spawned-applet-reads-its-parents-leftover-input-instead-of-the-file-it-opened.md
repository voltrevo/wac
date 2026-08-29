# 0285 — a spawned applet reads its parent's leftover input instead of the file it opened

- **Status:** closed
- **Reported by:** agent-c
- **Date:** 2026-08-29
- **Kind:** bug
- **Symptom:** wrong answer — file contents replaced by whatever the parent had left on standard
  input, and an exit status of 0

## Reproduction

The V8 host, a shell that has consumed some of its own standard input, and any applet that reads a
named file.

```
$ printf 'one\nLEFTOVER-A\nLEFTOVER-B\n' | wac ./spawnsh.wasm -c 'read v; cat MERGE.md'
LEFTOVER-A
LEFTOVER-B
```

`cat MERGE.md` printed the parent's leftover standard input. The file was opened, was found, and was
not read.

Usually the parent has nothing left, and then the answer is empty rather than wrong-and-visible:

```
                        V8                            Deno
wc -l MERGE.md          0 MERGE.md                    118 MERGE.md
sha256sum MERGE.md      e3b0c442…b855                 17e54d3f…
head -1 / cat           (nothing)                     (the file)
```

`e3b0c442…b855` is the SHA-256 of the empty string. `wc -l` answering `0` is the worst of these: a
plausible number that a script will act on.

**The file is genuinely opened.** A missing file still reports properly —
`wc: nosuch.md: No such file or directory` — and an absolute path fails the same way as a relative
one, so this is not path resolution.

**The trigger is not where the script came from.** That is what this issue said when it was filed,
and it was wrong. The trigger is whether the parent has consumed its own standard input: `-c` with a
`read` first fails identically, and standard input with no `read` is fine. What the shell's script
arrived on only matters because reading it is what consumes the stream.

## Cause

`native/v8/src/main.rs`. `Cap::ReadStdin` (~2355) and `Cap::ReadChunk` (~3237) both decide where to
read in this order:

    1. from_parent   — the parent's queue        <- taken first
    2. redirected    — an explicit openInput
    3. framed        — the frame's queue

So `openInput` wins over the *frame's* queue and loses to the *parent's*.

**Half of this was already fixed.** The comment above `Cap::ReadChunk` describes the frame version —
*"an applet that opened one and then read the frame's queue instead read what its caller had already
finished: `sha256sum README.md` inside the shell hashed nothing and printed the hash of the empty
string, which is a wrong answer that looks like a right one"* — and ends *"`native/src/main.rs`
carries the same warning about `cat f`; I ordered these the other way round and walked into it."*
The parent-queue branch sits four lines above that comment, in the same function, unordered.

`native/src/main.rs` (wasmtime) has it right in both of its equivalents — `input.is_some()` at 1513
and 1580, ahead of the `as_child` checks at 1522 and 1595 — and states the rule at 1575: *"An
explicit `openInput` wins over the parent's queue, and the order is the whole of the bug it fixes."*
Deno is right too. The V8 host is the only one that is wrong, and it is wrong on both routes.

## Fix

Hoist `redirected` above `from_parent` at both sites and skip the parent's queue when it is set.
There are exactly two consumer sites — `child_input` appears at 2366 and 3239 and nowhere else in
the host — so the enumeration is bounded.

## Scope

Every file-reading applet, not `cp`. **37 files** under `packages/box/src` import the `input.wac`
helper that calls `openInput`; nine callers repo-wide call it directly.

It needs the parent to have consumed standard input, which a shell does whenever its script is
piped, and `read` does explicitly — so an `ssh` session and any piped script are the ordinary way in.

## Why nothing caught it

`packages/platform/test/wac/v8host_test.wac` drives its spawning shell on standard input — the
failing route — but nothing in its script read a file. Its other script runs
`packages/box/example/boxsh.wac`, whose applets run in-process through `pushChild` and never spawn,
which is why the first attempt at a test for this was decorative.

`issues/system/0279c`'s point exactly: the comparison that includes the shipped host had no breadth,
and the one with breadth — `native_hostfs_test.wac` — does not include that host.

## Test

The leftover-stdin case above, in `v8host_test.wac`'s `SPAWNING_SCRIPT` — it is the one that
separates this defect from "reads empty", and an empty-file assertion would have passed against a
host that returned the parent's bytes. A case on the unbounded route (`readStdin`) too, since both
were wrong and only `readChunk` is exercised by `cat`.

## Notes

Tenth host divergence found on 2026-08-29, and the first found by a *test* rather than by hand.
