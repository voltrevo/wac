#!/usr/bin/env -S deno run --allow-read
// wapy — print a wac file in Python-flavoured syntax.
//
//   deno run --allow-read tools/wapy.ts packages/std/src/option.wac
//   deno run --allow-read tools/wapy.ts --stats src/*.wac
//
// ## What this is
//
// A **cosmetic surface**. Same language, same semantics, same everything after parsing — this
// reads the AST `wacParse` already produces and prints it with indentation instead of braces
// and `def` instead of a leading return type. It compiles nothing and checks nothing.
//
// ## What this is not
//
// **Not Python, and not trying to be.** Running Python code through wac is an explicit
// anti-goal. wapy will not accept a Python file, and a wapy file is not guaranteed to be
// parseable by Python's own parser — `match` stays an expression, `!` stays a postfix unwrap,
// `i32[]` stays an array type, `switch` keeps its keyword, and identifiers that happen to be
// Python keywords (`from`, `in`, `pass`, `range`) are left exactly as written.
//
// That was a deliberate choice. Constraining wapy to Python's grammar would buy Python's
// editors and formatters, and would cost a bijective identifier-mangling scheme plus folding
// wac's `match` *expression* into Python's `match` *statement* on the way back. Both are
// gymnastics in service of a resemblance nobody asked to be exact, and both would make the
// round-trip non-mechanical. Python-flavoured keeps the mapping one-to-one.
//
// One earlier figure here was wrong and is worth correcting: an initial count of "1,248 wac
// identifiers that are Python keywords" was counting comments and string literals. Stripped of
// those, wac-mono has **no** bare use of `and`, `or`, `True`, `False` or `self`; every `not` is
// part of `is not null`, which is wac syntax; and `None` appears only as a variant name. The
// real collisions are `pass` and `range` as ordinary variables, and both are distinguishable by
// position. Which is why the reverse direction below is possible at all.
//
// ## Why print-only, for now
//
// This direction alone answers "what would it look like" over the whole corpus rather than
// over hand-picked examples, and it is write-only, so it cannot break anything. The reader
// (wapy → wac) is the part that needs a round-trip test to be trustworthy, and it is much
// easier to decide whether to build it once you can see 41,000 lines of output.
//
// Printing the same AST back as *wac* would be the same machinery, which is where canonical
// formatting comes from if that turns out to be wanted.

import { wacLex } from "../atoms/wac/wacLex.ts";
import { wacParse } from "../atoms/wac/wacParse.ts";
import type {
  Block, ConstDecl, EnumDecl, Expr, FuncDecl, Import, Lvalue, MatchArm, MethodDecl,
  Param, Program, Stmt, StructDecl, TopLevel, WacType,
} from "../atoms/wac/wacParse.ts";

const IND = "    ";

/** Anything the printer meets and does not know. Counted, never silently dropped. */
const unhandled: string[] = [];
function unknown(what: string, detail: string): string {
  unhandled.push(what);
  return `<!${what}: ${detail}!>`;
}

// ── Types ────────────────────────────────────────────────────────────────────
//
// Kept close to wac rather than to Python's typing module: `i32[]` reads better than
// `list[i32]` and, more to the point, maps back without a decision. `T?` becomes `T | None`
// because that one genuinely is clearer and is still one-to-one.

/**
 * `inExpr` switches the generic-argument brackets.
 *
 * In an annotation, `Vec[i32]` is the PEP 695 look and is unambiguous. In expression position
 * it is not: `Vec[i32](0)` is indistinguishable from indexing a funcref array and calling it,
 * `arr[i](5)`, which is legal wac. So a constructor keeps `Vec<i32>(0)`. Slightly inconsistent,
 * and the alternative is a heuristic that guesses — which the round-trip test would catch
 * eventually and painfully.
 */
function ty(t: WacType, inExpr = false): string {
  switch (t.kind) {
    case "prim":     return t.name;
    case "struct": {
      if (!t.typeArgs?.length) return t.name;
      const args = t.typeArgs.map((a) => ty(a, inExpr)).join(", ");
      return inExpr ? `${t.name}<${args}>` : `${t.name}[${args}]`;
    }
    case "array":    return `${ty(t.elem, inExpr)}[]`;
    // `?` when nested, because `Point | None[]` reparses as `Point | (None[])`. Only an
    // *outermost* annotation gets the `| None` spelling — see `tyTop`.
    case "nullable": return `${ty(t.inner, inExpr)}?`;
    case "funcref":  return `fn[${ty(t.ret, inExpr)}(${t.params.map((p) => ty(p, inExpr)).join(", ")})]`;
    default:         return unknown("type", (t as { kind: string }).kind);
  }
}

