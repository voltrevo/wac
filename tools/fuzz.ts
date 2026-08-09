// A program generator for wac, with a by-construction oracle.
//
//   deno run -A tools/fuzz.ts [--count N] [--seed S] [--verbose]
//
// Every sweep so far enumerated one feature at a time — arithmetic, casts, strings — and every
// bug that survived those lived at an *intersection*: casts crossed with unsigned and width,
// `continue` crossed with the one loop whose test is at the bottom. Intersections are what a
// generator reaches and a hand-written matrix does not.
//
// **The oracle is the generated tree, not a second interpreter.** Each expression node carries an
// `eval` alongside its source text, so the expected answer comes from the same structure that
// produced the program. That matters because the last sweep's oracle was wrong more often than the
// compiler was: 31 of 36 disagreements were mine. A separate evaluator of *wac source* would put
// that mistake right back.
//
// Every branch outcome is decided at generation time — the generator knows which arm runs and how
// many times a loop goes round — so the untaken paths are filled with code that must still compile
// and typecheck without affecting the answer. That is deliberate: a compiler is as likely to get
// the unexecuted branch wrong as the executed one, and validation will say so.

import { wacCompile } from "../compiler/wacCompile.ts";
import { wacInstance } from "../compiler/wacInstance.ts";

// ── Values and types ──────────────────────────────────────────────────────────

type Ty = "i32" | "i64" | "bool";

/** A number the oracle tracks: bigint for the integer types, boolean for bool. */
type V = bigint | boolean;

/** Local variables in scope, and what each holds right now. */
type Env = Map<string, V>;

/**
 * A generated expression: its source, its type, and how to compute it again.
 *
 * `evalIn` re-evaluates against an environment rather than returning a value fixed at generation
 * time, because a loop body has to be evaluated once per iteration with different locals.
 */
type Expr = { src: string; ty: Ty; evalIn: (env: Env) => V };

const wrap = (v: bigint, ty: Ty): bigint =>
  ty === "i64" ? BigInt.asIntN(64, v) : BigInt.asIntN(32, v);

const asInt = (v: V): bigint => typeof v === "boolean" ? (v ? 1n : 0n) : v;
const asBool = (v: V): boolean => typeof v === "boolean" ? v : v !== 0n;

// ── Deterministic RNG, so a failure reproduces from its seed ──────────────────

export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0; }
  next(): number {
    // xorshift32 — small, deterministic, and good enough to pick between shapes.
    let x = this.s;
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }
  int(n: number): number { return Math.floor(this.next() * n); }
  pick<T>(xs: readonly T[]): T { return xs[this.int(xs.length)]; }
  bool(): boolean { return this.next() < 0.5; }
}

// ── The generator ─────────────────────────────────────────────────────────────

type Local = { name: string; ty: Ty };

class Gen {
  private n = 0;
  /** Locals in scope, innermost last, with the value each holds at this point. */
  private scopes: Local[][] = [[]];
  private env: Env = new Map();
  private lines: string[] = [];
  private indent = "  ";
  /** Helper functions generated alongside, so calls have somewhere to go. */
  private helpers: string[] = [];
  private helperSigs: { name: string; params: Ty[]; ret: Ty; body: Expr; paramNames: string[] }[] = [];

  constructor(private rng: Rng) {}

  private fresh(prefix: string): string { return `${prefix}${this.n++}`; }

  private inScope(ty: Ty): Local[] {
    return this.scopes.flat().filter((l) => l.ty === ty);
  }

  // ── Expressions ─────────────────────────────────────────────────────────────

  private literal(ty: Ty): Expr {
    if (ty === "bool") {
      const b = this.rng.bool();
      return { src: String(b), ty, evalIn: () => b };
    }
    const pool = ty === "i32"
      // i32's minimum is written by subtraction for the same reason i64's is: `-2147483648` is a
      // unary minus over a magnitude that needs 64 bits, so with no expected type it is an i64 and
      // any arithmetic around it is too. That is the language behaving correctly and it makes the
      // literal useless *inside* a generated i32 expression.
      ? [0n, 1n, 2n, -1n, 7n, 255n, 65536n, 2147483647n, -2147483647n, 12345n]
      // Every i64 literal is chosen outside i32's range, so its *own* width makes it an i64. wac
      // types a literal from context and that context reaches through a cast's operand, so a small
      // one written `(3 as i64)` is a redundant i64-to-i64 cast wherever an i64 was already
      // expected. Small i64 values still arise, from arithmetic on these.
      : [4294967296n, -4294967296n, 2147483648n, -2147483649n, 1000000000000n,
         9223372036854775807n, -9223372036854775808n];
    const v = this.rng.pick(pool);
    return { src: this.intLiteral(v, ty), ty, evalIn: () => v };
  }

