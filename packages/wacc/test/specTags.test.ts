// Every clause the spec states about **wacc only** is named by something that checks it.
//
// `compiler/wacSpec.test.ts` holds this rule for `§wac-*` tags — *"a tag is a promise that the claim
// beside it is checked, and a claim nobody checks is the same as a claim nobody wrote, except that it
// reads as evidence"* — and it can only hold it for clauses the reference implements. The clauses
// that target wacc alone (`§jsx-*` for JSX, `§wacc-*` for a rule the seed does not have) were outside
// every guard, and so were the older `§enum-*` ones: 44 clauses with nothing enforcing that any test
// named one. They are all covered today, which is the point of measuring — the number to keep is 44
// of 44, and a new clause that nothing checks makes it 44 of 45.
//
// That is the same rot one namespace over, and it arrived the moment the spec started targeting wacc
// (`design/lang/0003`). This is the other half of that rule.
//
// **Where a claim may be checked.** A spec case says which clauses it holds, in a `// spec:` header
// line beside `// from:`; a test in this package or in `compiler/` holds one by mentioning the tag.
// All three count, because the claims are of three kinds: a program's behaviour (a case), what the
// compiler does with it (`§jsx-text-is-not-wac-source` is about the lexer, and
// `packages/wacc/test/jsxLex.test.ts` asserts it), and the older `§enum-*` clauses, which both
// compilers implement and `compiler/wacSpec.test.ts` names one test at a time.

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** Every `[§tag]` in a directory's files, with the file that claimed it. */
async function tagsIn(dir: string, suffix: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const TAG = /\[§([a-z0-9-]+)\]/g;
  for await (const e of Deno.readDir(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) {
      for (const [tag, where] of await tagsIn(path, suffix)) if (!out.has(tag)) out.set(tag, where);
    } else if (e.name.endsWith(suffix)) {
      for (const m of (await Deno.readTextFile(path)).matchAll(TAG)) {
        if (!out.has(m[1])) out.set(m[1], path);
      }
    }
  }
  return out;
}

/** Every tag named by a spec case's `// spec:` header or by a test in this package. */
async function tagsNamed(): Promise<Set<string>> {
  const out = new Set<string>();
  for await (const e of Deno.readDir("spec/cases")) {
    if (!e.name.endsWith(".wac")) continue;
    const text = await Deno.readTextFile(`spec/cases/${e.name}`);
    for (const line of text.split("\n")) {
      if (!line.startsWith("// spec:")) continue;
      for (const t of line.slice("// spec:".length).trim().split(/\s+/)) {
        if (t.startsWith("§")) out.add(t.slice(1));
      }
    }
  }
  for (const dir of ["packages/wacc/test", "compiler"]) {
    for await (const e of Deno.readDir(dir)) {
      if (!e.name.endsWith(".test.ts")) continue;
      const text = await Deno.readTextFile(`${dir}/${e.name}`);
      for (const m of text.matchAll(/§([a-z0-9-]+)/g)) out.add(m[1]);
    }
  }
  return out;
}

Deno.test("every wacc-only clause in spec/ is named by a case or a test", async () => {
  const claimed = await tagsIn("spec/spec", ".md");
  // The `§wac-*` ones are the reference's to answer for, and `compiler/wacSpec.test.ts` already
  // requires a test per tag there. Asking twice would report the same gap in two places. Everything
  // else — `§jsx-*`, `§wacc-*` and the older `§enum-*` — was asked by nobody.
  const mine = [...claimed].filter(([tag]) => !tag.startsWith("wac-"));
  if (mine.length < 10) {
    throw new Error(`only ${mine.length} wacc-only tags found — did the walk resolve? (cwd is the repo root)`);
  }
  const named = await tagsNamed();
  const missing = mine.filter(([tag]) => !named.has(tag));
  console.log(`    wacc-only clauses: ${mine.length - missing.length} of ${mine.length} named by a case or a test`);
  assertEquals(
    missing.map(([tag, where]) => `${tag} — ${where}`),
    [],
    "each of these is a claim in the spec that nothing checks; add a `// spec:` line to the case " +
      "that holds it, or name the tag in the test that does",
  );
});