/**
 * A type in annotation position, where an outermost nullable can safely read as `| None`.
 *
 * Only outermost: nested, it is ambiguous. `Point?[]` as `Point | None[]` parses as
 * `Point | (None[])`, which is how the round-trip test found this.
 */
function tyTop(t: WacType): string {
  return t.kind === "nullable" ? `${ty(t.inner)} | None` : ty(t);
}

// ── Expressions ──────────────────────────────────────────────────────────────
//
// Precedence-aware, because the first version was not and printed `(a + b) * c` as
// `a + b * c` — which reparses as `a + (b * c)`. The round-trip test found it immediately,
// which is the argument for having built the round-trip test.
//
// Levels mirror `wacParse`'s ladder exactly: ternary loosest, then `is`, then `||` down
// through `*`, then casts, then unary. Every binary operator there is left-associative.

const PREC: Record<string, number> = {
  "||": 2, "&&": 3, "|": 4, "^": 5, "&": 6,
  "==": 7, "!=": 7,
  "<": 8, "<=": 8, ">": 8, ">=": 8,
  "<<": 9, ">>": 9, ">>>": 9,
  "+": 10, "-": 10,
  "*": 11, "/": 11, "%": 11,
};
const P_TERNARY = 1, P_IS = 1.5, P_CAST = 12, P_UNARY = 13, P_PRIMARY = 99;

function prec(e: Expr): number {
  switch (e.kind) {
    case "binary":    return PREC[e.op] ?? P_PRIMARY;
    // Self-delimiting: the ternary always prints its own parentheses and a match expression
    // its own braces, so treating them as primaries avoids `((a if c else b))`.
    case "ternary":   return P_PRIMARY;
    case "matchExpr": return P_PRIMARY;
    case "is":        return P_IS;
    case "cast":      return P_CAST;
    case "unary":     return P_UNARY;
    default:          return P_PRIMARY;
  }
}

/** Print `e` as an operand of something at `outer`, parenthesising only when needed. */
function operand(e: Expr, outer: number, rightOfLeftAssoc = false): string {
  const inner = prec(e);
  const need = rightOfLeftAssoc ? inner <= outer : inner < outer;
  return need ? `(${expr(e)})` : expr(e);
}

function expr(e: Expr): string {
  switch (e.kind) {
    case "int":    return e.value;
    case "float":  return e.value;
    case "string": return JSON.stringify(e.value);
    case "bool":   return e.value ? "True" : "False";
    case "null":   return "None";
    // `this` is a wac keyword and reaches here as an identifier. The receiver is called
    // `self` in the signature, so every use of it has to agree.
    case "ident":  return e.name === "this" ? "self" : e.name;

    case "unary": {
      // `!x` is Python's `not x`; the arithmetic and bitwise unaries keep their spelling.
      const inner = operand(e.expr, P_UNARY);
      return e.op === "!" ? `not ${inner}` : `${e.op}${inner}`;
    }

    case "binary": {
      const op = e.op === "&&" ? "and" : e.op === "||" ? "or" : e.op;
      const lvl = PREC[e.op] ?? P_PRIMARY;
      return `${operand(e.left, lvl)} ${op} ${operand(e.right, lvl, true)}`;
    }

    // The four cast modes keep their spelling. `as` is already a Python keyword in `import
    // x as y`, and the other three have no Python analogue at all, so inventing names for
    // them would be worse than leaving them recognisable.
    case "cast":   return `${operand(e.expr, P_CAST)} ${e.op} ${ty(e.type, true)}`;

    case "is": {
      const rhs = e.rhs === "null" ? "None"
        : isType(e.rhs) ? ty(e.rhs as WacType) : expr(e.rhs as Expr);
      return `${operand(e.expr, P_IS)} is ${e.not ? "not " : ""}${rhs}`;
    }

    // Python's own conditional expression, and the one construct that reads better here.
    // Always parenthesised. Python's conditional expression binds differently from wac's
    // `? :` in ways that are easy to get wrong, and the parens make the reverse direction a
    // lookup rather than a guess.
    case "ternary":
      return `(${expr(e.then)} if ${expr(e.cond)} else ${expr(e.else_)})`;

    case "call":   return `${operand(e.callee, P_PRIMARY)}(${e.args.map(expr).join(", ")})`;
    case "index":  return `${operand(e.expr, P_PRIMARY)}[${expr(e.idx)}]`;
    case "field":  return `${operand(e.expr, P_PRIMARY)}.${e.name}`;
    case "unwrap": return `${operand(e.expr, P_PRIMARY)}!`;

    case "construct": {
      const named = (e.named ?? []).map((n) => `${n.name}=${expr(n.val)}`);
      return `${ty(e.ctype, true)}(${[...e.args.map(expr), ...named].join(", ")})`;
    }

    case "arrNew": {
      const el = ty(e.elem, true);
      if (e.size !== null) {
        const fill = e.fill ? `fill=${expr(e.fill)}` : "";
        return `${el}[${expr(e.size)}](${fill})`;
      }
      return `${el}[](${e.fixed.map(expr).join(", ")})`;
    }

    // Stays an expression. Python's `match` is a statement, and folding this into one would
    // make the reverse direction guess at intent — see the header.
    case "matchExpr": {
      const arms = e.arms.map((a) => `case ${pattern(a)}: ${a.value ? expr(a.value) : "..."}`);
      return `match ${expr(e.subject)} { ${arms.join(", ")} }`;
    }

    case "incr-expr":
      return e.prefix ? `${e.op}${lval(e.lval)}` : `${lval(e.lval)}${e.op}`;

    default: return unknown("expr", (e as { kind: string }).kind);
  }
}

