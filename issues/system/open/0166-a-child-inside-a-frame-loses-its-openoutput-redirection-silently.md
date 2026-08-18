# 0166 — a child inside a frame loses its `openOutput` redirection, and is told it worked

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer — a file that is never written, from a program that reports success

## Reproduction

```wac
export i32 main(Core core, Cli cli) {
  string dir = string.fromBytes(cli.arg(0).wait());

  cli.pushChild(string[]("kid"), u8[0](), dir, false).wait();
  Change opened = cli.openOutput("out.txt").wait();   // the child says: my output is a file now
  bool wrote = cli.write("hello\n".toBytes());
  cli.openOutput("").wait();
  Captured got = cli.popChild().wait();

  core.log("openOutput ok?  " + (opened.ok() ? "yes" : "no"));
  core.log("write said      " + (wrote ? "true" : "false"));
  core.log("captured bytes   " + itoa(got.out.len()));
  FileResult inDir = cli.readFile(dir + "/out.txt").wait();
  core.log("in child cwd     " + (inDir.ok ? itoa(inDir.bytes.len()) + " bytes" : "no such file"));
  FileResult here = cli.readFile("out.txt").wait();
  core.log("in process cwd   " + (here.ok ? itoa(here.bytes.len()) + " bytes" : "no such file"));
  return 0;
}
```

Both hosts, run from a clean directory with the child's `cwd` set to a temporary one:

|                        | Deno host (`host/deno.ts`) | native host (`native/v8`) |
|------------------------|----------------------------|---------------------------|
| `openOutput` answers   | ok                         | ok                        |
| `write` answers        | true                       | true                      |
| the six bytes go to    | the capture                | the capture               |
| the file is created    | in the child's `cwd`       | in the **process's** cwd  |
| and holds              | 0 bytes                    | 0 bytes                   |

Expected: the six bytes in `out.txt`, since that is what `openOutput` means and it answered `ok`.
Actual: they are in the capture, the file is created and truncated and then never written, and every
answer along the way says the redirection worked. A file that existed before is emptied.

**The last row is a second defect, in the native host only.** `pushChild`'s contract says that between
it and `popChild` "every path is taken relative to `cwd`", and native's `OPEN_OUTPUT` does not: the
file lands beside the *process* instead of beside the child. It was found because the probe left an
`out.txt` in the repository root. Whoever fixes the first defect has to fix this one too, or the bytes
will start arriving in the wrong file rather than in no file.

## Why

`deno.ts`'s `WRITE_STDOUT` asks `kids.active` before it looks at `sink`:

```ts
[OP.WRITE_STDOUT]: async (p) => {
  if (kids.active) {
    if (!kids.write(p)) throw new Error("the child's output buffer is full");
    return EMPTY;
  }
  // openOutput's file first, and the caller's write second …
```

So inside a frame the sink is unreachable. `OPEN_OUTPUT` still opens and truncates the file, which is
why the failure is silent in both directions. `browser.ts` has the same order, and the native host
reaches the same outcome by its own route.

The order itself is deliberate for the *caller's* `write` option — the comment above it is about
wac-mono 0070, where a spawned child's redirection was lost — and a child's own `openOutput` was
simply never considered.

## Who this reaches

Applets that redirect their own output, running in a shell that cannot spawn — a browser, and any
sealed session, which is exactly where the in-process route is taken:

- `packages/box/src/applets/split.wac` — every part file
- `packages/box/src/applets/wget.wac` — `wget URL out`
- `packages/box/src/lib/safe.wac` — writes a temporary file and renames it over the original, so an
  applet that edits a file in place would rename an empty temp over real content

Not seen in the Deno suite because `sh` tries `spawn` first there and an applet run as a real child
has no frame. `packages/box/test/sealed.test.ts` is the route that would show it.

## Why it is filed rather than fixed

**The answer is a decision about what `Captured` then holds**, and both spellings are defensible: a
child that redirected its output produced no standard output, so the capture should be empty — or a
frame captures everything the child wrote regardless, and `openOutput` is what a frame overrides.
`sh` streaming into `> file` (wac-mono 0070) is on the other side of the same question, and picking
wrong is a silent data-loss bug rather than a loud one.

It also has to be decided once for both host implementations and for
`packages/platform/src/frame.wac`, whose substitute capabilities reproduce today's behaviour
deliberately — `childCli` passes `openOutput` to the parent and keeps capturing, so the two agree.
Changing one and not the other would make them disagree about something neither documents, and the
differential in `packages/platform/test/frame.test.ts` would then be enforcing the bug.

