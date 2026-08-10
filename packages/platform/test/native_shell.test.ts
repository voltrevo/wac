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
import { type Bounded, bounded, DEFAULT_SECONDS, hangReport } from "../../../harness/bounded.ts";
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

function shell(cmd: string, args: string[], script: string): Bounded {
  return bounded(DEFAULT_SECONDS, cmd, [...args, "-c", script], { cwd: tmp });
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
    // **A bound that fired is not an answer.** `timeout` reports 124, which no program chose, so a
    // run that never finished used to be printed as a host that disagreed — `native "" (124)` — and
    // read as a conformance failure. Issue 0128 is what that cost.
    const hung = hangReport(JSON.stringify(script), [{ name: "deno", run: a }, { name: "native", run: b }]);
    if (hung !== null) { differ.push(hung); continue; }
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
    const stuck = hangReport(script, [{ name: "deno", run: a }, { name: "native", run: b }]);
    if (stuck !== null) throw new Error(stuck);
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

/**
 * The **seal**, on both hosts — design/0001's "no implicit access to *either* host".
 *
 * `packages/box/test/sealing.test.ts` asks all of this and asks it on one host. That was the honest
 * state of it and `test/conformance.test.ts` said so in as many words: `ENV`'s entry read "checks a
 * session cannot read the machine's environment, on one host only", and `RANDOM_BYTES`'s read "the
 * comparable claims are length and that a sealed session gets one without a grant, neither of which
 * is checked across hosts".
 *
 * A seal verified on one host is half a claim. The whole of design/0001's arrival test is that the
 * *same system* appears on two substantially different hosts, and a leak is exactly the kind of thing
 * that would differ between them: the two runtimes reach the environment, the clock and the CSPRNG by
 * completely different routes — `Deno.env` against `std::env`, `crypto.getRandomValues` against
 * whatever the Rust host uses — and nothing had ever asked the second one.
 *
 * ## Built *with* the grants, which is what makes it a test
 *
 * Both binaries here are built with read, write and env. A sealed session must still see none of it,
 * because `Shell.onFs` turns `hostEnv` off and its filesystem is its own — and if the grants were
 * withheld at build time instead, every assertion below would pass for the wrong reason, which is the
 * mistake `sealing.test.ts` records making once already.
 */
Deno.test("the seal holds on both hosts, not just the one it was written on", async () => {
  const denoSealed = `${tmp}/sealed-granted`;
  await buildApp(ENTRY, denoSealed, { read: true, write: true, env: true });

  const native = await nativeBinary();
  if (native === null) return;
  await buildNative(ENTRY, `${tmp}/sealed-granted-native`, { read: true, write: true, env: true });
  const nativeManifest = `${tmp}/sealed-granted-native.json`;

  // The machine has these, so an empty answer means they were withheld rather than absent.
  if ((Deno.env.get("HOME") ?? "").length === 0) throw new Error("this machine has no HOME to leak");

  // **And the grant is live on *both* hosts**, which is the canary this test cannot do without: a
  // seal assertion passes just as well against a runtime that never reads the environment for
  // anybody. `packages/box/src/bin/sh.wac` is the same binary shape with a shell whose world *is* the
  // host's, so it must print what the machine says — and it does on both, checked rather than
  // assumed, because `Cap::Env` in the native host is a separate implementation from Deno's.
  const openDeno = `${tmp}/open-granted`;
  await buildApp("packages/box/src/bin/sh.wac", openDeno, { read: true, write: true, env: true });
  await buildNative("packages/box/src/bin/sh.wac", `${tmp}/open-granted-native`, {
    read: true,
    write: true,
    env: true,
  });
  for (const [name, cmd, args] of [
    ["deno", openDeno, []],
    ["native", native, [`${tmp}/open-granted-native.json`]],
  ] as const) {
    const sees = shell(cmd, [...args], "echo HOME=[$HOME]");
    if (!sees.out.includes(Deno.env.get("HOME") ?? "\u0000")) {
      throw new Error(
        `the ${name} host does not read the environment at all, so the seal below proves nothing: ` +
          JSON.stringify(sees.out + sees.err),
      );
    }
  }

  /** A file that exists on this machine and cannot exist in a fresh session. */
  const hostFile = ["/etc/hostname", "/etc/hosts", "/etc/passwd"]
    .find((p) => {
      try {
        Deno.statSync(p);
        return true;
      } catch {
        return false;
      }
    });

  const asked: { script: string; want?: string }[] = [
    // D4: the environment is the session's, not the server's.
    { script: "echo [$HOME] [$PATH] [$USER]", want: "[] [] []\n" },
    // D4: so are the arguments — `-c` and the script are the *binary's* argv, not the shell's.
    { script: "echo count=[$#] zero=[$0] one=[$1]", want: "count=[0] zero=[] one=[]\n" },
    // Step 6: a sealed session has a real CSPRNG without a grant for one, because `Backing.Synth`
    // carries `randomBytes` and nothing else. Length is the comparable claim; the bytes are not.
    { script: "head -c 16 /dev/urandom | wc -c", want: "16\n" },
    { script: "head -c 1 /dev/urandom | wc -c", want: "1\n" },
    // `/dev/null` and `/dev/zero`, which are the other two the design names.
    { script: "cat /dev/null | wc -c", want: "0\n" },
    { script: "head -c 4 /dev/zero | wc -c", want: "4\n" },
    // The machine's own filesystem, by the two routes a session has: a simple command, and a
    // *spawned* stage, which is the one that reads a different disk when it goes wrong (0116).
    { script: `cat ${hostFile ?? "/etc/hostname"}; echo st=$?` },
    { script: `cat ${hostFile ?? "/etc/hostname"} | head -1; echo st=$?` },
    { script: "ls /", want: "bin\ndev\nproc\ntmp\n" },
  ];

  const differ: string[] = [];
  for (const { script, want } of asked) {
    const a = shell(denoSealed, [], script);
    const b = shell(native, [nativeManifest], script);
    const stuck = hangReport(JSON.stringify(script), [{ name: "deno", run: a }, { name: "native", run: b }]);
    if (stuck !== null) { differ.push(stuck); continue; }
    // **Each host against the claim first, then against the other.** Two hosts that leaked the same
    // way would agree with each other and be wrong, which is the failure a pure comparison cannot
    // see — and the reason every case that has a knowable answer states it.
    if (want !== undefined) {
      if (a.out !== want) differ.push(`deno ${JSON.stringify(script)}: ${JSON.stringify(a.out + a.err)}`);
      if (b.out !== want) differ.push(`native ${JSON.stringify(script)}: ${JSON.stringify(b.out + b.err)}`);
    }
    if (a.out !== b.out || a.err !== b.err || a.code !== b.code) {
      differ.push(
        `${JSON.stringify(script)}\n  deno   ${JSON.stringify(a.out + a.err)} (${a.code})` +
          `\n  native ${JSON.stringify(b.out + b.err)} (${b.code})`,
      );
    }
  }

  // The host's own file, wherever it was found, must not appear in either answer — checked on the
  // text rather than on the status, because `cat x | head -1` reports `head`'s status and not `cat`'s.
  if (hostFile !== null && hostFile !== undefined) {
    const first = Deno.readTextFileSync(hostFile).split("\n")[0];
    if (first.length > 0) {
      for (const [name, cmd, args] of [["deno", denoSealed, []], ["native", native, [nativeManifest]]] as const) {
        const seen = shell(cmd, [...args], `cat ${hostFile} | head -1`);
        if (seen.out.includes(first)) {
          differ.push(`${name} read ${hostFile}: ${JSON.stringify(seen.out)}`);
        }
      }
    }
  }

  assertEquals(differ.length, 0, `\n${differ.slice(0, 6).join("\n")}`);
});
