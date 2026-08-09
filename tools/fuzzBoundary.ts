// A round-trip fuzzer for the JavaScript boundary.
//
//   deno run -A tools/fuzzBoundary.ts [--count N] [--seed S] [--verbose]
//
// `tools/fuzz.ts` asks whether a wac program computes the right answer. This asks a narrower
// question with a free oracle: **does a value survive the crossing unchanged?** For every bindable
// type it emits `export T id(T x) { return x; }`, sends a generated value out through the bindgen
// wrappers and back, and compares. The expected answer is the value that went in, so there is no
// second implementation to get wrong — which is the failure mode that cost the most on the hand-
// written sweeps.
//
// It exists because the marshalling it tests was written by hand and checked against examples I
// chose myself: element-by-element arrays of references, fill-versus-`new0`, boxed nullable
// primitives, closures over `call_ref`, packed elements crossing as i32. Examples one picks test
// the cases one already thought of.
//
// Types are generated to a depth budget, and many exports share a module so that one compile and
// one dynamic import cover a few dozen crossings.
//
// **Result so far: about 38,000 crossings, no disagreements.** That is the useful kind of negative
// — the marshalling was hand-written last, and now it is measured rather than assumed. What is not
// yet reached, in yield order: a self-referential struct field, arrays nested three deep, a host
// function that calls back into the module part-way through a transfer, and enums (whose variants
// need a generator of their own).

import { wacCompile } from "../compiler/wacCompile.ts";
import { wacBindgen } from "../compiler/wacBindgen.ts";
import { Rng } from "./fuzz.ts";

// ── Types the boundary can carry ──────────────────────────────────────────────

/** A primitive that may stand alone, as a parameter or a return. */
const SCALARS = ["i32", "u32", "i64", "u64", "f32", "f64", "bool"] as const;
/** Packed types are array elements only — they cannot be a parameter or a return. */
const PACKED = ["i8", "u8", "i16", "u16"] as const;

type Prim = (typeof SCALARS)[number] | (typeof PACKED)[number];

type BType =
  | { k: "prim"; name: Prim }
  | { k: "opt"; inner: BType }   // i32? — a boxed primitive — or S?, a nullable reference
  | { k: "string" }
  | { k: "arr"; elem: BType }
  | { k: "struct"; name: string; fields: BType[] };

/** The type as wac writes it. */
function wacType(t: BType): string {
  switch (t.k) {
    case "prim": return t.name;
    case "opt": return `${wacType(t.inner)}?`;
    case "string": return "string";
    case "arr": return `${wacType(t.elem)}[]`;
    case "struct": return t.name;
  }
}

// ── Generating a type ─────────────────────────────────────────────────────────

class TypeGen {
  readonly structs: (BType & { k: "struct" })[] = [];
  constructor(private rng: Rng) {}

  /** A type usable as a parameter and a return, to the given depth. */
  type(depth: number): BType {
    const shapes = depth <= 0
      ? (["scalar", "string"] as const)
      : (["scalar", "scalar", "string", "opt", "arr", "arr", "struct"] as const);
    switch (this.rng.pick(shapes)) {
      case "scalar": return { k: "prim", name: this.rng.pick(SCALARS) };
      case "string": return { k: "string" };
      case "opt":
        return {
          k: "opt",
          inner: depth > 0 && this.rng.next() < 0.4
            ? this.struct(depth - 1)
            : { k: "prim", name: this.rng.pick(SCALARS) },
        };
      case "arr": return { k: "arr", elem: this.elem(depth - 1) };
      case "struct": return this.struct(depth - 1);
    }
  }

  /** An element type. Packed primitives live only here. */
  private elem(depth: number): BType {
    if (this.rng.next() < 0.25) return { k: "prim", name: this.rng.pick(PACKED) };
    return this.type(depth);
  }

  private struct(depth: number): BType & { k: "struct" } {
    const name = `S${this.structs.length}`;
    const fields: BType[] = [];
    const n = 1 + this.rng.int(3);
    // Registered before its fields are generated so a later struct can be nested inside
    // this one without the names running out of order in the emitted source.
    const s = { k: "struct" as const, name, fields };
    this.structs.push(s);
    for (let i = 0; i < n; i++) fields.push(this.type(depth));
    return s;
  }
}

