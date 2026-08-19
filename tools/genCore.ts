// `core`, from one source tree into the two compilers that embed it — `design/lang/0009` D3 step 2.
//
//     deno task gen:core           # write both embeddings
//     deno task gen:core --check   # fail if either is out of step
//
// ## Why a generator rather than a shared file
//
// **Neither compiler can read `core` at runtime.** The reference is bundled into the playground and
// has to reach a browser with no filesystem; wacc's copy lives inside a wasm module. So both keep a
// literal, and de-duplicating means generating both from one tree rather than teaching either to
// open a file.
//
// **The two embeddings are not the same text, and should not be.** The reference has no JSX
// frontend, so it gets `Read` alone; wacc gets `Read`, `Attr` and `Node`. That is a documented
// omission — `compiler/README.md` carries the row — and a generator writing one text into both
// would delete it.
//
// ## How the omission is expressed
//
// **By which file a declaration is in.** `core/read.wac` goes to both; `core/jsx.wac` goes to wacc
// only, and the two lists are the constants below. The alternative was a marker inside one shared
// file — `// @wacc-only` or similar — which is a third thing to invent, to parse, and to keep true,
// for a distinction the directory already draws. D3 makes `core` an embedded source *tree*
// regardless, so this is on that path rather than beside it.
//
// ## One thing this changes on purpose
//
// wacc's copy was written without the comments — 239 characters against the reference's 1077 — as a
// hand-maintenance economy. Generating both from one tree gives them back. That is about 800 bytes
// in a 777 KB seed and nothing else: comments do not survive the lexer, so the emitted module is
// unchanged, and the first `deno task seed` after this moves the seed's bytes once and then settles.

const READ = "core/read.wac";
const JSX = "core/jsx.wac";

/**
 * The **root** of the tree: what `import … from core;` gets, concatenated.
 *
 * `read.wac` and `jsx.wac` are two files only so the wacc-only omission has somewhere to live —
 * together they are one module. `design/lang/0009` settles what `"core"` names: a root module with
 * siblings, neither reachable through the other, which is what D4's own example shows when it
 * fetches `Option` by path *because* it is not in `"core"`.
 */
const REFERENCE_ROOT = [READ];
/** The same root for wacc, which does have a JSX frontend. */
const WACC_ROOT = [READ, JSX];

/**
 * The siblings: files in the tree that are named by path and are *not* part of the root.
 *
 * Both compilers get all of these — the omission the two lists above express is about the root, not
 * about the tree. A sibling costs nothing until something imports it, because each is its own module.
 */
const SIBLINGS = ["core/option.wac", "core/result.wac", "core/hash.wac", "core/map.wac", "core/vec.wac"];

/**
 * `std` — the capability half of the built-ins, `design/lang/0009` D4.
 *
 * **One file, and D4 is what says so**: `std` is "`Core`, `Cli`, filesystem, network, processes,
 * environment, terminal, clocks, randomness, page", which is `platform.wac` and names nothing else.
 * `frame.wac` and `stream.wac` sit next to it in `packages/platform` and are *not* in it — they are
 * library code written over the capabilities rather than capabilities, and they stay a package.
 *
 * That distinction is also the one the mechanism can enforce. **A built-in cannot import a package**,
 * because the compiler carries its text and there is no `../../bytes/src/buf.wac` inside a wasm
 * module. `platform.wac` imports `"core"` and nothing else, so it embeds exactly; both of the others
 * import `Buf` from `packages/bytes`, so neither could, whatever D4 had said.
 *
 * Siblings only, with no root module: D4's own example reaches it by path
 * (`import { Core, Cli } from "std/platform.wac";`) and there is no declaration that wants to be in
 * a `std` root. `"std"` is still reserved, so a project cannot define one and have it mean something
 * other than a built-in.
 */
const STD = ["std/platform.wac"];

/**
 * Which of those the reference compiler gets, and the answer is none of them.
 *
 * **`platform.wac` uses lambdas and the reference frontend has none.** Measured rather than assumed:
 * `compiler/wacParse.ts` gives 19 errors on it, every one cascading from the single
 * `(i32 id) => { … }` at `platform.wac:286`. So `std` is wacc-only in full — the same mechanism as
 * `core/jsx.wac` above, a file the reference does not get expressed by which list it is in, and a
 * documented omission rather than a bug (`compiler/README.md` carries the row).
 *
 * The reference refuses it **by name**, with the reason, rather than by failing to find it: "unknown
 * module" would send a reader looking for a typo in a specifier that is in fact correct.
 */
