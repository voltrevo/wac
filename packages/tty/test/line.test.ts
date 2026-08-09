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
  // A character is not a byte, and erase works on bytes: `é` is two of them, and one DEL leaves the
  // first behind — on the screen *and* in the line. That is what this pty does, in both `iutf8` modes,
  // measured rather than assumed, and it is why `columns` is a function of a byte.
  "erase half of a two-byte character": "a\xc3\xa9\x7fz\n",
  "erase half of a three-byte one": "a\xe2\x82\xac\x7fz\n",
  "erase half of a four-byte one": "a\xf0\x9f\x92\xa9\x7fz\n",
  "kill a line with a multi-byte character in it": "a\xc3\xa9b\x15z\n",
  "word erase over one": "x a\xc3\xa9b\x17z\n",
  // **`^R` reprints the line**, and it was being delivered as a `\x12` in the middle of one. It is what
  // you reach for when a program's output has scribbled over what you were editing, and no case here
  // had asked about it — which is how a rule the kernel has and this module did not went unseen.
  "reprint": "abc\x12\n",
  "reprint an edited line": "ab\x7fc\x12\n",
  "reprint an empty line": "\x12\n",
  // **DEL renders as `^?`.** `columns` has always answered 2 for it and `render` answered a bare DEL
  // byte, so the two halves of one module disagreed about one character: the echo drew one column and
  // the erase arithmetic rubbed out two. The second case is the one that shows it — erasing a literal
  // DEL has to take both columns back.
  "a literal DEL is a caret pair": "ab\x16\x7f\n",
  "erasing a literal DEL takes two columns": "ab\x16\x7f\x7fz\n",
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

/**
 * The settings the oracle is running with, which decide what "correct" means.
 *
 * A line discipline is *configurable* — `stty erase ^H` moves erase to `^H`, `stty -echo` stops the echo,
 * `stty raw` turns the whole thing off — so the pty this compares against is not "the" line discipline,
 * it is one configuration of it. Every rule in `packages/tty` was measured through this pty, and none of
 * the tests below record which pty they measured. On a machine whose defaults differ, they would fail
 * with a byte mismatch and no clue why.
 *
 * So this asks the pty what it is set to, and fails with the setting rather than with the bytes. It is
 * also the honest answer to "is your oracle independent?" — it is independent of our code and *not*
 * independent of the machine's `termios` defaults, which is worth stating where somebody will read it.
 */
Deno.test({
  name: "the oracle is a line discipline in the configuration this module implements",
  ignore: !haveScript,
  fn: async () => {
    const said = new TextDecoder().decode(
      await through("script", ["-qec", "stty -a", "/dev/null"], new Uint8Array(0)),
    );
    // As *tokens*, not as substrings. `stty -a` prints `-echoprt` and `-echonl`, so asking whether the
    // output "includes echo" is a check that cannot fail — which is the shape this repo keeps finding in
    // its own measurements and would be a poor thing to add while writing about it.
    const flags = new Set(said.split(/[\s;]+/).filter((w) => w.length > 0));
    const control = (name: string, key: string) => new RegExp(`\\b${name}\\s*=\\s*\\${key}`).test(said);

    if (!control("erase", "^?")) throw new Error(`erase is not DEL in this pty:\n${said.trim()}`);
    if (!control("kill", "^U")) throw new Error(`kill is not ^U in this pty:\n${said.trim()}`);
    if (!control("werase", "^W")) throw new Error(`werase is not ^W in this pty:\n${said.trim()}`);
    for (const on of ["icanon", "echo", "echoe", "isig"]) {
      if (!flags.has(on)) {
        throw new Error(`this pty has no \`${on}\`, so it is not what packages/tty implements:\n${said.trim()}`);
      }
      if (flags.has(`-${on}`)) {
        throw new Error(`this pty has \`-${on}\`, which makes the comparison below meaningless`);
      }
    }
  },
});

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

  // **`^\` is the other one, and it was an ordinary control character.** The kernel throws the line
  // away and signals, exactly as for `^C`; this delivered `ab\x1cz` — measured through the pty, which
  // is the oracle this module claims and which nothing had asked about `^\`. It is here beside `^C`
  // rather than in the comparison above for the same reason `^C` is: the oracle's `cat` is killed
  // mid-buffer, so which bytes get echoed first is a race.
  const quit = await through(ttycat, [], enc("ab\x1cz\n"));
  assertEquals(show(quit), show(enc("ab^\\")), "^\\ echoes ^\\, keeps no line, and ends the run");

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
