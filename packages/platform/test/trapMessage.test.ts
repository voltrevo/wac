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
// **A bare `trap;` must stay silent about a message it has not got**, which is the half that keeps this
// honest: an engine trap — a bounds check, a null dereference — writes nothing, and reporting the
// previous message for one of those would be worse than reporting none.

import "../../../harness/spawnRetry.ts";

const WAC = "native/v8/target/release/wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

async function run(program: string): Promise<{ said: string; code: number }> {
  const dir = await Deno.makeTempDir({ prefix: "wac-trapmsg-" });
  try {
    const path = `${dir}/p.wac`;
    await Deno.writeTextFile(path, program);
    const r = new Deno.Command(WAC, { args: ["run", path], stdout: "piped", stderr: "piped" })
      .outputSync();
    const dec = new TextDecoder();
    return { said: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a trap with a message says it", async () => {
  const { said, code } = await run(`export i32 main() { trap "the ring is full"; }\n`);
  assertEquals(code, 1, said);
  assertEquals(said.includes("trapped: the ring is full"), true, said);
});

Deno.test("a message the program computed, not only a literal", async () => {
  const { said } = await run(
    `export i32 main() { string why = "ring " + "full"; if (1 > 0) { trap why; } return 0; }\n`,
  );
  assertEquals(said.includes("trapped: ring full"), true, said);
});

// **And through the JavaScript host**, where it took a different route: a wac `string` is a GC array and
// opaque to JavaScript, so the message comes back through the module's staging buffer — which means the
// *glue* has to do it, not the host. `bindgen` emits a `$trapped` guard around each exported wrapper, so
// `app.main(…)` throws an `Error` that already says it and the launcher prints that.
//
// A program with capabilities is the case that matters and the case that works: its exports cross strings,
// so its glue has a staging buffer. One that crosses none — `export i32 main() { trap "…"; }` — has no
// buffer and still shows `unreachable` there, which is in the issue rather than pretended away.
Deno.test("a built app reports the message the program gave", async () => {
  const dir = await Deno.makeTempDir({ dir: ".", prefix: "wac-trapmsg-app-" });
  try {
    await Deno.writeTextFile(
      `${dir}/p.wac`,
      `import { Cli, Core } from "../packages/platform/src/platform.wac";\n\n` +
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

Deno.test("a bare trap claims no message", async () => {
  const { said, code } = await run(`export i32 main() { trap; }\n`);
  assertEquals(code, 1, said);
  assertEquals(said.includes("trapped"), true, said);
  assertEquals(said.includes("trapped:"), false, said);
});
