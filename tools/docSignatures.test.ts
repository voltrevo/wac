// Every wac name a README quotes exists, and every signature it prints is the real one.
//
//   deno test -A tools/docSignatures.test.ts
//
// ## Why
//
// A README is the only description of a package most readers will get, and nothing checked that
// its claims about the code were still true. Two were not. `packages/gzip` printed
//
//     export i32 gunzipStream(fn[u8[]()] read, fn[bool(u8[])] write)
//
// which stopped being the signature the day `Read` replaced `u8[]` — and that replacement is the
// whole point of `Read`, since an empty `u8[]` cannot say whether the input finished or failed. The
// same README then named a `gzipBytes` that has never existed. Both were found by eye, which is not
// a method.
//
// ## The two checks, and why not a third
//
// **Signatures** in ```wac fences: an `export` line must match a declaration, parameter types
// included. Precise — there is nothing to argue about and no allowlist.
//
// **Call-shaped references** in prose: `` `name(…)` `` claims something callable exists. Also
// precise once the declaration set includes struct *fields*, because a capability is a funcref
// field rather than a function, and `outputError()` is a real thing spelled that way.
//
// A third was measured and rejected: bare backticked identifiers. 249 of them resolve to nothing,
// and nearly all are prose — `stored`, `mainnet`, `root`. A guard that cries wolf gets ignored and
// then deleted, which is the note `tools/wac/map.wac` already carries about its own `--check`.
//
// External vocabulary is listed below rather than pattern-matched away. A README that says
// `Number(s)` is naming JavaScript's, and one that says `is_valid_merkle_branch(...)` is naming the
// consensus spec's. Writing them down is what makes the rest of the check strict.
//
// Declarations come from the parser rather than a regex, for the reason `harness/wacFiles.ts`
// gives: a specifier — or here a signature — inside a comment or a string is not a declaration, and
// a regex cannot tell.

import { KEYWORDS } from "../compiler/wacLex.ts";
import { CORE } from "wac/wacCore.ts";
import { wacLex } from "wac/wacLex.ts";
import { wacParse } from "wac/wacParse.ts";
import type { Program, WacType } from "wac/wacParse.ts";
import { docTest } from "./docCheck.ts";

/** Names that belong to something other than this repo, so a README may say them freely. */
/**
 * Whether this name is JavaScript's, asked of the runtime rather than of a list.
 *
 * `Number`, `String`, `Date.UTC` and `parseFloat` are all the same case — a README explaining how the
 * compiler works naming the host function it calls — and every one of them had to be *added by hand*
 * after breaking the shared suite for whoever pushed next. Twice in two days, which is what turned a
 * list into a question: `globalThis` already knows its own members, and a `X.y` is foreign when `X` is.
 *
 * It only ever *widens* what is allowed, so the risk is a wac export that shares a name with a
 * JavaScript builtin going unchecked. There is none today, and `FOREIGN` below stays for the names no
 * runtime can answer for — a spec's, another implementation's, or one that deliberately does not exist.
 */
function isJavaScripts(name: string): boolean {
  const root = name.split(".")[0];
  const g = globalThis as unknown as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(g, root) || root in g;
}

const FOREIGN = new Set([
  // JavaScript and the host
  "Number", "String", "Buffer.from", "Date.UTC", "wacCompile", "DecompressionStream", "parseFloat",
  // Ours, but written in TypeScript, which this check does not parse — test harnesses and oracles.
  // `wacCompile` above is the same case. Listed rather than resolved because reading TS declarations
  // is a second parser for a handful of names, and the point of this file is that the wac half is
  // strict; a name here is unchecked, so keep the group small.
  "refCompress", "generate",
  // Browser APIs, named in `packages/webrtc` because the oracle there is a real browser.
  // `getStats` is `RTCPeerConnection.getStats`, whose candidate-pair statistics are what
  // `issues/system/0152` was closed with — a peer's own count of the requests it answered.
  "getStats",
  // Mathematics and cryptography, written the way the papers write it
  "e", "E", "EXP", "MAC", "O", "sqrt",
  // Ethereum's consensus and execution specs
  "hash_tree_root", "is_valid_merkle_branch", "is_valid_normalized_merkle_branch",
  "get_subtree_index", "transfer", "addr",
  // tor's own source and specification
  "get_time_period_length", "MAX",
  // Placeholders in prose: `x(…)` is any capability, `chooser()` any of several. `Box` is the
  // spec's own example generic — `struct Box<T>` appears in generics.md and nowhere in the tree.
  // `S` joined them on 2026-08-09: `packages/wacc/README.md` explains that `S()` fills a `string`
  // field with `""` rather than null, and `S` is an example struct that exists nowhere in the tree.
  // It reached master red — the prose is right and the check is right, and a one-letter example type
  // is exactly what this group is for.
  "x", "chooser", "feed", "cliFeed", "transform", "page", "Box", "S",
  // The language's own surface. These exist, but no package declares them — they are builtins the
  // compiler knows about, so there is nothing for this check to resolve them against.
  "f64.toBits", "f64.fromBits", "f32.toBits", "f32.fromBits",
  "string.fromCodepoint", "string.fromBytes", "toBytes",
  // Named because they do NOT exist: an API that was removed, or one that was never built
  "inputError", "torFetch", "XList",
  // Written by a *reader*, in an example of what their own program exports — `page` is an
  // application's browser entry point and `test_…` is a wac-written test, so neither is ours.
  "page", "test_crc32_of_hello_world",
]);

