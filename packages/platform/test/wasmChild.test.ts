// A JavaScript host starting a **wasm module** as a child.
//
// `spawn` takes a program's bytes, and on `native/v8` those bytes are a module carrying its own
// manifest. This is the JavaScript side of the same artefact: `spawnChild` wraps a module in a stub
// that imports `childWasm.ts`, which drives it from that manifest and hands it to the runtime's
// ordinary worker loop. `issues/system/0144`.
//
// ## The two worlds, and what this file is the near half of
//
// The entry has to reach the worker as *source*, and there are two ways to have it: as written, which
// is what a host running from its own tree does and what this file exercises, or already bundled,
// which is what a built application carries. This one is the cheap half — no build, no subprocess,
// `spawnChild` called directly with a module and the entry `moduleEntryFromSource` found.
//
// The far half is `packages/platform/test/wac/spawn_test.wac`, where a *built* program spawns a
// module and is granted the filesystem through it. That case is the one 0144 was open on: a built
// application refused every module by name until 2026-08-21, because it looked for `childWasm.ts`
// beside itself and found the built file. Neither test replaces the other — this one would pass with
// the build broken, and that one costs a build.

import { buildNative } from "../native.ts";
import { moduleEntryFromSource, spawnChild } from "../host/children.ts";
import { bridgeOf, newBridge } from "../host/layout.ts";
import { serveHostCalls } from "../host/respond.ts";
import { denoWorld } from "../host/deno.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

Deno.test("a wasm module is started as a child, and its output comes back", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-wasmchild-" });
  try {
    // `hello.wac` needs only `Core`, so what this proves is the whole path — module, manifest,
    // driver, funcref registry, worker loop — without a filesystem or a socket in it.
    await buildNative("native/v8/example/hello.wac", `${dir}/hello`, {});
    const wasm = await Deno.readFile(`${dir}/hello.wasm`);

    const child = spawnChild(
      wasm,
      [],
      // **A world, served.** A child talks to its parent through the bridge and blocks until
      // somebody answers — a stub that serves nothing does not fail, it *hangs*, which is what the
      // first version of this test did. `hello` only logs, so this world only needs the two output
      // streams; everything else is absent rather than refused, and absent is what a program with
      // no grants sees.
      (sab, cargs, out, _input, cerr) => {
        const enc = new TextEncoder();
        return serveHostCalls(bridgeOf(sab), denoWorld({
          args: cargs,
          log: async (l: string) => { await out.push(enc.encode(l + "\n")); },
          warn: async (l: string) => { await cerr.push(enc.encode(l + "\n")); },
        }));
      },
      () => newBridge(),
      // **What the host passes, rather than a default inside `spawnChild`.** The choice between the
      // Deno and Node entries is the host's — a wrong default is a build that starts the other
      // runtime's worker loop — so there is no default and every caller says which world it is.
      undefined,
      undefined,
      moduleEntryFromSource("deno"),
    );

    // `loaded` is the empty string when the source loaded and the host's message when it did not.
    const loaded = await child.loaded;
    assertEquals(loaded, "", `the child did not start: ${loaded}`);

    const code = await child.exit;
    assertEquals(code, 0, "hello returns 0");

    // `rest()` drains to the end, which the child reached when it exited above.
    const said = new TextDecoder().decode(await child.out.rest());
    const warned = new TextDecoder().decode(await child.err.rest());
    assertEquals(said.trim(), "hello from a Rust host on V8");
    assertEquals(warned.trim(), "and this goes to stderr");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
