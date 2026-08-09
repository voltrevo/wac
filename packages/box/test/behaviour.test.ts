// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { pool } from "../../../harness/inFlight.ts";
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
  // **Bytes that are not text**, which every case above is. Found by feeding the applets NUL bytes,
  // invalid UTF-8, no trailing newline and 5000-character lines and comparing the *bytes*: `wc -w`
  // counted a run of unprintable bytes as a word where GNU counts none, and `base64` wrote one long
  // line where GNU wraps at 76 columns and wrote a newline for empty input where GNU writes nothing.
  "wc -w bin.txt", "wc bin.txt", "wc -w ctrl.txt", "wc -w hi.txt",
  "base64 long.txt", "base64 -w 10 words.txt", "base64 -w 0 long.txt", "base64 empty.txt",
  "base32 long.txt", "base32 -w 0 words.txt", "base32 empty.txt",
  "base64 bin.txt", "base64 hi.txt", "cat hi.txt", "sha256sum hi.txt", "sha256sum empty.txt",
  "head -1 hi.txt", "tail -1 hi.txt", "tac hi.txt", "sort hi.txt", "cut -c1-2 hi.txt",
  "tr a-z A-Z < hi.txt", "nl hi.txt", "fold -w3 hi.txt", "uniq hi.txt",
  // **`grep` and a binary file.** Input containing a NUL is binary — `\377\376` is not, which is the
  // narrower rule than "not valid text" — and GNU then prints no matching lines, says "binary file
  // matches" on stderr, and still counts normally for `-c`. In a binary file a NUL ends a line too,
  // which only shows through `-c` and is measured rather than reasoned about.
  "grep c bin.txt", "grep -a c bin.txt", "grep -I c bin.txt", "grep -c . bin.txt",
  "grep -q c bin.txt; echo st=$?", "grep z bin.txt; echo st=$?",
  "grep c clean.txt bin.txt", "grep -I c bin.txt clean.txt", "grep . hi.txt",
  "grep -n c bin.txt", "grep -c . nulsplit.bin", "grep -ac . nulsplit.bin",
  // `-l` lists what matched and `-L` what did not; both win over `-c` and `-n`, and the *status* is
  // still about matching rather than about what was listed — `grep -L zzz a b` lists both and exits 1.
  "grep -l a words.txt dup.txt", "grep -L a words.txt dup.txt",
  "grep -l zzz words.txt; echo st=$?", "grep -L zzz words.txt dup.txt; echo st=$?",
  "grep -lc a words.txt", "grep -ln a words.txt", "grep -l c bin.txt",
  "grep -l a < words.txt", "grep -L zzz < words.txt; echo st=$?",
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
      await w("empty.txt", "");
      // Not `writeTextFile`: these are the bytes a text encoder would not survive, which is the point.
      await Deno.writeFile(`${dir}/hi.txt`, Uint8Array.from([0x80, 0x81, 0xff, 0x0a, 0x61, 0xff, 0x62, 0x0a]));
      await Deno.writeFile(`${dir}/ctrl.txt`, Uint8Array.from([0x01, 0x02, 0x0a, 0x01, 0x61, 0x0a]));
      await Deno.writeFile(`${dir}/nulsplit.bin`, Uint8Array.from([0x61, 0x00, 0x62, 0x0a]));
      await w("clean.txt", "clean c\n");

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

      // Four at a time rather than one, which is what the two sibling corpora already do — every case
      // is an independent pair of processes and the loop was waiting on each before starting the next.
      // The pool also names what is still in flight if the run wedges, which a bare loop cannot: a
      // stall here used to report the test's name and none of the thirty-two scripts. wac-mono 0082.
      //
      // Results are kept **by index** rather than pushed as they finish, so the report reads in the
      // order the cases are written however the pool interleaves them.
      const found: (string | undefined)[] = new Array(CASES.length);
      await pool(CASES, 4, async (script, i, note) => {
        note("bash");
        const want = await run("bash", script);
        note("ours");
        const got = await run(built, script);
        if (want.out !== got.out || want.code !== got.code) {
          found[i] =
            `$ ${script}\n  bash ${JSON.stringify(want.out.slice(0, 200))} exit ${want.code}\n` +
            `  ours ${JSON.stringify(got.out.slice(0, 200))} exit ${got.code}` +
            (got.err.trim() === "" ? "" : `\n  err  ${got.err.trim().split("\n")[0]}`);
        }
      });
      const bad = found.filter((x): x is string => x !== undefined);
      if (bad.length > 0) {
        throw new Error(`${bad.length} of ${CASES.length} invocations differ from the real tools:\n\n${bad.join("\n\n")}`);
      }
    } finally {
      await Deno.remove(built).catch(() => {});
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