type Decls = {
  /** Every name a wac declaration introduces: functions, types, variants, fields, methods. */
  names: Set<string>;
  /** Exported function signatures, rendered the way a README would print one. */
  signatures: Map<string, string>;
};

function typeStr(t: WacType): string {
  switch (t.kind) {
    case "prim": return t.name;
    case "struct": return t.typeArgs?.length ? `${t.name}<${t.typeArgs.map(typeStr).join(", ")}>` : t.name;
    case "array": return `${typeStr(t.elem)}[]`;
    case "nullable": return `${typeStr(t.inner)}?`;
    case "funcref": return `fn[${typeStr(t.ret)}(${t.params.map(typeStr).join(", ")})]`;
  }
}

function collect(program: Program, into: Decls): void {
  for (const item of program.items) {
    if (item.tag === "func") {
      into.names.add(item.name);
      if (item.exported) {
        const params = item.params.map((p) => `${p.isConst ? "const " : ""}${typeStr(p.type)} ${p.name}`);
        into.signatures.set(item.name, `export ${typeStr(item.returnType)} ${item.name}(${params.join(", ")})`);
      }
    } else if (item.tag === "struct") {
      into.names.add(item.name);
      for (const f of item.fields) into.names.add(f.name);
      for (const m of item.methods) into.names.add(m.name);
    } else if (item.tag === "enum") {
      into.names.add(item.name);
      for (const v of item.variants) {
        into.names.add(v.name);
        for (const f of v.fields) into.names.add(f.name);
      }
      for (const m of item.methods) into.names.add(m.name);
    } else if (item.tag === "const") {
      into.names.add(item.name);
    }
  }
}

async function declarations(): Promise<Decls> {
  const out: Decls = { names: new Set(), signatures: new Map() };
  const walk = async (dir: string): Promise<void> => {
    for await (const e of Deno.readDir(dir)) {
      const path = `${dir}/${e.name}`;
      if (e.isDirectory) await walk(path);
      else if (e.name.endsWith(".wac")) {
        const { tokens } = wacLex(await Deno.readTextFile(path));
        const { program } = wacParse(tokens, path);
        collect(program, out);
      }
    }
  };
  for await (const pkg of Deno.readDir("packages")) {
    if (!pkg.isDirectory) continue;
    // `src/` only: an example or a test may name something it declares itself, and a README
    // quoting one of those is quoting the example rather than the package.
    try {
      await walk(`packages/${pkg.name}/src`);
    } catch {
      // A package with no src/ contributes nothing.
    }
  }
  // `core` is not in any package — it ships inside the compiler — but `Read`, `Data`, `End` and
  // `Failed` are named by READMEs all over this repo, and they are the most real names here.
  collect(wacParse(wacLex(CORE.source).tokens, CORE.key).program, out);
  return out;
}

