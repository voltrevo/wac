// The module graph, flattened — portable.
//
// wac compiles a whole program into **one** wasm module, so an import is a file to include rather
// than a boundary to cross — and resolving one is path arithmetic and a file read, neither of
// which a wac-L4 program can do. So the host does it, which is also where `files.wac` does it in
// the real compiler.
//
// **The host arrives as two methods rather than as a filesystem**, because there are four of them
// and one has no filesystem at all. `read` answers a file's text or throws; `canonical` answers a
// name two paths to the same file agree on, and a host with nothing better can answer the path
// unchanged — it only decides whether a diamond is visited once or twice.
//
// Depth first and post-order, so a file is emitted after everything it imports.

/**
 * @typedef {object} Files
 * @property {(path: string) => Promise<string>} read
 * @property {(path: string) => Promise<string>} [canonical]
 */

/**
 * @typedef {object} Mod
 * @property {string} path
 * @property {string} mod
 * @property {string} text
 * @property {Map<string, string>} aliases
 * @property {{ name: string, exported: boolean }[]} decls
 */

/**
 * **Flattening is two passes, not one.** Which of two colliding names has to be renamed cannot be
 * decided as the modules arrive: lex.wac has a private `emit` and api.wac an exported one, and
 * api.wac is the later of the two — so the answer is to rename the *earlier*, which by then has
 * already been written out. The first pass collects the modules in dependency order and the second
 * decides every rename with all of them in hand.
 *
 * @param {string} entry
 * @param {Files} files
 * @returns {Promise<string>}
 */
export async function flatten(entry, files) {
  /** @type {Mod[]} */
  const mods = [];
  await gather(entry, new Set(), mods, files);

  // Every top-level name, and which modules declare it.
  /** @type {Map<string, { mod: string, exported: boolean }[]>} */
  const owners = new Map();
  for (const m of mods) {
    m.decls = topLevelDecls(m.text);
    for (const d of m.decls) {
      const list = owners.get(d.name) ?? [];
      list.push({ mod: m.mod, exported: d.exported });
      owners.set(d.name, list);
    }
  }

  /** @type {Map<string, Map<string, string>>} */
  const renames = new Map();
  /** @param {string} mod @param {string} from @param {string} to */
  const renameIn = (mod, from, to) => {
    const m = renames.get(mod) ?? new Map();
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

/**
 * Dependency order, each module once, imports before the module that asks for them.
 *
 * @param {string} entry
 * @param {Set<string>} seen
 * @param {Mod[]} out
 * @param {Files} files
 * @returns {Promise<void>}
 */
async function gather(entry, seen, out, files) {
  const path = files.canonical === undefined ? entry : await files.canonical(entry);
  if (seen.has(path)) return;
  seen.add(path);
  const text = await files.read(path);
  const dir = path.slice(0, path.lastIndexOf("/"));

  // `import { x as y }` renames a declaration for this module only, and concatenating the
  // modules loses the rename along with the import. So the alias is undone — every occurrence
  // of `y` outside a string or a comment becomes `x`, which is what the importing module meant.
  /** @type {Map<string, string>} */
  const aliases = new Map();
  for (const m of text.matchAll(/^\s*import\s*\{([^}]*)\}\s*from\s*"([^"]+)"\s*;/gm)) {
    const from = await resolve(dir, m[2], files);
    if (from !== null) await gather(from, seen, out, files);
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

/**
 * The names a module declares at the top level, and whether each is exported. A declaration is
 * what starts at brace depth zero and reaches a `(`, a `{` or an `=` — a function, a struct, an
 * enum or a global. Comments and strings are stepped over, because a brace inside either would
 * leave the depth wrong for the rest of the file.
 *
 * @param {string} text
 * @returns {{ name: string, exported: boolean }[]}
 */
function topLevelDecls(text) {
  /** @type {{ name: string, exported: boolean }[]} */
  const out = [];
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

/**
 * `"./m.wac"` is relative to the importing file and `"core/option.wac"` is a path from a package
 * root — and nothing here knows where the root is, so it is found by walking up until the spec
 * resolves. A real compiler reads it from the manifest; this is a flattener, and the answer is
 * the same one for every layout the corpus uses.
 *
 * @param {string} dir
 * @param {string} spec
 * @param {Files} files
 * @returns {Promise<string | null>} the file to read, or `null` when the specifier names no file
 */
async function resolve(dir, spec, files) {
  if (spec.startsWith("./") || spec.startsWith("../")) return `${dir}/${spec}`;
  // **`core` and `std` name no file.** `import { Read } from "core"` — which `std/platform.wac`
  // does — asks the compiler for a type it carries itself. `isBuiltinSpec` in `coretext.wac`
  // answers true for exactly these two bare names, and `coreFile` then has no text for either,
  // so there is nothing to inline and skipping is the whole of the rule.
  //
  // The list is *these two names*, not "anything without a `.wac`". Written the looser way this
  // also dropped `lib/point.l5`, a real file with the wrong extension, and the imports fixture
  // went red — one test standing in for every corpus that does not spell things wac's way.
  //
  // Before either version it returned the path anyway and let the read fail. The failure was
  // `realpath '.../std/core'`, which reads as a broken repository rather than as a specifier
  // this did not understand, and it hid 62 corpus entry points behind an error about the
  // filesystem — a fifth of the corpus, absent from a census that never said so.
  if (spec === "core" || spec === "std") return null;
  let at = dir;
  for (let i = 0; i < 12; i++) {
    try {
      await files.read(`${at}/${spec}`);
      return `${at}/${spec}`;
    } catch { /* not this level */ }
    const up = at.slice(0, at.lastIndexOf("/"));
    if (up === "" || up === at) break;
    at = up;
  }
  // Unresolved, and the caller's error names it better than anything this could throw.
  return `${dir}/${spec}`;
}

/**
 * Identifiers only: a rename must not reach inside a string, a character literal or a comment.
 *
 * @param {string} text
 * @param {Map<string, string>} aliases
 * @returns {string}
 */
function unalias(text, aliases) {
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
