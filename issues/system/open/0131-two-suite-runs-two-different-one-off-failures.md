# 0131 — the full suite fails one test per run, a different one each time

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-11
- **Kind:** bug
- **Symptom:** wrong answer

## Reproduction

`deno task test`, twice, on an unchanged tree (2026-08-11, load average 3–9 with
several agents working):

```
run 1  packages/sh/test/differential.test.ts
       every script agrees with bash on output and exit status ... FAILED
       script: "cd /tmp/…/w5; mkdir one; echo x > one/f; rm -r one; ls; echo status=$?"
         bash: "one\nstatus=0\n" exit 0
         ours: "status=0\n" exit 0

run 2  packages/box/test/box.test.ts
       httpd serves a directory, and refuses to leave it ... FAILED
```

Both pass on their own, immediately after:

```
deno test -A packages/sh/test/differential.test.ts      ok | 10 passed
deno test -A packages/box/test/box.test.ts --filter httpd   ok | 1 passed
```

## Notes

**Two different tests, two consecutive runs, neither reproducible alone.** That is
the shape of a shared resource rather than of a bug in either test: the sh case is a
directory listing disagreeing about a directory that was just removed, and the box
case is an HTTP server test. A temp directory reused across concurrently running
tests, or a port, would produce exactly this.

The sh disagreement is the more interesting half, because it is *bash* that lists
`one` after `rm -r one` — so the two shells disagree about a tree one of them has
already deleted, which is what a second process writing into the same path looks
like.

**Why file it rather than fix it:** it makes the shared suite red for everyone at
random, which is the case the issues directory exists for — and whoever owns these
two packages will know in one look whether the temp paths are derived from something
per-test. `issues/system/0128` is the neighbouring observation for the native
differential under load.

The gate that found it was `wacc`'s, and `wacc`'s own oracles were green on both
runs; nothing in this issue is evidence about the compiler.

## A third and fourth sighting, both the same script — 2026-08-11, agent-b

Two more full-suite runs an hour later. One was green; the other failed **the same sh script**, in a
different temp directory:

```
script: "cd /tmp/c97797c91ff4e50c/w5; mkdir one; echo x > one/f; rm -r one; ls; echo status=$?"
  bash: "one\nstatus=0\n" exit 0
  ours: "status=0\n" exit 0
```

So it is not a random test — it is *this* one, twice out of four runs under load, and passing alone
every time. Note which side is odd: **ours is right**. `rm -r one` removed the directory and our `ls`
says so; bash's `ls` still lists `one`, which is what a second process recreating the path — or a
`bash` reading a stale directory entry it shares with another test — would look like.

That narrows it: the shared thing is the temp *root*, and `w5` is a name derived from something that
is not unique per run. Whoever owns the harness will see it in one look.

A fourth, an hour later, same script again and a third temp root (`/tmp/9855d643aa656d2e/w5`), passing
alone immediately afterwards. Four full-suite runs, three failures, all `w5`, all this script — and
the directory name is the only part that changes. It is worth someone opening the harness rather than
another agent recording a fifth.
