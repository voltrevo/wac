// The reference parser's AST, projected onto `src/print.wac`'s canonical text form.
//
// Neither side's AST is comparable to the other's directly — one is an object graph of string-bearing
// nodes, the other sum types holding token indices — so both are projected onto the same text. This
// is the reference half of that projection, and it is deliberately dumb: no cleverness, no shared
// helpers with the wac side, so an agreement means both implementations independently arrived at the
// same tree rather than that one derived from the other.
//
// Positions are included. They are part of what a parser owes its caller, and rung 3 compares
// diagnostics by position, so a divergence is much cheaper to find here.
//
// It lived in the parse differential until 2026-08-18, when the *harness* moved to wac
// (`issues/system/0161`) and this stayed: the reference is TypeScript, and a differential against it
// needs it. `test/reference.ts` is what wac asks.

import { wacLex } from "wac/wacLex.ts";
import { wacParse } from "wac/wacParse.ts";

// The reference's AST types are structural; typing this printer against them exactly would mean
// importing a dozen unexported types, so it walks with narrow local casts.
// deno-lint-ignore-file no-explicit-any

function pos(n: any): string {
  return `@${n.line}:${n.col}`;
}

/** Escape one byte the way `Pr.escByte` does. */
function escapeStr(value: string): string {
  let out = '"';
  for (const ch of value) {
    const c = ch.codePointAt(0)!;
    if (ch === "\\" || ch === '"') out += "\\" + ch;
    else if (c < 32 || c === 127) out += "\\x" + c.toString(16).padStart(2, "0");
    else out += ch;
  }
  return out + '"';
}

function ty(t: any): string {
  switch (t.kind) {
    case "prim":     return `(prim${pos(t)} ${t.name})`;
    // The argument list is always printed, empty or not: a shape that disappears when empty would let
    // the two implementations agree by both leaving `Vec<i32>`'s arguments out.
    case "struct":
      return `(named${pos(t)} ${t.name} (${(t.typeArgs ?? []).map(ty).join(" ")}))`;
    case "array":    return `(arr${pos(t)} ${ty(t.elem)})`;
    case "nullable": return `(nullable${pos(t)} ${ty(t.inner)})`;
    case "funcref":
      return `(funcref${pos(t)} ${ty(t.ret)} (${t.params.map(ty).join(" ")}))`;
  }
  throw new Error(`unknown type kind ${t.kind}`);
}

/** ` <T U>` after a declaration's name, and ` <>` when it has none. */
function typeParams(ps: string[] | undefined): string {
  return ` <${(ps ?? []).join(" ")}>`;
}

function exprList(items: any[]): string {
  return ` (${items.map(expr).join(" ")})`;
}

