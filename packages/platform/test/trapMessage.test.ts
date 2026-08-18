// What a program says when it traps.
//
//     export i32 main() { trap "the ring is full"; }
//     $ wac run p.wac
//     wac: p.wac trapped: the ring is full
//
// It used to be `Uncaught RuntimeError: unreachable` and nothing else. `trap "…"` is the language's way
// to say why — `spec/spec` has it, the checker checks the message's *type* — and wacc's emitter matched
// the statement without binding its payload, so a program could be refused for writing `trap 7` and then
// have a correct message thrown away. `issues/lang/0147`.
//
// The message goes into a global before the trap, because after one there is no code left to run, and
// `$trap$message` hands it back once the trap has unwound. Both are the reference compiler's shape, so a
// host that reads one reads the other.
//
// ## One case left, and it is not waiting for a capability — 2026-08-18
//
// Three of the four moved to `test/wac/trapmessage_test.wac`, which drives `wac run` and reads what it
// said: the literal message, a computed one, and the bare `trap;` that must stay silent about a message
// it has not got. None of those needs a host.
//
// **This one is about the JavaScript, which is why it stays.** The route is different here: a wac
// `string` is a GC array and opaque to JavaScript, so the message comes back through the module's
// staging buffer — the *glue* carries it, not the host. `bindgen` emits a `$trapped` guard around each
// exported wrapper, the launcher in `host/entry.ts` prints `wac trap: …`, and both of those are
// TypeScript. Running the same module with `wac p.wasm` takes the interpreter's own path and says
// `wac: p.wac trapped: …` instead — a different sentence from different code, so asserting one against
// the other would be a translation that changed the subject.

import "../../../harness/spawnRetry.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

// **And through the JavaScript host**, where it took a different route: a wac `string` is a GC array and
// opaque to JavaScript, so the message comes back through the module's staging buffer — which means the
// *glue* has to do it, not the host. `bindgen` emits a `$trapped` guard around each exported wrapper, so
// `app.main(…)` throws an `Error` that already says it and the launcher prints that.
//
// A program with capabilities is the case that matters and the case that works: its exports cross strings,
// so its glue has a staging buffer. One that crosses none — `export i32 main() { trap "…"; }` — has no
// buffer and still shows `unreachable` there, which is in the issue rather than pretended away.
Deno.test("a built app reports the message the program gave", async () => {
  // Under `.cache` — in the tree, because the program imports `packages/platform` relatively, but not
  // at the root where every walker over this repository's files sees it appear and vanish. See the note
  // in `tools/testCli.test.ts` for the failure that cost.
  await Deno.mkdir(".cache", { recursive: true });
  const dir = await Deno.makeTempDir({ dir: ".cache", prefix: "wac-trapmsg-app-" });
  try {
    await Deno.writeTextFile(
      `${dir}/p.wac`,
      `import { Cli, Core } from "../../packages/platform/src/platform.wac";\n\n` +
        `export i32 main(Core core, Cli cli) {\n` +
        `  core.log("about to fail");\n  trap "the ring is full";\n}\n`,
    );
    const { buildApp } = await import("../build.ts");
    await buildApp(`${dir}/p.wac`, `${dir}/p`, {});
    const r = new Deno.Command(`${dir}/p`, { stdout: "piped", stderr: "piped" }).outputSync();
    const dec = new TextDecoder();
    const said = dec.decode(r.stdout) + dec.decode(r.stderr);
    assertEquals(said.includes("about to fail"), true, said);
    assertEquals(said.includes("wac trap: the ring is full"), true, said);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
