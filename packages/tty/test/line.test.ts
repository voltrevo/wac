// Imported for its side effect: retries a spawn that fails with "Text file busy" and names
// whoever held the file, if anyone did. wac-mono 0074.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
// The line discipline, against the kernel's own.
//
// `script -qec cat /dev/null` puts a **pty** between the bytes we write and `cat`, which is exactly the
// arrangement `packages/tty` imitates: the terminal edits what is typed, echoes it, and hands finished
// lines to a program whose output comes back through the same terminal. So the oracle here is not a
// table somebody wrote — it is Linux's `n_tty`, on this machine, answering the same input.
//
// `example/ttycat.wac` is our side of that: our `Line`, and a `cat` that adds nothing.
//
// **This found things a hand-written expectation would not have.** Three of them, on the first runs:
//
// - erasing a control character takes **two** backspaces, because it is shown as `^A` and occupies two
//   columns. Rubbing out one leaves a stray caret on the screen — invisible to any test that compares
//   the lines a program receives, and the first thing a person would see.
// - `^H` is **not** erase. Only DEL is. `^H` is echoed `^H` and delivered as a byte.
// - `^W`'s idea of a word is letters and digits, not "not a space": `ls /usr/bin^W` leaves `ls /usr/`,
//   and `a b.c^W` leaves `a b.`. A rule written as "back to the previous space" gets both wrong, and it
//   is the rule anyone would write.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const ttycat = await Deno.makeTempFile({ prefix: "wac-ttycat-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(ttycat);
  } catch {
    // Already gone, or never built.
  }
});
await buildApp("packages/tty/example/ttycat.wac", ttycat, {});

/** Whether a pty is available to be the oracle. Without `script` there is nothing to compare against. */
const haveScript = await (async () => {
  try {
    const r = await new Deno.Command("script", { args: ["--version"], stdout: "null", stderr: "null" })
      .output();
    return r.success;
  } catch {
    return false;
  }
})();

/**
 * Every editing rule this module claims, as a byte sequence somebody could type.
 *
 * Each is fed whole rather than a keystroke at a time, which keeps the comparison deterministic: with
 * everything already in the pty's buffer there is no race between the echo and the program's output.
 * `^C` and `^D` are the two that cannot be asked this way — see below.
 */
const TYPED: Record<string, string> = {
  plain: "abc\n",
  empty: "\n",
  "carriage return is a newline": "abc\r",
  "erase one": "ab\x7fc\n",
  "erase nothing": "\x7fa\n",
  "erase past the start": "abc\x7f\x7f\x7f\x7fz\n",
  "erase a control character": "a\x01\x7f\x7fz\n",
  "kill the line": "abc\x15xy\n",
  "kill nothing": "\x15x\n",
  "kill a line with a control character in it": "a\x01b\x15z\n",
  "word erase": "one two\x17three\n",
  "word erase eats the spaces behind it": "one two   \x17x\n",
  "word erase twice": "a b c\x17\x17z\n",
  "word erase over a whole line": "abc def\x17\x17z\n",
  "word erase nothing": "\x17x\n",
  "a dot ends a word": "a b.c\x17z\n",
  "a dash ends a word": "a b-c\x17z\n",
  "digits are part of one": "a b12\x17z\n",
  "a slash ends a word": "ls /usr/bin\x17z\n",
  "a tab ends a word": "a b\tc\x17z\n",
  "a control character ends a word": "ab\x01cd\x17z\n",
  "a trailing control character is skipped first": "ab\x01\x17z\n",
  "word erase over only control characters": "\x01\x02\x17z\n",
  "a tab is echoed as itself": "a\tb\n",
  "a control character is echoed as a caret pair": "a\x01b\n",
  "control-h is not erase": "ab\x08c\n",
  "escape is a control character": "a\x1bb\n",
  "so is NUL": "a\x00b\n",
  "bytes over 127 pass through": "a\xc3\xa9b\n",
  "literal next": "a\x16\x03b\n",
};

const enc = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));

async function through(cmd: string, args: string[], input: Uint8Array): Promise<Uint8Array> {
  const p = new Deno.Command(cmd, { args, stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
  const w = p.stdin.getWriter();
  await w.write(input);
  await w.close();
  return (await p.output()).stdout;
}

const show = (b: Uint8Array) => JSON.stringify(String.fromCharCode(...b));

Deno.test({
  name: "every editing rule answers what the kernel's line discipline answers",
  ignore: !haveScript,
  fn: async () => {
    // **The canary.** Every assertion here is "these two agree", which a harness that ran neither would
    // also satisfy. Two inputs that must not produce the same bytes prove the comparison is live.
    const one = await through("script", ["-qec", "cat", "/dev/null"], enc("ab\n"));
    const two = await through("script", ["-qec", "cat", "/dev/null"], enc("ab\x7f\n"));
    assertEquals(
      String.fromCharCode(...one) === String.fromCharCode(...two),
      false,
      "the oracle is not running",
    );

    const differed: string[] = [];
    for (const [name, typed] of Object.entries(TYPED)) {
      const input = enc(typed);
      const kernel = await through("script", ["-qec", "cat", "/dev/null"], input);
      const ours = await through(ttycat, [], input);
      if (show(kernel) !== show(ours)) {
        differed.push(`${name}: typed ${JSON.stringify(typed)}\n    kernel ${show(kernel)}\n    ours   ${show(ours)}`);
      }
    }
    assertEquals(
      differed.length,
      0,
      `${differed.length} of ${Object.keys(TYPED).length} differ:\n  ${differed.join("\n  ")}`,
    );
  },
});

/**
 * `^C` and `^D`, which the comparison above cannot ask.
 *
 * Both act on the *timing* of a program that is reading, and the harness above writes everything at
 * once: `^C` kills `cat` while bytes are still in the pty's buffer, so which of them get echoed before
 * it dies is a race between two processes, and `^D` delivers a partial line to a `cat` that has not
 * been scheduled yet. Comparing those byte for byte would be pinning the scheduler.
 *
 * What they do is not in doubt — it is in POSIX and it is what every terminal does — so it is asserted
 * directly, through the same program. The rules being checked:
 *
 * - `^C` echoes `^C` **and no newline**: the newline you see at a prompt belongs to the shell.
 * - `^D` on an empty line ends the input; on a line with something on it, it delivers what is there
 *   *without* a newline and the line goes on. That is why `cat` needs two after an unterminated line.
 */
Deno.test("interrupt and end-of-input, which the pty comparison cannot ask", async () => {
  // `ttycat` stops at either, so what comes back is everything up to and including the event.
  const interrupted = await through(ttycat, [], enc("abc\x03def\n"));
  assertEquals(show(interrupted), show(enc("abc^C")), "^C echoes ^C, keeps no line, and ends the run");

  const eofEmpty = await through(ttycat, [], enc("\x04"));
  assertEquals(show(eofEmpty), show(enc("")), "^D on an empty line says nothing and ends the input");

  // The line is delivered with no newline on it — `cat` writes `abc` and no `\r\n` follows, which is
  // exactly what a terminal shows when you press `^D` half way through a line.
  const eofLine = await through(ttycat, [], enc("abc\x04"));
  assertEquals(show(eofLine), show(enc("abcabc")), "^D on a line delivers it without a newline");

  // …and then the input carries on, because that ^D was an end of *line*.
  const eofThenMore = await through(ttycat, [], enc("ab\x04cd\n"));
  assertEquals(show(eofThenMore), show(enc("abab" + "cd\r\ncd\r\n")), "the line goes on after a ^D");
});
