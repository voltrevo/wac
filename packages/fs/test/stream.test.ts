// A filesystem you can write to as the bytes arrive.
//
// `writeFile(path, bytes)` needs all of them at once, and a redirection must not: `seq 1 2000000000 >
// out` built twenty gigabytes in the shell and trapped on one wasm array (wac-mono 0070). The only
// streaming write in the world was `Cli.openOutput`, which redirects *the process's* standard output —
// so `packages/sh` had **two implementations of `>`**, one writing through this filesystem and one
// writing through the host, disagreeing about which disk a session's redirection landed on.
//
// That was latent rather than live, because a sealed session does not spawn and so never took the
// streaming route (wac-mono 0116). It would have become a leak the day it did.
//
// So: `openOut`, `writeOut`, `closeOut`, mount-dispatched like every other operation. This file is the
// memory backing, tested directly; `packages/box/test/shell.test.ts` drives the same three through a
// pipeline on a host mount, which is the route that already existed.

import { wacBind } from "../../../harness/wacBind.ts";
import "../../../harness/spawnRetry.ts";

/** Local, because this repo has no third-party dependencies. Structural, because listings are arrays. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const fs = await wacBind("packages/fs/src/fs.wac") as unknown as {
  Fs: { inMemory(now: bigint): FsHandle };
};

type Change = { fault: number; message: string };
type FsHandle = {
  mkdir(path: string, parents: boolean): Change;
  writeFile(path: string, data: Uint8Array): Change;
  readFile(path: string): { ok: boolean; bytes: Uint8Array; error: string };
  stat(path: string): { exists: boolean; size: bigint };
  openOut(path: string): Change;
  writeOut(bytes: Uint8Array): boolean;
  closeOut(): Change;
};

const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array) => new TextDecoder().decode(b);

Deno.test("bytes written as they arrive end up as one file", () => {
  const f = fs.Fs.inMemory(0n);
  assertEquals(f.openOut("/log").fault, 0);
  for (const chunk of ["one\n", "two\n", "three\n"]) {
    assertEquals(f.writeOut(bytes(chunk)), true, chunk);
  }
  assertEquals(f.closeOut().fault, 0);
  assertEquals(text(f.readFile("/log").bytes), "one\ntwo\nthree\n");
  // And the size is the file's, so a `stat` between chunks is not reading a stale length.
  assertEquals(Number(f.stat("/log").size), 14);
});

Deno.test("opening truncates, as a `>` does", () => {
  const f = fs.Fs.inMemory(0n);
  f.writeFile("/log", bytes("old and long\n"));
  assertEquals(f.openOut("/log").fault, 0);
  f.writeOut(bytes("new\n"));
  f.closeOut();
  // Not "new\nnd long\n": `>` replaces, and a streaming write that only overwrote the front would
  // leave the tail of whatever was there — which is the shape of a very confusing file.
  assertEquals(text(f.readFile("/log").bytes), "new\n");
});

Deno.test("a second open closes the first, and a write with nothing open is refused", () => {
  const f = fs.Fs.inMemory(0n);
  assertEquals(f.writeOut(bytes("nowhere")), false, "a write with nothing open should not land");

  f.openOut("/a");
  f.writeOut(bytes("first\n"));
  // No `closeOut` — the second open has to finish it, or `/a` would be left open for ever and the
  // next `writeOut` would append to the wrong file.
  f.openOut("/b");
  f.writeOut(bytes("second\n"));
  f.closeOut();
  assertEquals(text(f.readFile("/a").bytes), "first\n");
  assertEquals(text(f.readFile("/b").bytes), "second\n");

  assertEquals(f.writeOut(bytes("after")), false, "a write after closing should not land");
  assertEquals(text(f.readFile("/b").bytes), "second\n");
});

Deno.test("opening what cannot be written says why, and opens nothing", () => {
  const f = fs.Fs.inMemory(0n);
  f.mkdir("/d", false);
  const dir = f.openOut("/d");
  assertEquals(dir.fault !== 0, true, "a directory should not open for writing");

  const missing = f.openOut("/nosuch/deep");
  assertEquals(missing.fault !== 0, true, "a path whose parent is absent should not open");

  // And neither left a cursor behind: a failed open that still accepted writes would put bytes
  // somewhere nobody asked for, which is worse than the failure it reported.
  assertEquals(f.writeOut(bytes("leaked")), false, "a failed open left something open");
});
