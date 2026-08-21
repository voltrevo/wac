// Reading the case corpus. See README.md for the format.
//
// Deliberately not a test: `compiler/wacCases.test.ts` checks that every case states what it wants,
// `packages/wacc/test/wac/cases_test.wac` runs the files against wacc, and neither should own the
// parsing. A third consumer — a compiler nobody has written yet — should need only this file.
//
// **The reference does not run them, deliberately**, and this sentence used to say it did.
// `wacCases.test.ts` explains why at length: asking it to run the cases made it a second
// implementation of the language and so a constraint on the language, with every lambda case needing
// a `// only: wacc` marker. The cases are run by wacc, which is the compiler the spec targets —
// `design/lang/0003`.

export type Expectation =
  | { kind: "emits" }
  | { kind: "refused" }
  | { kind: "answers"; fn: string; value: string }
  // A rule the other three cannot state: the program is legal, the module is built, and calling
  // `fn` traps. Half of what `spec/spec/casts.md` promises is of this shape — `as!` is the checked
  // cast — and so are the bounds checks and `!` on a null. A case that could only say "answers"
  // had to leave those to prose [issue 0085].
  | { kind: "traps"; fn: string };

export type Case = {
  name: string;
  why: string;
  from: string;
  expect: Expectation;
  /**
   * Which compilers this case is asked of.
   *
   * `"both"` unless the header says otherwise, and that is the answer to want: a case both meet is
   * a rule with two witnesses. `"wacc"` is for a feature the reference does not have — the spec
   * targets wacc as of design/lang/0003, so those exist on purpose now, and the runner for the
   * reference must not read them as failures.
   */
  /** Path to source, in declaration order. The entry is `main.wac`, or the only file. */
  files: [string, string][];
  entry: string;
};

const FILE_MARK = /^\/\/ ---- (\S+) ---- *$/;

/** Parse one case file. Throws rather than guessing: a case nobody can read is worse than none. */
export function parseCase(name: string, text: string): Case {
  let expect: Expectation | null = null;
  let why = "";
  let from = "";
  const files: [string, string][] = [];
  let current = "main.wac";
  let body: string[] = [];
  let started = false;

  const flush = () => {
    if (body.length > 0 || started) files.push([current, body.join("\n") + "\n"]);
    body = [];
  };

  for (const line of text.split("\n")) {
    const mark = FILE_MARK.exec(line);
    if (mark) {
      if (started) flush();
      current = mark[1];
      started = true;
      continue;
    }
    if (!started && line.startsWith("// expect:")) {
      const spec = line.slice("// expect:".length).trim();
      if (spec === "emits") expect = { kind: "emits" };
      else if (spec === "refused") expect = { kind: "refused" };
      else {
        const t = /^traps\s+(\S+)$/.exec(spec);
        if (t) { expect = { kind: "traps", fn: t[1] }; continue; }
        const m = /^answers\s+(\S+)\s*=\s*(.+)$/.exec(spec);
        if (!m) throw new Error(`${name}: cannot read expectation ${JSON.stringify(spec)}`);
        expect = { kind: "answers", fn: m[1], value: m[2].trim() };
      }
      continue;
    }
    if (!started && line.startsWith("// why:")) { why = line.slice("// why:".length).trim(); continue; }
    if (!started && line.startsWith("// from:")) { from = line.slice("// from:".length).trim(); continue; }
    body.push(line);
  }
  flush();

  if (expect === null) throw new Error(`${name}: no "// expect:" line`);
  if (why === "") throw new Error(`${name}: no "// why:" line — a case that cannot say what it is about is a puzzle`);
  if (files.length === 0) throw new Error(`${name}: no source`);

  const entry = files.length === 1 ? files[0][0] : "main.wac";
  if (!files.some(([p]) => p === entry)) throw new Error(`${name}: no ${entry} among its files`);
  return { name, why, from, expect, files, entry };
}

/** Every case, in name order, read from `spec/cases`. */
export async function loadCases(dir = "spec/cases"): Promise<Case[]> {
  const names: string[] = [];
  for await (const e of Deno.readDir(dir)) {
    if (e.isFile && e.name.endsWith(".wac")) names.push(e.name);
  }
  names.sort();
  const out: Case[] = [];
  for (const n of names) out.push(parseCase(n, await Deno.readTextFile(`${dir}/${n}`)));
  return out;
}
