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

/**
 * One capture recipe: the two tools that implement it and the file they must both write.
 *
 * `needs` is the external thing without which neither can run — named so the skip below says what
 * is missing rather than that something was. A tool that spawns nothing has `needs: null`.
 */
type Recipe = {
  name: string;
  wac: string;
  py: string;
  vectors: string;
  needs: string | null;
  grants: string[];
};

const RECIPES: Recipe[] = [
  {
    name: "hsntor",
    wac: "packages/tor/tools/capture-hsntor.wac",
    py: "packages/tor/tools/capture-hsntor.py",
    vectors: "packages/tor/test/data/hsntor_vectors.json",
    needs: torProg(),
    grants: ["--allow-read", "--allow-env", "--allow-run"],
  },
  {
    // Spawns nothing — it reads what chutney wrote. Here because a capture recipe should not be in
    // two languages, not because `exec` unblocked it.
    name: "relaycert",
    wac: "packages/tor/tools/capture-relaycert.wac",
    py: "packages/tor/tools/capture-relaycert.py",
    vectors: "packages/tor/test/data/relaycert_vectors.json",
    needs: chutneyNodes(),
    grants: ["--allow-read", "--allow-env"],
  },
  {
    // Compiles `blind-probe.c` against tor's `libtor.a` and runs what it built, so `exec` twice
    // over. Its vectors use `indent=1`, unlike the two above.
    name: "blind",
    wac: "packages/tor/tools/capture-blind.wac",
    py: "packages/tor/tools/capture-blind.py",
    vectors: "packages/tor/test/data/blind_vectors.json",
    needs: `${Deno.env.get("HOME") ?? "/root"}/tor-build/torproject-tor-c8d2b17/libtor.a`,
    grants: ["--allow-read", "--allow-write", "--allow-env", "--allow-run"],
  },
];

const WAC_BIN = `${ROOT}/native/v8/target/release/wac`;

/** The path `capture-hsntor` will look for, so a skip can name the real reason. */
function torProg(): string {
  const set = Deno.env.get("TOR_HS_NTOR_CL");
  if (set !== undefined) return set;
  const home = Deno.env.get("HOME") ?? "/root";
  return `${home}/tor-build/torproject-tor-c8d2b17/src/test/test-hs-ntor-cl`;
}

/** chutney's nodes directory under *this* agent's workspace — the tools derive it the same way. */
function chutneyNodes(): string {
  const m = /\/(agent-[a-z0-9]+)\//.exec(ROOT);
  if (m === null) return `${Deno.env.get("HOME") ?? "/root"}/chutney/net/nodes`;
  return `${ROOT.slice(0, ROOT.indexOf(m[1]) + m[1].length)}/workspaces/chutney/net/nodes`;
}

function present(path: string): boolean {
  try {
    const s = Deno.statSync(path);
    return s.isFile || s.isDirectory;
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

for (const r of RECIPES) {
  Deno.test(`capture-${r.name}: the wac and Python tools write the same vectors, and they are the committed ones`, async () => {
    if (r.needs !== null && !present(r.needs)) {
      console.warn(`SKIPPING capture-${r.name}: ${r.needs} is not here, so neither tool can run.`);
      return;
    }
    if (!present(WAC_BIN)) {
      console.warn(`SKIPPING capture-${r.name}: no wac binary at ${WAC_BIN} — \`deno task seed\`.`);
      return;
    }

    const committed = await Deno.readFile(`${ROOT}/${r.vectors}`);
    const fromWac = await run(WAC_BIN, ["run", ...r.grants, r.wac]);
    const fromPy = await run("python3", [r.py]);

    // Against the committed file first. If both tools have drifted the same way, the two-tool
    // comparison below would pass and say nothing.
    if (!same(fromWac, committed)) {
      throw new Error(`the wac tool no longer writes ${r.vectors} — ${firstDifference(fromWac, committed)}`);
    }
    if (!same(fromPy, committed)) {
      throw new Error(`the Python tool no longer writes ${r.vectors} — ${firstDifference(fromPy, committed)}`);
    }
    if (!same(fromWac, fromPy)) {
      throw new Error(`the two ${r.name} tools disagree — ${firstDifference(fromWac, fromPy)}`);
    }

    // A floor, so a run that produced nothing at all cannot pass all three comparisons by being
    // equally empty everywhere.
    if (committed.length < 1000) {
      throw new Error(`${r.vectors} is ${committed.length} bytes — did it load?`);
    }
  });
}