/** Every package README, as path and text. */
async function readmes(): Promise<{ path: string; text: string }[]> {
  const out: { path: string; text: string }[] = [];
  for await (const pkg of Deno.readDir("packages")) {
    if (!pkg.isDirectory) continue;
    const path = `packages/${pkg.name}/README.md`;
    try {
      out.push({ path, text: await Deno.readTextFile(path) });
    } catch {
      // Not every package has one.
    }
  }
  return out;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

docTest("docs: an `export` signature in a README is the signature in the source", async () => {
  const decls = await declarations();
  const wrong: string[] = [];
  for (const { path, text } of await readmes()) {
    for (const fence of text.matchAll(/^```wac\n([\s\S]*?)^```/gm)) {
      for (const m of fence[1].matchAll(/^\s*(export\s+[^\n{;]*?\))\s*[{;]?\s*$/gm)) {
        const written = norm(m[1]);
        const name = written.match(/^export\s+\S+\s+([A-Za-z_]\w*)\s*\(/)?.[1];
        if (name === undefined) continue;             // not a function signature
        if (KEYWORDS.has(name) || FOREIGN.has(name) || isJavaScripts(name)) continue;
        const real = decls.signatures.get(name);
        const line = text.slice(0, text.indexOf(m[1])).split("\n").length;
        if (real === undefined) {
          wrong.push(`${path}:${line}: names \`${name}\`, which no package exports`);
        } else if (norm(real) !== written) {
          wrong.push(`${path}:${line}:\n      says: ${written}\n      is:   ${norm(real)}`);
        }
      }
    }
  }
  if (wrong.length) throw new Error(`${wrong.length} signature(s) a README gets wrong:\n  ${wrong.join("\n  ")}`);
});

docTest("docs: a README's `name(…)` names something that exists", async () => {
  const decls = await declarations();
  const missing: string[] = [];
  for (const { path, text } of await readmes()) {
    for (const m of text.matchAll(/`([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\([^`]*\)`/g)) {
      const written = m[1];
      const name = written.split(".").pop()!;
      // **A keyword in prose is the language being discussed, not a call.** `packages/wacc`'s README
      // says "**`null()` is not callable**" beside the same point about `7()` — both are examples of
      // invalid code, and `7()` slipped through only because it does not look like a name.
      //
      // Asked of `KEYWORDS` in the compiler's own lexer rather than listed here: the language's
      // reserved words are a fact the compiler already holds, and a second copy would be a list to
      // maintain in the same way `isJavaScripts` replaced one.
      if (KEYWORDS.has(name) || KEYWORDS.has(written)) continue;
      if (decls.names.has(name) || FOREIGN.has(name) || FOREIGN.has(written)) continue;
      // JavaScript's own, asked of the runtime — see `isJavaScripts`. This is the check that
      // `parseFloat` and `Date.UTC` reached, and the one that was being kept current by hand.
      if (isJavaScripts(name) || isJavaScripts(written)) continue;
      const line = text.slice(0, m.index!).split("\n").length;
      missing.push(`${path}:${line}: \`${written}(…)\` — no declaration, and not in FOREIGN`);
    }
  }
  if (missing.length) {
    throw new Error(
      `${missing.length} reference(s) to something that does not exist:\n  ${missing.join("\n  ")}\n\n` +
        `If the name belongs to another system — JavaScript, a spec, another implementation — add it ` +
        `to FOREIGN in this file with the group comment that says which.`,
    );
  }
});

/**
 * The capability table in `packages/platform`'s README lists **every** field of `Core`, `Cli` and
 * `Page`.
 *
 * The checks above ask whether a name the README quotes exists. This asks the other direction —
 * whether a name the *code* has reached the README — and it is the direction that rots, because
 * adding a capability is a change to `platform.wac` and the table is somewhere else.
 *
 * It is here rather than in `packages/platform` because the failure has a twin next door:
 * `packages/box`'s README lists its applets, and on 2026-08-11 that list was two names short — `id`
 * and `whoami` were dispatched, printed by `box help`, and missing from the document — while the
 * *count* in the same file had been checked against the dispatcher for days. A checked number beside
 * an unchecked list is exactly the shape that produces it. `box.test.ts` holds that one; this is the
 * other list of names a reader is entitled to treat as complete.
 */
docTest("docs: platform's capability table lists every capability", async () => {
  const src = await Deno.readTextFile("packages/platform/src/platform.wac");
  const { program } = wacParse(wacLex(src).tokens, "packages/platform/src/platform.wac");
  const readme = await Deno.readTextFile("packages/platform/README.md");
  const table = /\| \| capability \| grant \|[\s\S]*?\n\n/.exec(readme);
  if (table === null) throw new Error("platform's README has no capability table — has it been renamed?");
  const listed = new Set([...table[0].matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((m) => m[1]));

  const missing: string[] = [];
  for (const item of program.items) {
    if (item.tag !== "struct" || !["Core", "Cli", "Page"].includes(item.name)) continue;
    // A funcref field is a capability; a plain one is bookkeeping the caller never sees.
    for (const f of item.fields) {
      if (f.type.kind !== "funcref") continue;
      if (!listed.has(f.name)) missing.push(`${item.name}.${f.name}`);
    }
  }
  if (missing.length > 0) {
    throw new Error(
      `${missing.length} capability(ies) are in platform.wac and not in the README's table:\n  ` +
        missing.join("\n  ") + "\n\nAdd the row, with the grant it needs — that column is the point.",
    );
  }
});

/**
 * Every `deno task …` a *current* document names is a task that exists.
 *
 * A command in a README is a claim of the same kind as a signature: a reader types it, and either
 * it runs or the document is wrong about the repository. It rots the same way too, and faster,
 * because a task list is edited by whoever adds a task and read by everybody else.
 *
 * It had. `packages/README.md` documented `deno task wac:pin` in four places, with a page and a
 * half on when to bump the pin and a shell block telling the reader to `git -C ../wac pull` first —
 * a mechanism whose three files were deleted on 2026-08-09 when the two repositories became one.
 * Nothing failed, because nothing read the commands.
 *
 * **Documents that describe the repository as it is now**, which is what this walks: `README.md`
 * anywhere, `design/`, `spec/`, and the two files at the root. Not `issues/` and not `site/blog/` —
 * a closed issue naming `wac:pin` is a correct record of what somebody ran in July, and a check
 * that forced history to be edited every time a task was renamed would be a worse document, not a
 * better one. That is the same line `readmeFigures.test.ts` draws with its dates.
 *
 * **Inside a fenced block only**, because that is what a reader copies. Prose is where a document
 * says what a task *was* — this file's own account of `wac:pin` names it in a sentence explaining
 * that it does not exist, and a check that could not tell those apart would forbid the repository
 * from describing its own history. A placeholder is not a claim either: `deno task coverage:<pkg>`
 * names a shape rather than a task, and the pattern below only matches a literal name.
 */
docTest("docs: every `deno task` a current document names exists", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as { tasks: Record<string, string> };
  const tasks = new Set(Object.keys(config.tasks));

  const listed = new Deno.Command("git", { args: ["ls-files", "*.md"] });
  const { stdout } = await listed.output();
  const files = new TextDecoder().decode(stdout).split("\n").filter((f) =>
    f !== "" && !f.startsWith("issues/") && !f.startsWith("site/blog/") && !f.includes("node_modules")
  );
  const bad: string[] = [];
  for (const file of files) {
    const text = await Deno.readTextFile(file);
    for (const block of text.matchAll(/```[a-z]*\n([\s\S]*?)```/g)) {
      for (const m of block[1].matchAll(/deno task ([a-z][a-z0-9]*(?::[a-z][a-z0-9-]*)?)\b/g)) {
        if (!tasks.has(m[1])) bad.push(`${file}: deno task ${m[1]}`);
      }
    }
  }
  if (bad.length > 0) {
    throw new Error(
      `${bad.length} document(s) name a task that is not in deno.json:\n  ` + bad.join("\n  ") +
        "\n\nEither the task was renamed and the document was not, or the document is describing " +
        "a repository that no longer exists. Both are the reader's problem.",
    );
  }
});

/**
 * The per-package coverage tasks are listed **completely** where they are listed at all.
 *
 * The check above catches a command that does not exist. The opposite — a list that is missing one —
 * reads as complete and is worse, because there is nothing for a reader to notice. `packages/README`
 * named thirteen of the twenty `coverage:*` tasks in a block that looks exhaustive, so a reader
 * looking for `coverage:fs` would conclude `fs` had no coverage run on the day its ratchet was the
 * thing that needed running.
 */
docTest("docs: the commands block lists every coverage task", async () => {
  const config = JSON.parse(await Deno.readTextFile("deno.json")) as { tasks: Record<string, string> };
  const all = Object.keys(config.tasks).filter((t) => t.startsWith("coverage:"));
  const text = await Deno.readTextFile("packages/README.md");
  const missing = all.filter((t) => !text.includes(`deno task ${t}`));
  if (missing.length > 0) {
    throw new Error(
      `packages/README.md's command block is missing ${missing.length} coverage task(s):\n  ` +
        missing.join("\n  ") +
        "\n\nThe block reads as the complete list, so a missing one says the package has no run.",
    );
  }
});
