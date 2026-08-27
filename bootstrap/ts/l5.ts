// wac-L5, driven through every rung below it.
//
//   a wac program
//     -> the L5 compiler, an L4 program
//       -> the L4 compiler, an L3 program
//         -> the L3 compiler, an L2 program
//           -> the L2 compiler, an L1 program
//             -> L1, hand-written wac-L0
//               -> wac-L0, assembled, run
//
// Six languages and two interpreters, and nothing in the path that was not built here.

import { assemble } from "./assemble.ts";
import { l4ToL0 } from "./l4.ts";

const root = new URL("..", import.meta.url).pathname;
const SRC = 16777216, OUT = 4194304;

let cached: WebAssembly.Module | null = null;

export async function l5Compiler(): Promise<WebAssembly.Module> {
  if (cached === null) {
    const l0 = await l4ToL0(await Deno.readTextFile(`${root}boot/l5.l4`));
    cached = await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer);
  }
  return cached;
}

/**
 * The module graph, flattened.
 *
 * wac compiles a whole program into **one** wasm module, so an import is a file to include rather
 * than a boundary to cross — and resolving one is path arithmetic and a file read, neither of which
 * a wac-L4 program can do. So the driver does it, which is also where `files.wac` does it in the
 * real compiler.
 *
 * Depth first and post-order, so a file is emitted after everything it imports; visited once, so a
 * diamond does not duplicate a declaration.
 */
// **Flattening is two passes, not one.** Which of two colliding names has to be renamed cannot
// be decided as the modules arrive: lex.wac has a private `emit` and api.wac an exported one, and
// api.wac is the later of the two — so the answer is to rename the *earlier*, which by then has
// already been written out. So the first pass collects the modules in dependency order and the
// second decides every rename with all of them in hand.
export async function flatten(entry: string): Promise<string> {
  const mods: Mod[] = [];
  await gather(entry, new Set<string>(), mods);

  // Every top-level name, and which modules declare it.
  const owners = new Map<string, { mod: string; exported: boolean }[]>();
  for (const m of mods) {
    m.decls = topLevelDecls(m.text);
    for (const d of m.decls) {
      const list = owners.get(d.name) ?? [];
      list.push({ mod: m.mod, exported: d.exported });
      owners.set(d.name, list);
    }
  }

  const renames = new Map<string, Map<string, string>>();
  const renameIn = (mod: string, from: string, to: string) => {
    const m = renames.get(mod) ?? new Map<string, string>();
    m.set(from, to);
    renames.set(mod, m);
  };

  // A module that aliases an import *and* declares its own thing with the original's name — the
  // whole point of `import { isBuiltinSpec as coreIsBuiltinSpec }` in files.wac is that it can
  // then export a wrapper of the same name. Its own declaration is renamed apart first, while
  // the two are still spelled differently, because undoing the alias would fuse them into one
  // self-calling function.
  for (const m of mods) {
    for (const orig of m.aliases.values()) {
      if (m.decls.some((d) => d.name === orig)) renameIn(m.mod, orig, `${orig}_${m.mod}`);
    }
  }

  // Then the collisions. The keeper is the one exported, if exactly one is — nothing outside a
  // module can be referring to a private name, so renaming a private one is always safe, and
  // renaming an exported one would break whoever imports it. Two exported declarations of one
  // name is a clash a flattener cannot resolve, and is left for the assembler to report.
  for (const [name, list] of owners) {
    if (list.length < 2) continue;
    const exported = list.filter((o) => o.exported);
    if (exported.length > 1) continue;
    const keeper = exported.length === 1 ? exported[0].mod : list[0].mod;
    for (const o of list) {
      if (o.mod === keeper) continue;
      renameIn(o.mod, name, `${name}_${o.mod}`);
    }
  }

  let out = "";
  for (const m of mods) {
    const rewrite = new Map([...(renames.get(m.mod) ?? []), ...m.aliases]);
    out += (rewrite.size === 0 ? m.text : unalias(m.text, rewrite)) + "\n";
  }
  return out;
}

type Mod = {
  path: string;
  mod: string;
  text: string;
  aliases: Map<string, string>;
  decls: { name: string; exported: boolean }[];
};

// Dependency order, each module once, imports before the module that asks for them.
async function gather(entry: string, seen: Set<string>, out: Mod[]): Promise<void> {
  const path = await Deno.realPath(entry);
  if (seen.has(path)) return;
  seen.add(path);
  const text = await Deno.readTextFile(path);
  const dir = path.slice(0, path.lastIndexOf("/"));

  // `import { x as y }` renames a declaration for this module only, and concatenating the
  // modules loses the rename along with the import. So the alias is undone — every occurrence
  // of `y` outside a string or a comment becomes `x`, which is what the importing module meant.
  const aliases = new Map<string, string>();
  for (const m of text.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;/gm)) {
    await gather(await resolve(dir, m[2]), seen, out);
    for (const item of m[1].split(",")) {
      const a = item.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (a) aliases.set(a[2], a[1]);
    }
  }
  out.push({
    path,
    mod: path.slice(path.lastIndexOf("/") + 1).replace(/\.wac$/, ""),
    text,
    aliases,
    decls: [],
  });
}


