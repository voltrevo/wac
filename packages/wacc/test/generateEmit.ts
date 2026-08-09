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

  // Enums: a tag, a payload, and the four things a program does with one — construct it, match it,
  // narrow it, test it. The payload type is the axis, since a payload slot is a struct field and
  // every field type has its own instruction.
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][0];
    const E = `enum E { A, B(${t} x), C(${t} p, ${t} q) }\n`;
    add(`enum ${t} construct`,
      E + `export ${t} f() { E e = E.B(${v}); match (e) { case A: return ${w}; ` +
      `case B(x): return x; case C(p, q): return p; } }`);
    add(`enum ${t} second payload`,
      E + `export ${t} f() { E e = E.C(${w}, ${v}); match (e) { case A: return ${w}; ` +
      `case B(x): return x; case C(p, q): return q; } }`);
    add(`enum ${t} payload-less`,
      E + `export ${t} f() { E e = E.A; match (e) { case A: return ${v}; ` +
      `case B(x): return x; case C(p, q): return p; } }`);
    add(`enum ${t} else arm`,
      E + `export ${t} f() { E e = E.B(${v}); match (e) { case B(x): return x; else: return ${w}; } }`);
    add(`enum ${t} ignored payload`,
      E + `export ${t} f() { E e = E.C(${v}, ${w}); match (e) { case C(_, q): return q; ` +
      `else: return ${w}; } }`);
    add(`enum ${t} narrowed field`,
      E + `export ${t} f() { E e = E.B(${v}); match (e) { case B: return e.x; else: return ${w}; } }`);
    add(`enum ${t} is`,
      E + `export bool f() { E e = E.B(${v}); return e is B; }`);
    add(`enum ${t} is other`,
      E + `export bool f() { E e = E.C(${v}, ${w}); return e is B; }`);
    add(`enum ${t} through a call`,
      E + `${t} g(E e) { match (e) { case A: return ${w}; case B(x): return x; ` +
      `case C(p, q): return p + q; } }\n` +
      `export ${t} f() { return g(E.C(${v}, ${w})) + g(E.B(${v})) + g(E.A); }`);
    add(`enum ${t} in an array`,
      E + `export ${t} f() { E[] es = E[](E.A, E.B(${v}), E.C(${v}, ${w})); ${t} n = ${w}; ` +
      `for (i32 i = 0; i < 3; i++) { match (es[i]) { case A: n = n + ${w}; case B(x): n = n + x; ` +
      `case C(p, q): n = n + q; } } return n; }`);
    add(`enum ${t} in a struct`,
      E + `struct H { E e; }\nexport ${t} f() { H h = H(E.B(${v})); ` +
      `match (h.e) { case B(x): return x; else: return ${w}; } }`);
    add(`enum ${t} as an expression`,
      E + `export ${t} f() { E e = E.B(${v}); return match (e) { case A: ${w}, case B(x): x, ` +
      `case C(p, q): q }; }`);
  }

  // The shapes that are about the *enum* rather than its payload: many variants, so a tag is not a
  // boolean; a variant with a reference payload; a match whose arms fall through to other control
  // flow; and a `break` inside an arm, which leaves the enclosing loop rather than the match.
  const TAGS = ["A", "B", "C", "D", "E", "F", "G", "H"];
  for (let n = 2; n <= TAGS.length; n++) {
    const decl = `enum T { ${TAGS.slice(0, n).join(", ")} }\n`;
    for (let k = 0; k < n; k++) {
      add(`enum tag ${k}/${n}`,
        decl + `export i32 f() { T t = T.${TAGS[k]}; match (t) { ` +
        TAGS.slice(0, n).map((c, i) => `case ${c}: return ${i * 3 + 1};`).join(" ") + ` } }`);
    }
  }
  add("enum reference payload",
    `enum V { N(i32 x), S(string s), L(i32[] xs) }\n` +
    `export i32 f() { V v = V.L(i32[](1, 2, 3)); match (v) { case N(x): return x; ` +
    `case S(s): return s.len(); case L(xs): return xs.len(); } }`);
  add("enum string payload",
    `enum V { N(i32 x), S(string s) }\n` +
    `export i32 f() { V v = V.S("hello"); match (v) { case N(x): return x; ` +
    `case S(s): return s.len(); } }`);
  add("enum break leaves the loop",
    `enum S { Go, Stop }\nstruct H { S s; }\n` +
    `export i32 f() { H h = H(S.Go); i32 n = 0; ` +
    `while (n < 100) { n = n + 1; match (h.s) { case Go: { if (n > 3) { h = H(S.Stop); } } ` +
    `case Stop: break; } } return n; }`);
  add("enum nested match",
    `enum A { P(i32 v), Q }\nenum B { R(i32 w), S }\n` +
    `export i32 f() { A a = A.P(4); B b = B.R(5); match (a) { case P(v): { ` +
    `match (b) { case R(w): return v * w; case S: return v; } } case Q: return 0; } return -1; }`);
  add("enum two payloads named alike",
    `enum W { Add(i32 lhs, i32 rhs), Neg(i32 lhs) }\n` +
    `export i32 f() { W w = W.Add(3, 4); match (w) { case Add(a, b): return a + b; ` +
    `case Neg(a): return 0 - a; } }`);

  // Nullable references, which are the same wasm type as the ones that are not: what varies is
  // whether the value is there, so every cell is generated in both states and the pair is the point.
  for (const t of ["i32", "f64", "string"]) {
    const some = t === "string" ? `"abc"` : t === "f64" ? `1.5` : `7`;
    const arr = t === "string" ? `string[]` : `${t}[]`;
    add(`null ${t} array is null`, `export bool f() { ${arr}? a = null; return a is null; }`);
    add(`null ${t} array is not null`,
      `export bool f() { ${arr}? a = ${arr}(${some}, ${some}); return a is null; }`);
    add(`null ${t} array unwrapped`,
      `export i32 f() { ${arr}? a = ${arr}(${some}, ${some}); return a!.len(); }`);
    add(`null ${t} struct is null`,
      `struct P { ${t} v; }\nexport bool f() { P? p = null; return p is null; }`);
    add(`null ${t} struct unwrapped`,
      t === "string"
        ? `struct P { ${t} v; }\nexport i32 f() { P? p = P(${some}); return p!.v.len(); }`
        : `struct P { ${t} v; }\nexport ${t} f() { P? p = P(${some}); return p!.v; }`);
    add(`null ${t} guarded`,
      `struct P { ${t} v; }\nexport bool f() { P? p = null; if (p is null) { return true; } ` +
      `return p!.v == ${some}; }`);
    add(`null ${t} from a function`,
      `struct P { ${t} v; }\nP? mk(bool y) { if (y) { return P(${some}); } return null; }\n` +
      `export bool f() { return (mk(false) is null) && !(mk(true) is null); }`);
    add(`null ${t} in a field`,
      `struct N { ${t} v; N? next; }\nexport bool f() { N tail = N(${some}, null); ` +
      `N head = N(${some}, tail); return (tail.next is null) && !(head.next is null); }`);
    add(`null ${t} identity`,
      `struct P { ${t} v; }\nexport bool f() { P a = P(${some}); P b = a; P c = P(${some}); ` +
      `return (a is b) && !(a is c); }`);
    add(`null ${t} ternary`,
      `export i32 f() { ${arr}? a = null; return a is null ? 5 : a!.len(); }`);
  }

  // Compound assignment, over the three things that can be on the left of it.
  //
  // A local was the only one any hand-written case had ever compounded into, and the other two were
  // *wrong*: `p.x += 5` emitted `p.x = 5`, dropping the operator entirely. It validated — the field
  // is an `i32` either way — so only running it could tell.
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][3] ?? VALUES[t][1];
    const ops = t.startsWith("f") ? ["+=", "-=", "*=", "/="] : ["+=", "-=", "*=", "/=", "%=", "&=", "|=", "^="];
    for (const op of ops) {
      add(`compound local ${t} ${op}`,
        `export ${t} f() { ${t} n = ${v}; n ${op} ${w}; return n; }`);
      add(`compound field ${t} ${op}`,
        `struct P { ${t} x; }\nexport ${t} f() { P p = P(${v}); p.x ${op} ${w}; return p.x; }`);
      add(`compound element ${t} ${op}`,
        `export ${t} f() { ${t}[] a = ${t}[](${v}, ${v}); a[1] ${op} ${w}; return a[1]; }`);
      add(`compound element ${t} ${op} computed index`,
        `export ${t} f() { ${t}[] a = ${t}[](${v}, ${v}); i32 i = 1; a[i] ${op} ${w}; ` +
        `return a[i] + a[0]; }`);
      add(`compound field ${t} ${op} twice`,
        `struct P { ${t} x; ${t} y; }\nexport ${t} f() { P p = P(${v}, ${w}); p.x ${op} ${w}; ` +
        `p.y ${op} p.x; return p.y; }`);
    }
  }
  // A string is the one reference that can be compounded, and `+=` is the only operator for it.
  for (const a of ['""', '"a"', '"hello"']) {
    add("compound local string",
      `export i32 f() { string s = ${a}; s += "tail"; return s.len(); }`);
    add("compound field string",
      `struct P { string s; }\nexport i32 f() { P p = P(${a}); p.s += "tail"; return p.s.len(); }`);
    add("compound element string",
      `export i32 f() { string[] xs = string[](${a}, ${a}); xs[0] += "tail"; ` +
      `return xs[0].len() + xs[1].len(); }`);
    add("compound string in a loop",
      `export i32 f() { string s = ${a}; for (i32 i = 0; i < 3; i++) { s += "ab"; } return s.len(); }`);
  }

  // The statics on a primitive: a receiver that is a type name rather than a value, and one
  // reinterpret instruction each. Round-tripped as well as read, since a pair of instructions that
  // are each other's inverse is the one shape where two wrongs agree.
  for (const [t, bits] of [["f32", "u32"], ["f64", "u64"]] as const) {
    for (const v of VALUES[t]) {
      add(`${t}.toBits`, `export ${bits} f() { return ${t}.toBits(${v}); }`);
      add(`${t}.toBits via local`, `export ${bits} f() { ${t} x = ${v}; return ${t}.toBits(x); }`);
      add(`${t} bits round trip`,
        `export bool f() { ${t} x = ${v}; return ${t}.fromBits(${t}.toBits(x)) == x; }`);
      add(`${t} bits are not the value`,
        `export bool f() { ${t} x = ${v}; return ${t}.toBits(x) == 0; }`);
    }
    for (const v of VALUES[bits]) {
      add(`${t}.fromBits`, `export bool f() { ${t} x = ${t}.fromBits(${v}); return x == x; }`);
    }
  }

  // Indexing a string, which is a decode rather than a read. The strings here are chosen for their
  // *encodings* — one, two, three and four byte characters, and the offsets in the middle of each —
  // since a decoder that reads the lead byte and a decoder that reads any byte agree on ASCII.
  const UTF8 = ['"hello"', '"h\u00e9llo"', '"a\u{1f600}b"', '"\u{20ac}"', '"\u00e9\u00e9"', '""'];
  for (const s2 of UTF8) {
    for (let i = 0; i < 6; i++) {
      add(`string index ${i}`, `export i32 f() { string s = ${s2}; return s.len() > ${i} ? s[${i}].len() : -1; }`);
      add(`string index ${i} equals itself`,
        `export bool f() { string s = ${s2}; return s.len() > ${i} ? s[${i}] == s[${i}] : true; }`);
    }
    add("string index sums to the length",
      `export i32 f() { string s = ${s2}; i32 n = 0; for (i32 i = 0; i < s.len(); i++) { ` +
      `n = n + s[i].len(); } return n; }`);
    add("string index concatenated back",
      `export i32 f() { string s = ${s2}; string out = ""; ` +
      `for (i32 i = 0; i < s.len(); i++) { out += s[i]; } return out == s ? 1 : out.len(); }`);
    add("string index of a computed string",
      `export i32 f() { string s = ${s2} + "z"; return s[s.len() - 1].len(); }`);
  }

  // Function references: obtained by name, called through a value. Every cell exists in a version
  // that calls one function and a version that calls another through the same reference, because a
  // `call_ref` that always reaches the same place is indistinguishable from a direct call.
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const decls = `${t} inc(${t} x) { return x + ${v}; }\n${t} dbl(${t} x) { return x + x; }\n`;
    add(`funcref ${t} local`,
      decls + `export ${t} f() { fn[${t}(${t})] g = inc; return g(${v}); }`);
    add(`funcref ${t} reassigned`,
      decls + `export ${t} f() { fn[${t}(${t})] g = inc; g = dbl; return g(${v}); }`);
    add(`funcref ${t} as a parameter`,
      decls + `${t} apply(fn[${t}(${t})] g, ${t} x) { return g(x); }\n` +
      `export ${t} f() { return apply(inc, ${v}) + apply(dbl, ${v}); }`);
    add(`funcref ${t} returned`,
      decls + `fn[${t}(${t})] pick(bool b) { if (b) { return inc; } return dbl; }\n` +
      `export ${t} f() { return pick(true)(${v}) + pick(false)(${v}); }`);
    add(`funcref ${t} in a struct`,
      decls + `struct H { fn[${t}(${t})] cb; }\n` +
      `export ${t} f() { H h = H(inc); H j = H(dbl); return h.cb(${v}) + j.cb(${v}); }`);
    add(`funcref ${t} in an array`,
      decls + `export ${t} f() { fn[${t}(${t})][] fs = fn[${t}(${t})][](inc, dbl); ` +
      `return fs[0](${v}) + fs[1](${v}); }`);
    add(`funcref ${t} nullable`,
      decls + `export bool f() { fn[${t}(${t})]? g = null; fn[${t}(${t})]? h = inc; ` +
      `return (g is null) && !(h is null) && h!(${v}) == inc(${v}); }`);
    add(`funcref ${t} two arguments`,
      `${t} add(${t} a, ${t} b) { return a + b; }\n${t} sub(${t} a, ${t} b) { return a - b; }\n` +
      `export ${t} f() { fn[${t}(${t},${t})] g = add; ${t} n = g(${v}, ${v}); g = sub; ` +
      `return n + g(${v}, ${v}); }`);
    add(`funcref ${t} void`,
      `struct C { ${t} n; }\nvoid bump(C c, ${t} by) { c.n += by; }\n` +
      `export ${t} f() { C c = C(${v}); fn[void(C,${t})] g = bump; g(c, ${v}); g(c, ${v}); ` +
      `return c.n; }`);
    add(`funcref ${t} through a chain`,
      decls + `fn[${t}(${t})] idOf(fn[${t}(${t})] g) { return g; }\n` +
      `export ${t} f() { return idOf(dbl)(${v}); }`);
  }
  // A reference to a function that takes and returns references, which is where the signature's own
  // parameter types have to have been registered before the type section was written.
  add("funcref over references",
    `u8[] head(u8[] xs) { return xs; }\n` +
    `export i32 f() { fn[u8[](u8[])] g = head; return g(u8[3]()).len(); }`);
  add("funcref over a struct",
    `struct P { i32 x; }\nP mk(i32 v) { return P(v); }\n` +
    `export i32 f() { fn[P(i32)] g = mk; return g(7).x; }`);
  add("funcref over a string",
    `string tail(string s) { return s + "!"; }\n` +
    `export i32 f() { fn[string(string)] g = tail; return g("ab").len(); }`);
  add("funcref of a funcref",
    `i32 one(i32 x) { return x + 1; }\n` +
    `fn[i32(i32)] outer(fn[i32(i32)] g) { return g; }\n` +
    `export i32 f() { fn[fn[i32(i32)](fn[i32(i32)])] h = outer; return h(one)(41); }`);

  // Module-level constants with identity. A scalar constant is inlined and has none; an array or a
  // struct is one value shared by every use, which is why it lives in a global — and why the cells
  // below ask *which* value as well as what it holds.
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][3] ?? VALUES[t][1];
    add(`const ${t} array`,
      `const ${t}[] A = ${t}[](${v}, ${w});\nexport ${t} f() { return A[0] + A[1]; }`);
    add(`const ${t} array is one array`,
      `const ${t}[] A = ${t}[](${v}, ${w});\n${t}[] g() { return A; }\n` +
      `export bool f() { return g() is A; }`);
    add(`const ${t} array through a function`,
      `const ${t}[] A = ${t}[](${v}, ${w});\n${t} sum(${t}[] xs) { return xs[0] + xs[1]; }\n` +
      `export ${t} f() { return sum(A); }`);
    add(`const ${t} struct`,
      `struct P { ${t} x; }\nconst P Q = P(${v});\nexport ${t} f() { return Q.x; }`);
    add(`const ${t} computed`,
      `const ${t}[] A = ${t}[2](fill: ${v});\nexport ${t} f() { return A[0] + A[1]; }`);
  }
  // The ones wasm cannot write in a global at all — a concatenation and a call are not constant
  // expressions, so the value arrives when the start function runs rather than when the module is
  // declared, and the only way to tell is to read it.
  add("const built by a call",
    `u8[] mk(i32 n) { return u8[n](); }\nconst u8[] T = mk(5);\nexport i32 f() { return T.len(); }`);
  add("const built by concatenation",
    `const string S = "ab" + "cd";\nexport i32 f() { return S.len(); }`);
  add("const built from another const",
    `const string A = "xy";\nconst string B = A + A;\nexport i32 f() { return B.len(); }`);
  add("const built by arithmetic",
    `const i32[] A = i32[](0 - 5, 3 * 4);\nexport i32 f() { return A[0] + A[1]; }`);
  add("const struct built by a call",
    `struct P { i32 x; }\nP mk() { return P(9); }\nconst P Q = mk();\nexport i32 f() { return Q.x; }`);
  add("const array of a computed length",
    `i32 n() { return 3; }\nconst i32[] A = i32[n()]();\nexport i32 f() { return A.len(); }`);
  add("const read before and after",
    `const string S = "a" + "b";\ni32 first() { return S.len(); }\n` +
    `export i32 f() { return first() + S.len(); }`);

  // Block scoping. A name declared in two blocks is two locals, and the pair that matters is two
  // blocks declaring it at two *types* — which is exactly what a name-to-slot table cannot hold, and
  // what this emitter used to decline the whole function for.
  for (const [a, b] of [["i32", "i64"], ["i32", "f64"], ["u8[]", "i32"], ["string", "i32"]] as const) {
    const av = a === "u8[]" ? "u8[](1, 2)" : a === "string" ? '"ab"' : VALUES[a][1];
    const bv = VALUES[b][1];
    const asize = a === "u8[]" || a === "string" ? "k.len()" : "k as~ i32";
    add(`scope ${a} then ${b}`,
      `export i32 f() { i32 n = 0; { ${a} k = ${av}; n = n + ${asize}; } ` +
      `{ ${b} k = ${bv}; n = n + (k as~ i32); } return n; }`);
    add(`scope ${a} shadowed by ${b}`,
      `export i32 f() { ${a} k = ${av}; i32 n = ${asize}; { ${b} k = ${bv}; n = n + (k as~ i32); } ` +
      `return n + ${asize}; }`);
    add(`scope ${a} in a loop then ${b}`,
      `export i32 f() { i32 n = 0; for (i32 i = 0; i < 2; i++) { ${a} k = ${av}; n = n + ${asize}; } ` +
      `{ ${b} k = ${bv}; n = n + (k as~ i32); } return n; }`);
    add(`scope ${a} in both arms`,
      `export i32 f() { i32 n = 0; if (n == 0) { ${a} k = ${av}; n = ${asize}; } ` +
      `else { ${b} k = ${bv}; n = k as~ i32; } return n; }`);
  }
  add("scope two loops one name",
    `export i32 f() { i32 n = 0; for (i32 i = 0; i < 3; i++) { n = n + i; } ` +
    `for (i64 i = 0; i < 3; i++) { n = n + (i as~ i32); } return n; }`);
  add("scope a name declared after a block that had it",
    `export i32 f() { { i32 k = 5; } i64 k = 7; return k as~ i32; }`);

  // `string.fromCodepoint`, whose answer is a *number of bytes* as much as a character — so the
  // cells straddle every boundary in UTF-8's encoding, and the two that must trap are here too.
  for (const cp of [0, 65, 127, 128, 233, 2047, 2048, 8364, 65535, 65536, 128512, 1114111]) {
    add(`fromCodepoint ${cp}`, `export i32 f() { return string.fromCodepoint(${cp}).len(); }`);
    add(`fromCodepoint ${cp} round trip`,
      `export bool f() { string s = string.fromCodepoint(${cp}); return s[0] == s; }`);
    add(`fromCodepoint ${cp} concatenated`,
      `export i32 f() { return ("x" + string.fromCodepoint(${cp})).len(); }`);
  }
  for (const bad of [55296, 57343, 1114112]) {
    add(`fromCodepoint ${bad} traps`, `export i32 f() { return string.fromCodepoint(${bad}).len(); }`);
  }

  // `slice` clamps and never traps, so every combination of arguments has an answer and all of them
  // are cells; `indexOf` answers -1 as readily as a position, and an empty needle is found at 0.
  for (const [a, b] of [[0, 5], [1, 3], [3, 99], [9, 99], [3, 1], [-2, 3], [2, 2], [0, 0], [-9, -1]]) {
    add(`slice ${a},${b}`, `export i32 f() { return "hello".slice(${a}, ${b}).len(); }`);
    add(`slice ${a},${b} of a computed string`,
      `export i32 f() { string s = "he" + "llo"; return s.slice(${a}, ${b}).len(); }`);
    add(`slice ${a},${b} equals itself`,
      `export bool f() { return "hello".slice(${a}, ${b}) == "hello".slice(${a}, ${b}); }`);
  }
  for (const n of ['"world"', '"o"', '"hello world"', '""', '"zz"', '"h"', '"d"', '"lo w"']) {
    add(`indexOf ${n}`, `export i32 f() { return "hello world".indexOf(${n}); }`);
    add(`indexOf ${n} in an empty string`, `export i32 f() { return "".indexOf(${n}); }`);
    add(`indexOf ${n} then slice`,
      `export i32 f() { string s = "hello world"; i32 at = s.indexOf(${n}); ` +
      `return at < 0 ? -1 : s.slice(at, s.len()).len(); }`);
  }

  // Character literals, which are integer literals wearing quotes — and which every literal in this
  // generator had been a number instead of, so `' '` compiled to 0 and `isSpace(c)` asked whether a
  // byte was NUL. The bootstrap found it; these keep it found.
  const CHARS = ["' '", "'a'", "'Z'", "'0'", "'~'", "'\\n'", "'\\t'", "'\\r'", "'\\\\'", "'\\''", "'\u00e9'", "'\u20ac'"];
  for (const c of CHARS) {
    add(`char ${c}`, `export i32 f() { return ${c}; }`);
    add(`char ${c} compared`, `export bool f() { i32 x = 32; return x == ${c}; }`);
    add(`char ${c} in a chain`,
      `export bool f() { i32 x = ${c}; return x == ' ' || x == '\\t' || x == '\\n' || x == ${c}; }`);
    add(`char ${c} as an i64`, `export i64 f() { i64 x = ${c}; return x + 1; }`);
    add(`char ${c} indexed against`,
      `export i32 f() { u8[] b = "a b"; i32 n = 0; for (i32 i = 0; i < 3; i++) ` +
      `{ if (b[i] == ${c}) { n++; } } return n; }`);
  }
  // Incrementing something that is not a local, which is what `lex.wac`'s cursor does and what
  // emitted nothing at all until the bootstrap ran.
  for (const t of ["i32", "u32", "f64"]) {
    add(`increment a field ${t}`,
      `struct P { ${t} x; }\nexport ${t} f() { P p = P(1); p.x++; p.x++; p.x--; return p.x; }`);
    add(`increment an element ${t}`,
      `export ${t} f() { ${t}[] a = ${t}[](1, 2); a[1]++; a[0]--; return a[0] + a[1]; }`);
    add(`increment a field in a loop ${t}`,
      `struct C { ${t} n; }\nexport ${t} f() { C c = C(0); while (c.n < 4) { c.n++; } return c.n; }`);
    add(`increment through a method ${t}`,
      `struct C { ${t} n; void bump(this) { this.n++; } }\n` +
      `export ${t} f() { C c = C(0); for (i32 i = 0; i < 5; i++) { c.bump(); } return c.n; }`);
  }

  // Where the `else` arm is *written*. It is the default wherever it stands, and this emitter used
  // to emit each arm's body where the arm stood — so an `else` written first ran unconditionally and
  // no `case` was ever reached. Every generated match had put `else` last, which is why 3,700
  // programs missed it and a compiler compiling itself did not.
  const ARMS = ["case A(x): { n = x; }", "case B(y): { n = y * 10; }", "else: { n = 99; }"];
  const K = `enum K { A(i32 x), B(i32 y), C }\n`;
  for (let pos = 0; pos < 3; pos++) {
    const arms = [...ARMS];
    arms.splice(pos, 0, ...arms.splice(2, 1));
    for (const v of ["K.A(5)", "K.B(5)", "K.C"]) {
      add(`match else at ${pos} on ${v}`,
        K + `export i32 f() { K k = ${v}; i32 n = 0; match (k) { ${arms.join(" ")} } return n; }`);
    }
    const vals = ["case A(x): x", "case B(y): y * 10", "else: 99"];
    const varms = [...vals];
    varms.splice(pos, 0, ...varms.splice(2, 1));
    for (const v of ["K.A(5)", "K.B(5)", "K.C"]) {
      add(`match expression else at ${pos} on ${v}`,
        K + `export i32 f() { K k = ${v}; return match (k) { ${varms.join(", ")} }; }`);
    }
  }

  // Templates. `Box<T>` is not a type and `Box<i32>` is, so a template is compiled once per
  // instantiation — and the cells that matter are the ones with *two* instantiations in one module,
  // since a single one cannot tell a substitution from a rename.
  const BOX = `struct Box<T> { T v; Box<T> of(T x) { return Box(x); } T get(const this) { return this.v; } ` +
    `void set(this, T x) { this.v = x; } }\n`;
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][3] ?? VALUES[t][1];
    add(`template ${t}`, BOX + `export ${t} f() { Box<${t}> b = Box.of(${v}); return b.get(); }`);
    add(`template ${t} mutated`,
      BOX + `export ${t} f() { Box<${t}> b = Box.of(${v}); b.set(${w}); return b.get(); }`);
    add(`template ${t} beside another`,
      BOX + `export ${t} f() { Box<${t}> a = Box.of(${v}); Box<bool> b = Box.of(true); ` +
      `return b.get() ? a.get() : ${w}; }`);
    add(`template ${t} nested`,
      BOX + `export ${t} f() { Box<${t}> inner = Box.of(${v}); Box<Box<${t}>> outer = Box.of(inner); ` +
      `return outer.get().get(); }`);
    add(`template ${t} of an array`,
      BOX + `export i32 f() { Box<${t}[]> b = Box.of(${t}[](${v}, ${w})); return b.get().len(); }`);
    add(`template ${t} in a field`,
      BOX + `struct H { Box<${t}> b; }\nexport ${t} f() { H h = H(Box.of(${v})); return h.b.get(); }`);
    add(`template ${t} through a call`,
      BOX + `${t} peek(Box<${t}> b) { return b.get(); }\n` +
      `export ${t} f() { return peek(Box.of(${v})); }`);
  }
  add("template with a string",
    BOX + `export i32 f() { Box<string> b = Box.of("hello"); return b.get().len(); }`);
  add("template beside the string helpers",
    BOX + `export i32 f() { Box<string> b = Box.of("a" + "b"); Box<i32> n = Box.of(3); ` +
    `return b.get().len() + n.get(); }`);

  // Generic enums, and templates with **two** type parameters — which failed for a reason no
  // one-parameter cell could show: a signature is spelled `fn[bool(Result<i32,string>)]`, and a
  // scanner that nests brackets but not angle brackets reads the comma inside the instantiation as
  // a parameter separator. The function then declared one parameter while its type said two.
  const OPT = `enum Opt<T> { Some(T v), None\n` +
    `  bool isSome(const this) { return match (this) { case Some(_): true, case None: false }; }\n` +
    `  T orElse(const this, T d) { match (this) { case Some(v): { return v; } case None: { return d; } } }\n}\n`;
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][3] ?? VALUES[t][1];
    add(`generic enum ${t} some`, OPT + `export ${t} f() { Opt<${t}> o = Opt.Some(${v}); return o.orElse(${w}); }`);
    add(`generic enum ${t} none`, OPT + `export ${t} f() { Opt<${t}> o = Opt.None; return o.orElse(${w}); }`);
    add(`generic enum ${t} tested`, OPT + `export bool f() { Opt<${t}> o = Opt.Some(${v}); return o.isSome(); }`);
    add(`generic enum ${t} matched`,
      OPT + `export ${t} f() { Opt<${t}> o = Opt.Some(${v}); ` +
      `match (o) { case Some(x): { return x; } case None: { return ${w}; } } }`);
    add(`generic enum ${t} beside another instance`,
      OPT + `export ${t} f() { Opt<${t}> a = Opt.Some(${v}); Opt<bool> b = Opt.None; ` +
      `return b.isSome() ? ${w} : a.orElse(${w}); }`);
    add(`two type parameters ${t}`,
      `struct Two<A, B> { A a; B b; Two<A,B> of(A x, B y) { return Two(x, y); } ` +
      `A first(const this) { return this.a; } B second(const this) { return this.b; } }\n` +
      `export ${t} f() { Two<${t}, bool> p = Two.of(${v}, true); ` +
      `return p.second() ? p.first() : ${w}; }`);
    add(`two type parameters ${t} reversed`,
      `struct Two<A, B> { A a; B b; Two<A,B> of(A x, B y) { return Two(x, y); } ` +
      `B second(const this) { return this.b; } }\n` +
      `export ${t} f() { Two<bool, ${t}> p = Two.of(false, ${v}); return p.second(); }`);
  }
  add("two type parameters over references",
    `struct Two<A, B> { A a; B b; Two<A,B> of(A x, B y) { return Two(x, y); } ` +
    `i32 sizes(const this) { return this.a.len() + this.b.len(); } }\n` +
    `export i32 f() { Two<string, i32[]> p = Two.of("abc", i32[](1, 2)); return p.sizes(); }`);
  add("a generic enum with two parameters",
    `enum Res<T, E> { Ok(T v), Err(E e)\n  bool isOk(const this) { return match (this) { case Ok(_): true, case Err(_): false }; }\n}\n` +
    `export bool f() { Res<i32, string> r = Res.Ok(3); Res<i32, string> b = Res.Err("no"); ` +
    `return r.isOk() && !b.isOk(); }`);

  // Two enums in one module that share a variant name. The corpus has an `Opened.Ok` and a
  // `Found.Ok`, and resolving an arm by file scope rather than within the enum being matched finds
  // whichever was declared first — a different enum's variant with the same spelling.
  const TWO = `enum Opened { Ok(i32 fd), Denied }\nenum Found { Ok(i32 at), Missing }\n`;
  for (const [subject, arms, expect] of [
    ["Opened.Ok(7)", "case Ok(fd): { return fd; } case Denied: { return -1; }", "Opened"],
    ["Opened.Denied", "case Ok(fd): { return fd; } case Denied: { return -1; }", "Opened"],
    ["Found.Ok(9)", "case Ok(at): { return at; } case Missing: { return -2; }", "Found"],
    ["Found.Missing", "case Ok(at): { return at; } case Missing: { return -2; }", "Found"],
  ] as const) {
    add(`two enums one variant name: ${subject}`,
      TWO + `export i32 f() { ${expect} v = ${subject}; match (v) { ${arms} } }`);
  }
  add("two enums one variant name, both matched",
    TWO + `i32 a(Opened o) { match (o) { case Ok(fd): { return fd; } case Denied: { return -1; } } }\n` +
    `i32 b(Found g) { match (g) { case Ok(at): { return at * 10; } case Missing: { return -2; } } }\n` +
    `export i32 f() { return a(Opened.Ok(3)) + b(Found.Ok(4)); }`);

  // A template's static in the two slots an array gives it — a `fill:` and a literal element — where
  // the element type is the only thing that says which instantiation is meant.
  const BOX2 = `struct Box<T> { T v; Box<T> of(T x) { return Box(x); } T get(const this) { return this.v; } }\n`;
  add("template static as an array fill",
    BOX2 + `export i32 f() { Box<i32>[] bs = Box<i32>[3](fill: Box.of(4)); return bs[2].get(); }`);
  add("template static as an array element",
    BOX2 + `export i32 f() { Box<i32>[] bs = Box<i32>[](Box.of(4), Box.of(5)); ` +
    `return bs[0].get() + bs[1].get(); }`);
  add("template static in a nested array",
    BOX2 + `export i32 f() { Box<string>[] bs = Box<string>[2](fill: Box.of("ab")); ` +
    `return bs[1].get().len(); }`);

  // `fill(value, start, count)`, which is one instruction whose operands the language writes in a
  // different order — and the ranges are the point, since a fill that ignores its bounds passes any
  // cell that fills the whole array.
  for (const t of NUMS) {
    const v = VALUES[t][1];
    const w = VALUES[t][3] ?? VALUES[t][1];
    add(`fill ${t} whole`,
      `export ${t} f() { ${t}[] a = ${t}[3](fill: ${w}); a.fill(${v}, 0, 3); ` +
      `return a[0] + a[1] + a[2]; }`);
    add(`fill ${t} middle`,
      `export ${t} f() { ${t}[] a = ${t}[4](fill: ${w}); a.fill(${v}, 1, 2); ` +
      `return a[0] + a[1] + a[2] + a[3]; }`);
    add(`fill ${t} none`,
      `export ${t} f() { ${t}[] a = ${t}[3](fill: ${w}); a.fill(${v}, 1, 0); ` +
      `return a[0] + a[1] + a[2]; }`);
    add(`fill ${t} computed`,
      `export ${t} f() { ${t}[] a = ${t}[4](fill: ${w}); i32 n = 2; a.fill(${v}, 2, n); ` +
      `return a[2] + a[3] + a[0]; }`);
  }
  // Assigning `null` — where the slot is the assignment's target rather than a declaration.
  add("null assigned to a local",
    `struct P { i32 x; }\nexport bool f() { P? p = P(1); p = null; return p is null; }`);
  add("null assigned to an array local",
    `export bool f() { i32[]? a = i32[](1, 2); a = null; return a is null; }`);
  add("null assigned to a field",
    `struct N { i32 v; N? next; }\n` +
    `export bool f() { N n = N(1, N(2, null)); n.next = null; return n.next is null; }`);
  add("null assigned to an element",
    `struct P { i32 x; }\nexport bool f() { P?[] ps = P?[2](); ps[0] = P(1); ps[0] = null; ` +
    `return ps[0] is null; }`);

  // A cast to `bool` is a test, not a reinterpretation — and `bool` is an `i32` here, so the
  // same-width rule called it a no-op and left the number on the stack.
  for (const t of ["i32", "u32", "i64", "u64"]) {
    for (const v of ["0", "1", "5", "255"]) {
      add(`cast ${t} to bool`, `export bool f() { ${t} x = ${v}; return (x as~ bool) == (${v} != 0); }`);
      add(`cast ${t} to bool then back`,
        `export i32 f() { ${t} x = ${v}; bool b = x as~ bool; return b ? 1 : 0; }`);
    }
  }
  // Every slot of `P[n]()` is its **own** struct: `array.new` repeats one reference, and writing
  // through the first would then be visible through the second.
  add("sized array of structs is distinct",
    `struct P { i32 v; }\nexport i32 f() { P[] a = P[3](); a[0].v = 9; return a[1].v + a[2].v; }`);
  add("sized array of structs, computed size",
    `struct P { i32 v; }\nexport i32 f() { i32 n = 3; P[] a = P[n](); a[0].v = 9; a[2].v = 4; ` +
    `return a[1].v * 100 + a[2].v; }`);
  add("a fill shares one, deliberately",
    `struct P { i32 v; }\nexport i32 f() { P[] a = P[2](fill: P(1)); a[0].v = 9; return a[1].v; }`);
  add("sized array of nested structs is distinct",
    `struct Q { i32 w; }\nstruct R { Q q; }\n` +
    `export i32 f() { R[] a = R[2](); a[0].q.w = 7; return a[1].q.w; }`);
  add("a sized array of strings still shares",
    `export i32 f() { string[] a = string[2](); return a[0].len() + a[1].len(); }`);

  // Float literals, compared as **bits** rather than as numbers, because a printed float hides the
  // last place it differs in. These are the values that break a conversion which scales by tens: the
  // two ends of the range, both sides of the subnormal boundary, a mantissa longer than an `f64`
  // holds, and the exponents where a power of ten stops being exact.
  const FLOATS = [
    "0.0", "1.0", "1.5", "0.1", "3.14", "2e-3", "6.283185307179586", "1_000.5", "0.000_1",
    "1e1", "1e2", "1e22", "1e23", "1e-7", "1e300", "1e-300", "1e308", "1e-308",
    "1.7976931348623157e308", "2.2250738585072014e-308", "5e-324", "4.9e-324", "1e-323",
    "0.30000000000000004", "9007199254740993.0", "123456789012345678901234567890.5",
    "1.000000000000000000000000000001", "0.5", "0.25", "1e-45", "3.4028235e38", "2.5E2",
  ];
  for (const lit of FLOATS) {
    add(`float bits ${lit}`, `export u64 f() { return f64.toBits(${lit}); }`);
    add(`float round trip ${lit}`,
      `export bool f() { f64 x = ${lit}; return f64.fromBits(f64.toBits(x)) == x; }`);
    add(`float negated ${lit}`, `export u64 f() { return f64.toBits(0.0 - ${lit}); }`);
  }
  for (const lit of ["1.5", "0.1", "3.4028235e38", "1e-45", "0.0"]) {
    add(`float32 bits ${lit}`, `export u32 f() { return f32.toBits(${lit}); }`);
  }

  // String ordering, which is lexicographic **by bytes** — so a prefix is less than what extends it,
  // and UTF-8 sorts by codepoint without anything having to know that.
  const WORDS = ['""', '"a"', '"b"', '"ab"', '"abc"', '"abd"', '"Z"', '"\u00e9"', '"aa"'];
  for (const a of WORDS) {
    for (const b of WORDS) {
      for (const op of ["<", "<=", ">", ">="]) {
        add(`string ${op}`, `export bool f() { return ${a} ${op} ${b}; }`);
      }
    }
  }
  add("string ordering through locals",
    `export bool f() { string a = "ab"; string b = "abc"; return a < b && b > a && a <= a && a >= a; }`);
  add("string ordering of a computed string",
    `export bool f() { string a = "a" + "b"; return a < "ac" && a > "aa"; }`);

  // `x is T` where `T` is the value's own type asks whether it is there at all — the same question
  // `is null` asks, from the other side.
  const N = `struct P { i32 v; }\nP? find(bool y) { if (y) { return P(3); } return null; }\n`;
  add("is T on a present value", N + `export bool f() { return find(true) is P; }`);
  add("is T on an absent value", N + `export bool f() { return find(false) is P; }`);
  add("is not T", N + `export bool f() { return find(false) is not P; }`);
  add("is T guards the unwrap",
    N + `export i32 f() { P? p = find(true); if (p is P) { return p!.v; } return 0; }`);
  add("is T on an array", `export bool f() { i32[]? a = i32[](1); return a is i32[]; }`);
  add("is T on a null string", `export bool f() { string? s = null; return s is string; }`);

  // `++` and `--` **as expressions**, which the emitter accepted as statements long before it could
  // produce a value. The whole of what distinguishes the two forms is which value is the answer, so
  // every shape below is generated both ways round: a difference of one is exactly the bug to catch.
  for (const op of ["++", "--"]) {
    for (const pre of [true, false]) {
      const e = (t: string) => (pre ? `${op}${t}` : `${t}${op}`);
      const tag = `${pre ? "prefix" : "postfix"} ${op}`;
      add(`${tag} on a local`, `export i32 f() { i32 x = 5; i32 v = ${e("x")}; return v * 100 + x; }`);
      add(`${tag} on an i64 local`,
        `export i32 f() { i64 x = 5; i64 v = ${e("x")}; return (v * 100 + x) as! i32; }`);
      add(`${tag} on a u16 local`,
        `export i32 f() { i32 x = 5; i32 v = ${e("x")}; return v * 100 + x; }`);
      add(`${tag} on a field`,
        `struct P { i32 v; }\nexport i32 f() { P p = P(5); i32 v = ${e("p.v")}; return v * 100 + p.v; }`);
      add(`${tag} through an unwrap`,
        `struct P { i32 v; }\nP? mk() { return P(5); }\n` +
        `export i32 f() { P? p = mk(); i32 v = ${e("p!.v")}; return v * 100 + p!.v; }`);
      add(`${tag} on an element`,
        `export i32 f() { i32[] a = i32[3](fill: 5); i32 v = ${e("a[1]")}; return v * 100 + a[1] + a[0]; }`);
      add(`${tag} on a u8 element`,
        `export i32 f() { u8[] a = u8[3](fill: 5); i32 v = ${e("a[1]")}; return v * 100 + a[1]; }`);
      add(`${tag} in a condition`,
        `export i32 f() { i32 i = 0; i32 n = 0; while (${e("i")} < 3) { n = n + 1; } return n * 100 + i; }`);
      add(`${tag} as an argument`,
        `i32 g(i32 a) { return a * 2; }\nexport i32 f() { i32 i = 3; return g(${e("i")}) * 100 + i; }`);
      add(`${tag} as an index`,
        `export i32 f() { i32[] a = i32[4](fill: 0); i32 i = 1; a[${e("i")}] = 9; return a[1] * 100 + a[2] * 10 + i; }`);
      add(`${tag} twice in one expression`,
        `export i32 f() { i32 i = 1; i32 v = ${e("i")} + ${e("i")}; return v * 100 + i; }`);
      // A `for` update takes the **postfix** form only — `for (…; …; ++i)` is a parse error, which
      // is the grammar's answer rather than this generator's, so only one of the two goes in.
      if (!pre) {
        add(`${tag} in a for update`,
          `export i32 f() { i32 n = 0; for (i32 i = 0; i < 4; ${e("i")}) { n = n + ${e("i")}; } return n; }`);
      }
      add(`${tag} discarded then read`,
        `export i32 f() { i32 x = 7; ${e("x")}; return x; }`);
      add(`${tag} of a field of an element`,
        `struct P { i32 v; }\nexport i32 f() { P[] a = P[2](fill: P(4)); i32 v = ${e("a[0].v")}; return v * 100 + a[0].v; }`);
    }
  }
  // **Named construction is positional construction with the arguments out of order**, so the thing
  // to generate is orders: every permutation of three fields lands on the same value, and a wrong
  // one lands on a different value rather than an invalid module — which is why these compare
  // answers rather than validity.
  {
    const S3 = `struct T3 { i32 a; i32 b; i32 c; }\n`;
    const perms = [["a", "b", "c"], ["a", "c", "b"], ["b", "a", "c"], ["b", "c", "a"],
                   ["c", "a", "b"], ["c", "b", "a"]];
    const v: Record<string, string> = { a: "1", b: "20", c: "300" };
    for (const perm of perms) {
      const fields = perm.map((f) => `${f}: ${v[f]}`).join(", ");
      add(`named construction ${perm.join("")}`,
        `${S3}export i32 f() { T3 t = T3 { ${fields} }; return t.a + t.b + t.c + t.a * 1000; }`);
    }
    add("named construction of mixed types",
      `struct M { string s; i32 n; bool b; }\n` +
      `export i32 f() { M m = M { b: true, n: 7, s: "ab" }; return m.n * 10 + m.s.len() + (m.b ? 100 : 0); }`);
    add("named construction nested in another",
      `struct In { i32 v; }\nstruct Out { i32 n; In i; }\n` +
      `export i32 f() { Out o = Out { i: In { v: 4 }, n: 5 }; return o.n * 10 + o.i.v; }`);
    add("named construction of a single field",
      `struct One { i32 v; }\nexport i32 f() { One o = One { v: 9 }; return o.v; }`);
    add("named construction as an argument",
      `struct P2 { i32 x; i32 y; }\ni32 g(P2 p) { return p.x - p.y; }\n` +
      `export i32 f() { return g(P2 { y: 1, x: 8 }); }`);
    add("named construction returned",
      `struct P2 { i32 x; i32 y; }\nP2 mk() { return P2 { y: 2, x: 3 }; }\n` +
      `export i32 f() { return mk().x * 10 + mk().y; }`);
    add("named construction of an array element",
      `struct P2 { i32 x; i32 y; }\n` +
      `export i32 f() { P2[] a = P2[](P2 { y: 1, x: 2 }, P2 { x: 3, y: 4 }); return a[0].x * 10 + a[1].y; }`);
    add("named construction as a constant",
      `struct P2 { i32 x; i32 y; }\nconst P2 K = P2 { y: 6, x: 7 };\n` +
      `export i32 f() { return K.x * 10 + K.y; }`);
    add("named construction of a struct holding a string",
      `struct S1 { string a; string b; }\n` +
      `export i32 f() { S1 s = S1 { b: "xy", a: "z" }; return s.a.len() * 10 + s.b.len(); }`);
  }

  // **Subtyping**, which is `sub` in the type section and nothing at all at the use site: a `Rect`
  // reference already is a `Shape` reference once the types say so. What can go wrong is *slots* —
  // a subtype repeats its parent's fields before appending its own, so an emitter that forgets the
  // offset reads `w` where the program said `x` and returns a plausible number. Hence answers.
  {
    const H = `struct Shape { i32 x; i32 y; i32 name(const this) { return 1; } i32 getX(const this) { return this.x; } }\n` +
      `struct Rect : Shape { i32 w; i32 h; override i32 name(const this) { return 2; } i32 area(const this) { return this.w * this.h; } }\n` +
      `struct Circle : Shape { i32 r; override i32 name(const this) { return 3; } }\n`;
    add("subtype construction takes parent fields first",
      `${H}export i32 f() { Rect r = Rect(1, 2, 10, 20); return r.x * 1000 + r.y * 100 + r.w * 10 + r.h; }`);
    add("a subtype's own field after the inherited ones",
      `${H}export i32 f() { Rect r = Rect(1, 2, 10, 20); return r.w * 100 + r.h; }`);
    add("an inherited field read through the child",
      `${H}export i32 f() { Rect r = Rect(7, 8, 1, 1); return r.x * 10 + r.y; }`);
    add("an inherited field written through the child",
      `${H}export i32 f() { Rect r = Rect(1, 2, 3, 4); r.x = 9; r.h = 5; return r.x * 10 + r.h; }`);
    add("widening to the parent needs no instruction",
      `${H}export i32 f() { Rect r = Rect(4, 5, 6, 7); Shape s = r; return s.x * 10 + s.y; }`);
    add("an inherited method on the child",
      `${H}export i32 f() { Rect r = Rect(4, 5, 6, 7); return r.getX(); }`);
    add("an inherited method through the parent",
      `${H}export i32 f() { Rect r = Rect(4, 5, 6, 7); Shape s = r; return s.getX(); }`);
    add("an override is chosen by the static type",
      `${H}export i32 f() { Rect r = Rect(1, 2, 3, 4); Shape s = r; return r.name() * 10 + s.name(); }`);
    add("the child's own method",
      `${H}export i32 f() { Rect r = Rect(1, 2, 3, 4); return r.area(); }`);
    add("a subtype passed where the parent is wanted",
      `${H}i32 g(Shape s) { return s.x + s.y; }\nexport i32 f() { return g(Rect(3, 4, 0, 0)) * 10 + g(Circle(1, 2, 9)); }`);
    add("a subtype returned as the parent",
      `${H}Shape mk(bool c) { if (c) { return Circle(1, 2, 3); } return Rect(4, 5, 6, 7); }\n` +
      `export i32 f() { return mk(true).x * 10 + mk(false).x; }`);
    add("a type test down the chain",
      `${H}Shape mk(bool c) { if (c) { return Circle(1, 2, 3); } return Rect(4, 5, 6, 7); }\n` +
      `export bool f() { return mk(true) is Circle; }`);
    add("a type test that fails",
      `${H}Shape mk(bool c) { if (c) { return Circle(1, 2, 3); } return Rect(4, 5, 6, 7); }\n` +
      `export bool f() { return mk(false) is Circle; }`);
    add("a negated type test",
      `${H}Shape mk(bool c) { if (c) { return Circle(1, 2, 3); } return Rect(4, 5, 6, 7); }\n` +
      `export bool f() { return mk(false) is not Circle; }`);
    add("two type tests pick the arm",
      `${H}Shape mk(bool c) { if (c) { return Circle(1, 2, 3); } return Rect(4, 5, 6, 7); }\n` +
      `export i32 f() { Shape s = mk(false); if (s is Circle) { return 1; } if (s is Rect) { return 2; } return 0; }`);
    add("a null parent is not a subtype",
      `${H}export bool f() { Shape? s = null; return s is Circle; }`);
    add("an array of the parent holding children",
      `${H}export i32 f() { Shape[] a = Shape[](Rect(1, 2, 3, 4), Circle(5, 6, 7)); return a[0].x * 10 + a[1].x; }`);
    add("a field of the parent type holding a child",
      `${H}struct Box { Shape s; }\nexport i32 f() { Box b = Box(Rect(8, 9, 1, 2)); return b.s.x * 10 + b.s.y; }`);
    add("a defaulted subtype",
      `${H}export i32 f() { Rect r = Rect(); return r.x + r.y + r.w + r.h; }`);
    add("a three-deep chain",
      `struct A { i32 a; }\nstruct B : A { i32 b; }\nstruct C : B { i32 c; }\n` +
      `export i32 f() { C v = C(1, 2, 3); A w = v; return v.a * 100 + v.b * 10 + v.c + w.a; }`);
    add("a three-deep chain tested from the top",
      `struct A { i32 a; }\nstruct B : A { i32 b; }\nstruct C : B { i32 c; }\n` +
      `A mk() { return C(1, 2, 3); }\nexport bool f() { return (mk() is C) && (mk() is B); }`);
    add("a parent declared after its child",
      `struct Kid : Par { i32 k; }\nstruct Par { i32 p; }\n` +
      `export i32 f() { Kid v = Kid(1, 2); return v.p * 10 + v.k; }`);
    add("a subtype with a string field",
      `struct S { string a; }\nstruct T : S { string b; }\n` +
      `export i32 f() { T v = T("xy", "z"); return v.a.len() * 10 + v.b.len(); }`);
    add("a named construction of a subtype",
      `${H}export i32 f() { Rect r = Rect { h: 4, x: 1, w: 3, y: 2 }; return r.x * 1000 + r.y * 100 + r.w * 10 + r.h; }`);
  }

  // **`i31ref` is an integer inside a reference** and `anyref` the top of the hierarchy, which is how
  // an unboxed number and a heap object share one container. The interesting part is the boundary:
  // thirty-one bits fit and the thirty-second does not, and `as!` is checked rather than truncating.
  {
    const P = `struct P { i32 v; }\n`;
    for (const n of ["0", "1", "42", "-1", "-42", "1073741823", "-1073741824", "65535", "-65536"]) {
      add(`i31 round trip ${n}`, `export i32 f() { i31ref r = ${n} as! i31ref; return r as i32; }`);
    }
    // The out-of-range pair is **not** here: `as!` is specified to trap and the reference truncates,
    // so the two compilers disagree on purpose. A differential sweep has no way to say "we are right
    // and it is wrong", and a program whose mismatch is expected would hide the next real one — so
    // they live in `i31Trap.test.ts`, against the spec, with the issue number.
    add("i31 in an anyref array",
      `export i32 f() { anyref[] a = anyref[3](); a[0] = 7 as! i31ref; return (a[0] as! i31ref) as i32; }`);
    add("a struct in an anyref array",
      `${P}export bool f() { anyref[] a = anyref[2](); a[1] = P(3); return a[0] is i31ref; }`);
    add("a type test on the top type",
      `export bool f() { anyref[] a = anyref[2](); a[0] = 7 as! i31ref; return a[0] is i31ref; }`);
    add("a type test on the top type fails",
      `${P}export bool f() { anyref[] a = anyref[2](); a[0] = P(1); return a[0] is i31ref; }`);
    add("a null anyref is not an i31",
      `export bool f() { anyref[] a = anyref[1](); return a[0] is i31ref; }`);
    add("an anyref array defaults to nulls",
      `export bool f() { anyref[] a = anyref[4](); return (a[0] is null) && (a[3] is null); }`);
    add("i31 and a struct in one container",
      `${P}export i32 f() { anyref[] a = anyref[2](); a[0] = 9 as! i31ref; a[1] = P(4);\n` +
      `  i32 t = 0; if (a[0] is i31ref) { t = t + (a[0] as! i31ref) as i32; } return t; }`);
    add("an i31 local passed and returned",
      `i31ref twice(i31ref r) { return ((r as i32) * 2) as! i31ref; }\n` +
      `export i32 f() { return twice(21 as! i31ref) as i32; }`);
    add("an i31 field",
      `struct Q { i31ref r; }\nexport i32 f() { Q q = Q(5 as! i31ref); return q.r as i32; }`);
  }

  // **A method reference is the unbound one.** `Counter.inc` is a value whose first parameter is the
  // receiver; `c.inc` is a method already bound to an object, which has no representation here
  // because there are no closures. So every shape below passes the object explicitly.
  {
    const C = `struct Counter {\n  i32 count;\n  Counter create(i32 initial) { return Counter(initial); }\n` +
      `  void inc(this) { this.count++; }\n  i32 plus(this, i32 n) { return this.count + n; }\n}\n`;
    add("a method reference called twice",
      `${C}export i32 f() { fn[void(Counter)] bump = Counter.inc; Counter c = Counter(0); bump(c); bump(c); return c.count; }`);
    add("a static reference builds a value",
      `${C}export i32 f() { fn[Counter(i32)] make = Counter.create; return make(7).count; }`);
    add("a method reference called inline",
      `${C}export i32 f() { Counter c = Counter(1); (Counter.inc)(c); return c.count; }`);
    add("a method reference with an argument",
      `${C}export i32 f() { fn[i32(Counter,i32)] p = Counter.plus; return p(Counter(10), 5); }`);
    add("a method reference passed to a function",
      `${C}i32 twice(fn[i32(Counter,i32)] g, Counter c) { return g(c, 1) + g(c, 2); }\n` +
      `export i32 f() { return twice(Counter.plus, Counter(10)); }`);
    add("a method reference and a bare function in one signature",
      `${C}i32 bare(Counter c, i32 n) { return c.count * n; }\n` +
      `export i32 f() { fn[i32(Counter,i32)] g = bare; fn[i32(Counter,i32)] h = Counter.plus;\n` +
      `  return g(Counter(3), 4) * 100 + h(Counter(3), 4); }`);
    add("a method reference reassigned",
      `${C}export i32 f() { fn[void(Counter)] b = Counter.inc; Counter c = Counter(5); b(c); b = Counter.inc; b(c); return c.count; }`);
    add("a method reference in an array",
      `${C}export i32 f() { fn[i32(Counter,i32)][] t = fn[i32(Counter,i32)][](Counter.plus, Counter.plus);\n` +
      `  return t[0](Counter(2), 3) * 10 + t[1](Counter(4), 5); }`);
    add("a method reference through the parent",
      `struct Base { i32 v; i32 get(const this) { return this.v; } }\n` +
      `struct Derived : Base { i32 w; }\n` +
      `export i32 f() { fn[i32(Base)] g = Base.get; return g(Derived(6, 7)); }`);
  }

  add("increment feeds the base of another", `struct P { i32 v; }\n` +
    `P at(P[] a, i32 i) { return a[i]; }\n` +
    `export i32 f() { P[] a = P[2](fill: P(1)); a[1] = P(10); i32 i = 0; return at(a, i++).v * 100 + i; }`);

  return out;
}
