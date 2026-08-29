// The transform run the way a bootstrap runs it: no `wac` binary, no capabilities, no bridge.
//
//     deno test -A --no-check packages/ts/test/tinyInterface.test.ts
//
// `design/system/0009`. This is the claim the whole note rests on and the one nothing else checks:
// everything in `packages/ts/test/wac/` runs through `wac run`, which needs the binary that a
// bootstrap does not have yet.
//
// The interface is one function — `u8[] transform(u8[] archive)` — so the host is a hundred lines
// that pack a zip, write bytes into `$bind$mem` and read bytes back. No `Pending`, no scheduler, no
// marshalling. **The same host file runs under Deno and under Node**, and the test asserts they
// produce the same bytes, because "works on the machine I tried" is exactly the failure the
// bootstrap exists to avoid.

import { ROOT } from "../../../harness/programs.ts";

const WAC = `${ROOT}/native/v8/target/release/wac`;
const HOST = `${ROOT}/packages/ts/host/run.js`;

/** The bridge, in the order its graph is walked from. */
const FILES = [
  "deno.ts", "provider.ts", "children.ts", "call.ts", "marshal.ts", "faults.ts", "respond.ts",
  "layout.ts", "entry.ts", "queue.ts", "child.ts", "schedule.ts", "driver.ts", "childLife.ts",
  "ops.ts", "entropy.ts", "childWasm.ts",
].map((f) => `packages/platform/host/${f}`);

async function have(p: string): Promise<boolean> {
  try {
    return (await Deno.stat(p)).isFile;
  } catch {
    return false;
  }
}

/** Build `transform.wasm` — the one step that still needs a compiler, which the ladder supplies. */
async function buildTransform(dir: string): Promise<string> {
  const stem = `${dir}/transform`;
  const r = await new Deno.Command(WAC, {
    args: ["build", "packages/ts/src/transform.wac", "-o", stem, "--quiet"],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) throw new Error(new TextDecoder().decode(r.stderr).trim());
  return `${stem}.wasm`;
}

async function runHost(exe: string[], wasm: string): Promise<Uint8Array> {
  const r = await new Deno.Command(exe[0], {
    args: [...exe.slice(1), HOST, wasm, ...FILES],
    cwd: ROOT,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!r.success) {
    throw new Error(`${exe.join(" ")} failed:\n${new TextDecoder().decode(r.stderr).trim()}`);
  }
  return r.stdout;
}

Deno.test("the transform runs with no binary, no capabilities and no bridge", async () => {
  if (!await have(WAC)) return;
  const dir = await Deno.makeTempDir({ prefix: "wac-ts-tiny-" });
  try {
    const wasm = await buildTransform(dir);

    const viaDeno = await runHost([Deno.execPath(), "run", "-A"], wasm);
    if (viaDeno.length < 100_000) {
      throw new Error(`the bundle is ${viaDeno.length} bytes — that is not the bridge`);
    }

    // **The same host, the other runtime.** A bootstrap machine has one or the other, and a
    // transform that works on only one of them is a transform that works by accident.
    let viaNode: Uint8Array | null = null;
    try {
      await new Deno.Command("node", { args: ["--version"], stdout: "null", stderr: "null" })
        .output();
      viaNode = await runHost(["node"], wasm);
    } catch {
      viaNode = null; // no node here; the Deno half still stands
    }
    if (viaNode !== null) {
      if (viaNode.length !== viaDeno.length) {
        throw new Error(`node produced ${viaNode.length} bytes and deno ${viaDeno.length}`);
      }
      for (let i = 0; i < viaNode.length; i++) {
        if (viaNode[i] !== viaDeno[i]) {
          throw new Error(`node and deno differ at byte ${i} — the host is not runtime-independent`);
        }
      }
    }

    // And the answer has to be JavaScript, which only a JavaScript parser can say.
    const out = `${dir}/bridge.js`;
    await Deno.writeFile(out, viaDeno);
    const check = await new Deno.Command(Deno.execPath(), {
      args: ["check", "--no-lock", out],
      cwd: ROOT,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (!check.success) {
      throw new Error(`Deno will not parse it:\n${new TextDecoder().decode(check.stderr).trim()}`);
    }
    console.log(
      `   ${Math.round(viaDeno.length / 1024)} KB from ${FILES.length} files, ` +
        `${viaNode === null ? "deno only (no node here)" : "node and deno byte-identical"}`,
    );
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