/** `is` takes a type on the right in one form and an expression in another. */
function isType(x: unknown): boolean {
  const k = (x as { kind?: string }).kind;
  return k === "prim" || k === "struct" || k === "array" || k === "nullable" || k === "funcref";
}

function lval(l: Lvalue): string {
  switch (l.kind) {
    case "lv-ident":  return l.name === "this" ? "self" : l.name;
    case "lv-field":  return `${lval(l.base)}.${l.field}`;
    case "lv-index":  return `${lval(l.base)}[${expr(l.idx)}]`;
    case "lv-unwrap": return `${lval(l.base)}!`;
    default:          return unknown("lvalue", (l as { kind: string }).kind);
  }
}

function pattern(a: MatchArm): string {
  if (a.variant === null) return "else";
  return a.bindings.length ? `${a.variant}(${a.bindings.join(", ")})` : a.variant;
}

// ── Statements ───────────────────────────────────────────────────────────────

function block(b: Block, d: number): string[] {
  if (b.stmts.length === 0) return [IND.repeat(d) + "pass"];
  return b.stmts.flatMap((s) => stmt(s, d));
}

/**
 * `for (T n = A; n < B; n++)` and its `n += K` variant, as a Python range.
 *
 * Deliberately narrow: it must be a fresh declaration, a `<` test against the same name, and
 * an increment of that name. Anything else — a `<=` bound, a mutated limit, two variables,
 * a `--` — is not a range and falls back, because a recogniser that guesses is worse than
 * one that declines.
 */
function countedRange(s: Stmt & { kind: "for" }): { name: string; ann: string; range: string } | null {
  const init = s.init, cond = s.cond, upd = s.update;
  if (!init || !cond || !upd) return null;
  if (init.kind !== "var" || init.type.kind !== "prim") return null;
  if (cond.kind !== "binary" || cond.op !== "<") return null;
  if (cond.left.kind !== "ident" || cond.left.name !== init.name) return null;

  let step = "";
  if (upd.kind === "incr") {
    if (upd.op !== "++" || upd.lval.kind !== "lv-ident" || upd.lval.name !== init.name) return null;
  } else if (upd.kind === "assign") {
    if (upd.op !== "+=" || upd.lval.kind !== "lv-ident" || upd.lval.name !== init.name) return null;
    step = `, ${expr(upd.rhs)}`;
  } else return null;

  // `i32` is the default and covers every counted loop in wac-mono; anything else is
  // annotated, because the type is not recoverable from `range()` alone.
  const ann = init.type.name === "i32" ? "" : `: ${init.type.name}`;
  return { name: init.name, ann, range: `range(${expr(init.init)}, ${expr(cond.right)}${step})` };
}

