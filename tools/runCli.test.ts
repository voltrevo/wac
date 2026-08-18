// **A program that asks for nothing runs with nothing.**
//
//     export i32 main() { return 3; }
//
// `wac run` answered *no struct Core in the manifest* — a sentence about the host's own bookkeeping,
// about a program that is right. A `main` taking no capabilities declares none, so the manifest has no
// `Core` to find, and the world was built before anyone asked whether the program wanted one.
//
// The same reasoning is already written down two lines away in `native/v8/src/main.rs`, for test files:
// "A test file has no world, and must not be asked for one … building one first meant `wac test`
// refused every test file in the repository with *no struct Core in the manifest*, about a program that
// was right." This is that, one entry kind along.
//
// It is worth a test rather than a one-line fix because of what the program *is*: no ambient
// capabilities is the language's central claim, and the smallest program demonstrating it could not be
// run by the tool that runs programs.

// Imported for its side effect: retries a spawn that fails with "Text file busy", which a test that
// builds a binary and immediately runs it can hit. `tools/spawnretry.test.ts` checks that every such
// test does this, and mine builds an app in the last case.
import "../harness/spawnRetry.ts";

const WAC = "native/v8/target/release/wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function withProgram<T>(src: string, f: (path: string) => T): Promise<T> {
  const dir = await Deno.makeTempDir({ prefix: "wac-runcli-" });
  try {
    const path = `${dir}/p.wac`;
    await Deno.writeTextFile(path, src);
    return f(path);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function run(args: string[]): { out: string; code: number } {
  const r = new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
}

Deno.test("[§wac-cli-nocaps-5hq2xn9] wac run: a main that takes no capabilities runs, and its answer is the exit status", async () => {
  await withProgram("export i32 main() { return 3; }\n", (path) => {
    const r = run(["run", path]);
    assertEquals(r.out.includes("manifest"), false, r.out);
    assertEquals(r.code, 3, r.out);
  });
});

// **And the wasmtime host, which had the same two defects.** It built `Core` and `Cli`
// unconditionally and always passed both, so a `main` declaring nothing was refused for a missing
// `Core` and a `main(Core core)` alone would have failed on arity. Both hosts read the manifest's
// `main` params now.
//
// `buildNative` is what builds `wacland`, and it needs cargo. If cargo is absent this asserts nothing
// and says so — the pattern `packages/platform/test/native.test.ts` sets out: "silent skipping is how a
// differential test comes to compare nothing".
Deno.test("[§wac-cli-nocaps-5hq2xn9] wacland: a main that takes no capabilities runs there too", async () => {
  const cargo = await new Deno.Command("cargo", { args: ["--version"], stdout: "null", stderr: "null" })
    .output().catch(() => null);
  if (cargo === null || cargo.code !== 0) {
    console.log("    skipped: cargo is not here, so wacland cannot be built");
    return;
  }
  const { buildNative } = await import("../packages/platform/native.ts");
  const dir = await Deno.makeTempDir({ prefix: "wac-runcli-native-" });
  try {
    const src = `${dir}/p.wac`;
    await Deno.writeTextFile(src, "export i32 main() { return 3; }\n");
    await buildNative(src, `${dir}/p`, {});
    const r = new Deno.Command(`${Deno.cwd()}/native/target/release/wacland`, {
      args: [`${dir}/p.json`],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const said = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
    assertEquals(said.includes("manifest"), false, said);
    assertEquals(r.code, 3, said);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// **And the JavaScript hosts, which had it too.** `worldFor` built a `Core` from the module's exported
// classes unconditionally, and a program that declared no capabilities has no `Core` class to build from —
// `Cannot read properties of undefined (reading 'of')`, before `main` ran. The two Rust hosts read `main`'s
// parameter list; here the absent class is the same signal.
Deno.test("[§wac-cli-nocaps-5hq2xn9] a built app whose main takes no capabilities runs", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-runcli-app-" });
  try {
    const src = `${dir}/p.wac`;
    await Deno.writeTextFile(src, "export i32 main() { return 3; }\n");
    const { buildApp } = await import("../packages/platform/build.ts");
    await buildApp(src, `${dir}/p`, {});
    const r = new Deno.Command(`${dir}/p`, { stdout: "piped", stderr: "piped" }).outputSync();
    const said = new TextDecoder().decode(r.stdout) + new TextDecoder().decode(r.stderr);
    assertEquals(said.includes("reading 'of'"), false, said);
    assertEquals(r.code, 3, said);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("wac run: a main naming something this host cannot build still says so", async () => {
  // The other side of the same change: silence about a missing `Core` must not become silence about a
  // `main` that wanted one. `Page` is browser-only, so no host binary builds it.
  //
  // **The temporary directory goes inside the repository**, because an import specifier is relative —
  // `spec/spec/imports.md`: "Import paths are relative, using `./` or `../` prefixes" — so a program in
  // `/tmp` cannot reach `packages/platform` at all. Written from `/tmp` first, this test passed on a
  // *compile* failure instead of on the host's answer, which is a pass that would survive the host
  // losing the rule entirely.
  // Under `.cache` rather than at the root: a directory in the tree for a few milliseconds is one
  // every walker over this repository's own files can trip on, and one of them did — see the note in
  // `tools/testCli.test.ts`.
  await Deno.mkdir(".cache", { recursive: true });
  const dir = await Deno.makeTempDir({ dir: ".cache", prefix: "wac-runcli-page-" });
  try {
    const path = `${dir}/p.wac`;
    await Deno.writeTextFile(
      path,
      `import { Page } from "../../packages/platform/src/platform.wac";\n` +
        `export i32 main(Page page) { return 0; }\n`,
    );
    const r = run(["run", path]);
    assertEquals(r.code === 0, false, r.out);
    // Names the capability, rather than reporting a missing manifest struct or trapping inside.
    assertEquals(r.out.includes("Page"), true, r.out);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