  /**
   * A literal that types as `ty` wherever it appears.
   *
   * wac types an integer literal from its context, which is right for the language and wrong for a
   * generator: `0 as~ i32` in a cast is an i32-to-i32 cast and a compile error, because nothing
   * told the `0` it was an i64. So a small i64 literal is written `(0 as i64)`. And `i64`'s minimum
   * has no literal form at all — `-9223372036854775808` is a unary minus applied to a magnitude
   * one past `i64`'s maximum — so it is built by subtraction, which is what C has always done.
   */
  private intLiteral(v: bigint, ty: Ty): string {
    if (ty === "i32") return v === -2147483648n ? `(-2147483647 - 1)` : v.toString();
    if (v === -9223372036854775808n) return `(-9223372036854775807 - 1)`;
    return v.toString();
  }

  private variable(ty: Ty): Expr | null {
    const candidates = this.inScope(ty);
    if (candidates.length === 0) return null;
    const l = this.rng.pick(candidates);
    return { src: l.name, ty, evalIn: (env) => env.get(l.name)! };
  }

  private binary(ty: Ty, depth: number): Expr | null {
    if (ty === "bool") {
      // Comparisons of integers, and the boolean connectives.
      if (this.rng.bool()) {
        const it: Ty = this.rng.bool() ? "i32" : "i64";
        const op = this.rng.pick(["==", "!=", "<", "<=", ">", ">="] as const);
        const a = this.expr(it, depth - 1), b = this.expr(it, depth - 1);
        const f = (x: bigint, y: bigint): boolean =>
          op === "==" ? x === y : op === "!=" ? x !== y : op === "<" ? x < y
          : op === "<=" ? x <= y : op === ">" ? x > y : x >= y;
        return {
          src: `(${a.src} ${op} ${b.src})`, ty,
          evalIn: (env) => f(asInt(a.evalIn(env)), asInt(b.evalIn(env))),
        };
      }
      const op = this.rng.pick(["&&", "||"] as const);
      const a = this.expr("bool", depth - 1), b = this.expr("bool", depth - 1);
      return {
        src: `(${a.src} ${op} ${b.src})`, ty,
        evalIn: (env) => op === "&&"
          ? asBool(a.evalIn(env)) && asBool(b.evalIn(env))
          : asBool(a.evalIn(env)) || asBool(b.evalIn(env)),
      };
    }
    const op = this.rng.pick(["+", "-", "*", "&", "|", "^", "<<", ">>", "/", "%"] as const);
    const a = this.expr(ty, depth - 1);
    // A zero divisor traps, and so does INT_MIN / -1. Both are real wac behaviour and neither is
    // what this is looking for, so a divisor is a literal known to be safe.
    const bits = ty === "i64" ? 64n : 32n;
    if (op === "/" || op === "%") {
      const d = this.rng.pick([1n, 2n, 3n, 7n, 10n, 255n]);
      return {
        src: `(${a.src} ${op} ${d})`, ty,
        evalIn: (env) => {
          const x = asInt(a.evalIn(env));
          return wrap(op === "/" ? x / d : x % d, ty);
        },
      };
    }
    if (op === "<<" || op === ">>") {
      const sh = BigInt(this.rng.int(Number(bits)));
      return {
        src: `(${a.src} ${op} ${sh})`, ty,
        evalIn: (env) => {
          const x = asInt(a.evalIn(env));
          return wrap(op === "<<" ? x << sh : x >> sh, ty);
        },
      };
    }
    const b = this.expr(ty, depth - 1);
    const f = (x: bigint, y: bigint): bigint =>
      op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y
      : op === "&" ? x & y : op === "|" ? x | y : x ^ y;
    return {
      src: `(${a.src} ${op} ${b.src})`, ty,
      evalIn: (env) => wrap(f(asInt(a.evalIn(env)), asInt(b.evalIn(env))), ty),
    };
  }

  private ternary(ty: Ty, depth: number): Expr {
    const c = this.expr("bool", depth - 1);
    const t = this.expr(ty, depth - 1);
    const e = this.expr(ty, depth - 1);
    return {
      src: `(${c.src} ? ${t.src} : ${e.src})`, ty,
      evalIn: (env) => asBool(c.evalIn(env)) ? t.evalIn(env) : e.evalIn(env),
    };
  }

