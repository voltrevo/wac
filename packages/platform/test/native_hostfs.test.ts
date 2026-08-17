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
// test-lane: heavy — 1145 MB and 85s across seven cases, each driving the native host

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
import { type Bounded, boundedAgain, boundedInputAgain, DEFAULT_SECONDS, hangReport } from "../../../harness/bounded.ts";
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
  // A symlink, because `linkStat` is the one filesystem question no two-host script used to ask. It
  // has to be made from here: there is no `ln` in this system, so a script cannot create its own.
  Deno.symlinkSync("f", `${tmp}/tree/link`);
  Deno.symlinkSync("nosuch", `${tmp}/tree/dangling`);
  // A link that leads to itself: `ELOOP`, which no corpus script could reach and which both hosts
  // reported as the operating system's sentence with `(os error 40)` still attached.
  Deno.symlinkSync("loop", `${tmp}/tree/loop`);
}

/** A name longer than any filesystem here will take — `ENAMETOOLONG`, at 300 bytes. */
const TOO_LONG = "n".repeat(300);

function runIt(cmd: string, args: string[], cwd: string = tmp): Bounded {
  // Asks again at three times the bound if the first attempt does not finish — see 0128.
  return boundedAgain(DEFAULT_SECONDS, cmd, args, {
    cwd,
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: tmp },
  });
}

/** The real tools, through bash, in the same directory the shells are told to change to. */
function gnu(script: string): Bounded {
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
  // ── `linkStat`: the difference between a link and what it points at ──
  "test -h link; echo st=$?",
  "test -h f; echo st=$?",
  "test -h dangling; echo st=$?",
  "test -h nosuch; echo st=$?",
  // `-e` follows, so it disagrees with `-h` on both of them — the pair is what says the two calls are
  // actually different calls rather than one answering for both.
  "test -e link; echo st=$?",
  "test -e dangling; echo st=$?",
  "cat link",
  "cat dangling",
  "wc -c link",
  // ── Failures the fault table had no category for, so the errno reached the user ──
  //
  // Each of these printed GNU's sentence *plus* `(os error N)` on both hosts, which is why no
  // two-host differential ever saw it: they agreed, and what they agreed on was wrong. Found by
  // hand, against the real tool.
  "cat loop",
  "wc -c loop",
  "echo x > loop",
  "cat " + TOO_LONG,
  "echo x > " + TOO_LONG,
  "mkdir " + TOO_LONG,
  // ── A *path* that is not a program. A name with a slash is not searched for and does not fall back
  // to a builtin, so what the shell says about it is what the filesystem says — on both hosts, and the
  // same as GNU. All four of these used to be `command not found` and 127.
  "./nosuch",
  "./sub",
  "sub/",
  "./nosuch a b",
  "./sub | cat; echo st=$?",
  "cat f | ./sub; echo st=$?",
  "./nosuch | wc -l; echo st=$?",
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
    // A bound that fired is not an answer — see `harness/bounded.ts` and issue 0128.
    const stuck = hangReport(script, [{ name: "bash", run: want }, { name: "deno", run: js }]);
    if (stuck !== null) throw new Error(stuck);
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
    const stuckNative = hangReport(script, [{ name: "native", run: rs }]);
    if (stuckNative !== null) throw new Error(stuckNative);
    assertEquals(rs.out, want.out, `native: ${script}`);
    assertEquals(rs.err, js.err, `native stderr: ${script}`);
    assertEquals(rs.code, js.code, `native status: ${script}`);
  }

  // The canary: GNU must actually have answered something, or every assertion above holds vacuously.
  fixture();
  assertEquals(gnu("cat f").out, "a\nb\nc\n", "bash did not run — nothing was compared");
});

