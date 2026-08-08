// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// A sealed shell with the applets: sixty commands over a filesystem that is not the host's.
//
// This is the test wac-mono 0109 was filed for. An applet used to take a `Cli` and read the *host*
// through it, while the shell held its filesystem as a value — so composing the two would have given one
// session two filesystems, with `ls /` listing the image and `cat /etc/passwd` reading the real machine
// and nothing in the output to say which. Applets take an `Fs` now.
//
// The program is built with **no capabilities at all**, which is what makes the assertions mean
// something: there is no read grant to reach the host *with*, so a run that printed the real
// `/etc/passwd` could not have got there by accident.

const SEALED = "packages/box/src/bin/sealedsh.wac";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("the applets work on a filesystem that is not the host's", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "box-sealed-" });
  try {
    // No grants. `buildApp` writes the shebang from these, so this is not a claim about the program —
    // it is the program's own permission set.
    await buildApp(SEALED, built, {});

    const run = async (script: string) => {
      const r = await new Deno.Command(built, {
        args: ["-c", script], stdin: "null", stdout: "piped", stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" }, clearEnv: true,
      }).output();
      const d = new TextDecoder();
      return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
    };

    // Applets, over the image: `seq` writes it, `sort` and `head` read it back.
    const sorted = await run("seq 1 20 > n; sort -nr n | head -3");
    assertEquals(sorted.out, "20\n19\n18\n", sorted.err);

    // …and a pipeline of three, one of which counts what another produced.
    const counted = await run(`printf 'a\\nb\\na\\n' > d; sort d | uniq -c`);
    assertEquals(counted.out, "      2 a\n      1 b\n", counted.err);

    // The world is its own: what the shell wrote is what an applet reads, and `ls` sees both mounts.
    const listed = await run("echo hi > /f; cat /f; ls /");
    assertEquals(listed.out, "hi\ndev\nf\nproc\ntmp\n", listed.err);

    // **And the host is not there.** Not "refused" by a permission — absent, because the only
    // filesystem this program has is the one it made.
    const host = await run("cat /etc/passwd; echo rc=$?");
    assertEquals(host.out, "rc=1\n", host.err);
    assertEquals(host.err.includes("No such file or directory"), true, host.err);

    const home = await run("ls /home; echo rc=$?");
    assertEquals(home.out, "rc=2\n", home.err);
  } finally {
    await Deno.remove(built).catch(() => {});
  }
});

/**
 * The same applets, over memory, against the real tools.
 *
 * The test above proves the host is unreachable; this one proves the applets *work* on what is reachable
 * — and it is the guard for the class that made it necessary. Eight applets built their own
 * `Feed.fromStdin(cli)` after opening an operand, which was right when `openStream` redirected the
 * process's standard input and is wrong when it hands back a feed over bytes: `head f`, `uniq f`,
 * `cat -n f` and five more printed **nothing, and exited 0**, on a filesystem that had the file.
 *
 * Nothing on the host could see it. `packages/box/test/behaviour.test.ts` runs the same invocations
 * through a shell whose filesystem *is* the host's, where redirecting standard input is exactly what
 * happens — so every one of them passed there and passes there still.
 *
 * The fixtures are written by the shell itself, because in a sealed world there is no other way to put a
 * file anywhere.
 */
