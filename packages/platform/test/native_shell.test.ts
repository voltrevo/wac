// The arrival test, as close as it gets before there is an image to move: **one shell, two hosts.**
//
// design/0001's criterion is "the same image loaded in two substantially different hosts, showing the
// same users, files, installed programs, shell behaviour and system services in both". This is the
// **shell behaviour and installed programs** half of it, and the two hosts are one JavaScript and one
// that is not (D9), which is what makes it evidence rather than a coincidence.
//
// `sealedsh` is the right program to run: it builds its filesystem in memory with no grants at all, so
// what the two hosts share is the *system* rather than the machine underneath it. Every script below
// touches `packages/fs`'s VFS, `packages/sh`'s shell and `packages/box`'s applets, and none of them
// touches the disk.
//
// ## Why the scripts come from the existing corpus
//
// `packages/sh/test/corpus.ts` is already the differential fixture, compared against bash by
// `differential.test.ts` and against a second shell by `tools/corpusThrough.ts`. Importing it means
// these hosts are compared on the cases somebody wrote for a *reason* — each one is a rule of bash's
// that was got wrong once — rather than on scripts chosen to pass.
//
// **A bounded slice, and the bound is stated rather than silent.** Every case costs two subprocesses,
// so the whole corpus is minutes; this takes the first `SAMPLE` and says so. The full sweep is a
// `deno task`, not a gate.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
import { CORPUS } from "../../sh/test/corpus.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/box/src/bin/sealedsh.wac";
const CRATE = "native";
/** How many corpus scripts the gate runs. The rest is `deno task corpus:hosts`, which runs all 800-odd. */
const SAMPLE = 25;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-hosts-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

function shell(cmd: string, args: string[], script: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["10", cmd, ...args, "-c", script],
    cwd: tmp,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
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
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    console.warn(
      `SKIPPING the native half of the arrival test: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See issues/closed/0087.`,
    );
    return null;
  }
  // Absolute: every run below sets `cwd` to the scratch directory, and a relative path resolves from
  // there rather than from the repo. The first version of this failed with "No such file or directory"
  // naming a path that plainly existed.
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

Deno.test("the same sealed system answers the same on a JavaScript host and one that is not", async () => {
  const deno = `${tmp}/denosh`;
  await buildApp(ENTRY, deno, {});

  // The Deno half asserted on its own, so a skipped native half still tests something — and so that a
  // sealed session is known to be *doing* something rather than refusing everything.
  const alive = shell(deno, [], "mkdir /x; echo deep > /x/f; cat /x/f; seq 1 3 | tac | head -2");
  assertEquals(alive.out, "deep\n3\n2\n", alive.err);

  const native = await nativeBinary();
  if (native === null) return;
  await buildNative(ENTRY, `${tmp}/sealedsh`, {});
  const manifest = `${tmp}/sealedsh.json`;

  // The same assertion through the native host, before any comparison: two hosts that both did
  // nothing would agree on everything below.
  const aliveNative = shell(native, [manifest], "mkdir /x; echo deep > /x/f; cat /x/f; seq 1 3 | tac | head -2");
  assertEquals(aliveNative.out, "deep\n3\n2\n", aliveNative.err);

  const differ: string[] = [];
  for (const script of CORPUS.slice(0, SAMPLE)) {
    const a = shell(deno, [], script);
    const b = shell(native, [manifest], script);
    if (a.out !== b.out || a.err !== b.err || a.code !== b.code) {
      differ.push(
        `${JSON.stringify(script)}\n  deno   ${JSON.stringify(a.out + a.err)} (${a.code})` +
          `\n  native ${JSON.stringify(b.out + b.err)} (${b.code})`,
      );
    }
  }
  assertEquals(differ.length, 0, `\n${differ.slice(0, 5).join("\n")}`);
});

Deno.test("the applets answer the same on both hosts, including the ones with an oracle", async () => {
  const deno = `${tmp}/denosh`;
  await buildApp(ENTRY, deno, {});
  const native = await nativeBinary();
  if (native === null) return;
  await buildNative(ENTRY, `${tmp}/sealedsh`, {});
  const manifest = `${tmp}/sealedsh.json`;

  // Chosen because each reaches a different part of the boundary: an applet's own output through
  // `Core.log`, a pipeline through `pushChild`'s captured frame, the synthesised files, the process
  // table, and a hash whose answer a third party can check.
  const scripts = [
    "ls /",
    "ps",
    "echo a b c | wc -w",
    "printf 'b\\na\\nc\\n' | sort | tr a-z A-Z",
    "head -c 8 /dev/urandom | wc -c",
    "cat /proc/self/cmdline | wc -c",
    "echo hello | sha256sum",
    "for i in 1 2 3; do echo $i; done | tac",
  ];
  for (const script of scripts) {
    const a = shell(deno, [], script);
    const b = shell(native, [manifest], script);
    assertEquals(b.out, a.out, `${script} — stdout`);
    assertEquals(b.err, a.err, `${script} — stderr`);
    assertEquals(b.code, a.code, `${script} — status`);
  }

  // And one answer that is right rather than merely shared: `sha256sum` of "hello\n" is a number
  // neither host chose. Two hosts agreeing on a wrong hash would pass every assertion above.
  const hash = shell(native, [manifest], "echo hello | sha256sum");
  assertEquals(
    hash.out,
    "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03  -\n",
    hash.err,
  );
});
