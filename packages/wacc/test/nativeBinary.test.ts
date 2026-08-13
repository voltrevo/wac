// The compiler as **one file**, on the primary platform.
//
// `native/v8` has always been handed a program: `wacv8 prog.wasm args…`. That is a runtime, not a
// command — and the thing design/lang/0003 step 4 is about is a single `wac` that compiles wac with
// no Deno, no JavaScript and no module beside it. `native/v8/build.rs` embeds `seed/wacc.wasm` when
// it is there, and the binary then treats a first argument that is not a bundle as arguments for the
// program inside it.
//
// It also rebuilds the payload it carries — `wacc build` writes the manifest a native host needs,
// so the TypeScript bundler is in the loop only for producing the *first* seed.
//
// **The assertion is the bytes, not the exit code.** A binary that compiled *something* would pass a
// test that only checked it ran; what has to hold is that going through the embedded compiler on
// this host produces the same module as calling `emitFiles` in process — because the moment those
// differ, "one file compiles this repository" stops being one claim and becomes two. The entry is
// wacc's own API: the heaviest thing here, and the one whose output seeds the next build.
//
// **Opt-in**, like `binary.test.ts` and for the same reason: this rebuilds the crate and writes 67 MB.
//
//     WAC_V8_SEED=1 deno test -A packages/wacc/test/nativeBinary.test.ts
//
// It leaves `native/v8/target/release/wacv8` *seeded*, which no other test minds — `v8host.test.ts`
// hands its program a stem, and that path is unchanged by carrying a payload.

import { buildNative } from "../../platform/native.ts";
import { buildNativeBinary } from "../../platform/nativeBinary.ts";
import { wacBind } from "../../../harness/wacBind.ts";
import { wacFiles } from "../../../harness/wacFiles.ts";
import "../../../harness/spawnRetry.ts";

const CRATE = "native/v8";
const ENTRY = "packages/wacc/src/api.wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