Found while building the substitute capabilities for `issues/lang/0137`, by reading `WRITE_STDOUT`
to decide what the substitute should do about a sink it cannot see.

## A recommendation, with the evidence that narrows it — 2026-08-17

The open question is what `Captured` holds when the child redirected its own output, and it read as 50/50.
It is not, once you follow where the capture goes.

`packages/box/src/shrun.wac`'s `boxRun` ends with

```wac
  return Output(got.out, got.err, code, true, false);
```

— the capture *is* the applet's `Output`, and the shell prints it. That is how an in-process applet's
output reaches the terminal at all. So "a frame captures everything the child wrote regardless" means:
`split bigfile` prints every part file's contents to the terminal, `wget URL out` prints the download, and
`safe.wac` prints whatever it was about to rename into place. All three are named above as the consumers
this reaches.

The other side of the question is `sh` streaming into `> file` — wac-mono 0070 — and that is the *parent*
redirecting a *child*. Both are satisfied by one rule:

> **The innermost redirection wins.** A child's own `openOutput` takes its bytes; a frame captures what
> the child did not redirect. A parent's redirection of a child applies to whatever reaches the parent.

Which makes the capture empty in the reproduction above, and leaves 0070 as it is.

I am not treating that as decided — it is still a decision about a silent-data-loss boundary, and it has
to land in both hosts and in `packages/platform/src/frame.wac` together, with `frame.test.ts`'s
differential updated in the same commit or it will enforce the old behaviour. But the 50/50 framing in the
section above was mine and it was wrong: one of the two answers prints file contents to a terminal.

## A victim, found by moving a test in process — 2026-08-18

`split` is the one applet that redirects its own standard output: `cli.openOutput(name)` per piece, then
ordinary writes, which the host lands in the file. Inside a frame those writes are kept by the capture, so

    split -l 10 long.txt part

writes `partaa`, `partab`, `partac` **and** prints all thirty lines to standard output. Spawned, the same
applet prints nothing, which is GNU's behaviour and what `packages/box/test/behaviour-vectors.txt` records.

Reproduced with no test harness in the way:

    wac sh --allow-read --allow-write -c 'split -l 10 long.txt part'   # 30 lines
    ./built-box-sh                     -c 'split -l 10 long.txt part'  # nothing

**This is the first time it has cost anything**, because until now every sweep that covered `split`
spawned. `packages/box/test/wac/behaviour_test.wac` replays 104 applet invocations in process and skips
this one by name, with `blockedByFrame` pointing here — when this is fixed that function empties and the
replay's count assertion rises by one, which is how the fix announces itself.

It also makes the case for fixing rather than documenting: the more of the suite moves to pure wac
in-process testing, the more this gap costs, and it is invisible from the spawned side by construction.

## It is four applets, it is silent, and it reaches the browser — 2026-08-18

`split` was the first victim found. It is not the only one. Everything that writes through
`lib/safe.wac`'s streaming form takes the same path — `cp`, `sponge`, `split`, `wget` — and on the
in-process route each of them **writes an empty file and exits 0**:

    $ wac sh --allow-read --allow-write -c 'cp src copy; echo status=$?; wc -c copy'
    some bytes to copy      <- the contents, on standard output
    status=0                <- reported success
    0 copy                  <- and an empty file

    $ … 'cat src | sponge s1; wc -c s1'   ->  0 s1
    $ … 'split -l 1 src p;   wc -c paa'   ->  0 paa

The shell's *own* redirection is unaffected — `echo x > r1` writes its eleven bytes — so this is the
applets' `openOutput`, not redirection in general.

**The route this breaks is the one the website runs.** `packages/box/example/boxsh.wac` is the shell with
spawning turned off, `site/tools/site.test.ts` drives the front page's commands through it, and
`routes.test.ts` exists to say that route and the spawned one are one program. For these four applets they
are not, and the difference is a copy that silently produces nothing.

**And the sentence in `frame.wac` is wrong.** It reads:

> **`openOutput` does not escape the capture**, which is the host's behaviour too

The host's behaviour is to write the file. Measured above: spawned, `cp` copies; in process, it does not.
Whatever is decided about the fix, that clause should go, because it is the reason this was filed rather
than changed.

## What a fix has to decide

A `Frame` would need output-redirection state: `openOutput(p)` sends subsequent writes to `p` instead of
the capture, `openOutput("")` puts the capture back, and something has to flush a redirect the child never
closed. `lib/safe.wac` does close its own (`openOutput("")` on both the success and failure paths), so the
common case is covered, but "the child exited mid-redirect" needs an answer rather than an assumption.

That is a change to a platform contract, so it is written down here rather than made in passing.

