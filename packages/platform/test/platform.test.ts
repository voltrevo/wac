// The bridge itself: a worker calling `hostCall`, and a host answering it.
//
// **What is left here has no wac in it at all**, which is the reason it is left. These four drive
// `newBridge`, `serveHostCalls` and `worker_probe.ts` directly — an oversized response, a handler
// that throws, an opcode nobody serves, and a handler that takes real asynchronous time while the
// main thread keeps running. The subject is `host/layout.ts` and `host/call.ts`, so there is nothing
// to translate: a wac program cannot post a message to a `SharedArrayBuffer` it does not know about,
// and could not reach an unserved opcode if it wanted to.
//
// The thirteen end-to-end tests that used to sit here moved on 2026-08-19 — `test/wac/world_test.wac`
// (the application, its grants, its stdin and its filters), `test/wac/runtimes_test.wac` (the built
// executable, and Deno against Node) and `test/wac/chunking_test.wac` (a megabyte in both
// directions). `issues/system/0161`.

import { denoWorld } from "../host/deno.ts";
import { newBridge } from "../host/layout.ts";
import { serveHostCalls } from "../host/respond.ts";
import { hostCall, HostCallError, str, unstr } from "../host/call.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
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

// ── The bridge itself ─────────────────────────────────────────────────────────

Deno.test("the bridge carries a response larger than its buffer", async () => {
  // A `readFile` of something bigger than the window must not become an error nobody
  // expected, so an oversized response arrives in chunks and is rejoined.
  const b = newBridge();
  // getRandomValues caps at 64KiB per call, so this is filled in blocks. Random rather
  // than a pattern so a chunk delivered twice, or out of order, cannot look correct.
  const big = new Uint8Array(3_000_000);
  for (let at = 0; at < big.length; at += 65536) {
    crypto.getRandomValues(big.subarray(at, Math.min(at + 65536, big.length)));
  }
  const responder = serveHostCalls(b, { 1: () => big });

  // The blocking side must not run on this thread — it would deadlock against the
  // responder. A worker is the only place `hostCall` is legal.
  const worker = new Worker(
    import.meta.resolve("./worker_probe.ts"),
    { type: "module" },
  );
  const got = await new Promise<{ len: number; first: number; last: number }>((res, rej) => {
    worker.onmessage = (e) => res(e.data);
    worker.onerror = (e) => rej(new Error(e.message));
    worker.postMessage({ sab: b.sab, op: 1, payload: new Uint8Array(0) });
  });
  responder.stop();
  worker.terminate();

  assertEquals(got.len, big.length, "every byte arrived");
  assertEquals(got.first, big[0]);
  assertEquals(got.last, big[big.length - 1]);
});

Deno.test("a capability that throws becomes an error in the application", async () => {
  const b = newBridge();
  const responder = serveHostCalls(b, {
    1: () => { throw new Error("the disk is on fire"); },
  });
  const worker = new Worker(import.meta.resolve("./worker_probe.ts"), { type: "module" });
  const got = await new Promise<{ error: string }>((res, rej) => {
    worker.onmessage = (e) => res(e.data);
    worker.onerror = (e) => rej(new Error(e.message));
    worker.postMessage({ sab: b.sab, op: 1, payload: new Uint8Array(0) });
  });
  responder.stop();
  worker.terminate();
  assertEquals(got.error, "the disk is on fire");
});

Deno.test("an unknown opcode is reported rather than hanging", async () => {
  const b = newBridge();
  const responder = serveHostCalls(b, {});
  const worker = new Worker(import.meta.resolve("./worker_probe.ts"), { type: "module" });
  const got = await new Promise<{ error: string }>((res, rej) => {
    worker.onmessage = (e) => res(e.data);
    worker.onerror = (e) => rej(new Error(e.message));
    worker.postMessage({ sab: b.sab, op: 99, payload: new Uint8Array(0) });
  });
  responder.stop();
  worker.terminate();
  assertEquals(got.error.includes("no handler for capability 99"), true, got.error);
});

Deno.test("a slow capability blocks the caller and nothing else", async () => {
  // The whole mechanism in one assertion: the handler takes 50ms of real asynchronous
  // time, the worker is parked for it, and the main thread stays free — which is why
  // the timer that resolves it can run at all.
  const b = newBridge();
  let mainThreadRan = 0;
  const ticker = setInterval(() => { mainThreadRan++; }, 5);
  const responder = serveHostCalls(b, {
    1: async () => {
      await new Promise((r) => setTimeout(r, 50));
      return str("late");
    },
  });
  const worker = new Worker(import.meta.resolve("./worker_probe.ts"), { type: "module" });
  const got = await new Promise<{ text: string }>((res, rej) => {
    worker.onmessage = (e) => res(e.data);
    worker.onerror = (e) => rej(new Error(e.message));
    worker.postMessage({ sab: b.sab, op: 1, payload: new Uint8Array(0), asText: true });
  });
  clearInterval(ticker);
  responder.stop();
  worker.terminate();
  assertEquals(got.text, "late", "the worker waited for it");
  assertEquals(mainThreadRan > 2, true, `main thread kept running (${mainThreadRan} ticks)`);
});

// Keeps the linter honest about the imports this file uses only through the worker.
void hostCall;
void HostCallError;
void unstr;
void denoWorld;