async function run(bin: string, args: string[]) {
  const r = await new Deno.Command(bin, { args, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

Deno.test({
  name: "one file compiles wac, and its bytes are the ones the library produces",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-v8seed-" });
    try {
      // The payload is the compiler as a program, built the way any program for this host is built:
      // one module carrying its own manifest. There is no seed-specific artefact, which is what keeps
      // the thing inside the binary the same thing that runs when it is handed over directly.
      //
      // All four grants named, which is what the `app:native` command line passes: `buildNative`
      // writes the object it was *handed*, so `{read, write}` yields a manifest with two keys and
      // the wac side — which has a bitmask, not an object — always writes four. The artefacts that
      // matter come from the command line, and there the two agree.
      await buildNative("packages/wacc/example/wacc.wac", `${dir}/wacc`, {
        read: true,
        write: true,
        env: false,
        net: false,
      });

      const built = await new Deno.Command("cargo", {
        args: ["build", "--release", "--quiet"],
        cwd: CRATE,
        env: { WAC_SEED_DIR: dir },
        stdout: "piped",
        stderr: "piped",
      }).output();
      if (built.code !== 0) {
        throw new Error(`cargo did not build ${CRATE}:\n${new TextDecoder().decode(built.stderr)}`);
      }
      const wac = `${CRATE}/target/release/wacv8`;

      const out = `${dir}/api.wasm`;
      const r = await run(wac, ["compile", ENTRY, out]);
      if (r.code !== 0) throw new Error(`compile failed (${r.code}): ${r.err || r.out}`);

      const api = await wacBind("packages/wacc/src/api.wac") as unknown as {
        emitFiles: (p: string[], s: string[], e: string) => Uint8Array;
      };
      const files = await wacFiles(ENTRY);
      const paths = [...files.keys()];
      const want = Uint8Array.from(
        api.emitFiles(paths, paths.map((p) => files.get(p)!), ENTRY) as unknown as number[],
      );
      const got = await Deno.readFile(out);
      assertEquals(got.length, want.length, "the binary and the library disagree on size");
      for (let i = 0; i < got.length; i++) {
        if (got[i] !== want[i]) throw new Error(`byte ${i} differs: ${got[i]} vs ${want[i]}`);
      }
      console.log(`    one file: ${got.length} bytes for ${ENTRY}, identical to the library's`);

      // **A bundle is still a bundle.** The seed decides what an argument means, and getting that
      // rule wrong turns a runtime into a compiler that cannot be handed a program — so the form
      // that worked before carrying a payload is asserted here rather than assumed.
      const asProgram = await run(wac, [`${dir}/wacc.wasm`, "check", "packages/json/src/json.wac"]);
      assertEquals(asProgram.code, 0, `a module argument stopped working: ${asProgram.err}`);

      // And a mistyped module is reported as a missing file rather than reaching the compiler, which
      // would answer *unknown command 'nosuch.wasm'* — a message about the wrong thing entirely.
      const missing = await run(wac, [`${dir}/nosuch.wasm`]);
      assertEquals(missing.code, 1, "a missing bundle should fail as one");
      assertEquals(
        missing.err.includes("cannot read") && !missing.err.includes("unknown command"),
        true,
        `named the wrong problem: ${missing.err}`,
      );

      // **It rebuilds the file it carries.** `build` is `compile` plus the boundary — the manifest a
      // native host needs, in the module — and the payload above was written by `app:native`, so a
      // byte-identical answer says the TypeScript bundler is no longer in the loop for anything but
      // producing the first one. The output stem is `wacc` again because a manifest names the file it
      // sits beside, and a rebuild under another name is a different artefact for a good reason.
      await Deno.mkdir(`${dir}/re`);
      const rebuilt = await run(wac, [
        "build",
        "packages/wacc/example/wacc.wac",
        "-o",
        `${dir}/re/wacc`,
        "--allow-read",
        "--allow-write",
      ]);
      if (rebuilt.code !== 0) throw new Error(`build failed (${rebuilt.code}): ${rebuilt.err}`);
      const mine = await Deno.readFile(`${dir}/re/wacc.wasm`);
      const seed = await Deno.readFile(`${dir}/wacc.wasm`);
      assertEquals(mine.length, seed.length, "the binary's own payload came out a different size");
      for (let i = 0; i < mine.length; i++) {
        if (mine[i] !== seed[i]) throw new Error(`the rebuilt seed differs at byte ${i}`);
      }
      console.log(`    and it rebuilt its own ${seed.length}-byte payload, byte for byte`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "and `app:wacbin` bakes the grants in, for any program rather than the compiler",
  ignore: Deno.env.get("WAC_V8_SEED") !== "1",
  fn: async () => {
    // `wc` rather than `wacc`, because the interesting claim is that this makes a native executable
    // of *a* wac program — the compiler is just the one that makes the result a `wac` command.
    const dir = await Deno.makeTempDir({ prefix: "wac-wacbin-" });
    try {
      const entry = "packages/platform/example/wc.wac";
      await buildNativeBinary(entry, `${dir}/wc`, { read: true });
      const granted = await run(`${dir}/wc`, ["README.md"]);
      assertEquals(granted.code, 0, `a granted wc failed: ${granted.err}`);
      assertEquals(granted.out.trim().split(/\s+/).length, 4, `not a wc line: ${granted.out}`);

      // **The canary, and the point of the whole layer.** Same program, same command line, one
      // grant fewer at packaging time — and it cannot read the file. A test that only ran the
      // granted build would pass for a binary that ignored grants entirely.
      await buildNativeBinary(entry, `${dir}/wc-nogrant`, {});
      const denied = await run(`${dir}/wc-nogrant`, ["README.md"]);
      assertEquals(denied.code !== 0, true, "an ungranted wc read the file");
      assertEquals(
        denied.err.includes("Not granted"),
        true,
        `refused for the wrong reason: ${denied.err}`,
      );
      console.log(`    ungranted: ${denied.err.trim()}`);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