  private cast(ty: Ty, depth: number): Expr | null {
    if (ty === "i64") {
      // A *variable*, not any i32 expression: a literal operand would be typed i64 by the very
      // context this cast sits in, and `x as i64` on an i64 is a redundant cast. The same reason
      // the i64 literals are all large.
      const a = this.variable("i32");
      if (!a) return null;
      return { src: `(${a.src} as i64)`, ty, evalIn: (env) => asInt(a.evalIn(env)) };
    }
    if (ty === "i32") {
      const a = this.rng.bool() ? this.variable("i64") : this.expr("i64", depth - 1);
      if (!a) return null;
      const how = this.rng.pick(["as@", "as~"] as const);
      return {
        src: `(${a.src} ${how} i32)`, ty,
        evalIn: (env) => {
          const x = asInt(a.evalIn(env));
          if (how === "as@") return BigInt.asIntN(32, x);       // keep the low bits
          const lo = -2147483648n, hi = 2147483647n;            // as~ clamps
          return x < lo ? lo : x > hi ? hi : x;
        },
      };
    }
    return null;
  }

  private callHelper(ty: Ty, depth: number): Expr | null {
    const usable = this.helperSigs.filter((h) => h.ret === ty);
    if (usable.length === 0) return null;
    const h = this.rng.pick(usable);
    const args = h.params.map((p) => this.expr(p, depth - 1));
    return {
      src: `${h.name}(${args.map((a) => a.src).join(", ")})`, ty,
      evalIn: (env) => {
        // The callee's body is evaluated in an environment of just its parameters, which is
        // exactly what wac does — no closure over the caller's locals.
        const callEnv: Env = new Map();
        h.paramNames.forEach((p, i) => callEnv.set(p, args[i].evalIn(env)));
        return h.body.evalIn(callEnv);
      },
    };
  }

  expr(ty: Ty, depth: number): Expr {
    if (depth <= 0) {
      return this.variable(ty) ?? this.literal(ty);
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const choice = this.rng.int(7);
      let e: Expr | null = null;
      if (choice === 0) e = this.literal(ty);
      else if (choice === 1) e = this.variable(ty);
      else if (choice <= 3) e = this.binary(ty, depth);
      else if (choice === 4) e = this.ternary(ty, depth);
      else if (choice === 5) e = this.cast(ty, depth);
      else e = this.callHelper(ty, depth);
      if (e) return e;
    }
    return this.literal(ty);
  }

  // ── Statements ──────────────────────────────────────────────────────────────

  private emit(line: string): void { this.lines.push(this.indent + line); }

  private declare(ty: Ty, init: Expr): Local {
    const name = this.fresh("v");
    this.emit(`${ty} ${name} = ${init.src};`);
    this.scopes[this.scopes.length - 1].push({ name, ty });
    this.env.set(name, init.evalIn(this.env));
    return { name, ty };
  }

  /** A run of statements in a nested scope, with the environment restored afterwards. */
  private block(gen: () => void): void {
    this.scopes.push([]);
    const saved = new Map(this.env);
    const savedIndent = this.indent;
    this.indent += "  ";
    gen();
    this.indent = savedIndent;
    // Locals declared inside go out of scope; values they assigned to *outer* locals stay.
    for (const l of this.scopes.pop()!) this.env.delete(l.name);
    for (const [k, v] of saved) if (!this.env.has(k)) this.env.set(k, v);
  }

  /**
   * A branch that is *not* taken: generated into a sandbox so it compiles and typechecks but
   * cannot affect the answer. A compiler is as likely to mis-emit the unexecuted arm.
   */
  private deadBranch(): void {
    const savedEnv = new Map(this.env);
    this.block(() => {
      const t = this.rng.pick(["i32", "i64", "bool"] as const);
      this.declare(t, this.expr(t, 2));
    });
    this.env = savedEnv;
  }