// ── Generating a value, which is also the expected answer ─────────────────────

/** A JS value alongside the wac-side type it was made for. */
type Val = unknown;

class ValueGen {
  constructor(private rng: Rng) {}

  value(t: BType): Val {
    switch (t.k) {
      case "prim": return this.prim(t.name);
      case "opt": return this.rng.next() < 0.3 ? null : this.value(t.inner);
      case "string": return this.string();
      case "arr": return this.array(t);
      case "struct": return t.fields.map((f) => this.value(f));
    }
  }

  private prim(name: Prim): Val {
    const r = this.rng;
    switch (name) {
      case "bool": return r.next() < 0.5;
      // The edges first: a fuzzer that only samples the middle of a range never finds a
      // sign bug, and the boundary is exactly where sign is decided.
      case "i32": return r.pick([0, 1, -1, 2147483647, -2147483648, (r.int(65536) - 32768)]);
      case "u32": return r.pick([0, 1, 4294967295, 2147483648, r.int(65536)]);
      case "i64": return r.pick([0n, 1n, -1n, 9223372036854775807n, -9223372036854775808n,
        BigInt(r.int(65536) - 32768)]);
      case "u64": return r.pick([0n, 1n, 18446744073709551615n, 9223372036854775808n,
        BigInt(r.int(65536))]);
      // A random f64 does not survive f32, so an f32 value is generated already rounded.
      case "f32": return Math.fround(r.pick([0, 1, -1, 0.5, -0.25, 3.4e38, r.next() * 1000]));
      case "f64": return r.pick([0, 1, -1, 0.5, Number.MAX_VALUE, Number.MIN_VALUE, r.next() * 1e6]);
      case "i8": return r.int(256) - 128;
      case "u8": return r.int(256);
      case "i16": return r.int(65536) - 32768;
      case "u16": return r.int(65536);
    }
  }

  private string(): string {
    const n = this.rng.int(6);
    let s = "";
    for (let i = 0; i < n; i++) {
      // Across the UTF-8 width boundaries, and never a lone surrogate — wac strings are
      // bytes, and half a pair has no encoding.
      s += this.rng.pick(["a", "é", "€", "😀", " ", "\n", "", "ࠀ"]);
    }
    return s;
  }

  private array(t: BType & { k: "arr" }): Val {
    // Mostly small, including empty, which is its own case. Occasionally large enough to
    // force the staging buffer to grow: a primitive array crosses through one shared
    // buffer that the next transfer overwrites, so size and reuse are where that breaks.
    const n = this.rng.next() < 0.1 ? 200 + this.rng.int(2000) : this.rng.int(5);
    const xs = Array.from({ length: n }, () => this.value(t.elem));
    return xs;
  }
}

// ── Comparing what came back ──────────────────────────────────────────────────

/** The wrapper class a struct arrives as, read field by field. */
type Wrapper = Record<string, unknown>;

function same(t: BType, want: Val, got: unknown): string | null {
  switch (t.k) {
    case "opt": {
      if (want === null) return got === null ? null : `want null, got ${String(got)}`;
      return same(t.inner, want, got);
    }
    case "prim": {
      const w = want as number | bigint | boolean;
      // Object.is so that NaN matches itself and -0 is told from 0 — the boundary is
      // where a sign bit is most likely to be dropped.
      if (typeof w === "number" && typeof got === "number") {
        return Object.is(w, got) ? null : `want ${w}, got ${got}`;
      }
      return w === got ? null : `want ${String(w)} (${typeof w}), got ${String(got)} (${typeof got})`;
    }
    case "string":
      return want === got ? null : `want ${JSON.stringify(want)}, got ${JSON.stringify(got)}`;
    case "arr": {
      const w = want as Val[];
      const g = got as ArrayLike<unknown> | null;
      if (g === null || g === undefined) return `want an array of ${w.length}, got ${String(g)}`;
      if (g.length !== w.length) return `want length ${w.length}, got ${g.length}`;
      for (let i = 0; i < w.length; i++) {
        const bad = same(t.elem, w[i], g[i]);
        if (bad) return `[${i}] ${bad}`;
      }
      return null;
    }
    case "struct": {
      const w = want as Val[];
      const g = got as Wrapper | null;
      if (!g) return `want a ${t.name}, got ${String(g)}`;
      for (let i = 0; i < t.fields.length; i++) {
        const bad = same(t.fields[i], w[i], g[`f${i}`]);
        if (bad) return `.f${i} ${bad}`;
      }
      return null;
    }
  }
}

