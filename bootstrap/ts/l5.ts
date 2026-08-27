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
export async function flatten(entry: string, seen = new Set<string>()): Promise<string> {
  const path = await Deno.realPath(entry);
  if (seen.has(path)) return "";
  seen.add(path);
  const text = await Deno.readTextFile(path);
  const dir = path.slice(0, path.lastIndexOf("/"));
  let out = "";
  // `import { x as y }` renames a declaration for this module only, and concatenating the
  // modules loses the rename along with the import. So the alias is undone here — every
  // occurrence of `y` outside a string or a comment becomes `x`, which is what the importing
  // module meant by it. Six of these exist in the corpus and all six read like renames rather
  // than like words that could also be someone's local: `pathResolveFrom`, `coreIsBuiltinSpec`.
  const aliases = new Map<string, string>();
  for (const m of text.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;/gm)) {
    out += await flatten(`${dir}/${m[2]}`, seen);
    for (const item of m[1].split(",")) {
      const a = item.trim().match(/^(\w+)\s+as\s+(\w+)$/);
      if (a) aliases.set(a[2], a[1]);
    }
  }
  // A module may alias an import *and* declare its own thing with the original's name — the
  // whole point of `import { isBuiltinSpec as coreIsBuiltinSpec }` in files.wac is that it can
  // then export a wrapper of the same name. Undoing the alias would fuse the two into one
  // self-calling function, so this module's own declaration is renamed apart first, while the
  // two are still spelled differently.
  const renames = new Map<string, string>();
  const mod = path.slice(path.lastIndexOf("/") + 1).replace(/\.wac$/, "");
  for (const orig of aliases.values()) {
    const declared = new RegExp(
      `^\\s*(export\\s+)?(struct|enum)?\\s*[\\w<>\\[\\]?]*\\s*\\b${orig}\\b\\s*[({]`,
      "m",
    );
    if (declared.test(text)) renames.set(orig, `${orig}_${mod}`);
  }
  const rewrite = new Map([...renames, ...aliases]);
  return out + (rewrite.size === 0 ? text : unalias(text, rewrite)) + "\n";
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
