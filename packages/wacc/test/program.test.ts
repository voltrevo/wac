// The compiler as a program, run as one.
//
// `example/wacc.wac` is what a `wac` binary would dispatch (design/lang/0003 step 4): it reads the
// entry, walks the imports with `src/files.wac`, and calls the same `emitFiles` the TypeScript CLI
// calls. What has to stay true is that going the long way round changes nothing — same input, same
// module, byte for byte — because the moment those differ, "wacc can build this repository by
// itself" stops being one claim and becomes two.
//
// Run as a *subprocess*, not through `wacBind`: the point is the whole path, including reading files
// through a capability and writing the result. A test that called `emitFiles` directly would pass
// for a program whose argument handling or file walk was broken.

import { buildApp } from "../../platform/build.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-waccprog-" });
await buildApp("packages/wacc/example/wacc.wac", built, { read: true, write: true });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

async function run(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const r = await new Deno.Command(built, { args, stdout: "piped", stderr: "piped" }).output();
  return {
    code: r.code,
    out: new TextDecoder().decode(r.stdout),
    err: new TextDecoder().decode(r.stderr),
  };
}

Deno.test("the program compiles what the library compiles, byte for byte", async () => {
  const entry = "packages/json/src/json.wac";
  const out = await Deno.makeTempFile({ suffix: ".wasm" });
  try {
    const r = await run(["compile", entry, out]);
    if (r.code !== 0) throw new Error(`compile failed: ${r.err || r.out}`);

    // The same program through the library the TypeScript CLI uses.
    const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
      emitFiles: (p: string[], s: string[], e: string) => Uint8Array;
    };
    const files = await wacFiles(entry);
    const paths = [...files.keys()];
    const want = Uint8Array.from(
      api.emitFiles(paths, paths.map((p) => files.get(p)!), entry) as unknown as number[],
    );
    const got = await Deno.readFile(out);
    if (got.length !== want.length) {
      throw new Error(`the program wrote ${got.length} bytes, the library ${want.length}`);
    }
    for (let i = 0; i < got.length; i++) {
      if (got[i] !== want[i]) throw new Error(`byte ${i} differs: ${got[i]} vs ${want[i]}`);
    }
    console.log(`    program: ${got.length} bytes for ${entry}, identical to the library's`);
  } finally {
    await Deno.remove(out);
  }
});

Deno.test("it names the file it cannot read, rather than the diagnostics that follow", async () => {
  // A missing import used to be discoverable only as whatever the checker said about the hole it
  // left, which points at the file that *imported* it. The walk stops and says which path.
  const dir = await Deno.makeTempDir({ prefix: "wac-waccprog-" });
  try {
    await Deno.writeTextFile(`${dir}/main.wac`, `import { x } from "./gone.wac";\nexport i32 f() { return x; }\n`);
    const r = await run(["check", `${dir}/main.wac`]);
    if (r.code === 0) throw new Error("a missing import compiled");
    if (!r.err.includes("gone.wac")) throw new Error(`did not name the file: ${r.err}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("check refuses a program the checker refuses, and says where", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-waccprog-" });
  try {
    await Deno.writeTextFile(`${dir}/bad.wac`, `export i32 f() { return "no"; }\n`);
    const r = await run(["check", `${dir}/bad.wac`]);
    if (r.code === 0) throw new Error("a type error passed the check");
    if (!r.err.includes("bad.wac")) throw new Error(`no file in the diagnostic: ${r.err}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("bindgen: the program writes glue, and the glue runs", async () => {
  // **The last piece of the toolchain that only existed in TypeScript.** `waccx bindgen` wrote glue
  // and the `wac` binary could not, which is a tooling-parity gap rather than a missing language
  // feature — `src/bindgen.wac` closes it, and `test/bindgenWac.test.ts` holds the two generators to
  // the same text byte for byte.
  //
  // Here the assertion is the *running*, not the reading: a generator that dropped a cast it needed
  // would still look like JavaScript. `.js` and imported as such, which is the browser's rule and
  // the reason the JavaScript mode exists at all.
  const dir = await Deno.makeTempDir({ prefix: "wac-waccprog-" });
  try {
    await Deno.writeTextFile(
      `${dir}/m.wac`,
      `struct Point { i32 x; i32 y; i32 sum(const this) { return this.x + this.y; } }\n` +
        `export Point origin(i32 x, i32 y) { return Point(x, y); }\n` +
        `export string greet(string who) { return "hi " + who; }\n`,
    );
    const r = await run(["bindgen", `${dir}/m.wac`, "--js"]);
    if (r.code !== 0) throw new Error(`bindgen failed: ${r.err || r.out}`);

    const mod = await import(`${dir}/m.gen.js`) as {
      origin(x: number, y: number): { sum(): number; x: number };
      greet(who: string): string;
    };
    if (mod.origin(4, 5).sum() !== 9) throw new Error("a struct class and its method");
    if (mod.origin(4, 5).x !== 4) throw new Error("a field accessor");
    if (mod.greet("world") !== "hi world") throw new Error("a string, both ways");

    // TypeScript by default, which is the other half of the same generator.
    const ts = await run(["bindgen", `${dir}/m.wac`]);
    if (ts.code !== 0) throw new Error(`bindgen --ts failed: ${ts.err}`);
    const text = await Deno.readTextFile(`${dir}/m.gen.ts`);
    if (!text.includes(": number")) throw new Error("the TypeScript mode emitted no annotations");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