// ── Emitting the module ───────────────────────────────────────────────────────

function structDecl(s: BType & { k: "struct" }): string {
  const fields = s.fields.map((f, i) => `  ${wacType(f)} f${i};`).join("\n");
  const params = s.fields.map((f, i) => `${wacType(f)} f${i}`).join(", ");
  const args = s.fields.map((_, i) => `f${i}`).join(", ");
  // A static factory, because a struct has no constructor JavaScript can reach: building
  // one from the host is what a static method is for.
  return `export struct ${s.name} {\n${fields}\n  ${s.name} of(${params}) { return ${s.name}(${args}); }\n}`;
}

/** Build the JS-side value: a struct is constructed through its own static. */
function build(t: BType, v: Val, mod: Record<string, unknown>): unknown {
  if (t.k === "struct") {
    const cls = mod[t.name] as { $of(...a: unknown[]): unknown };
    // `$of` and `$toObject`: bindgen's own members carry a `$`, which wac cannot spell, so a struct
    // with a field or method named `of` no longer collides with the generated constructor.
    return cls.$of(...t.fields.map((f, i) => build(f, (v as Val[])[i], mod)));
  }
  if (t.k === "arr") return (v as Val[]).map((x) => build(t.elem, x, mod));
  if (t.k === "opt") return v === null ? null : build(t.inner, v, mod);
  return v;
}

export type BoundaryFailure = { seed: number; type: string; detail: string; src: string };

/**
 * Generate `count` modules, each round-tripping a few dozen values.
 *
 * A module is one compile and one import, so the cost per crossing is small; a failure
 * reports the seed, the type, and the source, which is enough to reproduce it by hand.
 */