const REFERENCE_STD: string[] = [];
/** The rest of `STD`, which the reference refuses by name. Derived, so the two cannot drift. */
const REFERENCE_STD_ABSENT = STD.filter((f) => !REFERENCE_STD.includes(f));

const REF_OUT = "compiler/wacCore.ts";
const WACC_OUT = "packages/wacc/src/coretext.wac";

const read = async (paths: string[]): Promise<string> => {
  const parts: string[] = [];
  for (const p of paths) parts.push((await Deno.readTextFile(p)).replace(/\n+$/, "\n"));
  return parts.join("\n");
};

/** The text as a TypeScript template literal body. */
function asTemplate(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

/**
 * The text as a wac expression: one quoted line per source line, concatenated.
 *
 * A line each rather than one long literal, because that is what makes a diff of this generated
 * file readable — a one-line change to `core` should be a one-line change here.
 */
function asWac(text: string): string {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  const quoted = lines.map((l) =>
    `"${l.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}\\n"`
  );
  return quoted.map((q, i) => (i === 0 ? `  return ${q}` : `         + ${q}`)).join("\n") + ";";
}

const BANNER = (from: string[]) =>
  `Generated by \`deno task gen:core\` from ${from.join(", ")}. Do not edit.`;

async function referenceFile(): Promise<string> {
  return `// ${BANNER(REFERENCE_ROOT)}
//
// \`core\` — the declarations that ship inside the compiler, reached as \`import { Read } from core;\`.
// \`core/README.md\` is the argument for anything being in here at all, and the admission test a new
// declaration has to pass. This file is the reference compiler's embedding of it: no JSX frontend,
// so \`core/jsx.wac\` is not in it — \`compiler/README.md\` carries that row.

export const CORE = {
  /**
   * What core's declarations are keyed by, everywhere a file path would otherwise appear —
   * diagnostics, the program map, and the \`core$Read\` mangling. It cannot collide with a real
   * file, because every source path ends in a frontend's extension and this one does not.
   */
  key: "core",

  /**
   * Which frontend parses it. A provider names this rather than the caller inferring it, because a
   * prefixed specifier has no extension to infer from.
   */
  extension: ".wac",

  source: \`\\
${asTemplate(await read(REFERENCE_ROOT))}\`,

  /**
   * The tree's siblings, keyed by the specifier that names them.
   *
   * \`core\` is the root module above; these are files *in* the tree, each its own module, reached as
   * \`import { Option } from "core/option.wac";\`. The key is the specifier exactly as written, which
   * is what makes the reservation checkable: a resolver consults this before the filesystem, so a
   * project's own \`core/\` directory cannot shadow a built-in — \`design/lang/0009\` D4.
   */
  files: {
${(await Promise.all(SIBLINGS.map(async (f) =>
    `    ${JSON.stringify(f)}: \`\\\n${asTemplate(await read([f]))}\`,`))).join("\n")}
  } as Record<string, string>,
} as const;

/**
 * Does this specifier name a module inside the compiler rather than a file on disk?
 *
 * **Every resolver has to ask, and there are three.** \`compiler/wacResolve.ts\`'s \`importKey\` joins a
 * quoted path to the importing file's directory, \`harness/wacFiles.ts\`'s \`resolveFrom\` does the same
 * for the graph reader, and \`wacCompile\` injects the tree. A built-in that only one of them knows
 * about is a module the graph can read and the resolver cannot find — which reports as the type not
 * existing, several steps from the cause.
 *
 * The set is the tree's own keys, not the prefix \`core/\`. \`design/lang/0009\` D4 reserves the prefix,
 * and this repository keeps the tree's *source* at \`core/\` — so the literal rule makes
 * \`core/test/option_test.wac\` unreadable, a real file swallowed by the namespace it lives in.
 */
/**
 * \`std\` in the reference compiler: reserved, and empty.
 *
 * Its one file uses lambdas and this frontend has none, so there is nothing here to carry — see
 * \`REFERENCE_STD\` in \`tools/genCore.ts\` for the measurement behind that. The names are still listed,
 * because a resolver that cannot find \`std/platform.wac\` must say *why* rather than report an
 * unknown module: the specifier is correct and the compiler is the thing that is short.
 */