  private statement(depth: number): void {
    const kind = this.rng.int(depth <= 0 ? 3 : 8);
    switch (kind) {
      case 0: {                                    // declaration
        const ty = this.rng.pick(["i32", "i64", "bool"] as const);
        this.declare(ty, this.expr(ty, 2));
        return;
      }
      case 1: {                                    // assignment to an existing local
        const ty = this.rng.pick(["i32", "i64", "bool"] as const);
        const cands = this.inScope(ty);
        if (cands.length === 0) { this.declare(ty, this.expr(ty, 2)); return; }
        const l = this.rng.pick(cands);
        const e = this.expr(ty, 2);
        this.emit(`${l.name} = ${e.src};`);
        this.env.set(l.name, e.evalIn(this.env));
        return;
      }
      case 2: {                                    // compound assignment
        const cands = this.inScope("i32").concat(this.inScope("i64"));
        if (cands.length === 0) { this.declare("i32", this.expr("i32", 1)); return; }
        const l = this.rng.pick(cands);
        const op = this.rng.pick(["+=", "-=", "*="] as const);
        const e = this.expr(l.ty, 1);
        this.emit(`${l.name} ${op} ${e.src};`);
        const cur = asInt(this.env.get(l.name)!), rhs = asInt(e.evalIn(this.env));
        this.env.set(l.name,
          wrap(op === "+=" ? cur + rhs : op === "-=" ? cur - rhs : cur * rhs, l.ty));
        return;
      }
      case 3: {                                    // if / else, with the taken arm known
        const c = this.expr("bool", 2);
        const taken = asBool(c.evalIn(this.env));
        this.emit(`if (${c.src}) {`);
        if (taken) this.block(() => this.statements(depth - 1)); else this.deadBranch();
        this.emit(`} else {`);
        if (taken) this.deadBranch(); else this.block(() => this.statements(depth - 1));
        this.emit(`}`);
        return;
      }
      case 4: return this.loop(depth, "while");
      case 5: return this.loop(depth, "for");
      case 6: return this.loop(depth, "dowhile");
      default: {                                   // a nested bare block
        this.emit(`{`);
        this.block(() => this.statements(depth - 1));
        this.emit(`}`);
        return;
      }
    }
  }

  /**
   * A counted loop, in each of the three forms.
   *
   * The trip count is fixed and the body is a straight-line run of assignments to *existing*
   * locals, so the oracle can run the same run the same number of times. `continue` and `break`
   * are generated with the iteration they fire on chosen up front — which is the shape that found
   * the do-while bug, where `continue` skipped the condition.
   */
  private loop(_depth: number, form: "while" | "for" | "dowhile"): void {
    const trips = 1 + this.rng.int(4);
    const acc = this.inScope("i32")[0] ?? this.declare("i32", this.literal("i32"));
    const i = this.fresh("i");
    const step = this.expr("i32", 1);
    const useContinue = this.rng.bool();
    const contAt = this.rng.int(trips);          // the iteration `continue` fires on
    const useBreak = !useContinue && this.rng.bool();
    const breakAt = 1 + this.rng.int(trips);     // never the first, so the body runs at least once

    const bodyLines = (ind: string): string[] => {
      const out: string[] = [];
      if (useContinue) out.push(`${ind}if (${i} == ${contAt}) { continue; }`);
      if (useBreak) out.push(`${ind}if (${i} == ${breakAt}) { break; }`);
      out.push(`${ind}${acc.name} = ${acc.name} + ${step.src};`);
      return out;
    };

    // Emit, then simulate: the same decisions, in the same order.
    const ind = this.indent + "  ";
    if (form === "while") {
      this.emit(`i32 ${i} = 0;`);
      this.emit(`while (${i} < ${trips}) {`);
      this.lines.push(`${ind}${i} = ${i} + 1;`);
      // `continue` in a while re-tests the condition, so the counter must advance before it.
      for (const l of bodyLines(ind)) this.lines.push(l);
      this.emit(`}`);
    } else if (form === "for") {
      this.emit(`for (i32 ${i} = 0; ${i} < ${trips}; ${i}++) {`);
      for (const l of bodyLines(ind)) this.lines.push(l);
      this.emit(`}`);
    } else {
      this.emit(`i32 ${i} = 0;`);
      this.emit(`do {`);
      this.lines.push(`${ind}${i} = ${i} + 1;`);
      for (const l of bodyLines(ind)) this.lines.push(l);
      this.emit(`} while (${i} < ${trips});`);
    }

    // The oracle: the counter's values differ between the forms, so the simulation mirrors each.
    const values = form === "for"
      ? Array.from({ length: trips }, (_, k) => k)          // i is 0..trips-1 in the body
      : Array.from({ length: trips }, (_, k) => k + 1);     // incremented first in the other two
    for (const iv of values) {
      if (useContinue && iv === contAt) continue;
      if (useBreak && iv === breakAt) break;
      const cur = asInt(this.env.get(acc.name)!);
      this.env.set(acc.name, wrap(cur + asInt(step.evalIn(this.env)), "i32"));
    }
  }

