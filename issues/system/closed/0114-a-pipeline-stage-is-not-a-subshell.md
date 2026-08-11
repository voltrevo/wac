# 0114 — a pipeline stage is not a subshell, so an assignment in one leaks

- **Status:** closed
- **Closed by:** agent-a, 2026-08-11
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

## 2026-08-10: still reproduces, and one of the three obstacles dissolves

Re-run against today's shell, in an empty directory — which matters, because `echo [$v]` is a glob
character class and the first attempt at this ran in a directory holding a file called `t`, so *both*
sides came back mangled and neither was what the shell said:

    ours   [b]
    bash   [set]

So: live, and filed correctly.

**The first of the three "what makes it a decision" bullets is not an obstacle.** It says the code
"does not distinguish 'a single command' from 'the only stage of a pipeline'". On inspection there is
nothing to distinguish: `parsePipeline` builds a `Pipeline` whose `stages` is a `Vec<Command>`, a lone
command is a one-stage pipeline, and bash's own rule is *fork each stage when there is a pipe*. That
is `stages.len() > 1`, available directly at the top of `runStages`. `v=b` assigns because it has one
stage; `v=b | cat` forks because it has two.

The other two bullets are real and unchanged: `echo x | read v` becomes empty as it is in bash, which
is a behaviour change for anything here that relies on the current answer, and `cmd | while read …`
losing its variables is the boundary that has to be got right rather than assumed.

**What I would choose, since this is a decision:** bash's semantics. The reason is the oracle rather
than taste — 821 corpus scripts are checked against bash script for script, and a divergence here is a
latent corpus failure waiting for the next fuzz seed to land on it. It was `tools/shellFuzz.ts` seed
29 that found this one, and nothing stops seed 30 from finding it again in a shape that is harder to
read. The "more useful than bash" behaviour is also the one that makes a script silently
non-portable, which is the trade this repository usually declines.

Still not urgent, and still not mine to take unilaterally.

## Done, and it took three fixes rather than one — agent-a, 2026-08-11

**The decision went bash's way**, for the reason the note above gives: 828 corpus scripts are checked
against bash script for script, so a divergence here is a latent corpus failure waiting for a fuzz
seed. It was seed 29 that found this one.

`runStages` forks every stage when `stages.len() > 1`, which is the boundary the second look
identified — `v=b` alone is not a pipeline and still assigns. The child's output belongs to the
parent, exactly as `Subshell` already did it, and where it goes depends on the *parent*: a fork
always captures, so the last stage no longer writes as it goes and `runStages` writes for it.
`echo a | cat | cat` printed nothing until that was added.

**And forking every stage exposed two bugs that had been sitting in `( … )` all along**, because a
subshell is rare in the corpus and a pipeline is in half of it.

- **`fork()` did not carry the filesystem, the working directory or the environment.**
  `Shell.create` builds on `Fs.onHost` at the *host's* directory, so `cd sub; ( pwd )` printed the
  parent's directory where bash prints `sub` — and in a session on an image, a subshell would have
  asked this machine about a path inside it. That is the in-process twin of 0116, which fixed the
  same mistake for a spawned stage.
- **A command substitution copied `vars` and not `varNames`.** They are two halves of one fact: the
  map answers a lookup and the list says which names exist. `set` inside `$( )` listed nothing, and —
  the way this surfaced — `fork` copies variables by walking the names, so every stage of a pipeline
  inside a substitution started with none: `x=$(echo a b | wc)` answered `wc: command not found`
  because `$WACPATH` was not there to be read.

**Held by the corpus rather than by a unit test.** Seven scripts added to `test/corpus.ts` — the
assignment leak in both directions, the one-stage boundary, `echo x | read v`, a brace group as a
stage, and two `cd`-then-subshell cases — all compared with bash, which is what makes them
regressions rather than opinions.

Verified: `packages/sh` (30), `packages/box` (122), and `tools/shellFuzz.ts` on the seed that found
it — seed 29 went from **298** of 300 agreeing to **299**, the remaining one being an unrelated
divergence about `local` outside a function, filed as 0130. Seeds 1 and 30 are unchanged at 248/250
and 250/250, and their disagreements are that same `local` case.
