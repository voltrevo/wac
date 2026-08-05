# Holders: none found

*2026-08-05*

A test suite failed three times in one day with an error I could not reproduce:

```
Failed to spawn '/tmp/wac-split-b984fc8adbcc64dd': Text file busy (os error 26)
```

`ETXTBSY`. On Linux, `execve` returns it when the file you are trying to run is open for **writing** by
some process. The suite builds a small binary, chmods it, and runs it; a few hundred times per full
run, in eight parallel processes. Three times that day, one of those execs came back busy — and only
under load, never in isolation, never in the same test twice.

This is the story of the diagnosis, including the part where I was confidently wrong, because the
ending is a general lesson about when a retry is engineering and when it is a shrug.

## The two obvious causes were already fixed

Both with comments saying they had each cost a red suite:

```ts
// Unique per call, not `out + ".partial"`. Two builds to the *same* destination happen under
// `--parallel` … and with a shared temp name the loser was still holding the file the winner had
// just renamed into place.
const partial = `${out}.${crypto.randomUUID()}.partial`;
await Deno.writeTextFile(partial, text);
if (executable) await Deno.chmod(partial, 0o755);
await Deno.rename(partial, out);
```

Write to a unique temp, rename into place: the file you exec was never the file anyone wrote. The
content-addressed build cache does the same for its own entries. A colleague filing the bug wrote
exactly the right instruction into the issue:

> Whoever picks this up should start by working out which process holds the write handle, not by
> hardening the two places that are already hardened.

## Where I was wrong

I had a good story within about ten minutes. `Deno.writeTextFile` opens a file, writes, and closes it —
but the promise it returns resolves when the *write* completes, and the handle is closed when the
resource is dropped, which is not ordered against your next statement. So the writer holding the file
open for writing was *this process*, and the rename could not save us because the handle was still
open when the exec happened.

That story is plausible, it explains the load dependence (more load, wider window), and it comes with a
clean fix:

```ts
const file = await Deno.open(partial, { write: true, create: true, truncate: true });
try {
  const bytes = new TextEncoder().encode(text);
  let at = 0;
  while (at < bytes.length) at += await file.write(bytes.subarray(at));
  await file.sync();
} finally {
  file.close();
}
```

I shipped it. The flake came back on the next run, in a different test of the same file.

Worth noting what my fix *did* contain: my first version passed the whole buffer to one `file.write()`
call. `write` is POSIX `write` — it may accept fewer bytes than you hand it. On a 400 KB binary that is
a truncated executable, which is a considerably better bug than the one I was chasing. I caught it
while writing up the change, not while writing the change. The loop above is the fixed version.

## Measuring the thing I could not reproduce

With a confident theory dead, the next honest step is to stop reasoning and start counting. Three
experiments, in increasing fidelity to the real thing:

| what | rounds | ETXTBSY |
|---|---|---|
| write 20 bytes → chmod → rename → exec, three write patterns | 3 × 400 | 0 |
| 400 KB shebang script, three patterns, three concurrent processes | 3 × 120 | 0 |
| the *actual* build path (`buildApp`, cache hit, place, rename) then exec | 60, then 6 × 40 | 0 |

One of those patterns wrote straight to the destination with **no rename at all** — the version that
should be maximally exposed — and it never failed either. Roughly 660 build-and-exec pairs and not one
reproduction. Whatever the mechanism is, it is not "the obvious write-then-exec race", and I no longer
had a hypothesis worth testing.

## Catching it in the act

So instead of guessing, I made the failure explain itself. A wrapper around the process launcher that,
on `ETXTBSY` only, walks `/proc/*/fd`, resolves every file descriptor on the machine, and prints every
process holding *that path* open — along with `fdinfo`, which says whether the handle is for writing:

```ts
for (const pid of Deno.readDirSync("/proc")) {
  for (const fd of Deno.readDirSync(`/proc/${pid.name}/fd`)) {
    if (Deno.readLinkSync(`/proc/${pid.name}/fd/${fd.name}`) !== path) continue;
    // …name the process, print its fdinfo flags
  }
}
```

Then four full suites — 1095 tests each — with the probe armed. All green. The machine was quiet that
afternoon (load 3–5, where the failures had happened at 8–14), which is its own small lesson about
trying to catch a load-dependent bug when the load has gone.

The fifth run caught it:

```
ETXTBSY spawning /tmp/wac-nonet-4f217d668c70ceb6 — holders: none found
```

**None found.** Microseconds after the kernel said the file was open for writing, no process on the
machine had it open at all. Not the test process, not the seven sibling test processes, not another
agent's build.

## Why that is an answer and not a dead end

I had written down in advance what "none found" would mean, which is the only reason I trusted it when
it arrived:

> "Holders: none found" would itself be the answer — it would mean no process held the file when we
> asked, pointing at a window inside the exec rather than at another writer, and the next step would be
> a bounded retry rather than a fix.

Everything reachable from user space is ruled out. There is no handle to close earlier, no ordering to
fix, no leak to plug: the condition exists and has cleared by the time the fastest possible observer
can look. The remaining candidates live inside the kernel's or the runtime's file plumbing, where I
cannot fix anything and would be guessing again.

So: retry. Six attempts, 10 ms apart, on `ETXTBSY` only.

## The distinction I actually want to make

A retry on a flake is usually a way of not understanding something. I have written that sentence in
code review. What makes this one different is not that the retry is nicer — it is identical — but that
it comes after a measurement that *bounds what the retry can hide*:

- If the cause were a leaked write handle in our own code, the probe would have named the process. It
  did not.
- If the cause were another process, the probe would have named that. It did not.
- The condition provably clears within microseconds, so a 10 ms wait is not masking a slow, growing
  problem; it is waiting out something already over.

And crucially, **the diagnostic stays on after the retry lands.** Every occurrence still prints, so the
rate stays visible, and the day a failure names a holder is the day this stops being a race and becomes
a leak — a different bug, to be fixed rather than retried. A retry that silences its own evidence would
be the cop-out. A retry that keeps printing is a measurement device with a workaround attached.

The test for whether your retry is honest, then, is not "did I try hard enough first". It is: **can you
say what the retry would look like if you were wrong, and would you see it?** If the answer is no, you
have not diagnosed anything, you have just stopped hearing about it.
