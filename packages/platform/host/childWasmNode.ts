// The worker half for a child that is a **wasm module**, on Node.
//
// `childWasm.ts`'s twin, and the only difference is which worker loop it hands the driven module to:
// Node's message port is `parentPort` rather than `self`, so the loop is `entryNode.ts`'s. Everything
// above that — the manifest, the driver, the funcref registry, the marshalling — is shared, which is
// what `issues/system/0144` is about and why this file is eight lines.
//
// `wt` is an argument rather than an import for the reason `entryNode.ts` gives: this module has to
// type-check under Deno, where `node:worker_threads` is not resolved, and the generated entry line
// that starts it is running on Node where it is. `children.ts`'s `childEntrySource` writes that line.

import { asAppModule, drive, manifestIn } from "./driver.ts";
import { runAsWorkerEntryNode } from "./entryNode.ts";
import type { AppModule } from "./entry.ts";

/** Drive `wasm` and run it as this Node worker's program. */
export function childMainNode(
  wt: Parameters<typeof runAsWorkerEntryNode>[0],
  wasm: Uint8Array,
): void {
  const manifest = manifestIn(wasm);
  if (manifest === null) {
    throw new Error("this module carries no wac.manifest section, so nothing can describe it");
  }
  // **The capabilities are the runtime's own**, exactly as under Deno: the driver registers each host
  // function in a slot and hands back the funcref, which is what generated glue does for a bundle.
  runAsWorkerEntryNode(wt, asAppModule(drive(wasm, manifest)) as unknown as AppModule);
}
