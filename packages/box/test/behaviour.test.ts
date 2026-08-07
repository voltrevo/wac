// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// The flags these applets **do** implement, against the tools they imitate.
//
// Two sweeps came before this one and both were about refusals: `test/flags.test.ts` asks what an applet
// says about a flag it does not have, and `test/operands.test.ts` what it says about the wrong number of
// operands. Neither can see the case that matters most — a flag that is accepted, acted on, and answers
// something else.
//
// It found three on its first run, and two of them were the worst kind, where the output *looks* right:
//
//   - `cut -f2,3` printed field 2 alone. The list was read with `atoi`, which stops at the comma, so
//     `2-4`, `3-` and `-3` were all silently one field or a refusal.
//   - `basename x/c.txt .txt` answered `c.txt`: the suffix operand was ignored.
//   - `tac` on a file with no final newline added one, which is the line that comes *first* in its output.
//
// The scripts run through `src/bin/sh.wac` so that redirection and pipelines are available, and against
// `bash` so the comparison is with the real tools rather than with an idea of them.

const SHELL = "packages/box/src/bin/sh.wac";

const CASES = [
  "sort -n nums.txt", "sort -r nums.txt", "sort -u dup.txt", "sort -nr nums.txt",
  "sort nums.txt", "sort words.txt", "sort -u words.txt",
  "uniq -c dup.txt", "uniq -d dup.txt", "uniq -u dup.txt", "uniq dup.txt",
  "wc -l words.txt", "wc -w mixed.txt", "wc -c nonl.txt", "wc mixed.txt",
  "head -3 long.txt", "head -c 12 long.txt", "head -n -25 long.txt",
  "tail -3 long.txt", "tail -c 12 long.txt", "tail -n +28 long.txt",
  "cat -n mixed.txt", "cat -b mixed.txt", "cat -s mixed.txt", "cat -A tabs.txt",
  "cat -e mixed.txt", "cat -t tabs.txt", "cat -v bin.txt", "cat nonl.txt words.txt",
  "cut -f2 tabs.txt", "cut -f1,3 tabs.txt", "cut -d, -f1 words.txt",
  "fold -w 5 long.txt", "fold -w 3 words.txt",
  "tr a-z A-Z < words.txt", "tr -d aeiou < words.txt", "tr -s a < dup.txt",
  "grep -c a words.txt", "grep -n a words.txt", "grep -i APPLE words.txt",
  "grep -v a words.txt", "grep -x apple words.txt", "grep -E 'a|b' words.txt",
  "rev words.txt", "rev nonl.txt", "basename /a/b/c.txt .txt", "dirname /a/b/c.txt",
  "seq 5", "seq 2 6", "seq 1 3 10", "seq -1 1", "seq 5 1",
  "sha256sum nonl.txt", "base64 nonl.txt", "base32 nonl.txt",
  "split -l 10 long.txt part; ls part*; rm -f part*",
  "shuf -n 0 long.txt", "strings -n 2 bin.txt",
];

const haveBash = await (async () => {
  try {
    const r = await new Deno.Command("bash", { args: ["-c", "echo x"], stdout: "piped", stderr: "null" }).output();
    return r.success;
  } catch {
    return false;
  }
})();

Deno.test({
  name: "the flags these applets implement answer what the real tools answer",
  ignore: !haveBash,
  fn: async () => {
    const { buildApp } = await import("../../platform/build.ts");
    const built = await Deno.makeTempFile({ prefix: "box-behaviour-" });
    const dir = await Deno.makeTempDir({ prefix: "box-behaviour-" });
    try {
      await buildApp(SHELL, built, { read: true, write: true, net: true, env: true });
      const w = (name: string, text: string) => Deno.writeTextFile(`${dir}/${name}`, text);
      await w("nums.txt", "10\n9\n100\n1\n-5\n2.5\n0\n");
      await w("words.txt", "banana\nApple\ncherry\napple\nBanana\n");
      await w("dup.txt", "a\na\nb\nB\nb\nc\n");
      await w("tabs.txt", "a\tb\tc\nd\te\tf\n");
      await w("mixed.txt", "  leading\ntrailing  \n\nblank above\n");
      await w("long.txt", Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join("\n") + "\n");
      await w("bin.txt", "a\x00b\x01c\n");
      await w("nonl.txt", "no newline");

      const run = async (cmd: string, script: string) => {
        const r = await new Deno.Command(cmd, {
          args: ["-c", script], cwd: dir, stdin: "null", stdout: "piped", stderr: "piped",
          env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir }, clearEnv: true,
        }).output();
        const d = new TextDecoder();
        return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code };
      };

      // The canary. A harness that compares nothing reports that everything agrees, and this loop would
      // pass just as happily against a shell that printed nothing at all.
      const one = await run("bash", "echo one");
      const two = await run("bash", "echo two");
      if (one.out === two.out || one.out === "") throw new Error("the harness is not comparing anything");

      const bad: string[] = [];
      for (const script of CASES) {
        const want = await run("bash", script);
        const got = await run(built, script);
        if (want.out !== got.out || want.code !== got.code) {
          bad.push(
            `$ ${script}\n  bash ${JSON.stringify(want.out.slice(0, 200))} exit ${want.code}\n` +
            `  ours ${JSON.stringify(got.out.slice(0, 200))} exit ${got.code}` +
            (got.err.trim() === "" ? "" : `\n  err  ${got.err.trim().split("\n")[0]}`),
          );
        }
      }
      if (bad.length > 0) {
        throw new Error(`${bad.length} of ${CASES.length} invocations differ from the real tools:\n\n${bad.join("\n\n")}`);
      }
    } finally {
      await Deno.remove(built).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
