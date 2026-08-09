// `f/g` where `f` is a file, against the real tools — and against ourselves on two backings.
//
// `ENOTDIR` is the failure every path can reach, because any path with a `/` in it walks components and
// a component that turns out to be a file fails this way. It had **no fault category at all**, so it
// fell to `FAULT_OTHER`, so the host's own sentence was the only information a program had:
//
//     cat f/g      ->  cat: f/g: Not a directory (os error 20)
//     mkdir f/g    ->  mkdir: cannot create directory 'f/g': Not a directory (os error 20): mkdir '/tmp/…/f/g'
//     echo y > f/g ->  sh: /tmp/…/f/g: Not a directory (os error 20)
//     ls f/g       ->  ls: cannot access 'f/g': No such file or directory
//
// An errno GNU does not print, an absolute *host* path in a world whose first claim is that a session
// cannot see the machine it runs on, and — for the three tools that go through `stat` — the wrong
// absence entirely. `FAULT_NOT_A_DIR` is the category; this file is what says it arrived.
//
// ## Why the cases are run twice
//
// Once on a **host mount**, where the fault comes from the operating system through `host/faults.ts`,
// and once in an **image**, where it comes from `packages/fs`'s own tree. Those are two entirely
// separate classifications of the same fact, and they disagreed: the memory backing had three answers
// for it — `FAULT_OTHER` in `writeFile`, `FAULT_DENIED` in `mkdir` and `FAULT_DENIED` in `rename` —
// none of them the operating system's, and `find` collapsed "a component is a file" into "not there"
// before any of them could see it. That is design/0001's arrival test in miniature: the same image, two
// backings, different answers.
//
// The host-mount half is the one comparable with GNU, so that half compares; the image half compares
// against the host-mount half, which is the only oracle it can have.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const tmp = await Deno.makeTempDir({ prefix: "wac-notdir-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const wacsh = `${tmp}/wacsh`;
const imaged = `${tmp}/imaged`;
await buildApp("packages/box/src/bin/sh.wac", wacsh, { read: true, write: true, env: true });
await buildApp("packages/box/src/bin/imaged.wac", imaged, { read: true, write: true });

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const haveBash = (() => {
  try {
    return new Deno.Command("bash", { args: ["-c", "exit 0"], stdout: "null", stderr: "null" })
      .outputSync().code === 0;
  } catch {
    return false;
  }
})();

type Run = { code: number; out: string; err: string };

/**
 * One script, in one shell, in a directory holding a file `f` and a directory `d`.
 *
 * A fresh directory per run, because several of these scripts mutate — and because a case that left `f`
 * as something else would silently stop testing `ENOTDIR` while still passing.
 */
function run(cmd: string, args: string[], script: string): Run {
  const dir = Deno.makeTempDirSync({ dir: tmp, prefix: "case-" });
  Deno.writeTextFileSync(`${dir}/f`, "hi\n");
  Deno.mkdirSync(`${dir}/d`);
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, ...args, "-c", script],
    cwd: dir,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    // `LC_ALL=C` so GNU quotes with `'` rather than the locale's typographic quotes, which is what
    // every other differential test in this repo does and what our own output uses.
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** The same script through a session sealed in a fresh image, where `packages/fs` answers instead. */
function inImage(script: string): Run {
  const image = `${tmp}/img-${crypto.randomUUID()}.wacimg`;
  // `f` and `d` made *inside* the image, so nothing about this case touches the machine.
  return run(imaged, [image], `printf 'hi\\n' > /f; mkdir /d; cd /; ${script}`);
}

/**
 * Whole lines, compared against GNU.
 *
 * Not just the reason after the last colon, which is what `sh/test/differential.test.ts` does and says
 * why: a prefix can legitimately differ in shape. Here it cannot, because the point of the exercise was
 * that ours were *invented* — `rmdir: f/g:` where GNU says `rmdir: failed to remove 'f/g':`, and `ls:
 * f/g: cannot list`, a phrase no tool prints. Comparing only the reason would have passed all of those.
 */
const CASES: string[] = [
  "cat f/g",
  "ls f/g",
  "wc -c f/g",
  "head -1 f/g",
  "rm f/g",
  "rmdir f/g",
  "mkdir f/g",
  "touch f/g",
  "stat f/g",
  // And the same tools on a path that is simply absent, so the two absences are compared side by side.
  // Every one of these printed the *same* sentence as its `f/g` neighbour before there was a category,
  // which is the whole defect: `ls nosuch` and `ls f/g` are different mistakes.
  "cat nosuch",
  "ls nosuch",
  "rm nosuch",
  "rmdir nosuch",
  "mkdir nosuch/x",
  "touch nosuch/x",
  "stat nosuch",
];

Deno.test({
  name: "`f/g` where `f` is a file says what the real tool says",
  ignore: !haveBash,
  fn: () => {
    for (const script of CASES) {
      const theirs = run("bash", [], script);
      const ours = run(wacsh, [], script);
      assertEquals(ours.err.trim(), theirs.err.trim(), script);
      assertEquals(ours.out, theirs.out, `${script}: output`);
      assertEquals(ours.code, theirs.code, `${script}: status`);
    }
  },
});