// A file that exists, is not a directory, and is not a program. The three cases above are the
// filesystem's to answer and are the same everywhere; **this one is the runtime's**, and the two
// runtimes do not have the same answer to give. A JavaScript host would run a worker bundle and this
// is not one; the native host cannot run a foreign program at all, whatever it contains — see
// `Cap::Spawn` in `native/src/main.rs`, which answers -1 with a reason rather than -2 so that the
// shell reports the program rather than giving up on spawning.
//
// So the sentences are pinned rather than compared. What *is* the same on both, and is what a script
// can see, is the status and the shell naming the path it was given. If someone makes the two agree,
// this fails and says so — which is the right way round for a difference nobody has decided to keep.
Deno.test("the two hosts each say why a file is not a program, and differ", async () => {
  const native = await nativeBinary();
  fixture();
  const js = runIt(deno, ["-c", "cd tree; ./f"]);
  assertEquals(js.code, 126, "deno status");
  assertEquals(js.err, "sh: ./f: not a wac worker bundle: build one with --worker\n", "deno");
  // GNU's is `Permission denied` and neither host can say that: there is no execute bit in this
  // system to have refused. What both hosts do say is 126, which is the part a script reads.
  fixture();
  assertEquals(gnu("./f").code, 126, "bash disagrees about the status, which is the comparable part");
  if (native === null) return;
  fixture();
  const rs = runIt(native, [manifest, "-c", "cd tree; ./f"]);
  assertEquals(rs.code, 126, "native status");
  assertEquals(
    rs.err,
    "sh: ./f: spawning a program from its source is not implemented in the native runtime; " +
      "spawnSelf works\n",
    "native",
  );
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
 *
 * The refusal *for a withheld read* no longer differs: both hosts answer the sentence `platform.wac`
 * derives from `FAULT_NOT_GRANTED`, which is "Not granted to this application" — `issues/system/0169`.
 * The paragraph's point stands, which is why `wacland` reads the fault rather than grepping prose: a
 * host's own sentence is not a contract, and two of them agreeing today is not the same as it being
 * one.
 */
Deno.test("the four grants are independent: write without read, on both hosts", async () => {
  // `platform.wac` says a child's grants are "a ceiling of the parent's own, intersected by the host
  // rather than trusted", which reads as four separate switches — and on three hosts out of four it
  // is. This is the check that it is not four switches *in name only*: a build given write and not
  // read must be able to write and unable to read, rather than getting both or neither.
  //
  // **The fourth host cannot do it, and that is the platform rather than a bug.** In a page, reaching
  // a file to write it means walking directory handles from the root, and holding the root handle is
  // the read capability — there is no path-based open to separate them. `browser.ts` says so at the
  // line that delivers a child's filesystem, and `platform.wac` says so beside the sentence that
  // would otherwise imply otherwise.
  const native = await nativeBinary();
  if (native === null) return;

  await buildApp(ENTRY, `${tmp}/wonly-deno`, { write: true });
  await buildNative(ENTRY, `${tmp}/wonly`, { write: true });
  const where = `${tmp}/tree`;

  for (const [name, cmd, args] of [
    ["deno", `${tmp}/wonly-deno`, [] as string[]],
    ["native", native, [`${tmp}/wonly.json`]],
  ] as const) {
    fixture();
    // Writing works…
    const wrote = runIt(cmd, [...args, "-c", "echo written > made; echo st=$?"], where);
    assertEquals(wrote.out.includes("st=0"), true, `${name}: could not write: ${wrote.err}`);
    // …and the bytes really landed, which `st=0` alone would not prove — a write that silently did
    // nothing would report the same.
    assertEquals(Deno.readTextFileSync(`${where}/made`), "written\n", `${name}: nothing was written`);
    // …and reading does not.
    const read = runIt(cmd, [...args, "-c", "cat f"], where);
    assertEquals(
      read.err.includes("Not granted to this application"),
      true,
      `${name}: a write-only build read a file: ${read.out} / ${read.err}`,
    );
  }
});

Deno.test("a program reading its standard input answers the same on both hosts", async () => {
  // **Nothing compared this, and it was broken.** `conformance.test.ts` named it: every two-host
  // runner in this repository passes `stdin: "null"`, so the one thing none of them exercised was a
  // program reading its input. Under the native runtime every filter run by a shell that *spawns* —
  // `cat`, `wc`, `head`, `sort`, `grep` — produced nothing at all, while working in a sealed shell
  // that calls its applets in process, and while working when run directly.
  //
  // The cause was a queue shadowing the real thing: a child spawned with `inheritInput` has its
  // parent-fed queue finished at once, and `readChunk` read *that*, saw empty, and answered end of
  // input before reaching the process's own stdin. The comment beside the `finish` said the child
  // reads the process's input; the read path never let it.
  const native = await nativeBinary();
  if (native === null) return;

  const enc = new TextEncoder();
  async function withInput(cmd: string, args: string[], script: string, input: Uint8Array) {
    return await boundedInputAgain(DEFAULT_SECONDS, cmd, [...args, "-c", script], input, {
      cwd: tmp,
      env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    });
  }

  const cases: [string, Uint8Array][] = [
    ["cat", enc.encode("hello\nworld\n")],
    ["wc -c", enc.encode("12345")],
    ["cat; echo [done]", enc.encode("")],
    ["cat | wc -l", enc.encode("a\nb\nc\n")],
    ["read x; echo [$x]", enc.encode("typed\nmore\n")],
    // No trailing newline, which is where a reader that waits for one hangs or truncates.
    ["cat; echo [end]", enc.encode("partial")],
    // Bytes rather than text: a name and a line are bytes, and so is standard input.
    ["wc -c", Uint8Array.from([0xff, 0xfe, 0x00, 0x01])],
    // Past one chunk, which is the only case that exercises `readChunk` looping at all.
    ["wc -c", enc.encode("x".repeat(300_000))],
    // A reader that stops early, so the writer's end is closed under it.
    ["head -1", enc.encode("one\ntwo\nthree\n")],
    ["sort", enc.encode("c\na\nb\n")],
  ];

  for (const [script, input] of cases) {
    const js = await withInput(deno, [], script, input);
    const rs = await withInput(native, [manifest], script, input);
    assertEquals(rs.out, js.out, `\`${script}\`: the hosts read different input`);
    assertEquals(rs.err, js.err, `\`${script}\`: stderr`);
    assertEquals(rs.code, js.code, `\`${script}\`: status`);
  }

  // The canary: the JavaScript host really did read the input, so the comparison above is not two
  // programs agreeing that they saw nothing — which is exactly the state this test was written in.
  const sanity = await withInput(deno, [], "wc -c", enc.encode("12345"));
  assertEquals(sanity.out.trim(), "5", "the reference host read nothing either");
});

Deno.test("`kill %1` ends a background job on both hosts", async () => {
  // design/0001 step 3's criterion, and the one place a signal in this system does what a kernel's
  // does: a background job is a separate instance, so nothing cooperative can reach it, and `kill`
  // delivers by `closeSocket` — which both hosts implement and which is the whole reason `kill` can
  // end a job where it cannot end a pipeline stage.
  //
  // Here rather than only in `packages/box` because the *mechanism* is the capability layer's, and
  // the two hosts stop a child differently underneath: Deno terminates the worker, and the native
  // runtime finishes the child's queues so that its next write answers false. For every program in
  // this repo that is the same observable behaviour, which is what this asserts — and the difference
  // itself is wac-mono 0123.
  const native = await nativeBinary();
  if (native === null) return;

  const script = "seq 1 300000 & kill %1; wait";
  fixture();
  const js = runIt(deno, ["-c", script]);
  fixture();
  const rs = runIt(native, [manifest, "-c", script]);

  const lines = (t: string) => t.trimEnd().split("\n").filter((l) => l.length > 0).length;
  assertEquals(lines(js.out) < 1000, true, `deno: the kill did not stop it: ${lines(js.out)} lines`);
  assertEquals(lines(rs.out) < 1000, true, `native: the kill did not stop it: ${lines(rs.out)} lines`);
  assertEquals(rs.code, js.code, "the hosts disagree about the status");

  // The canary: left alone the job really does produce all of it, on both. Without this, a job that
  // failed to start would satisfy every assertion above.
  fixture();
  assertEquals(lines(runIt(deno, ["-c", "seq 1 300000 & wait"]).out), 300000, "deno ran no job");
  fixture();
  assertEquals(lines(runIt(native, [manifest, "-c", "seq 1 300000 & wait"]).out), 300000, "native ran no job");
});

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
