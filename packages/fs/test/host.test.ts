// The in-memory filesystem against the host's, operation for operation.
//
// The host is the oracle: whatever Deno's filesystem does to a sequence of writes, listings, renames and
// removals is what a filesystem *is*, and a memory implementation that disagrees is wrong even when its
// own tests pass. So `example/ops.wac` runs one script two ways — `ops mem` and `ops host <dir>` — and
// this compares the two transcripts.
//
// The scripts are shared bytes and nothing else: one process holds the tree in memory, the other in
// `/tmp`, and neither knows about the other. That is the same arrangement `packages/wacc` uses to compare
// two parsers, and it is why a divergence here means something.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const built = await Deno.makeTempFile({ prefix: "wac-fs-ops-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone. Nothing to report on the way out.
  }
});
await buildApp("packages/fs/example/ops.wac", built, { read: true, write: true });

/** Run a script against one backing and return its transcript. */
async function run(args: string[], script: string): Promise<string> {
  const child = new Deno.Command(built, { args, stdin: "piped", stdout: "piped", stderr: "piped" })
    .spawn();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(script));
  await w.close();
  const out = await child.output();
  const err = new TextDecoder().decode(out.stderr);
  if (err.trim().length > 0) throw new Error(`ops ${args.join(" ")}: ${err}`);
  return new TextDecoder().decode(out.stdout);
}

/**
 * The same script in memory and on a real disk.
 *
 * The host run works under a temp directory, so every path in a script is relative-looking but absolute
 * once the prefix is added — which is what `ops` does with its second argument. The memory run gets an
 * empty prefix, so `/a` really is `/a` in a filesystem that has nothing else in it.
 */
async function bothWays(name: string, script: string): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "wac-fs-host-" });
  try {
    const inMemory = await run(["mem"], script);
    const onHost = await run(["host", dir], script);
    // **A line per command, before the two are compared at all.**
    //
    // This compares two runs of *our own* program against each other, and that cannot see a fault
    // they share. It could not see the largest one: with `ops`'s `main` gutted to `return 0` — which
    // is what a mutation sweep does, and did — both runs print nothing, empty equals empty, and all
    // seven tests in this file passed against a program that does not exist. The differential this
    // file is named for was vacuous and had been for as long as it had existed.
    //
    // The anchor is cheap because the format is one line in and one line out. It does not say the
    // answers are *right* — `sameAsPinned` below does that once, against a transcript written out by
    // hand — but it does say a program ran and answered every question it was asked.
    const asked = script.split("\n").filter((l) => l.trim() !== "").length;
    for (const [which, text] of [["memory", inMemory], ["host", onHost]] as const) {
      const lines = text.split("\n").filter((l) => l !== "");
      assertEquals(
        lines.length,
        asked,
        `${name}: the ${which} run answered ${lines.length} of ${asked} commands — ` +
          `${JSON.stringify(text)}`,
      );
    }
    // The host's transcript names the temp directory nowhere — the answers are categories, sizes and
    // listings — so the two are comparable directly.
    assertEquals(inMemory, onHost, `${name}\n--- script ---\n${script}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("the transcript is what it says it is, once, written out by hand", async () => {
  // **The one place the answers are anchored to something outside this program.** Everything else
  // here is `mem` against `host`, which is our code against our code: it catches a backing that
  // disagrees with the other and nothing that both get wrong. So one script's whole transcript is
  // written out here, and it is the shape every other test is comparing.
  //
  // Chosen to cover what the categories *are* rather than to be long: absent, a write's answer, a
  // file with its size, the bytes back, a directory, and a listing.
  const script = [
    "stat /a",
    "write /a hello",
    "stat /a",
    "read /a",
    "mkdir /d",
    "stat /d",
    "ls /",
  ].join("\n");
  // Measured, not guessed: two of these were written from memory first — `stat dir 0` for a
  // directory, which has no size, and an unbracketed listing — and both were wrong. That is the
  // argument for pinning a transcript rather than trusting the shape everyone assumes it has.
  const want = [
    "stat absent",
    "write 0",
    "stat file 5",
    "read [hello]",
    "mkdir 0",
    "stat dir",
    "ls [a d]",
    "",
  ].join("\n");
  assertEquals(await run(["mem"], script), want, "the in-memory transcript");
  const dir = await Deno.makeTempDir({ prefix: "wac-fs-host-" });
  try {
    assertEquals(await run(["host", dir], script), want, "the same on a real disk");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("a file written reads back, the same way on both", async () => {
  await bothWays("files", [
    "stat /a",
    "write /a hello",
    "stat /a",
    "read /a",
    "write /a bye",
    "read /a",
    "stat /a",
  ].join("\n"));
});

Deno.test("directories, and the three faults that tell rm -f from rm", async () => {
  await bothWays("directories", [
    "mkdir /d",
    "mkdir /d",
    "stat /d",
    "write /d/f x",
    "rm /d",
    "rm /d/f",
    "rm /d",
    "rm /d",
    "rm /gone",
    "mkdir /x/y",
    "write /x/y z",
  ].join("\n"));
});

Deno.test("mkdir -p and rm -r", async () => {
  await bothWays("flags", [
    "mkdirp /a/b/c",
    "stat /a/b/c",
    "mkdirp /a/b/c",
    "write /a/b/c/f one",
    "rm /a",
    "rmr /a",
    "stat /a",
    "rmr /a",
  ].join("\n"));
});

Deno.test("a listing is the same set, in the same order", async () => {
  await bothWays("listing", [
    "write /b one",
    "write /a two",
    "mkdir /c",
    "write /c/inside three",
    "ls /",
    "ls /c",
    "ls /a",
    "ls /nope",
    "rm /a",
    "ls /",
  ].join("\n"));
});

Deno.test("rename moves a name, over an existing one if it has to", async () => {
  await bothWays("rename", [
    "mkdir /d",
    "write /a one",
    "mv /a /d/b",
    "stat /a",
    "read /d/b",
    "write /c two",
    "mv /d/b /c",
    "read /c",
    "mv /gone /x",
    "mv /c /nodir/x",
  ].join("\n"));
});

Deno.test("rename onto something that is already there, in every combination", async () => {
  // The four the memory backing had never been asked: a file onto a directory, a directory onto a file,
  // a directory onto an empty directory, and a directory onto a full one. It answered *success* to all
  // of them — replacing the entry and orphaning whatever the target held, which is a wrong answer rather
  // than a missing check, and in an image it is data loss.
  //
  // What each should be is not a decision: `rename(2)` has rules and the host follows them. Whatever
  // this transcript says on the host side is what memory has to say.
  await bothWays("rename-onto", [
    "mkdir /de",
    "mkdir /df",
    "write /df/x c",
    "write /f1 a",
    "write /f2 b",
    "mkdir /d1",
    "mv /f1 /de",          // a file onto an empty directory
    "mv /f1 /df",          // a file onto a full one
    "mv /d1 /f2",          // a directory onto a file
    "mv /d1 /df",          // a directory onto a full directory
    "mv /d1 /de",          // a directory onto an empty one, which is the only allowed pair
    "ls /",
    "ls /de",
    "ls /df",
    "read /df/x",
    "read /f1",
  ].join("\n"));
});

Deno.test("writing over a directory, and reading one", async () => {
  // Both refuse, and the *category* is what has to match: the messages are the host's own words.
  await bothWays("kinds", [
    "mkdir /d",
    "read /d",
    "write /d no",
    "stat /d",
  ].join("\n"));
});