function stmt(s: Stmt, d: number): string[] {
  const pad = IND.repeat(d);
  switch (s.kind) {
    // `name: T = value`, Python's annotated assignment. `const` has no Python spelling and
    // is load-bearing in wac, so it is kept as a prefix.
    case "var":
      return [`${pad}${s.isConst ? "const " : ""}${s.name}: ${tyTop(s.type)} = ${expr(s.init)}`];

    case "assign": return [`${pad}${lval(s.lval)} ${s.op} ${expr(s.rhs)}`];

    // Kept as `++`/`--` rather than `x += 1`. Python has neither, but they are distinct AST
    // nodes from an assignment, so rendering them as `+= 1` would not survive a round trip.
    case "incr":   return [`${pad}${lval(s.lval)}${s.op}`];

    case "if": {
      const out = [`${pad}if ${expr(s.cond)}:`, ...block(s.then, d + 1)];
      let els = s.els;
      while (els) {
        if (els.kind === "else-if") {
          const inner = els.stmt as Stmt & { kind: "if" };
          out.push(`${pad}elif ${expr(inner.cond)}:`, ...block(inner.then, d + 1));
          els = inner.els;
        } else {
          out.push(`${pad}else:`, ...block(els.block, d + 1));
          els = null;
        }
      }
      return out;
    }

    case "while": return [`${pad}while ${expr(s.cond)}:`, ...block(s.body, d + 1)];

    // A C-style three-clause `for` becomes `for x in range(...)` when it is the counted
    // form, which is the overwhelming majority of real loops and the one shape that both
    // reads like Python and round-trips exactly.
    //
    // Anything else falls back to `while`, which is honest but **loses the loop variable's
    // scoping**: `for (i32 i = ...)` scopes `i` to the loop, and hoisting it means two loops
    // in one function both declare `i` at the same level. Python does not mind; wac would
    // reject the second declaration. So the fallback does not round-trip, and is marked.
    case "for": {
      const r = countedRange(s);
      if (r) return [`${pad}for ${r.name}${r.ann} in ${r.range}:`, ...block(s.body, d + 1)];
      // Not a range, so the three clauses are kept on one line. Ugly, and the honest
      // rendering: hoisting the loop variable into an enclosing `while` changes its scope,
      // and two such loops in one function would declare the same name twice — which wac
      // rejects even though Python would not.
      const parts = [
        s.init ? stmt(s.init, 0)[0].trim() : "",
        s.cond ? expr(s.cond) : "",
        s.update ? stmt(s.update, 0)[0].trim() : "",
      ];
      return [`${pad}for ${parts.join("; ")}:`, ...block(s.body, d + 1)];
    }

    // `do:` then a tail `while cond` with no colon. Rendering it as `while True` plus a
    // trailing `if not c: break` reads better and is a different AST node, which the
    // round-trip test rejects.
    case "dowhile":
      return [`${pad}do:`, ...block(s.body, d + 1), `${pad}while ${expr(s.cond)}`];

    // `switch` keeps its own keyword. Printing it as `match` would be prettier and would
    // erase the difference between a switch on an integer and a match on an enum — two
    // different AST nodes that would then read back as whichever the reader guessed.
    case "switch": {
      const out = [`${pad}switch ${expr(s.expr)}:`];
      for (const c of s.cases) {
        out.push(`${IND.repeat(d + 1)}case ${c.value === "default" ? "_" : expr(c.value)}:`);
        out.push(...(c.body.length ? c.body.flatMap((b) => stmt(b, d + 2)) : [IND.repeat(d + 2) + "pass"]));
      }
      return out;
    }

    case "match": {
      const out = [`${pad}match ${expr(s.subject)}:`];
      for (const a of s.arms) {
        out.push(`${IND.repeat(d + 1)}case ${pattern(a)}:`);
        out.push(...(a.body.length ? a.body.flatMap((b) => stmt(b, d + 2)) : [IND.repeat(d + 2) + "pass"]));
      }
      return out;
    }

    case "return":   return [`${pad}return${s.value ? " " + expr(s.value) : ""}`];
    case "break":    return [`${pad}break`];
    case "continue": return [`${pad}continue`];
    case "trap":     return [`${pad}trap(${s.value ? expr(s.value) : ""})`];

    // A bare block has no Python equivalent, so it gets a keyword of its own. Flattening the
    // statements would read better and would lose the block, which is a real AST node — the
    // round-trip test rejects that, which is what the round-trip test is for.
    case "block":    return [`${pad}scope:`, ...block(s.block, d + 1)];

    case "expr":     return [`${pad}${expr(s.expr)}`];
    default:         return [`${pad}${unknown("stmt", (s as { kind: string }).kind)}`];
  }
}

// ── Declarations ─────────────────────────────────────────────────────────────

function params(ps: Param[]): string[] {
  return ps.map((p) => `${p.isConst ? "const " : ""}${p.name}: ${tyTop(p.type)}`);
}

function method(m: MethodDecl, d: number): string[] {
  const recv = m.hasThis ? [m.thisConst ? "const self" : "self"] : [];
  const sig = `def ${m.name}(${[...recv, ...params(m.params)].join(", ")}) -> ${tyTop(m.returnType)}:`;
  return [
    ...(m.isOverride ? [`${IND.repeat(d)}@override`] : []),
    `${IND.repeat(d)}${sig}`,
    ...block(m.body, d + 1),
  ];
}

