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

function runIt(cmd: string, args: string[], cwd: string = tmp): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, ...args],
    cwd,
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
  // `ENOTDIR`: `f` is a file, so every one of these walks into it. The failure any path can reach, and
  // the last one with no fault category — it fell to `FAULT_OTHER`, so each host printed its own
  // runtime's sentence and the two disagreed by construction: Deno's "Not a directory (os error 20)"
  // against Rust's "Not a directory (os error 20)" only because both happen to wrap the same errno, and
  // neither against GNU's four words. `FAULT_NOT_A_DIR` is the category, `fault_of` in `native/src`
  // learned it at the same time, and these are what say both ends arrived.
  "cat f/g",
  "ls f/g",
  "wc -c f/g",
  "rm f/g",
  "rm -f f/g; echo st=$?",
  "mkdir f/g",
  "rmdir f/g",
  "touch f/g",
  "test -e f/g; echo st=$?",
  "cd f/g",
  "echo y > f/g",
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
    // **And what it said when it failed.** Only stdout was compared against GNU here, with the two
    // hosts' stderr compared against each other below — so `ls nosuch`, `cat nosuch` and `wc -l nosuch`
    // sat in this list with the half that matters unchecked, and two hosts agreeing on a sentence GNU
    // does not use would have passed. bash prefixes a *builtin's* failure with `bash: line N: ` and
    // ours has no line number to give, which is the deliberate difference `sh/test/differential.test.ts`
    // already strips.
    const strip = (t: string) => t.replace(/^\S*bash: line \d+: /gm, "").replace(/^sh: /gm, "").trim();
    assertEquals(strip(js.err), strip(want.err), `deno stderr: ${script}`);
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

/**
 * Every operation that needs a grant, refused the same way on both hosts.
 *
 * **This was one operation.** `cat f` was the whole of it, out of the fourteen places `native/src` has
 * a grant check and the dozen `host/deno.ts` has — so thirteen capabilities could have been ungated on
 * one host, or refused in different words, and the suite would have said nothing. That is the arrival
 * test's own claim ("no implicit access to either host") tested at one point of entry.
 *
 * Two things are asserted per script and they are different claims:
 *
 *   - **the refusal happened** — the operation did not go through, and the status says so;
 *   - **the two hosts said the same thing** — the wac above the boundary is byte-identical, so any
 *     difference is the capability layer's, which is where a second host is most likely to diverge.
 *
 * The second is what found the two that were wrong: `du .` and `find .` reported a path they were not
 * granted as `not found` — a denial arriving as absence, which is what `Stat.fault` exists to prevent
 * — and `cat < f` printed the host's own sentence, which differs per runtime ("filesystem read not
 * granted to this application" against "this program was not granted reading") *and* named the
 * resolved absolute path of a machine the program is not supposed to be able to see.
 */
Deno.test("every capability that needs a grant is refused, the same way, on both hosts", async () => {
  const native = await nativeBinary();
  if (native === null) return;

  // The same program with no grants at all. A shell that could still read would mean the manifest's
  // grants were decoration; one that trapped would mean a program could not find out.
  await buildNative(ENTRY, `${tmp}/nogrant`, {});
  await buildApp(ENTRY, `${tmp}/nogrant-deno`, {});

  // One per grant-gated capability the shell can reach from a script. `stat`, `readDir`, `readFile`,
  // `writeFile`, `mkdir`, `remove`, `rename`, `openInput` and `openOutput` — read and write both.
  const SCRIPTS = [
    "cat f",              // readFile
    "cat < f",            // openInput, through a redirection rather than an operand
    "ls",                 // readDir
    "stat f",             // stat
    "du .",               // stat, then a walk
    "find .",             // the same, by the other applet
    "echo x > out",       // openOutput
    "mkdir new",          // mkdir
    "rm f",               // remove
    "mv f g",             // rename
    "touch t",            // writeFile
    "cp f copy",          // read and write in one command
  ];

  for (const script of SCRIPTS) {
    // **Started *in* the fixture rather than `cd`-ing into it**, and that is not tidiness. With
    // `cd tree; …` in front, `cd` fails first — it has no read grant either — and puts its own
    // "Not granted to this application" on stderr. Every assertion below that looks for that phrase
    // was then satisfied by `cd`'s line whatever the script did, and the test could not fail: putting
    // `du`'s old `not found` back left it green. Found by canarying it, which is the only way this
    // kind of pass shows up.
    const where = `${tmp}/tree`;
    fixture();
    const rs = runIt(native, [`${tmp}/nogrant.json`, "-c", `${script}; echo status=$?`], where);
    fixture();
    const js = runIt(`${tmp}/nogrant-deno`, ["-c", `${script}; echo status=$?`], where);

    // It did not happen. `status=0` would mean the operation went through; the file contents are
    // checked separately because a read that succeeded prints rather than failing.
    assertEquals(rs.out.includes("status=0"), false, `native: \`${script}\` succeeded: ${rs.out}`);
    assertEquals(js.out.includes("status=0"), false, `deno: \`${script}\` succeeded: ${js.out}`);
    assertEquals(rs.out.includes("a\nb\nc\n"), false, `native: \`${script}\` read the file: ${rs.out}`);
    assertEquals(js.out.includes("a\nb\nc\n"), false, `deno: \`${script}\` read the file: ${js.out}`);

    // And said the same thing about it. This is the comparison that matters: the wasm is identical, so
    // a difference here is the capability layer's.
    assertEquals(rs.err, js.err, `the hosts word \`${script}\` differently`);
    assertEquals(rs.out, js.out, `the hosts answer \`${script}\` differently`);

    // In the words `platform.wac` keeps for `FAULT_NOT_GRANTED`, which it holds apart from the
    // operating system's own denial so that "this build cannot" and "this file will not" are different
    // sentences. A host's raw message here would be a runtime leaking through the boundary.
    assertEquals(
      rs.err.includes("Not granted to this application"),
      true,
      `\`${script}\` did not say which kind of no: ${rs.err}`,
    );
    // Nothing about the machine underneath, either. `cat < f` named the resolved absolute path.
    assertEquals(rs.err.includes(tmp), false, `\`${script}\` leaked a host path: ${rs.err}`);
  }

  // The canary: a *granted* build must actually do these, or every assertion above holds because the
  // shell cannot do anything at all.
  fixture();
  const granted = runIt(deno, ["-c", "cat f"], `${tmp}/tree`);
  assertEquals(granted.out, "a\nb\nc\n", `the granted build could not read either: ${granted.err}`);
  // And one that the *stderr* comparison is not comparing two empties: a refusal really did say
  // something. Without this, a shell that failed silently would pass every line above.
  fixture();
  const said = runIt(`${tmp}/nogrant-deno`, ["-c", "cat f"], `${tmp}/tree`);
  assertEquals(said.err.trim().length > 0, true, "a refused read said nothing at all");
});