function expr(e: any): string {
  switch (e.kind) {
    case "int":    return `(int${pos(e)} ${e.value})`;
    case "float":  return `(float${pos(e)} ${e.value})`;
    case "string": return `(str${pos(e)} ${escapeStr(e.value)})`;
    case "bool":   return `(bool${pos(e)} ${e.value ? "true" : "false"})`;
    case "null":   return `(null${pos(e)})`;
    case "ident":  return `(ident${pos(e)} ${e.name})`;
    case "unary":  return `(unary${pos(e)} ${e.op} ${expr(e.expr)})`;
    case "binary": return `(binary${pos(e)} ${e.op} ${expr(e.left)} ${expr(e.right)})`;
    case "cast":   return `(cast${pos(e)} ${e.op} ${expr(e.expr)} ${ty(e.type)})`;
    case "is": {
      // The right side is a type, the literal string "null", or an expression. Types
      // and expressions share no tag names in this form, so they need no marker.
      const neg = e.not ? "not" : "plain";
      const TYPES = ["prim", "struct", "array", "nullable", "funcref"];
      const rhs = e.rhs === "null"
        ? "null"
        : TYPES.includes(e.rhs.kind) ? ty(e.rhs) : expr(e.rhs);
      return `(is${pos(e)} ${neg} ${expr(e.expr)} ${rhs})`;
    }
    case "matchExpr": {
      // An arm has a value where the statement form's has a body. Same arm syntax, different
      // position — which is how the language reads it too.
      const arms = e.arms.map((a: any) => {
        const name = a.variant === null ? "else" : a.variant;
        return `(arm ${name} (${a.bindings.join(" ")}) ${expr(a.value)})`;
      }).join(" ");
      return `(matchexpr${pos(e)} ${expr(e.subject)} (${arms}))`;
    }
    case "ternary":
      return `(ternary${pos(e)} ${expr(e.cond)} ${expr(e.then)} ${expr(e.else_)})`;
    case "call":   return `(call${pos(e)} ${expr(e.callee)}${exprList(e.args)})`;
    case "index":  return `(index${pos(e)} ${expr(e.expr)} ${expr(e.idx)})`;
    case "field":  return `(member${pos(e)} ${expr(e.expr)} ${e.name})`;
    case "unwrap": return `(unwrap${pos(e)} ${expr(e.expr)})`;
    case "construct": {
      const named = (e.named ?? [])
        .map((n: any) => `(${n.name} ${expr(n.val)})`).join(" ");
      return `(construct${pos(e)} ${ty(e.ctype)}${exprList(e.args ?? [])} (${named}))`;
    }
    case "incr-expr":
      return `(incr${pos(e)} ${e.op} ${e.prefix ? "pre" : "post"} ${lvalue(e.lval)})`;
    case "arrNew": {
      const size = e.size === null ? "-" : expr(e.size);
      const fill = e.fill === undefined || e.fill === null ? "-" : expr(e.fill);
      return `(arrnew${pos(e)} ${ty(e.elem)} ${size} ${fill}${exprList(e.fixed ?? [])})`;
    }
  }
  throw new Error(`unknown expr kind ${e.kind}`);
}

function lvalue(lv: any): string {
  switch (lv.kind) {
    case "lv-ident":  return `(lv-ident${pos(lv)} ${lv.name})`;
    case "lv-field":  return `(lv-field${pos(lv)} ${lvalue(lv.base)} ${lv.field})`;
    case "lv-index":  return `(lv-index${pos(lv)} ${lvalue(lv.base)} ${expr(lv.idx)})`;
    case "lv-unwrap": return `(lv-unwrap${pos(lv)} ${lvalue(lv.base)})`;
  }
  throw new Error(`unknown lvalue kind ${lv.kind}`);
}

function stmtList(items: any[]): string {
  return ` (${items.map(stmt).join(" ")})`;
}

/**
 * The reference's else branch, flattened to a statement list.
 *
 * It models `else if` as its own node kind; the wac AST models it as an else body
 * containing a single `if`, which is what it means. Normalising here rather than in
 * wac keeps the AST free of a case that exists only to mirror the reference.
 */
function elseStmts(els: any): any[] {
  if (els === null || els === undefined) return [];
  if (els.kind === "else-if") return [els.stmt];
  return els.block.stmts;
}

