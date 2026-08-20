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
//
// ## One test left, and it is the JavaScript one — 2026-08-20, `issues/system/0161`
//
// The two host *binaries* are asked in `tools/wac/runcli_test.wac`, along with the `Page` case: they
// spawn a binary and read what it said, which needs no JavaScript host. What stays here is the third
// host — `buildApp` makes a **Deno application** and runs that, so the subject is
// `packages/platform/build.ts` and the world it builds, where the same defect had its own shape:
// `worldFor` built a `Core` from the module's exported classes unconditionally, and a program that
// declares no capabilities has no `Core` class to build from — `Cannot read properties of undefined
// (reading 'of')`, before `main` ran. The two Rust hosts read `main`'s parameter list; here the absent
// class is the same signal.

// Imported for its side effect: retries a spawn that fails with "Text file busy", which a test that
// builds a binary and immediately runs it can hit. `tools/spawnretry.test.ts` checks that every such
// test does this, and the one below builds an app.
import "../harness/spawnRetry.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

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