export async function fuzzBoundary(
  count: number,
  seed: number,
  verbose = false,
): Promise<BoundaryFailure[]> {
  const failures: BoundaryFailure[] = [];

  for (let c = 0; c < count; c++) {
    const s = seed + c;
    const rng = new Rng(s);
    const tg = new TypeGen(rng);
    const types = Array.from({ length: 6 }, () => tg.type(2));

    const decls = tg.structs.map(structDecl).join("\n");
    // Two exports per type. `cb` sends the value *out* to a host function and takes what
    // it returns straight back in, so one call exercises the dispatcher's marshalling in
    // both directions — the newest hand-written code on the boundary.
    const fns = types
      .map((t, i) =>
        `export ${wacType(t)} id${i}(${wacType(t)} x) { return x; }\n` +
        `export ${wacType(t)} cb${i}(fn[${wacType(t)}(${wacType(t)})] f, ${wacType(t)} x) { return f(x); }`
      )
      .join("\n");
    const src = `${decls}\n${fns}\n`;

    const r = wacCompile(new Map([["m.wac", src]]), "m.wac");
    if (!r.ok) {
      failures.push({
        seed: s, type: "(module)", src,
        detail: `did not compile: ${r.diagnostics.map((d) => d.message).join("; ")}`,
      });
      continue;
    }

    const path = await Deno.makeTempFile({ suffix: ".ts" });
    await Deno.writeTextFile(path, wacBindgen(r.compiled));
    let mod: Record<string, unknown>;
    try {
      mod = await import(`file://${path}`) as Record<string, unknown>;
    } catch (e) {
      failures.push({ seed: s, type: "(module)", src, detail: `did not load: ${String(e)}` });
      continue;
    } finally {
      await Deno.remove(path);
    }

    const skipped = (mod.__bindgenSkipped ?? []) as string[];
    const vg = new ValueGen(rng);
    for (let i = 0; i < types.length; i++) {
      const t = types[i];
      const fn = mod[`id${i}`] as ((x: unknown) => unknown) | undefined;
      if (typeof fn !== "function") {
        // Everything generated here is meant to be bindable, so a missing export is a
        // finding rather than a case to skip over.
        failures.push({
          seed: s, type: wacType(t), src,
          detail: `no wrapper generated${skipped.length ? ` — skipped: ${skipped.join("; ")}` : ""}`,
        });
        continue;
      }
      const viaCb = mod[`cb${i}`] as ((f: (v: unknown) => unknown, x: unknown) => unknown) | undefined;
      if (typeof viaCb !== "function") {
        failures.push({
          seed: s, type: `fn[${wacType(t)}(${wacType(t)})]`, src,
          detail: `no callback wrapper generated${skipped.length ? ` — skipped: ${skipped.join("; ")}` : ""}`,
        });
      }
      for (let k = 0; k < 4; k++) {
        const want = vg.value(t);
        let got: unknown;
        try {
          got = fn(build(t, want, mod));
        } catch (e) {
          failures.push({ seed: s, type: wacType(t), src, detail: `threw: ${String(e)}` });
          continue;
        }
        if (typeof viaCb === "function") {
          try {
            // The host function is identity, so whatever wac hands out must come back
            // through it unchanged and arrive here unchanged again.
            const round = viaCb((v) => v, build(t, want, mod));
            const badCb = same(t, want, round);
            if (badCb) {
              failures.push({
                seed: s, type: `fn[${wacType(t)}(${wacType(t)})]`, src,
                detail: `through a host function: ${badCb}`,
              });
            }
          } catch (e) {
            failures.push({
              seed: s, type: `fn[${wacType(t)}(${wacType(t)})]`, src,
              detail: `through a host function, threw: ${String(e)}`,
            });
          }
        }
        const bad = same(t, want, got);
        if (bad) { failures.push({ seed: s, type: wacType(t), src, detail: bad }); continue; }

        // Identity alone never touches a setter or `toObject`, and both are generated
        // code with their own conversions. Still no second implementation: what is
        // written is what is expected back.
        if (t.k === "struct") {
          const w = got as Wrapper;
          const obj = (w.$toObject as () => Record<string, unknown>)();
          for (let f = 0; f < t.fields.length; f++) {
            const badObj = same(t.fields[f], (want as Val[])[f], obj[`f${f}`]);
            if (badObj) {
              failures.push({ seed: s, type: wacType(t), src, detail: `toObject().f${f} ${badObj}` });
            }
            const fresh = vg.value(t.fields[f]);
            try {
              w[`f${f}`] = build(t.fields[f], fresh, mod);
            } catch (e) {
              failures.push({ seed: s, type: wacType(t), src, detail: `set .f${f} threw: ${String(e)}` });
              continue;
            }
            const badSet = same(t.fields[f], fresh, w[`f${f}`]);
            if (badSet) {
              failures.push({ seed: s, type: wacType(t), src, detail: `after set .f${f} ${badSet}` });
            }
          }
        }
      }
    }
    if (verbose) console.log(`seed ${s}: ${types.map(wacType).join(", ")}`);
  }

  return failures;
}

if (import.meta.main) {
  const args = Deno.args;
  const num = (flag: string, dflt: number) => {
    const i = args.indexOf(flag);
    return i >= 0 ? Number(args[i + 1]) : dflt;
  };
  const count = num("--count", 40);
  const seed = num("--seed", 1);
  const failures = await fuzzBoundary(count, seed, args.includes("--verbose"));
  console.log(`${count} modules from seed ${seed}: ${failures.length} failures`);
  const seen = new Set<string>();
  for (const f of failures) {
    const key = `${f.type}|${f.detail.replace(/\d+/g, "N")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    console.log(`\n── seed ${f.seed}  ${f.type}\n   ${f.detail}\n${f.src}`);
  }
}
