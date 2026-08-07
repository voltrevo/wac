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