Deno.test({
  name: "`rm -f` treats it as nothing there, as GNU does",
  ignore: !haveBash,
  fn: () => {
    // GNU's `-f` is for exactly this: `rm -rf build/x/y` where `build/x` turned out to be a file should
    // be silent and successful, the same as when it is simply missing. Ours failed with a diagnostic —
    // first because `ENOTDIR` had no category, then because `Change.absent` still named only `ENOENT`.
    for (const script of ["rm -f f/g; echo st=$?", "rm -f nosuch; echo st=$?"]) {
      const theirs = run("bash", [], script);
      const ours = run(wacsh, [], script);
      assertEquals(ours.out, theirs.out, script);
      assertEquals(ours.err.trim(), theirs.err.trim(), `${script}: stderr`);
    }
  },
});

Deno.test({
  name: "`test -e f/g` is false rather than an error, as bash has it",
  ignore: !haveBash,
  fn: () => {
    // The half of the design that keeps the category safe to carry. `Stat` now reports a *fault* for
    // this, and every caller of `Stat.answered` treats a fault as "the question could not be reached" —
    // so without the exception in `answered`, `test` would have started exiting 2 with a diagnostic
    // where bash says plain false. That is the trade the old `statFault` refused the category over.
    for (const script of ["test -e f/g; echo st=$?", "test -f f/g; echo st=$?", "test -d f/g; echo st=$?"]) {
      const theirs = run("bash", [], script);
      const ours = run(wacsh, [], script);
      assertEquals(ours.out, theirs.out, script);
      assertEquals(ours.err.trim(), "", `${script}: said something bash does not`);
    }
  },
});

Deno.test({
  name: "the shell's own two — redirection and `cd` — say it without the host's path",
  ignore: !haveBash,
  fn: () => {
    // bash prefixes a builtin's failure with `bash: line N: ` and ours has no line number to give, which
    // is a deliberate difference the `cd` test in `sh/test/differential.test.ts` already strips. What is
    // compared here is everything after that.
    const strip = (t: string) => t.replace(/^\S*bash: line \d+: /gm, "").replace(/^sh: /gm, "").trim();
    for (const script of ["echo y > f/g", "cd f/g", "cd nosuch", "echo y > nosuch/x"]) {
      const theirs = run("bash", [], script);
      const ours = run(wacsh, [], script);
      assertEquals(strip(ours.err), strip(theirs.err), script);
      // And no absolute host path anywhere in it. This is the part that is not about GNU: `> f/g`
      // reported the *resolved* path, so a session sealed in an image named a directory on the machine
      // it is not supposed to be able to see.
      assertEquals(ours.err.includes(tmp), false, `${script} leaked a host path: ${ours.err}`);
    }
  },
});

Deno.test("an image answers exactly as a host mount does", () => {
  // The arrival-test half, and the one that found the three disagreeing categories in `packages/fs`.
  // The oracle is the host-mounted shell rather than GNU, because an image has no GNU to compare with —
  // and that is enough, since the case above holds the host-mounted shell to GNU.
  //
  // The paths differ by a leading `/` (the image case works at the root) so the comparison is of the
  // sentence with the operand stripped, which is where the category shows.
  const reason = (t: string) => t.trim().split("\n").map((l) => l.slice(l.indexOf(": ") + 2)).join("\n");
  for (const script of CASES) {
    const host = run(wacsh, [], script);
    const image = inImage(script);
    assertEquals(reason(image.err), reason(host.err), `${script}\n  image: ${image.err}\n  host: ${host.err}`);
    assertEquals(image.code, host.code, `${script}: status`);
  }
});

Deno.test("an image does not answer `Permission denied` for a path nothing refused", () => {
  // The single worst of the three: `mkdir f/g` in an image was `FAULT_DENIED`, so a person was told
  // they were not allowed to do something that had nothing to do with permission. It is the same
  // mistake `FAULT_UNSUPPORTED` was added for — the nearest available category blaming the file.
  for (const script of ["mkdir /f/g", "echo y > /f/g", "mv /d /f/g"]) {
    const r = inImage(script);
    assertEquals(r.err.includes("Permission denied"), false, `${script}: ${r.err}`);
    assertEquals(r.err.includes("Not a directory"), true, `${script}: ${r.err}`);
  }
});

Deno.test({
  name: "`cp` and `mv` name the operand at fault, and where they still differ it is sequencing",
  ignore: !haveBash,
  fn: () => {
    // `mv f f/g` reported `mv: f: Not a directory` — the **source**, which is a perfectly good file, for
    // a failure that is the destination's. GNU names both ends because a `rename` can fail from either.
    const moved = run(wacsh, [], "mv f f/g");
    assertEquals(moved.err.includes("'f' to 'f/g'"), true, moved.err);
    assertEquals(moved.err.trim().endsWith("Not a directory"), true, moved.err);

    // **A difference that stays, said plainly rather than tested around.** GNU's `cp f f/g` and `mv f
    // f/g` say `cannot stat 'f/g'`, because coreutils stats the destination first — it has to, to know
    // whether `f/g` is a directory to copy *into*. Neither of ours has copy-into-a-directory behaviour,
    // so neither has a reason to stat first, and printing "cannot stat" about something never stat'd
    // would be a worse kind of wrong than a different prefix. The *reason* matches; the prefix does not.
    const theirs = run("bash", [], "cp f f/g");
    const ours = run(wacsh, [], "cp f f/g");
    const reason = (t: string) => t.trim().slice(t.trim().lastIndexOf(": ") + 2);
    assertEquals(reason(ours.err), reason(theirs.err), "the reason is GNU's even where the frame is not");
    assertEquals(theirs.err.includes("cannot stat"), true, "GNU changed its wording; revisit the note above");
    assertEquals(ours.err.includes("cannot create regular file"), true, ours.err);
  },
});
