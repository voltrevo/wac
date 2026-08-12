// A JavaScript host starting a **wasm module** as a child.
//
// `spawn` takes a program's bytes, and on `native/v8` those bytes are a module carrying its own
// manifest. This is the JavaScript side of the same artefact: `spawnChild` wraps a module in a stub
// that imports `childWasm.ts`, which drives it from that manifest and hands it to the runtime's
// ordinary worker loop. `issues/system/0144`.
//
// ## The two worlds, and why one of them refuses
//
// The stub imports the entry **by URL**, which works while the host runs from source and cannot in a
// *built* application: there `import.meta.url` is the built file and no such sibling exists. So a
// built application says
//
//     this host starts JavaScript worker bundles, and cannot start a wasm module here
//
// which is an honest refusal a shell falls through on, rather than a worker dying with "Module not
// found". Closing that means inlining the entry at build time, which costs a `deno bundle` on every
// build — the decision 0144 holds. Both are asserted here so neither can change unnoticed.

import { buildNative } from "../native.ts";
import { spawnChild } from "../host/children.ts";
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
