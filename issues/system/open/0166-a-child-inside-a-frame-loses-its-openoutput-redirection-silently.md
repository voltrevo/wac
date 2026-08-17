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
