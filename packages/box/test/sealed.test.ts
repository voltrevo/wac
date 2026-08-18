// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { boundedInput, DEFAULT_SECONDS } from "../../../harness/bounded.ts";

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

/**
 * A program built with **no capabilities at all** cannot reach the host.
 *
 * This is the half of the sealed story that needs a process: the claim is about a *manifest*. There is
 * no read grant to reach the host *with*, so a run that printed the real `/etc/passwd` could not have
 * got there by accident — and `buildApp` writes the shebang from these grants, so the empty set is the
 * program's own permission set rather than something this test arranges.
 *
 * **Everything else that was here is `test/wac/sealedapplets_test.wac` now.** It ran the applets over an
 * in-memory filesystem by spawning this program once per invocation — 104 of them, 19s of every suite
 * run — and `Shell.onFs` takes the filesystem as a value, so the same 104 run in one process against the
 * same recorded answers. What is left is two scripts, because the manifest is what a second process is
 * for.
 */
Deno.test("a program built with no grants cannot reach the host", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "box-sealed-" });
  try {
    await buildApp(SEALED, built, {});

    const run = async (script: string) => {
      const r = await new Deno.Command(built, {
        args: ["-c", script], stdin: "null", stdout: "piped", stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" }, clearEnv: true,
      }).output();
      const d = new TextDecoder();
      return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
    };

    // **The host is not there.** Not "refused" by a permission — absent, because the only filesystem
    // this program has is the one it made.
    const host = await run("cat /etc/passwd; echo rc=$?");
    assertEquals(host.out, "rc=1\n", host.err);
    assertEquals(host.err.includes("No such file or directory"), true, host.err);

    // And the canary: a program that answered "absent" to everything would satisfy that on its own. The
    // world it *does* have is its own — what the shell wrote is what an applet reads, and `ls` sees the
    // mounts.
    const listed = await run("echo hi > /f; cat /f; ls /");
    assertEquals(listed.out, "hi\nbin\ndev\nf\nproc\ntmp\n", listed.err);
  } finally {
    await Deno.remove(built).catch(() => {});
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
      // 124 was the bug's shape, and `hung` is that same fact as a field rather than as a status the
      // program never chose — `harness/bounded.ts`.
      const r = await boundedInput(DEFAULT_SECONDS, built, ["-c", script], "");
      return { out: r.out, code: r.code, hung: r.hung };
    };

    // A lone applet that reads nothing: the case that hung.
    const lone = await open("seq 1 3");
    assertEquals(lone.code, 0, "a lone applet finished");
    assertEquals(lone.out, "1\n2\n3\n");

    // A pipeline, on the sequential route rather than the spawning one.
    const piped = await open("seq 1 3 | cat");
    assertEquals(piped.code, 0, "a pipeline finished");
    assertEquals(piped.out, "1\n2\n3\n");

    // `split` writes *several* files, and it wrote them by redirecting standard output — a capability
    // the host has and a memory image does not, so in a sealed session every piece was refused for want
    // of a grant it should never have needed. It collects and writes each piece now, which is the same
    // choice `lib/input.wac` makes for reading.
    const pieces = await open("seq 1 10 > n; split -l 4 n part; ls; cat partac");
    assertEquals(pieces.code, 0, "split finished");
    assertEquals(pieces.out, "bin\ndev\nn\npart" + "aa\npartab\npartac\nproc\ntmp\n9\n10\n");

    // **A relative operand after `cd`.** Resolution used to happen on the host, inside `pushChild`'s
    // frame; an applet asks the filesystem now, so the filesystem had to be told where the shell is
    // standing — without it `cat f` after `cd d` looked under the mount root and found nothing.
    const relative = await open("mkdir d; cd d; echo hi > f; cat f; ls; cd ..; cat d/f");
    assertEquals(relative.code, 0, "a relative operand after cd");
    assertEquals(relative.out, "hi\nf\nhi\n");

    // `find .` is the same question with the one name that is not a name: `.` means nothing at all
    // without a working directory, so it was the case that could not work by accident.
    const dot = await open("echo x > f; find .");
    assertEquals(dot.code, 0);
    assertEquals(dot.out.includes("./f"), true, dot.out);

    // And one that writes and reads a file, so the filesystem is in the loop as well.
    const both = await open(`printf 'b\\na\\n' > f; sort f`);
    assertEquals(both.code, 0);
    assertEquals(both.out, "a\nb\n");
  } finally {
    await Deno.remove(built).catch(() => {});
  }
});
