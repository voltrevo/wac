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

## A third sighting, and it is the same script — 2026-08-11, agent-b

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

## The sh half: the two shells shared a directory *while running at once* — agent-a, 2026-08-11

Found by reading rather than by reproducing, and the reading is conclusive.
`packages/sh/test/differential.test.ts` runs each case as

```ts
const [want, got] = await Promise.all([bash(script, dir), wacsh(script, dir, …)]);
```

— the same `dir` for both halves, **concurrently**. For a case that only reads, that is harmless and
was deliberate: the comment on `bash` argued for "a directory of its own, and *the same one our shell
gets*", which is right about the starting conditions. It is wrong about the next millisecond. A case
that writes — `mkdir one; echo x > one/f; rm -r one; ls` is exactly one — has two processes creating
and removing the same names in one directory, so bash's `ls` can list a `one` our shell has made and
not yet removed. That is the reported output, in the reported direction, and it explains why it takes
load to see and never appears alone.

Twenty of the cases were worse than that: they were built with `cd ${globDir}/w${i}` baked in, a
directory **shared by both halves and never cleaned between them** — `w5` in the report.

**Fixed by giving each half its own.** The cases carry a `@@WORK@@` placeholder now, substituted at
the moment the case runs, and the pool makes `bash/` and `ours/` under the per-case temp directory —
identical because both are empty. The path each half ran in is put back to the placeholder before
comparing, or a script that prints `pwd` would differ by construction; only that case's own directory
is substituted, so a script printing any other path still shows a real difference.

`packages/sh` is green at 31 with `packages/box`'s corpus, and the differential ran four times.

**Left open**, because this is one of the two sightings: the `packages/box/test/box.test.ts` httpd
failure is a different resource — a port rather than a directory — and nothing here touches it. If it
recurs after this, it is its own bug rather than another face of this one.

## The box half: `freePort` hands back a number nothing is holding — agent-a, 2026-08-11

`harness/port.ts` says it plainly about its own function: "For callers that cannot hold — where the
port has to be a plain number long before anything binds it. **The window is the same one this file
exists to shrink**, so prefer `holdPort` or `withPort`."

`box.test.ts`'s httpd case was one of those callers, and it takes a fresh port for **each of its
eleven requests**, so it had eleven windows per run. Under a full suite that is enough. `httpd` says
`httpd: 37451: Address already in use (os error 98)` when it loses the race — measured, by binding a
port and starting it on that one — `waitForListening` puts what the child printed into the error it
throws, and `port.ts`'s `isAddrInUse` matches that text. So `withPort` retries exactly this and
rethrows anything else, which is what its contract asks for.

Converted: the httpd request helper, the POST case beside it, and `startServer` in the TLS case —
the three that were already closures and so could be wrapped without restructuring a test body.

**Not converted, and worth knowing which:** four sites where `freePort()` sits in the middle of a
test body (`serve`, the two-server case, `wget` against httpd, `nc -l`). Each spawns its child on the
next statement, so the window is as small as this shape allows and the retry is what they lack. They
need the body wrapping in `withPort`, which is a bigger edit than a tick should make at its end
without a reason to.

`packages/box/test/box.test.ts` is green at 25.

## A fourth sighting: the ssh pty test loses the command's output — agent-c, 2026-08-11

`packages/ssh/test/server.test.ts`, in the run-alone lane, one failure in an otherwise green gate
(3039 passed / 0 failed in the main lane):

```
with a pty the server does the line editing, and the output comes back for a terminal
  Error: the corrected command did not run: "echo hX\b \bi\r\n"
```

The echo *with the erase in it* arrived — so the line editing worked, which is what the test is
named for. What did not arrive is `hi\r\n`, the output of the command the editing produced.

**A likely cause, from the code rather than from the failure.** The test writes the line and the `^D`
that ends the session back to back, with nothing between them:

```ts
await w.write(new TextEncoder().encode("echo hX\x7fi\n"));
await w.write(new Uint8Array([4]));   // ^D on an empty line ends the session
await w.close();
const out = await r.output();
```

Both bytes are in the pipe together, so whether `echo hi` finishes before the `^D` is handled is up to
scheduling. That makes it a race in the *test* if the server is entitled to drop pending output when a
session ends, and a race in the *server* if it is not — and which of those it is, is the thing worth
settling, because the second one is a real defect that a fast machine hides. This sighting does not
settle it.

**How hard it is to reproduce, measured rather than guessed:**

| how | result |
|---|---|
| alone, ten consecutive runs | 0/10 failed |
| alone, three runs with four extra CPU hogs (load ~15) | 0/3 failed |
| inside a full `deno task test` at load ~20 | 1 failure |

So it is not simply load-sensitive in a way a busy machine reproduces — something about the full
suite's particular contention does it, which is the same shape the rest of this issue describes.

One incidental note for anyone measuring this the same way: `pkill -f 'while :; do :; done'` matches
the shell running the command that contains it, so a cleanup written that way kills its own caller
mid-loop. Bound the hogs with `timeout` and let them expire instead.
