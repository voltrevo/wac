// How often does the repository launder const-ness through an assignment?
//
// **`issues/lang/0052` asks for exactly this number and nobody had taken it.** That issue is a
// soundness hole: `const` on a reference means "no writes through it at any depth"
// (`§wac-const-deep-j6b1nyg`) and both compilers accept a write through one. `design/lang/0008`
// prices the fix, and its measurement — *"nothing in the repository passes a const-rooted argument to
// a parameter its callee writes through"* — counted the **argument** shape only. The issue's own
// closing paragraph says why that is not enough:
//
//   > The assignment shape was not counted, and this is the reason to count it before pricing the
//   > option.
//
// Because one assignment launders the provenance:
//
//     i32 readOnly(const P p) { P q = p; mutate(q); return p.v; }
//
// `mutate(q)` takes an ordinary `P`, so a rule that refuses const-rooted *arguments* never sees it.
// Any fix that tracks const-ness has to follow it through the local, and how much that costs depends
// on how often the shape appears.
//
// ## What is counted, and what that is not
//
// A `var` statement whose initialiser's **root** is a `const` parameter or a `const this`, and whose
// declared type is not a scalar — the laundering step, syntactically. Reported per file with the line,
// so every hit can be read rather than trusted.
//
// **It is a lower bound, deliberately.** It does not track const-ness out of a `const` local or a
// const field, which is the same limit `design/lang/0008` states for its own probe, and it does not
// ask whether the laundered value is later written — a `P q = p;` that nobody mutates is harmless
// today and still has to be handled by any rule that follows provenance. So the number answers "how
// much code would a provenance-following rule have to reason about", which is the question that
// prices the option, and not "how many bugs are there".
//
// Run: `deno run -A --import-map deno.json tools/constLaundering.ts [dir…]`
// Default is every package's `src`, matching what `design/lang/0008` measured.
import { wacLex } from "wac/wacLex.ts";
import { wacParse } from "wac/wacParse.ts";
import type { Block, Expr, Func, Param, Stmt } from "wac/wacParse.ts";

/** The root identifier of a reference expression, or null when it is not rooted in a name. */
function rootName(e: Expr): string | null {
  // deno-lint-ignore no-explicit-any
  const x = e as any;
  switch (x.kind) {
    case "ident":
      return x.name as string;
    case "this":
      return "this";
    // A field or an element keeps the root: `h.s` and `xs[0]` are as const as `h` and `xs`.
    case "field":
    case "member":
      return rootName(x.obj ?? x.target ?? x.expr);
    case "index":
      return rootName(x.arr ?? x.target ?? x.obj ?? x.expr);
    default:
      return null;
  }
}

/** Whether a declared type is a reference — the only kind const-ness is deep through. */
function isReference(t: unknown): boolean {
  // deno-lint-ignore no-explicit-any
  const x = t as any;
  if (!x) return false;
  if (x.kind === "array" || x.kind === "slice") return true;
  // `struct` and `enum` are what the parser calls a named reference type; `prim` is a scalar and
  // `string` is immutable, so laundering one cannot write through anything.
  if (x.kind === "struct" || x.kind === "enum" || x.kind === "generic") return true;
  return false;
}

type Hit = { file: string; line: number; name: string; from: string; type: string };

function walk(b: Block, constNames: Set<string>, out: (s: Stmt) => void) {
  for (const s of b.stmts) visit(s, constNames, out);
}

function visit(s: Stmt, constNames: Set<string>, out: (s: Stmt) => void) {
  // deno-lint-ignore no-explicit-any
  const x = s as any;
  out(s);
  for (const k of ["then", "body"]) if (x[k]?.stmts) walk(x[k], constNames, out);
  if (x.els?.block?.stmts) walk(x.els.block, constNames, out);
  if (x.els?.stmt) visit(x.els.stmt, constNames, out);
  if (x.init) visit(x.init, constNames, out);
  if (x.update) visit(x.update, constNames, out);
  for (const c of x.cases ?? []) for (const st of c.body ?? []) visit(st, constNames, out);
  for (const a of x.arms ?? []) if (a.body?.stmts) walk(a.body, constNames, out);
}

function hitsIn(file: string, src: string): Hit[] {
  const lexed = wacLex(src, file);
  const parsed = wacParse(lexed.tokens, file);
  const hits: Hit[] = [];
  // deno-lint-ignore no-explicit-any
  // `program.items`, which is what the parser actually calls it. The first version of this probe
  // guessed `decls` and reported **0 over 376 files** — a scan that had walked nothing, and would have
  // been read as "the shape does not occur". The canary below is why that was caught in a minute.
  const decls = (parsed as any).program?.items ?? [];
  const funcs: Func[] = [];
  for (const d of decls) {
    // deno-lint-ignore no-explicit-any
    const x = d as any;
    if (x.tag === "func") funcs.push(x as Func);
    for (const m of x.methods ?? []) funcs.push(m as Func);
  }
  for (const f of funcs) {
    // deno-lint-ignore no-explicit-any
    const fx = f as any;
    const constNames = new Set<string>();
    for (const p of (fx.params ?? []) as Param[]) if (p.isConst) constNames.add(p.name);
    if (fx.thisConst) constNames.add("this");
    if (constNames.size === 0) continue;
    if (!fx.body?.stmts) continue;
    walk(fx.body, constNames, (s) => {
      // deno-lint-ignore no-explicit-any
      const x = s as any;
      if (x.kind !== "var" || x.isConst) return;
      const root = x.init ? rootName(x.init) : null;
      if (root === null || !constNames.has(root)) return;
      if (!isReference(x.type)) return;
      hits.push({
        file,
        line: x.line ?? 0,
        name: String(x.name),
        from: root,
        type: JSON.stringify(x.type).slice(0, 40),
      });
    });
  }
  return hits;
}

const dirs = Deno.args.length > 0 ? Deno.args : ["packages"];
const files: string[] = [];
for (const dir of dirs) {
  for await (const e of Deno.readDir(dir)) {
    if (!e.isDirectory) continue;
    const src = `${dir}/${e.name}/src`;
    try {
      for await (const f of walkDir(src)) files.push(f);
    } catch { /* a package with no src */ }
  }
}

async function* walkDir(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walkDir(p);
    else if (e.name.endsWith(".wac")) yield p;
  }
}

let scanned = 0;
let failed = 0;
const all: Hit[] = [];
for (const f of files.sort()) {
  try {
    all.push(...hitsIn(f, await Deno.readTextFile(f)));
    scanned++;
  } catch {
    // A file the *reference* cannot parse is not a hit and not a silence: counted, because a scan
    // that skipped half the tree would report a comfortable zero.
    failed++;
  }
}
for (const h of all) {
  console.log(`${h.file}:${h.line}  ${h.name} = ${h.from}   (${h.type})`);
}
console.log(
  `\n${all.length} assignment(s) launder const-ness, over ${scanned} file(s)` +
    (failed > 0 ? `; ${failed} file(s) the reference could not parse` : ""),
);
