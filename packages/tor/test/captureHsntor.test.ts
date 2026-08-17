// The two capture tools produce the same file, and it is the file that is committed.
//
// `capture-hsntor.py` and `capture-hsntor.wac` are one recipe written twice — the Python is what
// produced `test/data/hsntor_vectors.json`, and the wac is the port that `Cli.exec` made possible
// (`issues/system/0165`). A port that agreed about every *value* while formatting them differently
// would be useless for the only consumer these tools have, which is git: the point of a capture tool
// is that re-running it produces no diff, so the layout, the key order, the hex case and the
// trailing newline are all part of the answer.
//
// So the comparison here is `cmp`, not a parse-and-compare. Two derivations of one file have to
// agree byte for byte or one of them will surprise whoever reruns it.
//
// **Both are also compared against the committed vectors**, which is what makes this more than the
// two tools agreeing with each other. Two implementations of one mistake agree perfectly.
//
// ## When it does not run
//
// It needs tor's `test-hs-ntor-cl`, built by `tools/tor.sh`, and openssl. Neither is here by
// default, so this skips — loudly, naming what was missing, following `nativeBinary()` in
// `packages/platform/test/native.test.ts`. A skip that says nothing is how a differential quietly
// stops being one.

import { ROOT } from "../../../harness/programs.ts";

const VECTORS = `${ROOT}/packages/tor/test/data/hsntor_vectors.json`;
const WAC_TOOL = "packages/tor/tools/capture-hsntor.wac";
const PY_TOOL = "packages/tor/tools/capture-hsntor.py";
const WAC_BIN = `${ROOT}/native/v8/target/release/wac`;

/** The path `capture-hsntor` will look for, so the skip can name the real reason. */
function torProg(): string {
  const set = Deno.env.get("TOR_HS_NTOR_CL");
  if (set !== undefined) return set;
  const home = Deno.env.get("HOME") ?? "/root";
  return `${home}/tor-build/torproject-tor-c8d2b17/src/test/test-hs-ntor-cl`;
}

function present(path: string): boolean {
  try {
    return Deno.statSync(path).isFile;
  } catch {
    return false;
  }
}

async function run(cmd: string, args: string[]): Promise<Uint8Array> {
  const r = await new Deno.Command(cmd, { args, cwd: ROOT, stdout: "piped", stderr: "piped" })
    .output();
  if (r.code !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${r.code}: ${new TextDecoder().decode(r.stderr)}`);
  }
  return r.stdout;
}

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Where the two byte strings first differ, as a line number and the two lines. */
function firstDifference(a: Uint8Array, b: Uint8Array): string {
  const d = new TextDecoder();
  const la = d.decode(a).split("\n");
  const lb = d.decode(b).split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      return `line ${i + 1}:\n  one: ${JSON.stringify(la[i])}\n  two: ${JSON.stringify(lb[i])}`;
    }
  }
  return `no line differs, but the lengths do: ${a.length} and ${b.length}`;
}

Deno.test("the wac and Python capture tools write the same vectors, and they are the committed ones", async () => {
  const prog = torProg();
  if (!present(prog)) {
    console.warn(
      `SKIPPING: tor's test-hs-ntor-cl is not at ${prog}.\n` +
        `  Build it with \`make src/test/test-hs-ntor-cl\` in tor's tree, or set TOR_HS_NTOR_CL.`,
    );
    return;
  }
  if (!present(WAC_BIN)) {
    console.warn(`SKIPPING: no wac binary at ${WAC_BIN} — build it with \`deno task seed\`.`);
    return;
  }

  const committed = await Deno.readFile(VECTORS);

  const fromWac = await run(WAC_BIN, ["run", "--allow-read", "--allow-env", "--allow-run", WAC_TOOL]);
  const fromPy = await run("python3", [PY_TOOL]);

  // Against the committed file first. If both tools have drifted the same way, the two-tool
  // comparison below would pass and say nothing.
  if (!same(fromWac, committed)) {
    throw new Error(`the wac tool no longer writes the committed vectors — ${firstDifference(fromWac, committed)}`);
  }
  if (!same(fromPy, committed)) {
    throw new Error(`the Python tool no longer writes the committed vectors — ${firstDifference(fromPy, committed)}`);
  }
  if (!same(fromWac, fromPy)) {
    throw new Error(`the two tools disagree — ${firstDifference(fromWac, fromPy)}`);
  }

  // A floor, so a run that produced nothing at all cannot pass all three comparisons by being
  // equally empty everywhere.
  if (committed.length < 1000) throw new Error(`the vectors are ${committed.length} bytes — did they load?`);
});
