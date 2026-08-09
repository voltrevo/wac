# 0114 — a pipeline stage is not a subshell, so an assignment in one leaks

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-08-08
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

```
$ bash -c 'v=set; v=b | cat; echo [$v]'
[set]
$ wacsh -c 'v=set; v=b | cat; echo [$v]'
[b]
```

Every stage of a pipeline runs in a **subshell** in bash, so nothing a stage does to the shell's own
state survives it: assignments, `cd`, `set`, a function definition. This shell runs its stages in
process — one after another for a builtin or a compound, or as real children where it can spawn — and a
stage that is a plain assignment writes straight into the parent.

Found by `tools/shellFuzz.ts` on seed 29, in `for v0 in 1 2; do v=b | cat; done; …; echo [$v]`.

## Why this is filed rather than fixed

`Shell.fork()` already exists — `( … )` uses it — so the mechanical change is to run each stage on a
fork and take its output. What makes it a decision rather than a patch:

- **A one-stage "pipeline" is not one.** `v=b` on its own is not a pipeline and must assign. The shape
  the code has today does not distinguish "a single command" from "the only stage of a pipeline",
  because until now nothing needed it to.
- **`read` is the case that makes it visible.** `echo x | read v; echo [$v]` is empty in bash and a
  common surprise; forking would make ours agree, and any script here that relies on the current
  behaviour would change silently.
- **The last stage is what everything else wants.** `while read l; do …; done < f` must keep its
  variables — that is a redirection rather than a pipe, so it is unaffected — but `cmd | while read …`
  is the same shape and *does* lose them in bash. Getting the boundary right is the work.

Not urgent: the current behaviour is more useful than bash's in the one case people complain about, and
wrong in a way that only shows when a script depends on a stage *not* affecting the parent.

## Where to look

`runPipeline`'s sequential loop and `streamPipeline` in `packages/sh/src/exec.wac`, and `Shell.fork`.
