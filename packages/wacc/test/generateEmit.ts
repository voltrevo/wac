// Programs for rung 4's sweep: valid, runnable, and generated rather than thought of.
//
// The hand-written differential cases test what their author wrote down. That is a real bias and it
// cost a real bug: 172 programs and 222 calls, and **every integer literal in them was plain
// decimal** — so `0xff` compiled to 0 and `1_000` to 1, silently, for as long as the emitter had
// existed. Nobody had written a hex number because nobody thought to, and half this repository writes
// numbers that way.
//
// So: cross products, the same argument as rung 3's sweep one level down. A value shape added here is
// tried in every context; a context added here is tried with every value.
//
// Two constraints shape what can be generated. Each program must be **valid** — the reference has to
// compile it, and anything it refuses is skipped rather than counted — and each must be **runnable
// with no arguments**, because an `i64` or a reference crossing the JavaScript boundary is a
// marshalling problem rather than a compiler one. Constants go *in* the program and the answer comes
// out, which keeps the comparison about the compiler.

/** The value shapes worth trying, per type — boundaries, and the spellings a literal can have. */
const VALUES: Record<string, string[]> = {
  i32: ["0", "1", "-1", "7", "0xff", "0xDEAD", "1_000", "2147483647", "-2147483648", "0x7fffffff"],
  u32: ["0", "1", "7", "0xff", "4_000_000_000", "4294967295", "0xffffffff"],
  i64: ["0", "1", "-1", "0xdeadbeef", "4294967296", "9223372036854775807", "1_000_000_000_000"],
  u64: ["0", "1", "0xffffffffffffffff", "18446744073709551615", "4294967296"],
  f32: ["0.0", "1.5", "-2.25", "3.5"],
  f64: ["0.0", "1.5", "-2.25", "1e10", "0.1"],
  bool: ["true", "false"],
};

/** The numeric types, in the order a report reads best. */
const NUMS = ["i32", "u32", "i64", "u64", "f32", "f64"];

/** Operators that apply to every numeric type. */
const ARITH = ["+", "-", "*", "/"];
/** Operators only the integers take. */
const INT_ONLY = ["%", "&", "|", "^", "<<", ">>"];
/** Comparisons, which produce a `bool` whatever they are given. */
const CMP = ["==", "!=", "<", "<=", ">", ">="];

export type Cell = { context: string; src: string };

/**
 * Every program, in a stable order so a failure names a repeatable cell.
 *
 * The exported function is always `f` and always takes nothing: the interesting values are written
 * into the body, and what comes back is one number JavaScript can read.
 */
