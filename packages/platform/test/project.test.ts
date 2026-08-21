// An outsider's project, compiled through the Deno host.
//
// **`@/` is the one import form that needs something the compiler cannot look up.** `design/lang/0009`
// D7 defines it as the nearest `wac.json5` at or above the importing file, so somebody has to search
// the filesystem and hand the answer over. `harness/wacFiles.ts` does that search — `projectRootOf` —
// and `wacFilesWithRoots` is the entry point that returns what it found.
//
// The plain `wacFiles` **computes the roots and throws them away**, and every caller here used it. So
// the documented Deno path could not compile a project using `@/` at all, whichever compiler it asked:
//
//     wacc:        wacc cannot compile main.wac yet — an import of a file that was not supplied
//     reference:   `@/src/lib.wac` needs a project: no `wac.json5` above main.wac
//
// Two compilers, two messages, one cause a layer above both of them — and `compileArtifacts` had
// carried a documented `roots` option since GitHub issue 21 whose name appeared once in the file, in
// its own type declaration. Nothing read it. GitHub issue 22 finding 4.
//
// **Why a test out here rather than in `packages/wacc`.** The compiler's own lanes pass a `Res` they
// construct, so they prove the `In` entry points work and cannot say whether anything calls them.
// This drives `buildNative`, which is what the documentation tells a reader to run.

import { buildNative } from "../native.ts";

function assert(ok: boolean, msg: string): void {
  if (!ok) throw new Error(msg);
}

const MANIFEST = `{ name: "outsider" }\n`;
const LIB = `export i32 twice(i32 n) { return n * 2; }\n`;
/** Every entry is the same program; only where it sits, and so what `@/` has to climb, differs. */
const USES = `import { twice } from "@/src/lib.wac";\nexport i32 four() { return twice(2); }\n`;

/** A project on disk, and the absolute path of each entry in it. */
async function outsider(): Promise<{ dir: string; entries: Record<string, string> }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-outsider-" });
  await Deno.mkdir(`${dir}/src`, { recursive: true });
  await Deno.mkdir(`${dir}/deep/er`, { recursive: true });
  await Deno.writeTextFile(`${dir}/wac.json5`, MANIFEST);
  await Deno.writeTextFile(`${dir}/src/lib.wac`, LIB);
  const entries: Record<string, string> = {
    "at the project root": `${dir}/main.wac`,
    "beside the file it imports": `${dir}/src/uses.wac`,
    "two directories down": `${dir}/deep/er/nested.wac`,
  };
  for (const path of Object.values(entries)) await Deno.writeTextFile(path, USES);
  return { dir, entries };
}

Deno.test("a `@/` import resolves through the Deno host, from any depth", async () => {
  const { dir, entries } = await outsider();
  try {
    for (const [where, entry] of Object.entries(entries)) {
      // The failure this guards is a *decline*, not a wrong answer: without the roots the import
      // resolves to a key no supplied file has, so the file contributes no declarations and the
      // build refuses. Building at all is the assertion.
      const stem = `${dir}/out-${where.replaceAll(" ", "-")}`;
      const manifest = await buildNative(entry, stem, {}).catch((e: Error) => {
        throw new Error(`${where} (${entry}) did not build:\n  ${e.message}`);
      });
      assert(manifest.entry === entry, `${where}: the manifest names ${manifest.entry}`);
      const wasm = await Deno.stat(`${stem}.wasm`);
      assert(wasm.size > 0, `${where}: wrote an empty module`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("...and the module it produces runs, so the imported file is really in it", async () => {
  // **The build succeeding is not the whole claim.** A resolution bug that put the *wrong* file in
  // the graph would also build; what says the right one arrived is `twice` answering 4.
  const { dir, entries } = await outsider();
  try {
    const entry = entries["two directories down"];
    await buildNative(entry, `${dir}/run`, {});
    const wasm = await Deno.readFile(`${dir}/run.wasm`);
    const { instance } = await WebAssembly.instantiate(wasm, {});
    const four = (instance.exports as Record<string, CallableFunction>)["four"];
    assert(typeof four === "function", "the module exports no `four`");
    assert(four() === 4, `four() answered ${four()}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── The relative-entry half, which the cases above do not reach ──────────────────────────────────
//
// **An absolute entry never exercises `base`.** `resolveFromAt` maps a `@/` join back through the base
// only when the importing file's key is *relative* — an absolutely-keyed graph is already in the key
// space the join produces, and converting it would give one file two keys. So every case above leaves
// that branch untaken, and the bug it guards against is a real one that was live for a cycle: honouring
// the root and dropping the base gives `/abs/p/src/lib.wac` for a file keyed `src/lib.wac`.
//
// Which means this case has to be a subprocess. A relative entry is relative to the working directory,
// and `Deno.chdir` is process-wide — a test that changed it would change it for whatever else the
// runner has in flight.
Deno.test("a `@/` import resolves for a relative entry, which is what exercises the base", async () => {
  const { dir, entries } = await outsider();
  try {
    const root = new URL("../../../", import.meta.url).pathname;
    // Spelled relative to the project, and run from inside it — the way somebody actually types it.
    for (const rel of ["main.wac", "src/uses.wac", "deep/er/nested.wac", "./main.wac"]) {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          "run", "--allow-read", "--allow-write", "--allow-env", "--allow-run",
          "--import-map", `${root}deno.json`,
          `${root}packages/platform/native.ts`,
          rel, "-o", `out-${rel.replaceAll("/", "_")}`,
        ],
        cwd: dir,
        stdout: "piped",
        stderr: "piped",
      });
      const r = await cmd.output();
      const said = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
      assert(r.code === 0, `\`${rel}\` from inside the project failed (exit ${r.code}):\n  ${said.trim()}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
