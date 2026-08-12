// The toolchain as one executable.
//
// `deno task app:binary packages/wacc/example/wacc.wac --allow-read --allow-write -o wac` is the
// sanctioned way to build a wac toolchain that needs nothing installed (design/lang/0003). What has
// to stay true is that wrapping the program in a runtime changes nothing about what it emits.
//
// **Opt-in, and ignored rather than absent.** Not for time — it is about a second with the build
// cache warm — but for **disk**: each run writes a 105 MB executable, and the shared machine this
// suite runs on has hit 100% more than once. `program.test.ts` already runs the same wac program and
// compares its output byte for byte; `deno compile` only puts a runtime around it.
// `WAC_BINARY=1 deno test -A packages/wacc/test/binary.test.ts` runs it, and the ignored line in
// every other run is the reminder that it exists.

import { buildBinary } from "../../platform/binary.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";
import "../../../harness/spawnRetry.ts";

Deno.test({
  name: "the built executable compiles what the library compiles, byte for byte",
  ignore: Deno.env.get("WAC_BINARY") !== "1",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-binary-" });
    const exe = `${dir}/wac`;
    try {
      await buildBinary("packages/wacc/example/wacc.wac", exe, { read: true, write: true });

      const entry = "packages/json/src/json.wac";
      const out = `${dir}/out.wasm`;
      const r = await new Deno.Command(exe, {
        args: ["compile", entry, out],
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (r.code !== 0) {
        throw new Error(`compile failed: ${new TextDecoder().decode(r.stderr)}`);
      }

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
        throw new Error(`the executable wrote ${got.length} bytes, the library ${want.length}`);
      }
      for (let i = 0; i < got.length; i++) {
        if (got[i] !== want[i]) throw new Error(`byte ${i} differs`);
      }
      const size = (await Deno.stat(exe)).size;
      console.log(`    binary: ${(size / 1048576).toFixed(0)} MB, ${got.length} bytes out, identical`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
