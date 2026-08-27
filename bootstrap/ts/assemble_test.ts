// The assembler's tests: assemble each module in `tests/wax/`, instantiate it, call `main`, and
// check the answer against `tests/expect.json`.
//
// Running the module is the whole point. A byte comparison against a recorded blob would pass for an
// assembler that is consistently wrong, and the engine is the only thing here that knows wasm.

import { assemble, sleb, uleb } from "./assemble.ts";
/** No dependencies, deliberately: a bootstrap repository that needs a package registry to run its
 * own tests has missed the point. */
function assertEquals<T>(got: T, want: T) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) throw new Error(`got ${g}, want ${w}`);
}

const root = new URL("..", import.meta.url).pathname;

const expected: Record<string, number> = JSON.parse(
  await Deno.readTextFile(`${root}tests/expect.json`),
);

for (const [file, want] of Object.entries(expected)) {
  Deno.test(`${file} answers ${want}`, async () => {
    const src = await Deno.readTextFile(`${root}tests/wax/${file}`);
    const bytes = assemble(src);
    const mod = await WebAssembly.compile(bytes.buffer as ArrayBuffer);
    const instance = await WebAssembly.instantiate(mod, {});
    const main = instance.exports.main as () => number;
    assertEquals(main(), want);
  });
}

Deno.test("uleb encodes the boundary cases", () => {
  assertEquals(uleb(0), [0x00]);
  assertEquals(uleb(1), [0x01]);
  assertEquals(uleb(127), [0x7f]);
  assertEquals(uleb(128), [0x80, 0x01]);
  assertEquals(uleb(624485), [0xe5, 0x8e, 0x26]);
});

Deno.test("sleb encodes negatives, which uleb cannot", () => {
  assertEquals(sleb(0n), [0x00]);
  assertEquals(sleb(-1n), [0x7f]);
  assertEquals(sleb(63n), [0x3f]);        // the largest that fits one byte: -64..63
  assertEquals(sleb(64n), [0xc0, 0x00]);
  assertEquals(sleb(-64n), [0x40]);
  assertEquals(sleb(-65n), [0xbf, 0x7f]);
  assertEquals(sleb(-123456n), [0xc0, 0xbb, 0x78]);
});

Deno.test("an unknown instruction is refused by name and line", async () => {
  const src = "func $f -> i32\n  i32.frobnicate\nend\nexport \"main\" func $f\n";
  let msg = "";
  try { assemble(src); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "line 2: unknown instruction i32.frobnicate");
});

Deno.test("a branch to a label that is not open says so", () => {
  const src = "func $f -> i32\n  br $nowhere\nend\n";
  let msg = "";
  try { assemble(src); } catch (e) { msg = (e as Error).message; }
  assertEquals(msg, "line 2: no label $nowhere is open here");
});