function stmt(s: any): string {
  switch (s.kind) {
    case "var":
      return `(var${pos(s)} ${s.isConst ? "const" : "let"} ${ty(s.type)} ${s.name} ${expr(s.init)})`;
    case "assign":
      return `(assign${pos(s)} ${s.op} ${lvalue(s.lval)} ${expr(s.rhs)})`;
    case "incr":
      return `(incr-stmt${pos(s)} ${s.op} ${lvalue(s.lval)})`;
    case "if":
      return `(if${pos(s)} ${expr(s.cond)}${stmtList(s.then.stmts)}${stmtList(elseStmts(s.els))})`;
    case "while":
      return `(while${pos(s)} ${expr(s.cond)}${stmtList(s.body.stmts)})`;
    case "for": {
      const init = s.init === null ? "-" : stmt(s.init);
      const cond = s.cond === null ? "-" : expr(s.cond);
      const upd  = s.update === null ? "-" : stmt(s.update);
      return `(for${pos(s)} ${init} ${cond} ${upd}${stmtList(s.body.stmts)})`;
    }
    case "dowhile":
      return `(dowhile${pos(s)}${stmtList(s.body.stmts)} ${expr(s.cond)})`;
    case "switch": {
      const cases = s.cases.map((c: any) => {
        const v = c.value === "default" ? "default" : expr(c.value);
        return `(case ${v}${stmtList(c.body)})`;
      }).join(" ");
      return `(switch${pos(s)} ${expr(s.expr)} (${cases}))`;
    }
    case "match": {
      const arms = s.arms.map((a: any) => {
        const name = a.variant === null ? "else" : a.variant;
        return `(arm ${name} (${a.bindings.join(" ")})${stmtList(a.body)})`;
      }).join(" ");
      return `(match${pos(s)} ${expr(s.subject)} (${arms}))`;
    }
    case "return":   return `(return${pos(s)} ${s.value === null ? "-" : expr(s.value)})`;
    case "break":    return `(break${pos(s)})`;
    case "continue": return `(continue${pos(s)})`;
    // The message is part of the node: `trap "a"` and `trap "b"` are different programs, and a
    // rendering that dropped the value could not tell them apart — which it did until wacc started
    // carrying one. `spec/cases/0043`.
    case "trap":     return `(trap${pos(s)} ${s.value == null ? "-" : expr(s.value)})`;
    case "block":    return `(block${pos(s)}${stmtList(s.block.stmts)})`;
    case "expr":     return `(expr${pos(s)} ${expr(s.expr)})`;
  }
  throw new Error(`unknown stmt kind ${s.kind}`);
}

function params(ps: any[]): string {
  return ` (${ps.map((p) =>
    `(${p.isConst ? "const" : "mut"} ${p.name} ${ty(p.type)})`).join(" ")})`;
}

function decl(d: any): string {
  switch (d.tag) {
    case "import": {
      const items = d.items.map((i: any) => `(${i.name} ${i.alias})`).join(" ");
      // `-` for an ordinary path import, the provider's name for `from core`. Both sides render it,
      // so the corpus compares it rather than agreeing about a field neither one shows.
      return `(import${pos(d)} ${escapeStr(d.path)} ${d.prefix ?? "-"} (${items}))`;
    }
    case "func":
      return `(func${pos(d)} ${d.exported ? "export" : "local"} ${d.name}` +
        `${typeParams(d.typeParams)} ` +
        `${ty(d.returnType)}${params(d.params)}${stmtList(d.body.stmts)})`;
    case "struct": {
      const fields = d.fields.map((f: any) =>
        `(field ${f.isConst ? "const" : "mut"} ${f.name} ${ty(f.type)})`).join(" ");
      const methods = d.methods.map((m: any) => {
        const recv = m.hasThis ? (m.thisConst ? "constthis" : "this") : "static";
        return `(method ${m.name} ${m.isOverride ? "override" : "plain"} ${recv} ` +
          `${ty(m.returnType)}${params(m.params)}${stmtList(m.body.stmts)})`;
      }).join(" ");
      return `(struct${pos(d)} ${d.exported ? "export" : "local"} ` +
        `${d.isConst ? "const" : "mut"} ${d.name}${typeParams(d.typeParams)} ${d.parent ?? "-"} ` +
        `(${fields}) (${methods}))`;
    }
    case "enum": {
      const variants = d.variants.map((v: any) =>
        `(variant ${v.name}${params(v.fields)})`).join(" ");
      // An enum's methods are held by both ASTs and printed by neither: they are compared through rung
      // 3's diagnostics, and printing them here would only test this file against itself.
      return `(enum${pos(d)} ${d.exported ? "export" : "local"} ${d.name}` +
        `${typeParams(d.typeParams)} (${variants}))`;
    }
    case "const":
      return `(const${pos(d)} ${d.exported ? "export" : "local"} ${d.name} ` +
        `${ty(d.type)} ${expr(d.init)})`;
  }
  throw new Error(`unknown decl tag ${d.tag}`);
}

export function referenceDump(source: string): string {
  const { tokens } = wacLex(source);
  const { program } = wacParse(tokens, "main.wac");
  const body = program.items.map((d: any) => `\n  ${decl(d)}`).join("");
  return `(program${body})\n`;
}
