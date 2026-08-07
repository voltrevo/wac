// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// The two tables in `src/lib/flags.wac`, checked against the two things they claim to describe.
//
// `refuseFlags` picks one of two sentences for a flag an applet does not implement, and the choice
// rests entirely on `gnuFlags`:
//
//   - a letter the real tool has → `sort: -k is not implemented`, which says *this* program is unfinished;
//   - a letter it does not      → `sort: invalid option -- 'Q'`, which says the *command* is wrong.
//
// So a letter missing from `gnuFlags` produces the one sentence this repo most wants not to say: it
// blames the caller for a flag they read in a real manual. Writing the table by hand got three of them
// wrong in exactly that direction — `tr -C`, `rm -R` and `split -C`, all of which GNU documents as the
// second alias on a line and none of which a regex anchored at the start of the line can see.
//
// Hence this file. `gnuFlags` is checked against the installed tools' own `--help`, and
// `implementedFlags` against what the applets actually read — `has(a, 'X')` in their source. Neither
// table is allowed to be a memory of what was true when it was written.
//
// The behavioural half is deliberately small: four spawns to prove the two sentences reach a caller.
// `packages/sh/test/gaps.test.ts` explains why a per-option sweep is not worth 350 processes, and the
// property it would check is the one the table check above already establishes.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const FLAGS = new URL("../src/lib/flags.wac", import.meta.url).pathname;
const APPLETS = new URL("../src/applets/", import.meta.url).pathname;
const BOX = "packages/box/src/box.wac";

/**
 * The short options a real tool documents, from its own help text.
 *
 * Both spellings on a line: `-r, -R, --recursive` documents two letters, and matching only the one at
 * the start of the line loses the second — which is how `tr -C` and `rm -R` came to be missing.
 */
async function gnuOptions(tool: string): Promise<Set<string>> {
  const r = await new Deno.Command(tool, { args: ["--help"], stdout: "piped", stderr: "piped" })
    .output().catch(() => null);
  const help = r !== null && r.success ? new TextDecoder().decode(r.stdout) : "";
  const letters = new Set<string>();
  for (const m of help.matchAll(/(?:^\s+|,\s*)-([a-zA-Z])(?=[,\s=[]|$)/gm)) letters.add(m[1]);
  return letters;
}

/** One `name == "x" || name == "y") { return "abc"; }` table, read out of the wac source. */
function tableOf(source: string, fn: string): Map<string, string> {
  const body = source.split(`export string ${fn}(string name) {`)[1]?.split("\n  return \"\";")[0];
  if (body === undefined) throw new Error(`${fn} is not in flags.wac in the shape this test reads`);
  const out = new Map<string, string>();
  for (const line of body.split("\n")) {
    const value = line.match(/return "([^"]*)";/);
    if (value === null) continue;
    for (const n of line.matchAll(/name == "([a-z0-9]+)"/g)) out.set(n[1], value[1]);
  }
  return out;
}

/** The applets `refuseFlags` checks at all, from `flagsChecked`. */
function checkedApplets(source: string): string[] {
  const body = source.split("export bool flagsChecked(string name) {")[1]?.split(";")[0] ?? "";
  return [...body.matchAll(/name == "([a-z0-9]+)"/g)].map((m) => m[1]);
}

Deno.test("gnuFlags is what the installed tools document, not what someone remembered", async () => {
  const source = await Deno.readTextFile(FLAGS);
  const table = tableOf(source, "gnuFlags");
  const missing: string[] = [];
  let checked = 0;

  for (const [name, letters] of table) {
    const documented = await gnuOptions(name);
    if (documented.size === 0) continue; // Not installed on this machine; nothing to compare against.
    checked++;
    const mine = new Set(letters);
    for (const letter of documented) {
      if (!mine.has(letter)) {
        missing.push(`${name}: -${letter} is documented by the real tool and absent from gnuFlags`);
      }
    }
  }

  // A machine with no coreutils would pass this while comparing nothing.
  assertEquals(checked > 15, true, `only ${checked} of the tools were installed — is this the right image?`);
  assertEquals(
    missing.length,
    0,
    `these would be called "invalid option", which blames the caller for a real flag:\n  ${missing.join("\n  ")}`,
  );
});

Deno.test("implementedFlags is what the applets read, not what they were meant to read", async () => {
  const source = await Deno.readTextFile(FLAGS);
  const table = tableOf(source, "implementedFlags");
  const wrong: string[] = [];

  for (const name of checkedApplets(source)) {
    const file = `${APPLETS}${name}.wac`;
    const text = await Deno.readTextFile(file).catch(() => null);
    if (text === null) continue; // Dispatched from somewhere other than one file per applet.
    const read = new Set<string>();
    // `flagValue(a, 'd')` is the other way an applet reads a flag — `cut` takes both of its that way,
    // and counting only `has` would have called them unimplemented and refused them.
    for (const m of text.matchAll(/(?:has|flagValue)\(a, '(.)'\)/g)) read.add(m[1]);
    const claimed = new Set(table.get(name) ?? "");
    // `acceptedFlags` is the deliberate exception — a letter accepted because ignoring it is what the
    // real tool does too — so it is excused from "the applet must read it" and nothing else.
    for (const letter of tableOf(source, "acceptedFlags").get(name) ?? "") claimed.delete(letter);

    for (const letter of read) {
      if (!claimed.has(letter)) {
        wrong.push(`${name}: acts on -${letter} and implementedFlags does not list it, so it is refused`);
      }
    }
    // The other direction is not symmetric: a numeric flag arrives through `Args.num` rather than
    // through `has`, so `head -n`, `fold -w` and `split -l` are claimed here and never named there.
    for (const letter of claimed) {
      if (!read.has(letter) && !text.includes("a.num") && !text.includes("a.hasNum")) {
        wrong.push(`${name}: implementedFlags claims -${letter} and the applet never reads it`);
      }
    }
  }

  assertEquals(
    wrong.length,
    0,
    `implementedFlags disagrees with the applets:\n  ${wrong.join("\n  ")}`,
  );
});

Deno.test("the two sentences reach a caller", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "wac-box-flags-" });
  try {
    await buildApp(BOX, built, { read: true });
    const box = (args: string[]) => {
      const r = new Deno.Command(built, { args, stdin: "null", stdout: "piped", stderr: "piped" })
        .outputSync();
      return { err: new TextDecoder().decode(r.stderr).trim(), code: r.code };
    };

    // A real flag this applet does not have: ours is the incomplete side, and saying so is the point.
    assertEquals(box(["sort", "-k2"]).err.split("\n")[0], "sort: -k is not implemented");
    assertEquals(box(["sort", "-k2"]).code, 1);
    // An applet that implements no flags is still checked — that is what `flagsChecked` is for.
    assertEquals(box(["nl", "-b"]).err.split("\n")[0], "nl: -b is not implemented");
    // A letter nobody has: GNU's own wording, including the line that points at the right manual.
    assertEquals(box(["sort", "-Q"]).err, "sort: invalid option -- 'Q'\nTry 'sort --help' for more information.");
    // `echo` is not a getopt program and must not be dragged into this: `echo -x` prints `-x`.
    assertEquals(box(["echo", "-x"]).err, "");
  } finally {
    await Deno.remove(built);
  }
});
