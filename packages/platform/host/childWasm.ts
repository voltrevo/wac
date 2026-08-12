// The worker half for a child that is a **wasm module** rather than a bundle.
//
// `spawn` takes a program's bytes, and on the native hosts those bytes are a module carrying its own
// manifest. This is what lets a JavaScript host start the same artefact: the module is driven from
// its manifest — `host/driver.ts` — and then handed to the runtime's ordinary worker loop, which
// cannot tell the difference. `issues/system/0143`.
//
// Nothing here is program-specific, which is the whole point: one file serves every wasm child,
// where a bundle carries glue written for one program.

import { asAppModule, drive, manifestIn } from "./driver.ts";
import { runAsWorkerEntry } from "./entry.ts";
import type { AppModule } from "./entry.ts";

/** Drive `wasm` and run it as this worker's program. */
export async function childMain(wasm: Uint8Array): Promise<void> {
  const manifest = manifestIn(wasm);
  if (manifest === null) {
    throw new Error("this module carries no wac.manifest section, so nothing can describe it");
  }
  // **The capabilities are the runtime's own.** `runAsWorkerEntry` builds `Core` and `Cli` by
  // handing this module JavaScript functions that talk to the bridge; the driver registers each in
  // a slot and gives back the funcref, which is exactly what generated glue does for a bundle.
  const driven = drive(wasm, manifest);
  await runAsWorkerEntry(asAppModule(driven) as unknown as AppModule);
}
