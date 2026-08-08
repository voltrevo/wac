// One program, two substantially different hosts, and the same answer.
//
// design/0001's arrival test in miniature — "load the same image in two substantially different hosts
// and demonstrate the same behaviour in both", where **substantially different means one JavaScript
// host and one that is not** (D9). Two JavaScript hosts satisfy the words and prove nothing: they share
// the transport, the worker model and the event loop. This is the first test in the repo that does not.
//
// The program is `example/wacland.wac`, whose stages are 0087's "done when" in the order a host acquires
// them. The native runtime has stage 1; the Deno host has 1 and 2. So the comparison here is over the
// **prefix both hosts claim to implement**, and the test asserts three separate things:
//
//   1. the native runtime produces stage 1 byte-for-byte as Deno does — including which stream each
//      line went to, which is the half a terminal cannot show you;
//   2. it **refuses** stage 2 by name rather than answering something plausible (design/0001 D6); and
//   3. Deno gets *further*, which is what stops this from being a test that passes because both hosts
//      do nothing. A prefix comparison with no evidence that the prefix is short is the shape of a
//      harness that reports "all agree" while comparing nothing.
//
// ## When cargo is not there
//
// The runtime is Rust and the rest of the repo is not. If cargo is missing the native half is skipped —
// **loudly**, and the Deno half still runs and still asserts, so a skip cannot be mistaken for a pass.
// Silent skipping is how a differential test comes to compare nothing.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/platform/example/wacland.wac";
const CRATE = "packages/platform/host/native";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Run = { code: number; out: string; err: string };

async function runIt(cmd: string, args: string[]): Promise<Run> {
  const r = await new Deno.Command(cmd, { args, stdout: "piped", stderr: "piped" }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** The native binary, built if cargo is here, or null with the reason said out loud. */
async function nativeBinary(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) {
      throw new Error(new TextDecoder().decode(built.stderr));
    }
  } catch (e) {
    console.warn(
      `SKIPPING the native half of the arrival test: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See issues/open/0087.`,
    );
    return null;
  }
  return `${CRATE}/target/release/wacland`;
}

const tmp = await Deno.makeTempDir({ prefix: "wac-native-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

Deno.test("the same program says the same thing on a JavaScript host and one that is not", async () => {
  const denoProgram = `${tmp}/wacland-deno`;
  await buildApp(ENTRY, denoProgram, {});
  const js = await runIt(denoProgram, ["one", "two"]);

  // The Deno half, asserted on its own so that a skipped native half still tests something.
  const jsLines = js.out.split("\n").filter((l) => l.length > 0);
  assertEquals(jsLines[0], "wacland: stage 1 output", js.err);
  assertEquals(js.err.trim(), "wacland: stage 1 warn");
  assertEquals(jsLines.includes("wacland: stage 2 argCount 2"), true, js.out);
  assertEquals(jsLines[jsLines.length - 1], "wacland: reached the end of what is implemented");

  const native = await nativeBinary();
  if (native === null) return;

  await buildNative(ENTRY, `${tmp}/wacland`, {});
  const rs = await runIt(native, [`${tmp}/wacland.json`, "one", "two"]);

  // 1. Stage 1, byte for byte, on both streams.
  assertEquals(rs.out, "wacland: stage 1 output\n", rs.err);
  assertEquals(rs.err.split("\n")[0], "wacland: stage 1 warn");
  assertEquals(rs.out, js.out.split("wacland: stage 2")[0], "the two hosts disagree about stage 1");

  // 2. And stage 2 is refused by name rather than answered.
  assertEquals(rs.code !== 0, true, "the native host should stop at what it has not got");
  assertEquals(
    rs.err.includes("Cli.argCount is not implemented in the native runtime yet"),
    true,
    rs.err,
  );

  // 3. The canary. If the native host silently did nothing and Deno silently did nothing, every
  // assertion above would hold. This is the one that says the prefix was short *because the native
  // host stops*, not because there was nothing to compare.
  assertEquals(
    js.out.length > rs.out.length,
    true,
    "Deno got no further than the native host — one of them is not running the program",
  );
});

Deno.test("the manifest carries the field order rather than the runtime holding a copy", async () => {
  // The failure this guards is silent and expensive: insert a capability in the middle of `Core` in
  // `platform.wac`, and a runtime with its own idea of the order builds a `Core` whose `log` is the
  // previous field's function. Every call would go somewhere plausible.
  const m = await buildNative(ENTRY, `${tmp}/order`, {});
  const core = m.structs.find((s) => s.name === "Core");
  if (core === undefined) throw new Error("no Core in the manifest");
  assertEquals(core.fields.map((f) => f.name), [
    "nowMillis",
    "monotonicNanos",
    "sleepMillis",
    "randomBytes",
    "log",
    "warn",
    "waitAny",
  ]);
  // Every field names a signature that is actually in the callback table — the lookup the runtime does.
  for (const f of core.fields) {
    assertEquals(
      m.callbacks.some((c) => c.type === f.type),
      true,
      `Core.${f.name} wants ${f.type}, which is in no callback`,
    );
  }
  assertEquals(core.methods.find((x) => x.name === "of")?.export, "$bind$sm_Core_of");
});
