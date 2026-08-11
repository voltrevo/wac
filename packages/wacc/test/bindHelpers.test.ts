// The shapes a host actually calls, asserted against the module wacc emits.
//
// **A helper set is a calling convention before it is a layout.** Every other oracle here asks
// whether the module is well-formed or whether it answers what the reference's does; neither can see
// a helper with the right name and the wrong arity, because nothing in the module calls it. The
// generated glue does, and it is generated from the *reference's* view of the type — so these are
// read off `wacBindgen`'s output rather than derived from what this emitter finds convenient.
//
// `packages/bls` is why this file exists: `$bind$arr_u8Arr_new` was emitted taking a fill, the glue
// called it with one argument, and the boundary answered "type incompatibility when transforming
// from/to JS" — a diagnostic that names neither the helper nor the type.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac");
const emitFiles = mod.emitFiles as (p: string[], s: string[], e: string) => Uint8Array;

/**
 * Every exported function's parameter count, read out of the module's own bytes.
 *
 * Not `WebAssembly.Module.exports(...).type`: that is the type-reflection proposal, and this engine
 * does not implement it — the field is simply absent, which makes an assertion loop over it pass by
 * asserting nothing. Three sections say it between them: the export section maps a name to a
 * function index, the function section maps that to a type index, and the type section holds the
 * parameter count. wacc writes one rec group, which is the only wrinkle in walking it.
 */
function arities(src: string): Map<string, number> {
  const b = Uint8Array.from(emitFiles(["a.wac"], [src], "a.wac") as unknown as number[]);
  if (b.length <= 8) throw new Error("the emitter declined this program");
  let p = 8;
  const u32 = () => {
    let r = 0, sh = 0, x = 0;
    do { x = b[p++]; r |= (x & 0x7f) << sh; sh += 7; } while (x & 0x80);
    return r >>> 0;
  };
  const skipValType = () => {
    // A reference type is 0x63/0x64 followed by a signed heap type; everything else is one byte.
    if (b[p] === 0x63 || b[p] === 0x64) { p++; while (b[p] & 0x80) p++; p++; return; }
    p++;
  };
  const sections = new Map<number, number>();
  while (p < b.length) { const id = b[p++], size = u32(); sections.set(id, p); p += size; }

  const params: number[] = [];                       // type index → parameter count, -1 if not a func
  p = sections.get(1)!;
  u32();                                             // one rec group
  p++;                                               // 0x4E
  const typeCount = u32();
  for (let i = 0; i < typeCount; i++) {
    const tag = b[p++];
    if (tag === 0x5E) { skipValType(); p++; params.push(-1); }                       // array
    else if (tag === 0x50) {                                                         // sub … struct
      const sup = u32();
      for (let k = 0; k < sup; k++) u32();
      p++;
      const fc = u32();
      for (let f = 0; f < fc; f++) { skipValType(); p++; }
      params.push(-1);
    } else if (tag === 0x60) {                                                       // func
      const pc = u32();
      for (let k = 0; k < pc; k++) skipValType();
      const rc = u32();
      for (let k = 0; k < rc; k++) skipValType();
      params.push(pc);
    } else throw new Error(`unknown type tag 0x${tag.toString(16)} at entry ${i}`);
  }

  const funcTypes: number[] = [];
  p = sections.get(3)!;
  const funcCount = u32();
  for (let i = 0; i < funcCount; i++) funcTypes.push(u32());

  const out = new Map<string, number>();
  p = sections.get(7)!;
  const exportCount = u32();
  for (let i = 0; i < exportCount; i++) {
    const len = u32();
    const name = new TextDecoder().decode(b.subarray(p, p + len));
    p += len;
    const kind = b[p++], idx = u32();
    if (kind === 0) out.set(name, params[funcTypes[idx]]);
  }
  return out;
}

Deno.test("bind helpers: the array constructors have the arity the glue calls them with", () => {
  const a = arities(
    "export i32 rows(u8[][] g) { return g.len(); }\n" +
      "export i32 parts(string[] ps) { return ps.len(); }\n" +
      "export i32 sum(i32[] xs) { return xs.len(); }\n",
  );
  if (a.size === 0) throw new Error("no function export carried a type — nothing was asserted");

  // A `string` element is non-null on the reference's side, so the host says what to fill with, and
  // an empty one needs its own helper because there is no element to fill it from.
  if (a.get("$bind$arr_string_new") !== 2) {
    throw new Error(`$bind$arr_string_new takes ${a.get("$bind$arr_string_new")} args, glue passes 2`);
  }
  if (!a.has("$bind$arr_string_new0")) throw new Error("$bind$arr_string_new0 is missing");

  // An array element and a numeric one are both defaultable, so both take the count alone.
  if (a.get("$bind$arr_u8Arr_new") !== 1) {
    throw new Error(`$bind$arr_u8Arr_new takes ${a.get("$bind$arr_u8Arr_new")} args, glue passes 1`);
  }
  if (a.has("$bind$arr_u8Arr_new0")) throw new Error("$bind$arr_u8Arr_new0 exists and nothing calls it");
  if (a.get("$bind$arr_i32_new") !== 1) throw new Error("$bind$arr_i32_new should take a count alone");

  // The accessors, whose shape is the same whatever the element is.
  for (const [name, want] of [["get", 2], ["set", 3], ["len", 1]] as const) {
    for (const sfx of ["string", "u8Arr", "i32"]) {
      const key = `$bind$arr_${sfx}_${name}`;
      if (a.get(key) !== want) throw new Error(`${key} takes ${a.get(key)} args, wanted ${want}`);
    }
  }
});

Deno.test("bind helpers: a string, an enum and a method reach the host under the names bindgen uses", () => {
  const a = arities(
    "enum Shape { Circle(f64 r), Empty }\n" +
      "struct Counter { i32 n; i32 get(const this) { return this.n; } Counter create(i32 v) { return Counter(v); } }\n" +
      "export f64 radiusOf(Shape s) { return match (s) { case Circle(r): r, else: 0.0 }; }\n" +
      "export i32 use(Counter c) { return c.get(); }\n" +
      "export string echo(string s) { return s; }\n",
  );
  const want: [string, number][] = [
    ["$bind$str_new", 1], ["$bind$str_get", 2], ["$bind$str_set", 3], ["$bind$str_len", 1],
    ["$bind$str_to_mem", 1], ["$bind$str_from_mem", 1],
    ["$bind$e_Shape_tag", 1], ["$bind$e_Shape_Circle_new", 1], ["$bind$e_Shape_Circle_get_r", 1],
    ["$bind$e_Shape_Empty_new", 0],
    ["$bind$m_Counter_get", 1], ["$bind$sm_Counter_create", 1],
    ["$bind$s_Counter_new", 1], ["$bind$s_Counter_get_n", 1], ["$bind$s_Counter_set_n", 2],
    ["$bind$mem_ensure", 1],
  ];
  const missing = want.filter(([n]) => !a.has(n)).map(([n]) => n);
  if (missing.length > 0) throw new Error(`missing helpers: ${missing.join(", ")}`);
  const wrong = want.filter(([n, k]) => a.get(n) !== k).map(([n, k]) => `${n} takes ${a.get(n)}, wanted ${k}`);
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});
