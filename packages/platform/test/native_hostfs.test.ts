// The native host's **filesystem capabilities**, against GNU coreutils and against the Deno host.
//
// This surface had no test at all, and I found that out the honest way: a canary in
// `arrival.test.ts` did not fire. Perturbing the native `readDir` to answer in reverse order changed
// nothing there, because everything a sealed or image session does to files goes through
// `packages/fs`'s VFS *inside* the image — so the arrival test exercises `readFile` and `writeFile`
// and nothing else, and eight capabilities were sitting untested behind a green suite.
//
// The program that does reach them is `packages/box/src/bin/sh.wac` — `wacsh`, the shell over the
// *real* filesystem, which is what a host mount is for (design/0001 D3).
//
// ## Every case changes directory first, and that is the point
//
// `pushChild` says that between it and `popChild` "every path is taken relative to `cwd`". The first
// native implementation answered the frame's directory from `cli.cwd()` and then resolved paths
// against the *process's* — so `cat f` worked, `cd sub; cat f` said "No such file or directory", and
// every test that did not change directory passed. It broke every applet that reads a named file, the
// moment a script did the most ordinary thing a script does.
//
// So `cd` is in every script below rather than in one case labelled "with cd".
//
// ## Three answers, not two
//
// GNU is the oracle where it has an opinion. The Deno host is the second answer, because a difference
// between the two of *ours* is a difference in the capability layer rather than in the applets — the
// wasm above the boundary is identical. Cases where the real tool is not comparable (its `stat` prints
// a page of inode detail; its `du` counts blocks) are compared between the two hosts only, and said
// to be, rather than dropped.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/box/src/bin/sh.wac";
const CRATE = "native";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-hostfs-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

/** The tree every case works over, rebuilt before each script so one cannot see another's writes. */
function fixture(): void {
  try {
    Deno.removeSync(`${tmp}/tree`, { recursive: true });
  } catch {
    // Not there, which is the usual case.
  }
  Deno.mkdirSync(`${tmp}/tree/sub`, { recursive: true });
  Deno.writeTextFileSync(`${tmp}/tree/f`, "a\nb\nc\n");
  Deno.writeTextFileSync(`${tmp}/tree/n`, "3\n1\n2\n");
  Deno.writeTextFileSync(`${tmp}/tree/sub/deep`, "x\n");
}

type Run = { code: number; out: string; err: string };

function runIt(cmd: string, args: string[]): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, ...args],
    cwd: tmp,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: tmp },
    clearEnv: true,
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** The real tools, through bash, in the same directory the shells are told to change to. */
function gnu(script: string): Run {
  return runIt("bash", ["-c", `cd tree; ${script}`]);
}

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
      `SKIPPING the native half: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs. See issues/closed/0087.`,
    );
    return null;
  }
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

const deno = `${tmp}/wacsh-deno`;
await buildApp(ENTRY, deno, { read: true, write: true, env: true });
await buildNative(ENTRY, `${tmp}/wacsh`, { read: true, write: true, env: true });
const manifest = `${tmp}/wacsh.json`;

/** Scripts the real tools and both shells all answer the same way. */
const AGREED = [
  "cat f",
  "cat f sub/deep",
  "wc -c f",
  "wc -l n",
  "head -1 n",
  "sort -n n | head -1",
  "grep -c b f",
  "ls",
  "ls sub",
  "ls nosuch",
  "cat nosuch",
  "wc -l nosuch",
  "echo new > made; cat made; rm made; ls",
  "mkdir d2; ls; rmdir d2; ls",
  "cp f copy; cat copy; rm copy",
  "mv f moved; ls; mv moved f",
  "cat sub/deep > out; wc -c out; rm out",
];

/** Scripts where the real tool prints more than this system has, so the two hosts are the oracle. */
const HOSTS_ONLY = [
  "stat f",
  "stat sub",
  "find .",
  "du .",
];

Deno.test("wacsh over the real filesystem agrees with GNU on both hosts", async () => {
  const native = await nativeBinary();

  for (const script of AGREED) {
    fixture();
    const want = gnu(script);
    fixture();
    const js = runIt(deno, ["-c", `cd tree; ${script}`]);
    assertEquals(js.out, want.out, `deno: ${script}`);
    if (native === null) continue;
    fixture();
    const rs = runIt(native, [manifest, "-c", `cd tree; ${script}`]);
    assertEquals(rs.out, want.out, `native: ${script}`);
    assertEquals(rs.err, js.err, `native stderr: ${script}`);
    assertEquals(rs.code, js.code, `native status: ${script}`);
  }

  // The canary: GNU must actually have answered something, or every assertion above holds vacuously.
  fixture();
  assertEquals(gnu("cat f").out, "a\nb\nc\n", "bash did not run — nothing was compared");
});

Deno.test("the two hosts agree where the real tool prints more than this system has", async () => {
  const native = await nativeBinary();
  if (native === null) return;

  for (const script of HOSTS_ONLY) {
    fixture();
    const js = runIt(deno, ["-c", `cd tree; ${script}`]);
    fixture();
    const rs = runIt(native, [manifest, "-c", `cd tree; ${script}`]);
    // `stat` prints an mtime, and the fixture is rewritten between the two runs, so the *shape* is
    // what is comparable: the same fields in the same order, with the timestamp masked.
    const mask = (s: string) => s.replace(/\d{4}-\d\d-\d\dT[\d:.]+Z/g, "<when>");
    assertEquals(mask(rs.out), mask(js.out), `native: ${script}`);
    assertEquals(rs.code, js.code, `native status: ${script}`);
  }

  // And one thing the mask must not have eaten.
  fixture();
  const stat = runIt(native, [manifest, "-c", "cd tree; stat f"]);
  assertEquals(stat.out.startsWith("f file 6 "), true, stat.out);
});

Deno.test("a capability the build did not grant is refused, not quietly absent", async () => {
  const native = await nativeBinary();
  if (native === null) return;

  // The same program with no grants at all. A shell that could still read would mean the manifest's
  // grants were decoration; one that trapped would mean a program could not find out.
  await buildNative(ENTRY, `${tmp}/nogrant`, {});
  fixture();
  const r = runIt(native, [`${tmp}/nogrant.json`, "-c", "cd tree; cat f; echo status=$?"]);
  assertEquals(r.out.includes("a\nb\nc\n"), false, `it read the file anyway: ${r.out}`);
  assertEquals(r.out.includes("status=1"), true, `${r.out} / ${r.err}`);
  // And it says which kind of "no" it was in the words `packages/box` already uses for
  // `FAULT_NOT_GRANTED` — which platform.wac keeps apart from the operating system's own denial so
  // that "this build cannot" and "this file will not" are different sentences.
  assertEquals(r.err.includes("Not granted to this application"), true, r.err);
});