export const STD_ABSENT: Record<string, string> = {
${REFERENCE_STD_ABSENT.map((f) =>
  `  ${JSON.stringify(f)}: "it uses lambdas, which this compiler's frontend does not have",`).join("\n")}
};

export function isBuiltinSpecifier(spec: string): boolean {
  return spec === "core" || spec === "std" || spec in CORE.files || spec in STD_ABSENT;
}
`;
}

async function waccFile(): Promise<string> {
  return `// ${BANNER(WACC_ROOT)}
//
// wacc's embedding of \`core\`. \`core/README.md\` says why anything is in there; this file is only the
// text, kept apart from \`emit.wac\` so that a generator owns a whole file rather than splicing into
// one that is also in the seed.

export string coreSource() {
${asWac(await read(WACC_ROOT))}
}

/**
 * A sibling of the tree by the specifier that names it, or "" when there is no such file.
 *
 * \`coreSource\` above is the *root* — what \`import … from core;\` gets. These are files in the tree,
 * each its own module, reached as \`import { Option } from "core/option.wac";\`. "" rather than a trap
 * because the caller has to tell "not a built-in" from "a built-in that is broken": the first falls
 * through to the filesystem and the second is this generator's bug.
 */
export string coreFile(string path) {
${(await Promise.all(SIBLINGS.map(async (f) =>
  `  if (path == ${JSON.stringify(f)}) {\n${asWac(await read([f])).replace(/^/gm, "  ")}\n  }`
))).join("\n")}
  return "";
}

/**
 * Does this specifier name a module inside the compiler rather than a file on disk?
 *
 * The wac twin of \`isBuiltinSpecifier\` in \`compiler/wacCore.ts\`, and the two must agree: a built-in
 * one resolver knows about and the other does not is a module the graph reads and the linker cannot
 * find. Both are generated from the same list, which is the point of generating them.
 */
/**
 * A file of the \`std\` tree by the specifier that names it, or "" when there is no such file.
 *
 * The capability half of the built-ins — \`design/lang/0009\` D4. Separate from \`coreFile\` because the
 * two trees admit different things and the admission tests are different: \`core\` needs no capability
 * and \`std\` is nothing but capability. \`""\` on a miss for the same reason as \`coreFile\`.
 */
export string stdFile(string path) {
${(await Promise.all(STD.map(async (f) =>
  `  if (path == ${JSON.stringify(f)}) {\n${asWac(await read([f])).replace(/^/gm, "  ")}\n  }`
))).join("\n")}
  return "";
}

/** Every \`std\` specifier, so a caller can reserve them without guessing the list. */
export string[] stdFiles() {
  return string[](${STD.map((f) => JSON.stringify(f)).join(", ")});
}

export bool isBuiltinSpec(string spec) {
  if (spec == "core" || spec == "std") { return true; }
  return coreFile(spec) != "" || stdFile(spec) != "";
}

/** Every sibling's specifier, so a caller can reserve them without guessing the list. */
export string[] coreFiles() {
  return string[](${SIBLINGS.map((f) => JSON.stringify(f)).join(", ")});
}
`;
}

const check = Deno.args.includes("--check");
const wanted: [string, string][] = [
  [REF_OUT, await referenceFile()],
  [WACC_OUT, await waccFile()],
];

const stale: string[] = [];
for (const [path, text] of wanted) {
  const now = await Deno.readTextFile(path).catch(() => null);
  if (now === text) continue;
  if (check) {
    stale.push(now === null ? `${path} is missing` : `${path} is out of step with core/`);
    continue;
  }
  await Deno.writeTextFile(path, text);
  console.log(`wrote ${path} (${text.length} bytes)`);
}

if (check) {
  if (stale.length > 0) {
    console.error(
      `${stale.length} generated file(s) do not match \`core/\`:\n  ${stale.join("\n  ")}\n\n` +
        "Run `deno task gen:core`. Editing the embeddings by hand is what this replaces — the two " +
        "differ by design and the difference is which files each one is built from.",
    );
    Deno.exit(1);
  }
  console.log(`core/: both embeddings are in step`);
} else if (wanted.every(([p]) => p)) {
  console.log("core/: both embeddings written");
}