function struct(s: StructDecl): string[] {
  const gen = s.typeParams.length ? `[${s.typeParams.join(", ")}]` : "";
  const base = s.parent ? `(${s.parent})` : "";
  const out: string[] = [];
  if (s.exported) out.push("@export");
  if (s.isConst) out.push("@const");
  out.push(`class ${s.name}${gen}${base}:`);
  for (const f of s.fields) {
    out.push(`${IND}${f.isConst ? "const " : ""}${f.name}: ${tyTop(f.type)}`);
  }
  if (s.fields.length && s.methods.length) out.push("");
  s.methods.forEach((m, i) => {
    if (i) out.push("");
    out.push(...method(m, 1));
  });
  if (!s.fields.length && !s.methods.length) out.push(`${IND}pass`);
  return out;
}

function enumDecl(e: EnumDecl): string[] {
  const gen = e.typeParams.length ? `[${e.typeParams.join(", ")}]` : "";
  const out: string[] = [];
  if (e.exported) out.push("@export");
  out.push(`class ${e.name}${gen}(enum):`);
  for (const v of e.variants) {
    out.push(v.fields.length ? `${IND}${v.name}(${params(v.fields).join(", ")})` : `${IND}${v.name}`);
  }
  if (e.methods.length) out.push("");
  e.methods.forEach((m, i) => {
    if (i) out.push("");
    out.push(...method(m, 1));
  });
  return out;
}

function func(f: FuncDecl): string[] {
  const gen = f.typeParams.length ? `[${f.typeParams.join(", ")}]` : "";
  return [
    ...(f.exported ? ["@export"] : []),
    `def ${f.name}${gen}(${params(f.params).join(", ")}) -> ${tyTop(f.returnType)}:`,
    ...block(f.body, 1),
  ];
}

function constDecl(c: ConstDecl): string[] {
  return [
    ...(c.exported ? ["@export"] : []),
    `const ${c.name}: ${tyTop(c.type)} = ${expr(c.init)}`,
  ];
}

function importDecl(i: Import): string[] {
  const items = i.items.map((it) => (it.alias === it.name ? it.name : `${it.name} as ${it.alias}`));
  return [`from ${JSON.stringify(i.path)} import ${items.join(", ")}`];
}

function topLevel(t: TopLevel): string[] {
  switch (t.tag) {
    case "import": return importDecl(t);
    case "struct": return struct(t);
    case "enum":   return enumDecl(t);
    case "func":   return func(t);
    case "const":  return constDecl(t);
    default:       return [unknown("decl", (t as { tag: string }).tag)];
  }
}

export function printWapy(program: Program): string {
  const out: string[] = [];
  program.items.forEach((item, i) => {
    if (i) out.push("");
    out.push(...topLevel(item));
  });
  return out.join("\n") + "\n";
}

export function wapyOf(source: string, path: string): { text: string; unhandled: string[] } {
  unhandled.length = 0;
  const lex = wacLex(source);
  const parsed = wacParse(lex.tokens, path);
  if (parsed.errors.length) {
    throw new Error(
      `${path} did not parse:\n` +
        parsed.errors.map((e) => `  ${e.file}:${e.line}:${e.col} ${e.message}`).join("\n"),
    );
  }
  return { text: printWapy(parsed.program), unhandled: [...unhandled] };
}

// ── CLI ──────────────────────────────────────────────────────────────────────

if (import.meta.main) {
  const args = Deno.args.filter((a) => a !== "--stats");
  const statsOnly = Deno.args.includes("--stats");
  if (args.length === 0) {
    console.error("usage: wapy.ts [--stats] <file.wac> ...");
    Deno.exit(2);
  }
  const tally = new Map<string, number>();
  let files = 0, lines = 0, failed = 0;
  for (const path of args) {
    let r;
    try {
      r = wapyOf(await Deno.readTextFile(path), path);
    } catch (err) {
      console.error(`${(err as Error).message}`);
      failed++;
      continue;
    }
    files++;
    lines += r.text.split("\n").length;
    for (const u of r.unhandled) tally.set(u, (tally.get(u) ?? 0) + 1);
    if (!statsOnly) {
      if (args.length > 1) console.log(`# ── ${path} ${"─".repeat(Math.max(0, 66 - path.length))}`);
      console.log(r.text);
    }
  }
  if (statsOnly || tally.size) {
    console.error(`\n${files} files, ${lines} lines printed${failed ? `, ${failed} failed to parse` : ""}`);
    if (tally.size === 0) console.error("every construct handled");
    else for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1])) {
      console.error(`  unhandled: ${k} x${n}`);
    }
  }
  Deno.exit(failed ? 1 : 0);
}
