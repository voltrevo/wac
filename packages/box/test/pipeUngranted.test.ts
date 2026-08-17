// A pipeline needs no filesystem grant.
//
//     $ boxsh            # built with no grants at all
//     echo hi | cat
//     cat: : Not granted to this application
//
// `cat` was not reading a file. It had no operand, so `lib/input.wac` takes its "standard input is
// standard input, whatever the filesystem is" branch and calls `cli.openInput("")` — where `""` is the
// **reset** to the process's own stream and not a path. In a sealed shell the applet's world is
// `platform`'s substitute (`shrun.wac`'s `boxRun` → `childCli`), and that joined the sentinel onto the
// frame's directory: `parent.openInput(joinPath(cwd, ""))` is `parent.openInput(cwd)`, a *directory*,
// which the parent then grant-checks and refuses.
//
// So every streaming applet — `cat`, `grep`, `head`, `wc`, `tr` — needed `--allow-read` to read a pipe,
// and with the grant it was opening a directory whose bytes it then never used, because the substitute
// answers the reads from the frame's queue. `sort` was unaffected: it does not take that branch.
//
// Built with `{}` deliberately. Every other box test grants something, which is why sixty commands over
// a sealed shell never showed this.

import { buildApp } from "../../platform/build.ts";
import "../../../harness/spawnRetry.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("a pipeline in a shell with no grants at all", async () => {
  const built = await Deno.makeTempFile({ prefix: "box-ungranted-" });
  try {
    await buildApp("packages/box/example/boxsh.wac", built, {});
    const r = new Deno.Command(built, {
      args: [],
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const w = r.stdin.getWriter();
    await w.write(new TextEncoder().encode("echo hi | cat\necho a b | tr ' ' '-'\n"));
    await w.close();
    const out = await r.output();
    const dec = new TextDecoder();
    const said = dec.decode(out.stdout);
    const err = dec.decode(out.stderr);
    assertEquals(err.includes("Not granted"), false, `${err}\n--- stdout:\n${said}`);
    assertEquals(said, "hi\na-b\n", `${said}\n--- stderr:\n${err}`);
  } finally {
    await Deno.remove(built);
  }
});
