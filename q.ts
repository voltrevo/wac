import { wacCompile } from "./compiler/wacCompile.ts";
const PRE = `struct Cell<T> { T value; }
enum Maybe<T> { Just(T v), Absent
  T orElse(const this, T d) { return match (this) { case Just(v): v, case Absent: d }; }
}
i32 takeInt(Maybe<i32> m) { return m.orElse(0); }
`;
const cases: [string, string][] = [
  ["generic STRUCT names args",  `export i32 f() { Cell<i32> c = Cell<i32>(); c.value = 1; return c.value; }`],
  ["enum variant names args",    `export i32 f() { Maybe<i32> a = Maybe<i32>.Just(4); return a.orElse(0); }`],
  ["enum, expected type present",`export i32 f() { Maybe<i32> a = Maybe.Just(4); return a.orElse(0); }`],
  ["method on construction",     `export i32 f() { return Maybe.Just(4).orElse(0); }`],
  ["argument position",          `export i32 f() { return takeInt(Maybe.Just(4)); }`],
  ["return position",            `Maybe<i32> mk() { return Maybe.Just(4); }\nexport i32 f() { return mk().orElse(0); }`],
  ["ternary arms",               `export i32 f(bool b) { Maybe<i32> m = b ? Maybe.Just(1) : Maybe.Absent; return m.orElse(0); }`],
  ["array literal element",      `export i32 f() { Maybe<i32>[] xs = Maybe<i32>[](Maybe.Just(2)); return xs[0].orElse(0); }`],
];
for (const [l, src] of cases) {
  try {
    const r = wacCompile(new Map([["/main.wac", PRE + src]]), "/main.wac") as any;
    console.log(`${l.padEnd(29)} ${r.ok ? "compiles" : "REJECTED: " + (r.diagnostics?.[0]?.message ?? "").slice(0, 52)}`);
  } catch (e) { console.log(`${l.padEnd(29)} THREW: ${(e as Error).message.slice(0,44)}`); }
}
