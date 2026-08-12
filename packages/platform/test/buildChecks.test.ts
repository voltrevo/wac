// A build runs the checker, not only the emitter.
//
// `waccArtifacts` asked `blockedFiles` — what the *emitter* declined — and never `diagnoseFiles`,
// so a program with type errors was built and run as long as the emitter could guess its way
// through. `packages/platform/example/page.wac` imported two names `platform.wac` does not export,
// was reported by the checker, and shipped anyway. The reference path never had that hole:
// `wacCompile` answers `ok: false` and `build.ts` throws. Flipping the default to wacc carried it
// in, which is exactly the kind of thing a default change does quietly.

import { buildApp } from "../build.ts";
import "../../../harness/spawnRetry.ts";

Deno.test("a program the checker refuses does not build", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-buildchecks-" });
  try {
    // A type error the emitter would happily guess past: the name resolves to nothing, and an
    // emitter that skipped the function would still produce a module.
    const entry = `${dir}/bad.wac`;
    await Deno.writeTextFile(
      entry,
      'export i32 main() { return "not an i32"; }\n',
    );
    let threw = "";
    try {
      await buildApp(entry, `${dir}/out`, {});
    } catch (e) {
      threw = e instanceof Error ? e.message : String(e);
    }
    if (threw === "") throw new Error("a program with a type error was built");
    if (!threw.includes("did not compile")) {
      throw new Error(`built failed for the wrong reason:\n${threw}`);
    }
    // The diagnostic itself has to reach the caller, or "did not compile" is a riddle.
    if (!/bad\.wac:1:\d+/.test(threw)) {
      throw new Error(`the message names no position:\n${threw}`);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
