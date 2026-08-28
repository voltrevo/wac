// **The same ladder under three hosts, compared.**
//
//   hosts/deno.js     the portable core, Deno reading the files
//   hosts/node.js     the same core, `node:fs` reading them
//   rust-ladder/      V8 embedded in Rust, no JavaScript at all
//
// This checks the wac-L0 all three produce is identical — the argument the two assemblers already
// make, one level up: a rung that only ever ran under one host is a rung whose behaviour nobody
// has checked. It is also the acceptance criterion for the ports, stated as a test rather than a
// claim in a document.
//
// It is not the same as the two assemblers agreeing. That differential covers reading a format;
// this one covers *running* five compilers, where the differences an engine can introduce are
// the interesting ones — whether a module validates, whether a memory grew, what a trap does.
//
// Skips unless `rust-ladder/target/release/ladder` has been built, because a Deno suite should
// not require a Rust toolchain to be green.

import { l5ToL0 } from "./l5.ts";

const HERE = new URL(".", import.meta.url).pathname;
const BIN = `${HERE}../rust-ladder/target/release/ladder`;
const NODE_HOST = `${HERE}../hosts/node.js`;
const API = `${HERE}../../packages/wacc/src/api.wac`;

async function have(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Run a host and take the wasm it wrote. */
async function wasmFrom(cmd: string, args: string[], out: string): Promise<Uint8Array> {
  const ran = await new Deno.Command(cmd, { args: [...args, "-o", out] }).output();
  if (!ran.success) {
    throw new Error(`${cmd} failed: ${new TextDecoder().decode(ran.stderr).slice(0, 300)}`);
  }
  return await Deno.readFile(out);
}

/** Run a host binary on a file and take its wac-L0 from stdout. */
async function l0From(cmd: string, args: string[]): Promise<string> {
  const ran = await new Deno.Command(cmd, { args }).output();
  if (!ran.success) {
    throw new Error(`${cmd} failed: ${new TextDecoder().decode(ran.stderr).slice(0, 300)}`);
  }
  return new TextDecoder().decode(ran.stdout);
}

// Chosen to reach what a rung below cannot express: wasm GC, an enum with payloads, `match`,
// concatenation, a filled array, and a generic declaration.
//
// **It must compile cleanly, not merely identically.** It called the generic at first, which
// wac-L5 refuses by name — so all three hosts agreed, on the same refusal, and the comparison
// said nothing. Comparing the *wasm* is what found it, because a refusal has no wasm.
const PROGRAM = `
struct Point { i32 x; i32 y; }
enum Shape { Dot(Point p), Line(Point a, Point b) }
T id<T>(T v) { return v; }        // declared and skipped; calling one is refused by name
i32 span(Shape s) {
  match (s) {
    case Dot(p): { return p.x + p.y; }
    case Line(a, b): { return (b.x - a.x) + (b.y - a.y); }
  }
  return 0;
}
i32 main() {
  string label = "hello" + " " + "world";
  i32[] ns = i32[4](fill: 3);
  return span(Shape.Line(Point(1, 2), Point(11, 22))) + label.len() + ns[3];
}
`;

Deno.test({
  name: "the ladder produces the same wac-L0 under Deno, Node and V8 from Rust",
  ignore: !(await have(BIN)),
  fn: async () => {
    const tmp = await Deno.makeTempFile({ suffix: ".wac" });
    await Deno.writeTextFile(tmp, PROGRAM);
    try {
      const got: Record<string, string> = {
        deno: await l5ToL0(PROGRAM),
        rust: await l0From(BIN, [tmp, "--l0"]),
      };
      if (await have(NODE_HOST)) got.node = await l0From("node", [NODE_HOST, tmp, "--l0"]);

      const names = Object.keys(got);
      for (const name of names.slice(1)) {
        if (got[name] === got[names[0]]) continue;
        const a = got[names[0]].split("\n");
        const b = got[name].split("\n");
        const at = a.findIndex((l, i) => l !== b[i]);
        throw new Error(
          `${names[0]} and ${name} disagree at line ${at + 1} of ${a.length}/${b.length}:\n` +
            `  ${names[0]}: ${a[at]}\n  ${name}: ${b[at]}`,
        );
      }

      // **And the bytes, not only the text.** Identical wac-L0 through two *different* assemblers
      // — one JavaScript, one Rust — is not identical wasm unless they agree, and this is a much
      // bigger sample of that than `tests/l0/` holds: a couple of hundred lines of real compiler
      // output rather than a fixture written to make a point.
      const wasm: Record<string, Uint8Array> = {
        rust: await wasmFrom(BIN, [tmp], `${tmp}.rust.wasm`),
        deno: await wasmFrom("deno", ["run", "-A", `${HERE}../hosts/deno.js`, tmp], `${tmp}.deno.wasm`),
      };
      if (await have(NODE_HOST)) {
        wasm.node = await wasmFrom("node", [NODE_HOST, tmp], `${tmp}.node.wasm`);
      }
      for (const [name, bytes] of Object.entries(wasm)) {
        if (name === "rust") continue;
        const a = wasm.rust;
        if (a.length === bytes.length && a.every((v, i) => v === bytes[i])) continue;
        throw new Error(`rust and ${name} produced different wasm: ${a.length} vs ${bytes.length}`);
      }
      for (const k of Object.keys(wasm)) await Deno.remove(`${tmp}.${k}.wasm`).catch(() => {});
    } finally {
      await Deno.remove(tmp);
    }
  },
});

// **The flattener is written twice too**, in `js/flatten.js` and `rust-ladder/src/flatten.rs`,
// because the Rust host has to reach wacc's source tree without a JavaScript runtime anywhere.
// Two implementations of one rule need the same check the two assemblers get.
//
// The fixture has imports, a diamond and a `lib/` subdirectory, which is what makes it a test of
// flattening rather than of reading one file.
Deno.test({
  name: "the flattener agrees between JavaScript and Rust",
  ignore: !(await have(BIN)),
  fn: async () => {
    const entry = `${HERE}../tests/l5/imports.l5`;
    const { flatten } = await import("./l5.ts");
    const fromJs = await flatten(entry);
    const fromRust = await l0From(BIN, [entry, "--dump-flat"]);
    if (fromJs !== fromRust) {
      const a = fromJs.split("\n");
      const b = fromRust.split("\n");
      const at = a.findIndex((l, i) => l !== b[i]);
      throw new Error(
        `they disagree at line ${at + 1} of ${a.length}/${b.length}:\n` +
          `  js:   ${a[at]}\n  rust: ${b[at]}`,
      );
    }
  },
});

// **Acceptance criterion 2, on the program it is actually about.**
//
// The test above compares a program chosen to exercise wac-L5's harder corners, which is the right
// input for finding a disagreement. It is not the claim the criteria make: *each host builds wacc
// from source by itself, and the three artefacts are identical*. A 47-line program agreeing proves
// much less than a 37,873-line one — the flattener runs on an eighteen-module graph rather than a
// single file, and wac-L5 emits half a megabyte rather than two kilobytes.
//
// That claim had been checked by hand and written into a document, which is where a claim goes to
// stop being true. Four seconds for all three, so it is checked every run instead.
//
// Deno, Node and Rust; not the browser, which has no `-o` and no filesystem to write to. Criterion
// 3 is `ts/browser_test.ts`.
Deno.test({
  name: "Deno, Node and Rust each build wacc alone, and the three are identical",
  ignore: !(await have(BIN)) || !(await have(API)),
  fn: async () => {
    const dir = await Deno.makeTempDir();
    try {
      /** @type Record<string, Uint8Array> */
      const built: Record<string, Uint8Array> = {
        deno: await wasmFrom("deno", ["run", "-A", `${HERE}../hosts/deno.js`, API], `${dir}/d.wasm`),
        rust: await wasmFrom(BIN, [API], `${dir}/r.wasm`),
      };
      if (await have(NODE_HOST)) {
        built.node = await wasmFrom("node", [NODE_HOST, API], `${dir}/n.wasm`);
      }

      const names = Object.keys(built);
      const first = built[names[0]];
      // **Equal is not enough when the thing compared could be nothing.** Three hosts each writing
      // an empty file agree perfectly, and `wasmFrom` only checks the exit status. So the artefact
      // has to be a wasm module and has to be roughly the size wacc is — 659,236 bytes today, and
      // the floor is loose because the number moves whenever wacc does.
      if (first[0] !== 0x00 || first[1] !== 0x61 || first[2] !== 0x73 || first[3] !== 0x6d) {
        throw new Error(`${names[0]} wrote something that is not a wasm module`);
      }
      if (first.length < 400_000) {
        throw new Error(`${names[0]} wrote ${first.length} bytes, far too small to be wacc`);
      }
      for (const name of names.slice(1)) {
        const other = built[name];
        if (other.length !== first.length) {
          throw new Error(
            `${names[0]} built ${first.length} bytes of wacc and ${name} built ${other.length}`,
          );
        }
        const at = first.findIndex((b, i) => b !== other[i]);
        if (at !== -1) {
          throw new Error(
            `${names[0]} and ${name} differ at byte ${at} of ${first.length}: ` +
              `${first[at]} against ${other[at]}`,
          );
        }
      }
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
