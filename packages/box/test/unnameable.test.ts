// What a shell says about a file it can list and cannot open.
//
// wac-mono 0065. `bad-\xff-name` is an ordinary file on this filesystem and an unnameable one from Deno:
// `readDir` replaces the invalid byte with U+FFFD and every path built from that name fails. So `ls` shows
// a file that nothing can touch, and until now every program said "No such file or directory" about it —
// which reads as *the caller got the name wrong* rather than *this runtime cannot express it*.
//
// **Not a differential case.** bash handles these names perfectly: `cat $'bad-\xff-name'` prints the file.
// Comparing against it would only restate the gap, and the corpus asserts agreement. So this file asserts
// our own sentence instead, and `packages/sh/README.md` records the divergence.
//
// The fixture is made with bash, because neither Deno nor this shell can create such a file: both take a
// path as a string, and the string that would name it does not exist.
//
// **`stat` was the last thing still lying**, and the third test below is what that was. `Stat` had no fault
// field, so "the name cannot be expressed" and "there is nothing here" arrived identically as
// `exists = false` — `test -e` answered *no* about a file that is there, silently and with status 1, which
// is an answer a script then acts on. `Stat` carries a fault now: absence stays an answer with
// `FAULT_NONE`, and only a question that could not be reached is a fault.

import { buildApp } from "../../platform/build.ts";
import { type Bounded, bounded, DEFAULT_SECONDS } from "../../../harness/bounded.ts";
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

const shell = await Deno.makeTempFile({ prefix: "wacsh-unnameable-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(shell);
  } catch {
    // Already gone, or never built.
  }
});
await buildApp("packages/box/src/bin/sh.wac", shell, { read: true, write: true, env: true });

/** A directory holding one ordinary file and one whose name is not valid UTF-8. */
async function fixture(): Promise<string> {
  const dir = await Deno.makeTempDir({ prefix: "wac-unnameable-" });
  await Deno.writeTextFile(`${dir}/plain.txt`, "ordinary\n");
  const made = new Deno.Command("bash", {
    // `$'…'` is bash's byte-literal syntax, and bash is the only thing here that can write this name.
    args: ["-c", `printf 'invalid\\n' > "$1"/$'bad-\\xff-name'`, "bash", dir],
    stdout: "null",
    stderr: "piped",
  }).outputSync();
  if (!made.success) {
    throw new Error(`could not create the fixture: ${new TextDecoder().decode(made.stderr)}`);
  }
  return dir;
}

