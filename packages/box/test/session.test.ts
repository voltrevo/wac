// The one claim about a sealed session that is about the **built artefact**: what it asks the host for.
//
// The session's own filesystem — that it works, that it is not the host's, that two sessions share
// nothing — is `test/wac/session_test.wac`, in process and without building anything.
//
// This cannot go there, and the reason is the whole point of it. In process, a sealed session cannot
// reach the host because its `Fs` is `Fs.inMemory` and has no path to one: a property of the wiring.
// Here it cannot reach the host because the *program was built with no filesystem grants*, which the
// host enforces and the shebang states. Asserting that from inside a process that holds grants of its own
// would be asserting against the world you are standing in. `issues/system/0193` lists this among the
// things that stay out of pure wac.
//
// wac-mono 0067, and the payoff for threading the filesystem through the shell as a *value*: `bin/sh.wac`
// is a shell on the host, `bin/sealedsh.wac` is the same shell handed `Fs.inMemory()`, and the difference
// is one line at the top of the program.
//
// It lived in `packages/sh` until the twelve programs there were deleted (wac-mono 0103). What it asks
// about is a *filesystem*, and every question about a filesystem is asked with a *command* — so it moved
// to the package that has the commands, along with `backings`, `imaged`, `unnameable`, `node_shell` and
// `fs`'s `synth`, all for the same reason. `sealed.test.ts` beside this one asks whether the applets can
// reach the host; this one asks what the session's own world contains.
//
// The strongest part of this is not what the tests assert but how the binary is built: **no filesystem
// grants at all**. `buildApp(..., {})` means the world has no `fs`, so the program could not reach the host
// if it tried — a sealed session is enforced by the capability world and demonstrated by the mount table,
// rather than being a promise about what the code does.

import { buildApp } from "../../platform/build.ts";
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const sealed = await Deno.makeTempFile({ prefix: "wac-sealed-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(sealed);
  } catch {
    // Already gone, or never built.
  }
});
// No grants. Not `{ read: false }` — absent, which is how this world spells "no such capability".
// `coverage: false` because the assertion below is about an ordinary build: under `WAC_PROFILE`
// this repo builds instrumented programs, and one of those carries a scoped `--allow-write` for
// its coverage dump. That is a genuine difference in what the shebang says, and not the thing
// this file is checking. wac-mono 0024.
await buildApp("packages/box/src/bin/sealedsh.wac", sealed, {}, "deno", false, { coverage: false });

function run(script: string, cwd: string) {
  const r = new Deno.Command(sealed, {
    args: ["-c", script],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    // `PATH` because the shebang is `#!/usr/bin/env -S deno run …` and `env` needs to find `deno`. Without
    // it the binary never starts and every assertion here reads as "the shell printed nothing", which is
    // exactly what the first run of this test said.
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).outputSync();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

Deno.test("the sealed binary asks for no filesystem capability at all", async () => {
  // The shebang states what a program may do, so this is checkable rather than a claim: a sealed session
  // that could reach the host would say `--allow-read` here even if it never used it.
  const first = (await Deno.readTextFile(sealed)).split("\n")[0];
  assertEquals(
    first.includes("--allow-read") || first.includes("--allow-write"),
    false,
    `a sealed shell must not ask for the filesystem: ${first}`,
  );
});
