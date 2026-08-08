// `/dev` and `/proc`: files that do not exist until they are read.
//
// In `packages/box` rather than `packages/fs`, whose feature this is, for the reason the whole file
// states below: a synthesised mount takes a capability, so it has to be driven through a built shell —
// and a shell can only be asked about a file by running a command. `packages/box` is where the commands
// are (wac-mono 0103).
//
// design/0001 step 6, and its own criterion — "`cat /proc/self/cmdline` answers and
// `head -c 16 /dev/urandom | hex` works" — is the last test here, run through a **sealed** shell,
// which is the version of it that means something: a session built with no filesystem grants at all
// still gets a working `/dev/urandom`, because `Core.randomBytes` is a host function rather than a
// permission.
//
// Driven through a built shell rather than through `wacBind` because a synthesised mount takes a
// capability — the funcref `Core.randomBytes` — and a capability is what a built program has.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-fs-synth-" });
await buildApp("packages/box/src/bin/sealedsh.wac", built, {});
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; bytes: Uint8Array; err: string };

async function sh(script: string): Promise<Run> {
  const r = await new Deno.Command(built, {
    args: ["-c", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), bytes: r.stdout, err: d.decode(r.stderr) };
}

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("a mount is visible from the directory it is mounted in", async () => {
  // Without this a mount is invisible from above: the root's own tree has no entry for `/dev`, and only
  // the mount table knows. A listing that omits a directory you can `cd` into is worse than a wrong one,
  // because nothing about it looks wrong.
  assertEquals((await sh("ls /")).out, "dev\nproc\ntmp\n");
  assertEquals((await sh("mkdir /home; ls /")).out, "dev\nhome\nproc\ntmp\n", "sorted in with the real ones");
  // Only directly in it: `/proc/self` is under `/proc`, not under `/`.
  //
  // The pids are the process table — design/0001 step 3. `1` is the session, `2` is the `ls` doing the
  // looking, and `self` is a name for whichever is asking. A listing that changed as the table did is
  // the point of it; what makes this assertable is that the pids are allocated in order and never reused.
  assertEquals((await sh("ls /proc")).out, "1\n2\nself\n");
  assertEquals((await sh("ls /proc/self")).out, "cmdline\ncomm\nstatus\n");
  assertEquals((await sh("ls /dev")).out, "null\nrandom\nurandom\nzero\n");
});

Deno.test("/dev/null takes anything and keeps none of it", async () => {
  assertEquals((await sh("cat /dev/null; echo [$?]")).out, "[0]\n");
  const wrote = await sh("echo discarded > /dev/null; echo [$?]");
  assertEquals(wrote.out, "[0]\n", wrote.err);
  // And it is still empty afterwards, which is the whole of what it is for.
  assertEquals((await sh("echo discarded > /dev/null; cat /dev/null; echo [end]")).out, "[end]\n");
});

Deno.test("the endless devices give exactly what is asked of them", async () => {
  const zeros = await sh("head -c 8 /dev/zero");
  assertEquals(zeros.bytes.length, 8, zeros.err);
  assertEquals(zeros.bytes.every((b) => b === 0), true, "zero should be zeros");

  const some = await sh("head -c 32 /dev/urandom");
  assertEquals(some.bytes.length, 32, some.err);
  // Two reads differ. A `/dev/urandom` that repeated itself would pass every length check above and be
  // the most dangerous file in the tree, so this is the assertion that matters.
  const again = await sh("head -c 32 /dev/urandom");
  const same = some.bytes.every((b, i) => b === again.bytes[i]);
  assertEquals(same, false, "two reads of /dev/urandom were identical");
  // And not all one byte, which a stub returning a fill would also pass the test above with.
  assertEquals(new Set(some.bytes).size > 4, true, `too few distinct bytes: ${[...some.bytes]}`);
});

Deno.test("a file with no end says so rather than hanging or inventing a length", async () => {
  // GNU's `cat /dev/zero` runs until something stops it, which one `u8[]` cannot express. Refusing is
  // the honest third answer, and it names the read that does work.
  const whole = await sh("cat /dev/zero");
  assertEquals(whole.code, 1, "reading an endless device whole should fail");
  assertEquals(whole.err.includes("no end"), true, whole.err);
  assertEquals(whole.out, "", "nothing should have been printed");
  assertEquals((await sh("cat /dev/urandom")).code, 1);
  // `wc` reads whole too, so it gets the same refusal rather than a plausible number.
  assertEquals((await sh("wc -c /dev/zero")).code, 1);
});

Deno.test("everything but /dev/null is read-only, and says which", async () => {
  for (const path of ["/dev/zero", "/dev/urandom", "/proc/self/cmdline"]) {
    const r = await sh(`echo x > ${path}`);
    assertEquals(r.code !== 0, true, `${path} accepted a write`);
    assertEquals(r.err.includes("read-only"), true, `${path}: ${r.err}`);
  }
  for (const script of ["mkdir /dev/d", "rm /dev/null", "rmdir /proc/self"]) {
    const r = await sh(script);
    assertEquals(r.code !== 0, true, `${script} was allowed`);
  }
  // A name that is not there is absent, not read-only: the two are different answers.
  const missing = await sh("cat /dev/sda");
  assertEquals(missing.code, 1);
  assertEquals(missing.err.includes("No such file"), true, missing.err);
});

Deno.test("design/0001 step 6's own criterion, in a session with no grants at all", async () => {
  // `cat /proc/self/cmdline` answers…
  const cmdline = await sh("cat /proc/self/cmdline");
  assertEquals(cmdline.code, 0, cmdline.err);
  // NUL-separated, as Linux's is — a caller joining with spaces would produce something that reads the
  // same and parses differently.
  assertEquals(cmdline.out.includes("\0"), true, JSON.stringify(cmdline.out));
  // **`self` is the process doing the reading, which is `cat` — not the shell that started it.**
  //
  // This asserted `-c` until the process table existed, because `/proc/self` was the *program's* argv
  // and there was nothing else it could be. It was wrong, and bash says so: `bash -c 'cat
  // /proc/self/cmdline'` prints `cat\0/proc/self/cmdline\0`, which is now byte-for-byte what this
  // prints. A test written from what the code did rather than from what the system does will agree
  // with the code forever.
  const theirs = new Deno.Command("bash", { args: ["-c", "cat /proc/self/cmdline"] }).outputSync();
  assertEquals(cmdline.out, new TextDecoder().decode(theirs.stdout), "bash disagrees");

  // …and `head -c 16 /dev/urandom` works. The design writes `| hex`, which is a `packages/box` applet
  // and not one of this shell's twelve programs; `wc -c` asks the same question of the same bytes.
  const sixteen = await sh("head -c 16 /dev/urandom | wc -c");
  assertEquals(sixteen.out, "16\n", sixteen.err);
});

Deno.test("a mount point is a directory, and every question about it had a different wrong answer", async () => {
  // `/dev` is a mount point, so its **parent lives in the mount above** and the lookup inside `writeFile`
  // and `mkdir` searched the mounted tree for it. It found nothing, and each backing invented its own
  // reason: a memory mount said "no such file or directory" and a synthesised one said "read-only file
  // system". Neither is what `/dev` is, which is a directory.
  //
  // The right answers are GNU's, measured on this machine rather than remembered — `backings.test.ts`
  // would be the place to compare them, and cannot be: its host side runs with grants that stop at the
  // directory it was handed, so it fails on `/dev` with "Requires all access" instead of answering.
  //
  //     echo x > /dev     ->  Is a directory,  status 1
  //     mkdir /dev        ->  File exists,     status 1
  //     mkdir -p /dev     ->                   status 0
  const wrote = await sh("echo x > /dev; echo status=$?");
  assertEquals(wrote.out, "status=1\n");
  // Capitalised, as `strerror` and GNU have it — the phrase is `faultWords(FAULT_IS_DIR)` now rather
  // than a sentence the filesystem wrote for itself.
  assertEquals(wrote.err.includes("Is a directory"), true, wrote.err);

  const made = await sh("mkdir /dev; echo status=$?");
  assertEquals(made.out, "status=1\n");
  assertEquals(made.err.includes("File exists"), true, made.err);

  // `-p` means "and say nothing if it is already there", which is the whole of that flag.
  assertEquals((await sh("mkdir -p /dev; echo status=$?")).out, "status=0\n");
  // And an ordinary directory answers the same way, so this is about being a directory rather than
  // about being a mount.
  assertEquals((await sh("mkdir /d; mkdir /d; echo status=$?")).out, "status=1\n");
  assertEquals((await sh("mkdir /d; mkdir -p /d; echo status=$?")).out, "status=0\n");
});