function sh(script: string, cwd: string) {
  const r = new Deno.Command(shell, {
    args: ["-c", script],
    cwd,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).outputSync();
  const dec = new TextDecoder();
  return { code: r.code, out: dec.decode(r.stdout), err: dec.decode(r.stderr) };
}

Deno.test("a file that cannot be named says so, rather than saying it is missing", async () => {
  const dir = await fixture();
  try {
    // It is listed, because the host can enumerate it even though it cannot open it. That asymmetry is the
    // whole problem, so it is asserted rather than assumed.
    const listing = sh("ls", dir);
    assertEquals(listing.out.includes("plain.txt"), true, listing.out);
    assertEquals(listing.out.includes("�"), true, `the lossy name should be listed: ${listing.out}`);

    // And every program that opens it says which side is at fault. The glob is how a script would reach
    // it — nobody can type this name.
    for (const [script, program] of [["cat bad-*-name", "cat"], ["wc -l bad-*-name", "wc"]] as const) {
      const r = sh(script, dir);
      assertEquals(
        r.err.includes("cannot be named on this host"),
        true,
        `${program} should name the gap, said: ${JSON.stringify(r.err)}`,
      );
      assertEquals(
        r.err.includes("No such file or directory"),
        false,
        `${program} still blames the caller: ${JSON.stringify(r.err)}`,
      );
      assertEquals(r.code, 1, `${program} exited ${r.code}`);
    }

    // A genuinely missing file must still be missing, in GNU's words — the category the refinement could
    // most easily have swallowed.
    const absent = sh("cat no-such-file", dir);
    assertEquals(absent.err.includes("No such file or directory"), true, absent.err);
    assertEquals(absent.err.includes("cannot be named"), false, absent.err);

    // And the ordinary file in the same directory is untouched.
    assertEquals(sh("cat plain.txt", dir).out, "ordinary\n");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("removing one says the same thing, so a script cannot mistake it for gone", async () => {
  const dir = await fixture();
  try {
    const r = sh("rm bad-*-name; echo status=$?", dir);
    assertEquals(
      r.err.includes("cannot be named on this host"),
      true,
      `rm should name the gap, said: ${JSON.stringify(r.err)}`,
    );
    assertEquals(r.out.trim(), "status=1");
    // `rm -f` exists to ignore *absence*, and this is not absence: a file that is still there afterwards
    // must not be reported as removed.
    const forced = sh("rm -f bad-*-name; echo status=$?", dir);
    assertEquals(
      forced.err.includes("cannot be named on this host"),
      true,
      `rm -f swallowed a failure that is not absence: ${JSON.stringify(forced.err)}`,
    );
    assertEquals(forced.out.trim(), "status=1");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("`test -e` refuses to answer rather than saying no", async () => {
  // The shape this fixes: `exists = false` for a file that is *there*. `test` has one way to say it could
  // not tell — status 2 and a diagnostic, which is what it already does for an operator it has not
  // implemented — and using it is the difference between a script skipping a file and a script being told.
  const dir = await fixture();
  try {
    for (const op of ["-e", "-f", "-s"] as const) {
      const r = sh(`test ${op} bad-*-name; echo status=$?`, dir);
      assertEquals(
        r.err.includes("cannot be named on this host"),
        true,
        `test ${op} said nothing about why: ${JSON.stringify(r.err)}`,
      );
      assertEquals(r.out.trim(), "status=2", `test ${op} answered instead of refusing: ${r.out}`);
    }

    // And a name that is genuinely absent still answers, silently, with 1 — the whole reason the fault is
    // narrow. A `test` that complained about missing files would break every script that uses it to check.
    const absent = sh("test -e no-such-file; echo status=$?", dir);
    assertEquals(absent.out.trim(), "status=1");
    assertEquals(absent.err, "", `it complained about an ordinary absent file: ${absent.err}`);

    // As does an ordinary file, and a path *through* a file, which bash also calls simply false.
    assertEquals(sh("test -e plain.txt; echo status=$?", dir).out.trim(), "status=0");
    const through = sh("test -e plain.txt/inside; echo status=$?", dir);
    assertEquals(through.out.trim(), "status=1", `a path through a file should be false, not an error`);
    assertEquals(through.err, "", through.err);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("`ls` of the name it just listed does not call it missing", async () => {
  const dir = await fixture();
  try {
    const r = sh("ls bad-*-name", dir);
    assertEquals(
      r.err.includes("cannot be named on this host") || r.out.includes("cannot be named on this host"),
      true,
      `ls blamed the path: ${JSON.stringify(r.out)} / ${JSON.stringify(r.err)}`,
    );
    assertEquals(r.out.includes("No such file or directory"), false, r.out);
    // GNU's status for an inaccessible operand, which this already matched for a missing one.
    assertEquals(r.code, 2, `ls exited ${r.code}`);

    // A genuinely missing operand keeps GNU's sentence exactly, because that is the common case and the
    // corpus compares it.
    const missing = sh("ls no-such-file", dir);
    // On standard error, where a diagnostic belongs — `ls` writes its listing to standard output and its
    // complaints to standard error, and a test that conflated the two would pass for the wrong reason.
    assertEquals(
      missing.err.includes("cannot access 'no-such-file': No such file or directory"),
      true,
      `${JSON.stringify(missing.out)} / ${JSON.stringify(missing.err)}`,
    );
    assertEquals(missing.out, "", `a complaint went to standard output: ${missing.out}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── The other side of the same name ──────────────────────────────────────────
//
// Everything above is about a **host** mount, where the name is real and Deno cannot express it. In
// the system's *own* filesystem — memory, or an image — there is no such limit: a name is a byte array
// all the way down, which is what design/0001 D1 means by a VFS that is not the host's.
//
// Nothing held that. `packages/fs`'s round-trip property test builds its names from a fixed list of
// TypeScript strings, so every name it has ever round-tripped is valid UTF-8 — the harness cannot ask
// the question, because a JavaScript string that names such a file does not exist. The route that can
// is a *shell*, whose `$'…'` produces bytes, which is what this uses.

const sealedShell = await Deno.makeTempFile({ prefix: "wacsh-bytes-" });
const imagedShell = await Deno.makeTempFile({ prefix: "wacimg-bytes-" });
globalThis.addEventListener("unload", () => {
  for (const path of [sealedShell, imagedShell]) {
    try {
      Deno.removeSync(path);
    } catch {
      // Already gone.
    }
  }
});
await buildApp("packages/box/src/bin/sealedsh.wac", sealedShell, {});
await buildApp("packages/box/src/bin/imaged.wac", imagedShell, { read: true, write: true });

function byteSh(cmd: string, extra: string[], script: string): Bounded {
  return bounded(DEFAULT_SECONDS, cmd, [...extra, "-c", script]);
}

/** `n\xff` — the same shape of name, in the shell's own byte syntax. */
/**
 * `n\xff` — the same shape of name, in the shell's own byte syntax.
 *
 * **Written as the four characters `\xff`, not as the character U+00FF.** The first version of
 * this line held U+00FF, so the shell was handed `c3 bf` and faithfully made a file called that —
 * and the test reported a shell bug that did not exist. A test about bytes has to be written in
 * bytes.
 */
const BYTE_NAME = String.raw`$'n\xff'`;

Deno.test("a name that is not valid UTF-8 is an ordinary file in the system's own filesystem", () => {
  // Listed as the bytes it is — `6e ff` — rather than as a replacement character, and readable by the
  // same name that made it. Through `hex`, because the test harness cannot hold the name either.
  const r = byteSh(sealedShell, [], `echo inside > ${BYTE_NAME}; ls | hex; cat ${BYTE_NAME}`);
  assertEquals(r.code, 0, r.err);
  assertEquals(r.out.includes("6eff0a"), true, `the name was not the bytes: ${r.out}`);
  assertEquals(r.out.trim().endsWith("inside"), true, `it could not be read back: ${r.out}`);
});

Deno.test("and it survives an image, which is where a length-prefixed format would lose it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-bytes-image-" });
  try {
    const image = `${dir}/bytes.wacimg`;
    const made = byteSh(imagedShell, [image], `echo kept > ${BYTE_NAME}; ls | hex`);
    assertEquals(made.code, 0, made.err);
    assertEquals(made.out.includes("6eff0a"), true, made.out);

    // A second process, so the name went through the format and came back rather than staying in
    // memory. This is the case `packages/fs`'s property test cannot build.
    const back = byteSh(imagedShell, [image], `ls | hex; cat ${BYTE_NAME}`);
    assertEquals(back.out.includes("6eff0a"), true, `the name did not survive the image: ${back.out}`);
    assertEquals(back.out.trim().endsWith("kept"), true, `the contents did not: ${back.out}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

// ── A path the grant does not reach ──────────────────────────────────────────
//
// The same failure in a different disguise. `--allow-read` does **not** cover `/proc`, `/sys` or
// `/dev` under Deno: those need `--allow-all`, and asking without it throws `NotCapable` — a class
// newer than the `PermissionDenied` the fault table knew about. With no case for it the error fell
// through to "unknown", `statFault` turned it into `FAULT_NONE`, and a *denial arrived as absence*:
// `stat /proc` said "not found" about a directory that is plainly there.
//
// That is the failure this whole file is about, and `Stat.fault` exists to prevent it. The third test
// here is the one that matters — `test -e` answering **no** about something it could not look at is
// an answer a script then acts on.
//
// `readDir` has no fault to carry, so `ls /proc` still says "cannot access": its answer is
// `string[]?`, and a null cannot say why. That is the same gap `Stat` had before it gained a field,
// and closing it is a signature change across the platform rather than a mapping.

Deno.test("a path the build's grant does not reach is refused, not called absent", () => {
  // Through `wacsh` — a shell whose filesystem is the machine's — because that is the only place a
  // real path can be outside a real grant. `/proc` exists; this build may not look at it.
  const r = byteSh(shell, [], "stat /proc");
  // On the error stream, where a diagnostic belongs — checking standard output alone is how the first
  // version of this failed while the shell was saying exactly the right thing.
  assertEquals(r.err.includes("Not granted to this application"), true, `${r.out} / ${r.err}`);
  assertEquals(r.err.includes("not found"), false, `a denial should not read as absence: ${r.err}`);
  // The canary: `/proc` really is there, so "not found" would have been false rather than merely
  // unhelpful.
  //
  // Asked of **bash**, not of Deno. `Deno.readDirSync("/proc")` throws `NotCapable` unless the run
  // has `--allow-all`, which the gate does not — so the first version of this canary failed for the
  // very reason the test exists, and only under the suite rather than on its own. A canary that needs
  // the capability under test is not independent of it.
  const real = new Deno.Command("bash", { args: ["-c", "test -d /proc && echo yes"], stdout: "piped" })
    .outputSync();
  assertEquals(new TextDecoder().decode(real.stdout).trim(), "yes", "this machine has no /proc");
});

Deno.test("`test -e` refuses about a path it may not look at, rather than saying no", () => {
  // Status 2, not 1. A shell that answered "no" would send a script down the branch for *absent*,
  // which is the same mistake as the U+FFFD case above and just as quiet.
  const denied = byteSh(shell, [], "test -e /proc; echo [$?]");
  assertEquals(denied.out.trim().endsWith("[2]"), true, `${denied.out} / ${denied.err}`);

  // And ordinary absence is still ordinary: status 1, no complaint. Without this the fix would read
  // as "every failure is now a refusal", which would break `rm -f` and every "does it exist" check.
  const absent = byteSh(shell, [], "test -e /nosuchpath; echo [$?]");
  assertEquals(absent.out.trim(), "[1]", absent.out);
  assertEquals(absent.err, "", `absence should be silent: ${absent.err}`);
});

// ── A directory that is there and cannot be listed ───────────────────────────
//
// The same failure again, and the worst of the three because the answer was **success**: `chmod 000 d;
// ls d` printed `d` and exited 0, where GNU says "cannot open directory 'd': Permission denied" and
// exits 2. `ls` prints a *file*'s own name — that is what `ls f` does — and a directory whose listing
// was refused took that branch, because `readDir` answers `string[]?` and a null carries no reason.
//
// Not in `packages/sh`'s corpus, though that is where a bash comparison belongs, and the reason is
// worth knowing: **`chmod` on a host mount is not implemented**, so no script this shell can run is
// able to set the mode up. The condition is made here with `Deno.chmod` instead, and bash is still the
// oracle — its exact words and its exact status are what these assert.

Deno.test("a directory that cannot be listed is a failure, not a name", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-unlistable-" });
  try {
    await Deno.mkdir(`${dir}/shut`);
    await Deno.writeTextFile(`${dir}/plain`, "x\n");
    await Deno.chmod(`${dir}/shut`, 0o000);

    // What bash's `ls` says, asked rather than assumed — the words and the status both.
    const gnu = new Deno.Command("bash", {
      args: ["-c", "cd \"$1\"; ls shut; echo status=$?", "bash", dir],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    const d = new TextDecoder();
    const theirs = { out: d.decode(gnu.stdout), err: d.decode(gnu.stderr) };
    // The canary: if this machine let us list it — running as root would — the comparison below is
    // between two successes and says nothing.
    assertEquals(theirs.out.trim(), "status=2", `bash could list a 000 directory: ${theirs.out}`);

    const ours = byteSh(shell, [], `cd ${dir}; ls shut; echo status=$?`);
    assertEquals(ours.out.trim(), "status=2", `${ours.out} / ${ours.err}`);
    assertEquals(ours.err, theirs.err, "the complaint should be bash's, word for word");

    // And the branch it used to take is still right for a file: `ls f` prints `f`.
    const file = byteSh(shell, [], `cd ${dir}; ls plain; echo status=$?`);
    assertEquals(file.out, "plain\nstatus=0\n", `${file.out} / ${file.err}`);
  } finally {
    await Deno.chmod(`${dir}/shut`, 0o700).catch(() => {});
    await Deno.remove(dir, { recursive: true });
  }
});

// ── What we have not written, said as that ───────────────────────────────────
//
// The last shape in this file, and the one that took a category of its own. `Fs.chmod` on a host mount
// is not implemented; it answered `FAULT_DENIED` because that was the nearest word, and `packages/sh`
// renders a fault as `faultWords` gives it — so "we have not written this" reached the user as
// `chmod: cannot access 'o': Permission denied`, blaming the file twice over: once in the category and
// once in the "cannot access" frame. GNU succeeds there; `chmod` wants ownership, not read.
//
// `FAULT_UNSUPPORTED` has **no phrase** in `faultWords`, which is the mechanism rather than an
// omission: every caller already spells the empty case as `words == "" ? message : words`, so the
// message is what prints — and only the message can say *what* is unimplemented. wac-mono 0117.

Deno.test("an operation we have not written says so, and blames no file", () => {
  const dir = Deno.makeTempDirSync({ prefix: "wac-unsupported-" });
  try {
    const r = byteSh(shell, [], `cd ${dir}; mkdir o; chmod 700 o; echo status=$?`);
    // The sentence is ours because no GNU phrase fits: GNU never fails here at all.
    assertEquals(r.err.trim(), "chmod: chmod on a host mount is not implemented", r.err);
    assertEquals(r.out.trim(), "status=1", r.out);
    // Not "Permission denied", which is what it said before, and not "cannot access", which frames a
    // fact about us as a fact about the path.
    assertEquals(r.err.includes("Permission denied"), false, r.err);
    assertEquals(r.err.includes("cannot access"), false, r.err);

    const own = byteSh(shell, [], `cd ${dir}; chown somebody o`);
    assertEquals(own.err.trim(), "chown: chown on a host mount is not implemented", own.err);

    // The canary: GNU *can* do this, so our refusal is about us rather than about the directory. A
    // machine where `chmod` failed for a real reason would make the assertions above meaningless.
    const gnu = new Deno.Command("bash", {
      args: ["-c", `cd "$1"; chmod 700 o; echo status=$?`, "bash", dir],
      stdout: "piped",
    }).outputSync();
    assertEquals(new TextDecoder().decode(gnu.stdout).trim(), "status=0", "bash could not chmod either");
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
});
