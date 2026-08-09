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
  return out;
}