export function generateEmit(): Cell[] {
  const out: Cell[] = [];
  const add = (context: string, src: string) => out.push({ context, src });

  // A literal, straight out. This is the family that was silently wrong, and it is first for that
  // reason: every spelling of every value, returned unchanged.
  for (const t of NUMS) {
    for (const v of VALUES[t]) {
      add(`literal ${t}`, `export ${t} f() { return ${v}; }`);
      add(`literal ${t} via local`, `export ${t} f() { ${t} x = ${v}; return x; }`);
      add(`literal ${t} via const`, `const ${t} K = ${v}; export ${t} f() { return K; }`);
    }
  }

  // Operators, over pairs of interesting values. The second operand avoids zero for the operators
  // that would trap on it — a trap is a legitimate answer but not one this harness can compare.
  for (const t of NUMS) {
    const vals = VALUES[t];
    const nonZero = vals.filter((v) => !/^0(\.0)?$/.test(v));
    const ops = t.startsWith("f") ? ARITH : ARITH.concat(INT_ONLY);
    for (const op of ops) {
      const rights = op === "/" || op === "%" ? nonZero : vals;
      for (const a of vals) {
        for (const b of rights.slice(0, 4)) {
          const rhs = op === "<<" || op === ">>" ? "3" : b;
          add(`${t} ${op}`, `export ${t} f() { ${t} x = ${a}; ${t} y = ${rhs}; return x ${op} y; }`);
        }
      }
    }
    for (const op of CMP) {
      for (const a of vals) {
        for (const b of vals.slice(0, 3)) {
          add(`${t} ${op}`, `export bool f() { ${t} x = ${a}; ${t} y = ${b}; return x ${op} y; }`);
        }
      }
    }
  }

  // Conversions, every pair and every spelling — the four cast operators differ in what they permit
  // and the reference refuses the wrong one, so most of these are skipped and the rest are exactly
  // the conversions the language allows.
  for (const from of NUMS) {
    for (const to of NUMS) {
      for (const op of ["as", "as!", "as~", "as@"]) {
        for (const v of VALUES[from].slice(0, 4)) {
          const ret = to === "f32" || to === "f64" ? to : to;
          add(`cast ${op} ${from}->${to}`,
            `export ${ret} f() { ${from} x = ${v}; return x ${op} ${to}; }`);
        }
      }
    }
  }

  // Arrays: build one, write to it, read it back. The element type is the axis; the shape is fixed.
  for (const t of NUMS) {
    for (const v of VALUES[t].slice(0, 3)) {
      add(`array ${t} fill`, `export ${t} f() { ${t}[] a = ${t}[3](fill: ${v}); return a[2]; }`);
      add(`array ${t} set`, `export ${t} f() { ${t}[] a = ${t}[3](); a[1] = ${v}; return a[1]; }`);
      add(`array ${t} literal`,
        `export ${t} f() { ${t}[] a = ${t}[](${v}, ${v}); return a[0] + a[1]; }`);
      add(`array ${t} copy`,
        `export ${t} f() { ${t}[] a = ${t}[3](); ${t}[] b = ${t}[](${v}, ${v}, ${v}); ` +
        `a.copyFrom(b, 0, 0, 3); return a[2]; }`);
      add(`array ${t} len`, `export i32 f() { ${t}[] a = ${t}[4](fill: ${v}); return a.len(); }`);
    }
  }

  // Control flow, with the loop bound and the arithmetic varying by type.
  for (const t of ["i32", "i64", "u32"]) {
    for (const v of VALUES[t].slice(0, 4)) {
      add(`loop ${t}`,
        `export ${t} f() { ${t} t = 0; for (i32 i = 0; i < 4; i++) { t = t + ${v}; } return t; }`);
      add(`while ${t}`,
        `export ${t} f() { ${t} t = ${v}; i32 i = 0; while (i < 3) { t = t + 1; i = i + 1; } return t; }`);
      add(`branch ${t}`,
        `export ${t} f() { ${t} x = ${v}; if (x > 0) { return x; } else { return 0; } }`);
      add(`ternary ${t}`, `export ${t} f() { ${t} x = ${v}; return x > 0 ? x : 0; }`);
    }
  }

  // Strings, whose every operation is a generated helper or an array instruction.
  const STRS = ['""', '"a"', '"hello"', '"é"', '"a\\nb"', '"\\t"'];
  for (const a of STRS) {
    add("string len", `export i32 f() { return ${a}.len(); }`);
    add("string bytes", `export i32 f() { u8[] b = ${a}.toBytes(); return b.len(); }`);
    add("string roundtrip", `export bool f() { return string.fromBytes(${a}.toBytes()) == ${a}; }`);
    for (const b of STRS.slice(0, 4)) {
      add("string concat", `export i32 f() { return (${a} + ${b}).len(); }`);
      add("string eq", `export bool f() { return ${a} == ${b}; }`);
      add("string concat eq", `export bool f() { return (${a} + ${b}) == (${a} + ${b}); }`);
    }
  }

  // Structs: one field of each type, written and read.
  for (const t of NUMS) {
    for (const v of VALUES[t].slice(0, 2)) {
      add(`struct ${t}`, `struct P { ${t} v; } export ${t} f() { P p = P(${v}); return p.v; }`);
      add(`struct ${t} set`,
        `struct P { ${t} v; } export ${t} f() { P p = P(${v}); p.v = ${v}; return p.v; }`);
      add(`struct ${t} method`,
        `struct P { ${t} v; ${t} get(const this) { return this.v; } } ` +
        `export ${t} f() { P p = P(${v}); return p.get(); }`);
    }
  }
  return out;
}
