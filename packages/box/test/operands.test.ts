// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// What an applet says when the operands are wrong, against the tool it imitates.
//
// Twelve of them answered with a `usage:` line of their own invention and a status of 2, where every one
// of their counterparts says something else, in two lines, and exits 1. Both refuse, so this was never
// the silent-gap class — but the invented line is *less* informative (`usage: cut -f<n>` does not say
// which of the several things `cut` needs was missing, and GNU's sentence does), and a script testing
// for status 1 got 2.
//
// The sentences differ more than they look: coreutils says "missing operand", `cp`/`mv`/`touch` say
// "missing **file** operand", `cp` and `mv` name the operand they did get, `cut` names the flag it
// wanted, `grep` prints a usage summary and exits **2**, and `diff` — not coreutils — puts its own name
// on the "Try" line as well. Deriving any of that from the majority would be wrong for half of them,
// which is why this compares rather than asserts.

const BOX = "packages/box/src/box.wac";

const CASES: string[][] = [
  ["basename"], ["basename", "a", "b", "c"],
  ["dirname"], ["dirname", "a", "b", "c"],
  ["cp"], ["cp", "a.txt"],
  ["mv"], ["mv", "a.txt"],
  ["mkdir"],
  ["rmdir"],
  ["rm"],
  ["grep"],
  ["cut", "a.txt"],
  ["paste"],
  ["diff"], ["diff", "a.txt"],
  ["uniq", "a.txt", "b.txt", "c.txt"],
  ["shuf", "a.txt", "b.txt"],
  ["base64", "a.txt", "b.txt"],
  ["base32", "a.txt", "b.txt"],
  ["tr"], ["tr", "a"], ["tr", "a", "b", "c"],
  ["seq"], ["seq", "1", "2", "3", "4"],
  ["head", "-n"],
  ["split", "a.txt", "b", "c"],
  ["fold", "-w"],
  ["touch"], ["stat"],
  ["wc", "--"],
];

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

Deno.test("an operand error says what the real tool says, and exits as it exits", async () => {
  const { buildApp } = await import("../../platform/build.ts");
  const built = await Deno.makeTempFile({ prefix: "box-operands-" });
  const dir = await Deno.makeTempDir({ prefix: "box-operands-" });
  try {
    await buildApp(BOX, built, { read: true, write: true });
    await Deno.writeTextFile(`${dir}/a.txt`, "x\ny\n");
    await Deno.writeTextFile(`${dir}/b.txt`, "z\n");

    const run = async (cmd: string[]) => {
      const r = await new Deno.Command(cmd[0], {
        args: cmd.slice(1), cwd: dir, stdin: "null", stdout: "piped", stderr: "piped",
        env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" }, clearEnv: true,
      }).output().catch(() => null);
      if (r === null) return null;
      const d = new TextDecoder();
      return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
    };

    // The canary. A harness that compares nothing reports that everything agrees, and this one is a
    // loop of comparisons that all pass when the tools are missing.
    const one = await run(["bash", "-c", "echo one"]);
    const two = await run(["bash", "-c", "echo two"]);
    if (one === null || two === null || one.out === two.out) {
      throw new Error("the harness is not comparing anything");
    }

    const bad: string[] = [];
    let compared = 0;
    for (const argv of CASES) {
      const theirs = await run(argv);
      if (theirs === null) continue;               // not installed here; nothing to compare against
      const ours = await run([built, ...argv]);
      if (ours === null) continue;
      compared++;
      // GNU prints whatever argv[0] was and `Deno.Command` resolves it to a path. The name is not what
      // is under test, and comparing it would report a difference in every case.
      const theirErr = theirs.err.replaceAll(`/usr/bin/${argv[0]}`, argv[0]).replaceAll(`/bin/${argv[0]}`, argv[0]);
      if (theirErr.trim() !== ours.err.trim() || theirs.code !== ours.code || theirs.out !== ours.out) {
        bad.push(
          `$ ${argv.join(" ")}\n` +
          `  GNU  ${JSON.stringify(theirErr.trim())} out ${JSON.stringify(theirs.out)} exit ${theirs.code}\n` +
          `  ours ${JSON.stringify(ours.err.trim())} out ${JSON.stringify(ours.out)} exit ${ours.code}`,
        );
      }
    }
    assertEquals(compared > 20, true, `only ${compared} invocations had a counterpart to compare against`);
    if (bad.length > 0) {
      throw new Error(`${bad.length} of ${compared} operand errors differ:\n\n${bad.join("\n\n")}`);
    }
  } finally {
    await Deno.remove(built).catch(() => {});
    await Deno.remove(dir, { recursive: true }).catch(() => {});
  }
});
