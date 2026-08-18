// The generated scripts again, under the one stdin shape a `Frame` cannot express.
//
// **The differential itself moved to wac** — `test/wac/fuzz_test.wac` — and the answers it compares
// against were captured once by `tools/wac/shfuzz.wac` into `fuzz-vectors.txt`. What ran here was four
// seeds × thirty scripts × two stdin shapes × two shells: 480 processes, 38 s, every suite run, to ask
// what bash does about scripts that are fixed by their seed and do not change between runs.
//
// What is left is the shape that found wac-mono 0113 — **standard input open and silent**, which is a
// terminal's shape. A pipeline whose first stage produces no bytes hung under it, because one condition
// could not tell an empty held input from no input at all, and a `Frame`'s standard input is a byte array
// where empty *means* end of input. So the in-process replay collapses exactly the distinction 0113 was
// about, and this spawns instead (`issues/system/0195`).
//
// Bash is not spawned here at all: its answers are the captured ones, and **they do not depend on the
// stdin shape** — measured on 2026-08-18 by running all 120 both ways, 0 differed. Nothing `script()`
// generates reads standard input, since `cat` appears only as a pipeline stage and `read` only with a
// redirection. The two shapes were never about bash; they are about ours.
// test-lane: heavy — spawns a built binary per script

// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
import { testBounded } from "../../../harness/deadline.ts";
import { loadNow } from "../../../harness/bounded.ts";

const VECTORS = new URL("./fuzz-vectors.txt", import.meta.url).pathname;

/** Where this test had got to, for the report if it never gets any further. */
let reached = "(nothing yet)";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

type Vector = { script: string; status: number; text: string };

/**
 * The captured scripts and answers.
 *
 * Read rather than regenerated, which is what let the TypeScript generator go: it lives in
 * `tools/wac/shfuzz.wac` now, and a second implementation of it here would be a second thing to keep in
 * step with the seeds. Every script this needs is in the file it is comparing against.
 */
function vectors(): { items: Vector[]; oracle: string } {
  const bytes = Deno.readFileSync(VECTORS);
  const dec = new TextDecoder();
  let at = 0;
  const line = () => {
    let end = at;
    while (end < bytes.length && bytes[end] !== 0x0a) end++;
    return { text: dec.decode(bytes.subarray(at, end)), next: end + 1 };
  };
  let oracle = "";
  for (;;) {
    const l = line();
    at = l.next;
    if (l.text.startsWith("bash: ")) oracle = l.text.slice("bash: ".length);
    if (l.text.startsWith("count: ")) break;
    if (at >= bytes.length) throw new Error(`${VECTORS}: no count in the header`);
  }
  const items: Vector[] = [];
  while (at < bytes.length) {
    const s = line();
    if (!s.text.startsWith("S ")) break;
    const slen = Number(s.text.slice(2));
    const script = dec.decode(bytes.subarray(s.next, s.next + slen));
    at = s.next + slen + 1;
    const x = line();
    at = x.next;
    const c = line();
    const clen = Number(c.text.slice(2));
    items.push({ script, status: Number(x.text.slice(2)), text: dec.decode(bytes.subarray(c.next, c.next + clen)) });
    at = c.next + clen + 1;
  }
  return { items, oracle };
}

/**
 * The prefixes a diagnostic carries, removed so two shells' messages can be compared.
 *
 * **`normalise` in `tools/wac/shfuzz.wac` is the definition** — that is what the captured side went
 * through — and this is the same two substitutions for the side that has not. Kept here rather than
 * imported because the wac is not callable from Deno; if they drift, every script fails at once and
 * loudly, which is the failure mode a copy of two regexes can afford.
 */
const normalise = (t: string) => t.replace(/(?:\S*\/)?(?:bash|environment|ba-c): line \d+: /g, "").replace(/sh: /g, "");

/** Every fixture back to its starting contents, and everything a script may have made removed. */
function reset(dir: string): void {
  Deno.writeTextFileSync(`${dir}/f`, "a\nb\nc\n");
  Deno.writeTextFileSync(`${dir}/n`, "3\n1\n2\n");
  for (const e of Deno.readDirSync(dir)) {
    if (e.name !== "f" && e.name !== "n") {
      try {
        Deno.removeSync(`${dir}/${e.name}`, { recursive: true });
      } catch {
        // Already gone.
      }
    }
  }
}

testBounded({
  name: "the generated scripts answer the same with standard input open and silent",
  onTimeout: () => console.error(`fuzz: the case did not finish (${loadNow()}). It had reached ${reached}`),
}, async () => {
  const shell = await Deno.makeTempFile({ prefix: "sh-fuzz-" });
  const dir = await Deno.makeTempDir({ prefix: "sh-fuzz-" });
  try {
    // **`packages/box`'s shell, because bash has a `cat`.** The first version of this built
    // `packages/sh/src/sh.wac`, whose "command not found" is a perfectly good answer and not bash's —
    // 35 of 120 scripts differed for that reason alone.
    await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });
    const { items, oracle } = vectors();
    assertEquals(items.length > 0, true, `${VECTORS} parsed to nothing`);

    const differed: string[] = [];
    const hung: string[] = [];
    for (const [i, v] of items.entries()) {
      reached = `script ${i + 1} of ${items.length}`;
      reset(dir);
      const child = new Deno.Command("timeout", {
        args: ["10", shell, "-c", v.script],
        cwd: dir,
        // Held open and never written to is a terminal's shape, and is what 0113 needed to appear.
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir },
        clearEnv: true,
      }).spawn();
      const r = await child.output();
      const d = new TextDecoder();
      // **A bound that fired is not a difference**, and saying so is the whole of this branch. It read as
      // one on 2026-08-10: a script came back `bash "" (0) / ours "" (124)` in a gate on a busy machine,
      // and the same script finishes instantly on an idle one. Somebody — me — then went looking for a
      // regression in `break`. `timeout` answers 124 when it had to kill, which is a status no shell here
      // returns for itself.
      if (r.code === 124) {
        hung.push(`${JSON.stringify(v.script)}\n    did not finish in 10s (${loadNow()})`);
        continue;
      }
      const got = normalise(d.decode(r.stdout) + "\n" + d.decode(r.stderr));
      if (got !== v.text || r.code !== v.status) {
        differed.push(
          `${JSON.stringify(v.script)}\n    bash ${JSON.stringify(v.text)} (${v.status})` +
            `\n    ours ${JSON.stringify(got)} (${r.code})`,
        );
      }
    }
    // Reported separately and *not* as a failure: on a loaded machine a ten-second bound says more about
    // the machine than about the shell. A script that hangs on an idle one shows up as a difference the
    // moment the bound stops being the reason.
    if (hung.length > 0) {
      console.log(`  ${hung.length} script(s) hit the bound rather than answering:\n  ${hung.join("\n  ")}`);
    }
    assertEquals(
      differed.length,
      0,
      `${differed.length} of ${items.length} script(s) differ from the captured oracle (${oracle}):\n  ` +
        differed.join("\n  "),
    );
  } finally {
    await Deno.remove(shell).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
