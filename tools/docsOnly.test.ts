// `tools/docsOnly.ts` — the predicate the gate asks before skipping work that reads code.
//
//     deno test -A tools/docsOnly.test.ts
//
// The interesting half is not the fence extraction, it is the **list of files whose fences something
// executes**. That list is hard-coded in `fencesAreRun`, and a hard-coded list of consumers is the
// shape this repository keeps being bitten by — so the last test here derives the consumers from the
// tree and fails if a fourth one appears.

import { fencesAreRun, wacFences } from "./docsOnly.ts";

const eq = (got: unknown, want: unknown, what: string) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`${what}: got ${g}, want ${w}`);
};

Deno.test("docsOnly: a fence is found, and prose around it is not", () => {
  const text = "words\n\n```wac\nexport i32 f() { return 1; }\n```\n\nmore words\n";
  eq(wacFences(text).trim(), "export i32 f() { return 1; }", "the fence body");
  eq(wacFences("no fences here\n"), "", "a document with none");
});

Deno.test("docsOnly: a non-wac fence is not a program", () => {
  // Issues and design notes are full of these — measurements, terminal output, tables. Treating them
  // as code would make almost every prose edit non-documentary, which is the failure that would make
  // the predicate worthless rather than wrong.
  const text = "```\n$ wac build m.wac\n8 bytes\n```\n```text\nrise 2489 MB\n```\n";
  eq(wacFences(text), "", "bare and ```text fences");
});

Deno.test("docsOnly: two fences differing anywhere compare unequal", () => {
  const a = "```wac\nexport i32 f() { return 1; }\n```\n";
  const b = "```wac\nexport i32 f() { return 2; }\n```\n";
  if (wacFences(a) === wacFences(b)) throw new Error("a one-byte change compared equal");
  // And the joiner must not let a move between fences look like no change.
  const one = "```wac\nA\nB\n```\n";
  const two = "```wac\nA\n```\n```wac\nB\n```\n";
  if (wacFences(one) === wacFences(two)) throw new Error("regrouping compared equal");
});

Deno.test("docsOnly: fences are executed in spec/ and package READMEs, and nowhere else", () => {
  eq(fencesAreRun("spec/spec/types.md"), true, "spec/spec");
  eq(fencesAreRun("spec/cli/wac.md"), true, "elsewhere under spec/");
  eq(fencesAreRun("packages/json/README.md"), true, "a package README");
  eq(fencesAreRun("issues/lang/open/0235a-written-type-arguments-parse-as-a-comparison.md"), false, "an issue");
  eq(fencesAreRun("design/lang/0011-a-call-may-name-its-type-arguments.md"), false, "a design note");
  eq(fencesAreRun("docs/development.md"), false, "docs/");
  eq(fencesAreRun("README.md"), false, "the root README");
});

Deno.test("docsOnly: nothing else in the tree consumes a ```wac fence", async () => {
  // **Derived, because the list in `fencesAreRun` is the whole risk.** If someone teaches a fourth
  // test to compile fences — from `docs/`, say — that helper would quietly answer false for it and the
  // gate would skip work that mattered. This fails instead, naming the file.
  //
  // **It did not see `tools/docsOnly.ts` until 2026-08-27**, because that file contained a stray NUL
  // and ripgrep skips binary files — so the guard was blind to the one file that defines the
  // extractor. A byte nobody could see made a search quietly narrower, which is the same failure this
  // test exists to prevent, arriving through the file the test is about.
  //
  // The search is for the *extraction idiom*, not for the string: `packages/wacc/src/coretext.wac`
  // contains ```` ```wac ```` a dozen times because it embeds `std/` and `core/`'s doc comments as
  // string literals, and it parses nothing. Searching for the text found it and two false friends;
  // searching for `matchAll(/^\`\`\`wac` and `indexOf("\`\`\`wac` finds the three that read fences
  // and nothing else.
  const known = new Map([
    ["packages/wacc/test/wac/specfences_test.wac", "compiles every fence in spec/spec that checks clean"],
    ["tools/docSignatures.test.ts", "matches export lines in packages/*/README.md"],
    ["compiler/wacSpec.test.ts", "runs spec/**'s fences against the reference"],
    ["tools/docsOnly.ts", "defines wacFences, the extractor this predicate is built on"],
    ["tools/docsOnly.test.ts", "this file, which contains the search pattern itself"],
  ]);
  const r = await new Deno.Command("rg", {
    args: [
      "-l",
      "-e",
      'matchAll\\(/\\^```wac',
      "-e",
      'indexOf\\("```wac',
      "--glob",
      "*.ts",
      "--glob",
      "*.wac",
      "tools",
      "compiler",
      "packages",
      "harness",
      "site",
    ],
    stdout: "piped",
    stderr: "null",
  }).output();
  const found = new TextDecoder().decode(r.stdout).split("\n").map((s) => s.trim()).filter(Boolean);
  // A floor: if the search stops matching, every assertion here passes by finding nothing.
  if (found.length < 3) {
    throw new Error(`only ${found.length} fence consumers found; the search has stopped matching`);
  }
  const strangers = found.filter((f) => !known.has(f));
  if (strangers.length > 0) {
    throw new Error(
      `a file parses \`\`\`wac fences and \`fencesAreRun\` does not know about it: ${strangers.join(", ")}\n` +
        `  If it executes fences from a path outside spec/ or packages/*/README.md, widen fencesAreRun.\n` +
        `  If it does not, add it to \`known\` here with a note saying why.`,
    );
  }
});