Deno.test("the applets answer the same on an in-memory filesystem as the real tools do on disk", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "box-sealed-applets-" });
  const dir = await Deno.makeTempDir({ prefix: "box-sealed-applets-" });
  try {
    await buildApp(SEALED, built, {});

    const FIXTURE = [
  `printf '10\\n9\\n100\\n1\\n-5\\n2.5\\n0\\n' > nums.txt`,
  `printf 'banana\\nApple\\ncherry\\napple\\nBanana\\n' > words.txt`,
  `printf 'a\\na\\nb\\nB\\nb\\nc\\n' > dup.txt`,
  `printf 'a\\tb\\tc\\nd\\te\\tf\\n' > tabs.txt`,
  `printf '  leading\\ntrailing  \\n\\nblank above\\n' > mixed.txt`,
  // No `sed` here — box does not have one, and a fixture that needs a tool the shell lacks tests the
  // fixture rather than the applets. The shell's own `for` builds it.
  `for i in $(seq 1 30); do echo "line $i"; done > long.txt`,
  `printf 'no newline' > nonl.txt`,
].join("; ");
    const CASES = [
  "sort -n nums.txt", "sort -r nums.txt", "sort -u dup.txt", "sort nums.txt", "sort words.txt",
  "uniq -c dup.txt", "uniq -d dup.txt", "uniq -u dup.txt", "uniq dup.txt",
  "wc -l words.txt", "wc -w mixed.txt", "wc -c nonl.txt", "wc mixed.txt", "wc -l nums.txt words.txt",
  "head -3 long.txt", "head -c 12 long.txt", "tail -3 long.txt", "tail -c 12 long.txt",
  "cat -n mixed.txt", "cat -b mixed.txt", "cat -s mixed.txt", "cat -A tabs.txt", "cat nonl.txt words.txt",
  "nl mixed.txt", "tac long.txt", "tac nonl.txt", "rev words.txt", "rev nonl.txt",
  "cut -f2 tabs.txt", "cut -f1,3 tabs.txt", "cut -f2-3 tabs.txt", "cut -c2-4 tabs.txt",
  "fold -w 5 long.txt", "tr a-z A-Z < words.txt", "tr -d aeiou < words.txt", "tr -s a < dup.txt",
  "grep -c a words.txt", "grep -n a words.txt", "grep -i APPLE words.txt", "grep -v a words.txt",
  "grep -x apple words.txt", "grep -E 'a|b' words.txt", "sha256sum nonl.txt", "base64 nonl.txt",
  "sort dup.txt | uniq -c", "cat long.txt | wc -l", "grep line long.txt | head -2",
  "basename /a/b/c.txt .txt", "dirname /a/b/c.txt", "seq 5", "seq 2 6",
  "cp words.txt copy.txt; cat copy.txt", "mkdir d; echo in > d/f; cat d/f; ls d",
  "echo one > t; tee t2 < t; cat t2", "sort words.txt > s; head -2 s",
];

    const run = async (cmd: string, script: string, cwd: string) => {
      const r = await new Deno.Command(cmd, {
        args: ["-c", script], cwd, stdin: "null", stdout: "piped", stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" }, clearEnv: true,
      }).output();
      const d = new TextDecoder();
      return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
    };

    // The canary. Every assertion below is "these two agree", and a harness that ran nothing would
    // agree with itself.
    const one = await run("bash", "echo one", dir);
    const two = await run("bash", "echo two", dir);
    if (one.out === two.out || one.out === "") throw new Error("the harness is not comparing anything");

    const bad: string[] = [];
    for (const script of CASES) {
      // bash needs a fresh directory per case; the sealed shell starts from an empty world every time.
      const caseDir = await Deno.makeTempDir({ prefix: "sealed-case-" });
      try {
        const want = await run("bash", `${FIXTURE}; ${script}`, caseDir);
        const got = await run(built, `${FIXTURE}; ${script}`, dir);
        if (want.out !== got.out || want.code !== got.code) {
          bad.push(
            `$ ${script}\n  bash ${JSON.stringify(want.out.slice(0, 160))} exit ${want.code}\n` +
            `  ours ${JSON.stringify(got.out.slice(0, 160))} exit ${got.code}` +
            (got.err.trim() === "" ? "" : `\n  err  ${got.err.trim().split("\n")[0]}`),
          );
        }
      } finally {
        await Deno.remove(caseDir, { recursive: true }).catch(() => {});
      }
    }
    if (bad.length > 0) {
      throw new Error(`${bad.length} of ${CASES.length} differ on an in-memory filesystem:\n\n${bad.join("\n\n")}`);
    }
  } finally {
    await Deno.remove(built).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});

/**
 * The same hang, on the route a shell takes when it *cannot* spawn — wac-mono 0110's other half.
 *
 * `bin/sealedsh.wac` has no capabilities, so every applet runs in process through `pushChild`. That
 * takes the child's input as a **value**, so the shell had to read its own input to the end before it
 * could start an applet that might never read a byte of one: `seq 1 3` hung, with nothing waiting for
 * those bytes but the shell.
 *
 * `pushChild` can now be told the child reads the *real* input, which is the same answer `host/child.ts`
 * already gave for "no child running" — so the shell reads nothing and the applet reaches past the frame.
 *
 * `stdin: "piped"` and never written is the whole point of the harness: a standard input that stays
 * open, which is what a terminal is and what `stdin: "null"` — every other test in this repo — is not.
 */
Deno.test("an applet runs when the shell cannot spawn and its own input stays open", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "box-sealed-stdin-" });
  try {
    await buildApp(SEALED, built, {});
    const open = async (script: string) => {
      const child = new Deno.Command("timeout", {
        args: ["10", built, "-c", script], stdin: "piped", stdout: "piped", stderr: "piped",
      }).spawn();
      const r = await child.output();
      return { out: new TextDecoder().decode(r.stdout), code: r.code };   // 124 is the bug's shape
    };

    // A lone applet that reads nothing: the case that hung.
    const lone = await open("seq 1 3");
    assertEquals(lone.code, 0, "a lone applet finished");
    assertEquals(lone.out, "1\n2\n3\n");

    // A pipeline, on the sequential route rather than the spawning one.
    const piped = await open("seq 1 3 | cat");
    assertEquals(piped.code, 0, "a pipeline finished");
    assertEquals(piped.out, "1\n2\n3\n");

    // And one that writes and reads a file, so the filesystem is in the loop as well.
    const both = await open(`printf 'b\\na\\n' > f; sort f`);
    assertEquals(both.code, 0);
    assertEquals(both.out, "a\nb\n");
  } finally {
    await Deno.remove(built).catch(() => {});
  }
});
