// wacConstEval — evaluate a wac constant expression to a value at compile time.
//
// Needed because a wasm *global* initialiser must be a constant expression, and
// only const instructions are portable there. A module-level constant used
// inside a function body can simply have its initialiser substituted — the
// emitter is producing ordinary instructions and `1 + 2` is fine. A constant
// *array* cannot: its elements land in a global's init expression, so `1 + 2`
// has to have become `3` before emission.
//
// Deliberately narrow, matching what wacTypeCheck accepts in a constant: no
// calls, no construction, no run-time anything. Integers are carried as bigint
// so i64 and u64 are exact, and narrowed to the destination width on demand.

import { wacIntLit } from "./wacIntLit.ts";
import { wacFloatLit } from "./wacFloatLit.ts";
import type { Expr } from "./wacParse.ts";

/** A compile-time value, tagged by which wac type family it belongs to. */
export type ConstValue =
  | { kind: "int";   value: bigint }
  | { kind: "float"; value: number }
  | { kind: "bool";  value: boolean };

/** Resolve a name to the initialiser of another constant, or null if it is not one. */
export type ConstLookup = (name: string) => Expr | null;

const MASK32 = (1n << 32n) - 1n;
const MASK64 = (1n << 64n) - 1n;

/** Wrap to a width, as two's complement, mirroring wasm's integer behaviour. */
function wrap(v: bigint, bits: 32 | 64): bigint {
  return BigInt.asIntN(bits, v & (bits === 32 ? MASK32 : MASK64));
}

/**
 * The value of `expr`, or null if it is not a constant expression.
 *
 * `depth` guards against a cycle between constants. wacTypeCheck rejects those
 * with a proper diagnostic first; this is the backstop that keeps a malformed
 * program from recursing without end.
 */
export function wacConstEval(
  expr: Expr,
  lookup: ConstLookup,
  depth = 0,
): ConstValue | null {
  if (depth > 64) return null;
  const rec = (e: Expr) => wacConstEval(e, lookup, depth + 1);

  switch (expr.kind) {
    case "int": {
      const lit = wacIntLit(expr.value);
      return lit.ok ? { kind: "int", value: lit.value } : null;
    }
    case "float": return { kind: "float", value: wacFloatLit(expr.value) };
    case "bool":  return { kind: "bool", value: expr.value };

    case "ident": {
      const init = lookup(expr.name);
      return init === null ? null : wacConstEval(init, lookup, depth + 1);
    }

    case "cast": {
      // The value is unchanged; only its interpretation is, and that is the
      // caller's business when it picks an instruction to emit. Widths are
      // applied at emission via constValueBits.
      return rec(expr.expr);
    }

    case "unary": {
      const v = rec(expr.expr);
      if (!v) return null;
      if (expr.op === "-") {
        if (v.kind === "int")   return { kind: "int", value: -v.value };
        if (v.kind === "float") return { kind: "float", value: -v.value };
        return null;
      }
      if (expr.op === "~" && v.kind === "int") return { kind: "int", value: ~v.value };
      if (expr.op === "!" && v.kind === "bool") return { kind: "bool", value: !v.value };
      return null;
    }

    case "binary": {
      const a = rec(expr.left), b = rec(expr.right);
      if (!a || !b) return null;

      if (a.kind === "int" && b.kind === "int") {
        const x = a.value, y = b.value;
        switch (expr.op) {
          case "+":  return { kind: "int", value: x + y };
          case "-":  return { kind: "int", value: x - y };
          case "*":  return { kind: "int", value: x * y };
          // Division by zero traps at run time; as a constant it is simply not
          // a value, so the caller reports it rather than emitting something.
          case "/":  return y === 0n ? null : { kind: "int", value: x / y };
          case "%":  return y === 0n ? null : { kind: "int", value: x % y };
          case "&":  return { kind: "int", value: x & y };
          case "|":  return { kind: "int", value: x | y };
          case "^":  return { kind: "int", value: x ^ y };
          case "<<": return { kind: "int", value: x << (y & 63n) };
          case ">>": return { kind: "int", value: x >> (y & 63n) };
          case "==": return { kind: "bool", value: x === y };
          case "!=": return { kind: "bool", value: x !== y };
          case "<":  return { kind: "bool", value: x < y };
          case "<=": return { kind: "bool", value: x <= y };
          case ">":  return { kind: "bool", value: x > y };
          case ">=": return { kind: "bool", value: x >= y };
          // `>>>` depends on the operand width, which is not known here.
          default:   return null;
        }
      }
      if (a.kind === "float" && b.kind === "float") {
        const x = a.value, y = b.value;
        switch (expr.op) {
          case "+":  return { kind: "float", value: x + y };
          case "-":  return { kind: "float", value: x - y };
          case "*":  return { kind: "float", value: x * y };
          case "/":  return { kind: "float", value: x / y };
          case "==": return { kind: "bool", value: x === y };
          case "!=": return { kind: "bool", value: x !== y };
          case "<":  return { kind: "bool", value: x < y };
          case "<=": return { kind: "bool", value: x <= y };
          case ">":  return { kind: "bool", value: x > y };
          case ">=": return { kind: "bool", value: x >= y };
          default:   return null;
        }
      }
      if (a.kind === "bool" && b.kind === "bool") {
        switch (expr.op) {
          case "&&": return { kind: "bool", value: a.value && b.value };
          case "||": return { kind: "bool", value: a.value || b.value };
          case "==": return { kind: "bool", value: a.value === b.value };
          case "!=": return { kind: "bool", value: a.value !== b.value };
          default:   return null;
        }
      }
      return null;
    }

    case "ternary": {
      const c = rec(expr.cond);
      if (!c || c.kind !== "bool") return null;
      return rec(c.value ? expr.then : expr.else_);
    }

    default: return null;
  }
}