  statements(depth: number): void {
    const n = 1 + this.rng.int(3);
    for (let k = 0; k < n; k++) this.statement(depth);
  }

  // ── The whole program ───────────────────────────────────────────────────────

  private makeHelper(): void {
    const name = this.fresh("h");
    const ret = this.rng.pick(["i32", "i64", "bool"] as const);
    const nparams = this.rng.int(3);
    const params: Ty[] = [], paramNames: string[] = [];
    for (let k = 0; k < nparams; k++) {
      const t = this.rng.pick(["i32", "i64", "bool"] as const);
      params.push(t);
      paramNames.push(`p${k}`);
    }
    // The body is generated against the parameters alone.
    const savedScopes = this.scopes, savedEnv = this.env;
    this.scopes = [params.map((t, k) => ({ name: paramNames[k], ty: t }))];
    this.env = new Map(paramNames.map((p) => [p, 0n as V]));
    const body = this.expr(ret, 3);
    this.scopes = savedScopes; this.env = savedEnv;

    const sig = params.map((t, k) => `${t} ${paramNames[k]}`).join(", ");
    this.helpers.push(`${ret} ${name}(${sig}) { return ${body.src}; }`);
    this.helperSigs.push({ name, params, ret, body, paramNames });
  }

  /** Build one program. Returns its source and the value `main()` must return. */
  program(): { src: string; want: bigint } {
    for (let k = 0; k < 3; k++) this.makeHelper();
    this.statements(3);
    const result = this.expr("i32", 3);
    const want = asInt(result.evalIn(this.env));
    const src = [
      ...this.helpers,
      `export i32 main() {`,
      ...this.lines,
      `  return ${result.src};`,
      `}`,
    ].join("\n");
    return { src, want: BigInt.asIntN(32, want) };
  }
}

// ── Runner ────────────────────────────────────────────────────────────────────

export type FuzzFailure = { seed: number; src: string; want: bigint; got: string };

/** Generate and check `count` programs from `seed`. Returns the failures. */
export async function fuzz(count: number, seed: number, verbose = false): Promise<FuzzFailure[]> {
  const failures: FuzzFailure[] = [];
  for (let k = 0; k < count; k++) {
    const s = seed + k;
    const { src, want } = new Gen(new Rng(s)).program();
    const r = wacCompile(new Map([["m.wac", src]]), "m.wac");
    if (!r.ok) {
      failures.push({ seed: s, src, want, got: `compile: ${r.diagnostics.map((d) => d.message).join("; ")}` });
      continue;
    }
    try {
      const inst = await wacInstance(r.compiled);
      const got = inst.call("main", []);
      if (BigInt(got as number) !== want) {
        failures.push({ seed: s, src, want, got: String(got) });
      } else if (verbose) console.log(`seed ${s}: ok (${want})`);
    } catch (e) {
      failures.push({ seed: s, src, want, got: String(e).split("\n")[0] });
    }
  }
  return failures;
}

// ── What it does not reach yet ────────────────────────────────────────────────
//
// In rough order of expected yield, judged by where this compiler's bugs have actually lived:
//
//   1. generics — instantiating one generated template at several argument types, which is the
//      seam that produced the most bugs of any this month;
//   2. several files, so the "a name is unique only within its file" family is in range;
//   3. structs, enums and `match`, including a narrowed subject;
//   4. arrays, with in-bounds indices;
//   5. u32/u64/f64, whose semantics are already verified pointwise but not in combination.
//
// Each adds oracle surface, and the oracle is the thing to keep honest: every failure it reports
// should be minimised and read before it is believed. Of the first 36 disagreements the hand-written
// cast sweep produced, 31 were the oracle's fault.

if (import.meta.main) {
  const args = Deno.args;
  const num = (flag: string, dflt: number) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const count = num("--count", 200);
  const seed = num("--seed", 1);
  const verbose = args.includes("--verbose");
  const failures = await fuzz(count, seed, verbose);
  console.log(`${count} programs from seed ${seed}: ${failures.length} failures`);
  for (const f of failures.slice(0, 3)) {
    console.log(`\n── seed ${f.seed}: want ${f.want}, got ${f.got}\n${f.src}`);
  }
  if (failures.length > 0) Deno.exit(1);
}