// The names a module declares at the top level, and whether each is exported. A declaration is
// what starts at brace depth zero and reaches a `(`, a `{` or an `=` — a function, a struct, an
// enum or a global. Comments and strings are stepped over, because a brace inside either would
// leave the depth wrong for the rest of the file.
function topLevelDecls(text: string): { name: string; exported: boolean }[] {
  const out: { name: string; exported: boolean }[] = [];
  let depth = 0;
  let inBlockComment = false;
  for (const raw of text.split("\n")) {
    let line = "";
    for (let i = 0; i < raw.length; i++) {
      if (inBlockComment) {
        if (raw[i] === "*" && raw[i + 1] === "/") { inBlockComment = false; i++; }
        continue;
      }
      if (raw[i] === "/" && raw[i + 1] === "*") { inBlockComment = true; i++; continue; }
      if (raw[i] === "/" && raw[i + 1] === "/") break;
      if (raw[i] === '"' || raw[i] === "'") {
        const q = raw[i];
        i++;
        while (i < raw.length && raw[i] !== q) i += raw[i] === "\\" ? 2 : 1;
        line += '""';
        continue;
      }
      line += raw[i];
    }
    if (depth === 0) {
      const m = line.match(
        /^\s*(export\s+)?(?:const\s+)?(?:(?:struct|enum)\s+)?(?:[A-Za-z_][\w<>\[\]?]*\s+)?([A-Za-z_]\w*)\s*[({=]/,
      );
      if (m !== null && m[2] !== "import") out.push({ name: m[2], exported: m[1] !== undefined });
    }
    for (const c of line) {
      if (c === "{") depth++;
      if (c === "}") depth--;
    }
  }
  return out;
}

// `"./m.wac"` is relative to the importing file and `"core/option.wac"` is a path from a package
// root — and nothing here knows where the root is, so it is found by walking up until the spec
// resolves. A real compiler reads it from the manifest; this is a flattener, and the answer is
// the same one for every layout the corpus uses.
async function resolve(dir: string, spec: string): Promise<string> {
  if (spec.startsWith("./") || spec.startsWith("../")) return `${dir}/${spec}`;
  let at = dir;
  for (let i = 0; i < 12; i++) {
    try {
      await Deno.stat(`${at}/${spec}`);
      return `${at}/${spec}`;
    } catch { /* not this level */ }
    const up = at.slice(0, at.lastIndexOf("/"));
    if (up === "" || up === at) break;
    at = up;
  }
  // Unresolved, and the caller's error names it better than anything this could throw.
  return `${dir}/${spec}`;
}

// Identifiers only: a rename must not reach inside a string, a character literal or a comment.
function unalias(text: string, aliases: Map<string, string>): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const e = text.indexOf("\n", i);
      out += text.slice(i, e < 0 ? text.length : e);
      i = (e < 0 ? text.length : e) - 1;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const e = text.indexOf("*/", i + 2);
      const j = e < 0 ? text.length : e + 2;
      out += text.slice(i, j);
      i = j - 1;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c) j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < text.length && /[A-Za-z0-9_]/.test(text[j])) j++;
      const w = text.slice(i, j);
      out += aliases.get(w) ?? w;
      i = j - 1;
      continue;
    }
    out += c;
  }
  return out;
}

export async function l5RunFile(entry: string, fn = "main"): Promise<number> {
  return await l5Run(await flatten(entry), fn);
}

export async function l5ToL0(program: string): Promise<string> {
  const inst = await WebAssembly.instantiate(await l5Compiler(), {});
  const memory = inst.exports.memory as WebAssembly.Memory;
  const bytes = new TextEncoder().encode(program);
  const u8 = new Uint8Array(memory.buffer);
  u8.set(bytes, SRC);
  u8[SRC + bytes.length] = 0;
  const len = (inst.exports.compile as (s: number, o: number) => number)(SRC, OUT);
  return new TextDecoder().decode(new Uint8Array(memory.buffer, OUT, len));
}

export async function l5Run(program: string, entry = "main"): Promise<number> {
  const l0 = await l5ToL0(program);
  const mod = await WebAssembly.compile(assemble(l0).buffer as ArrayBuffer);
  const inst = await WebAssembly.instantiate(mod, {});
  return (inst.exports[entry] as () => number)();
}

if (import.meta.main) {
  const program = await flatten(Deno.args[0]);
  if (Deno.args.includes("--l0")) console.log(await l5ToL0(program));
  else console.log(await l5Run(program));
}
