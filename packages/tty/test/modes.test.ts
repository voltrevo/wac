// The oracle for terminal modes, and what the kernel does in each of them.
//
// `packages/tty` implements one arrangement — canonical with echo — and says so. Modes are its own
// named next step, and they were recorded in design/system/0001's open questions as **blocked on the
// oracle rather than on the code**: the module's comparison runs `script -qec cat`, and `script` will
// not hold an `stty`. `stty -echo; cat` echoes anyway, and `-icanon` leaves the oracle waiting for an
// end-of-input that a non-canonical mode does not deliver.
//
// That conclusion was wrong, and the correction is worth more than the tool. **This repository already
// drives reference implementations from Python to capture their behaviour** — every
// `packages/tor/tools/capture-*.py` does it against C tor. A pty is three lines of `termios` away in a
// language that has one, and Deno's inability to allocate one is a fact about Deno rather than about
// the problem. `tools/discipline.py` is that pty.
//
// ## What this file asserts, and what it deliberately does not
//
// It does **not** test `packages/tty` — the module has no modes yet, and a test asserting behaviour
// nothing implements would be a plan wearing a test's clothes. It tests the *oracle*, on two counts:
//
//   1. **It is a drop-in for the one already trusted.** In canonical mode it must reproduce
//      `script -qec cat` byte for byte, on the cases `line.test.ts` already compares. Without that,
//      any mode measured through it is measured through an unknown.
//   2. **The modes are actually different.** The first working version of the harness applied the mode
//      in the child after forking and wrote from the parent immediately — a race the parent won every
//      time, so all three modes produced byte-identical output. Three modes agreeing perfectly is not
//      a result; it is an instrument reading zero, and nothing but an assertion like this notices.
//
// The rules it records, measured rather than remembered, are what an implementation gets written
// against — and two of them are not what the names suggest:
//
//   - **`noecho` still edits.** `ab<DEL>c` delivers `ac`; the editing happens and is simply not drawn.
//     It is `ECHO` that is off, not `ICANON`.
//   - **`^R` stops reprinting and becomes a byte in the line.** Reprint is an echo feature: with
//     nothing being drawn there is nothing to draw again, so the kernel delivers `\x12` instead.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const have = (cmd: string, args: string[]) => {
  try {
    return new Deno.Command(cmd, { args, stdout: "null", stderr: "null" }).outputSync().success;
  } catch {
    return false;
  }
};
const haveTools = have("python3", ["--version"]) && have("script", ["--version"]);

const enc = (s: string) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const show = (b: Uint8Array) => JSON.stringify(String.fromCharCode(...b));

/** The cases `line.test.ts` already compares, plus the two this module learned most recently. */
const CASES: Record<string, string> = {
  plain: "abc\n",
  "erase one": "ab\x7fc\n",
  "kill the line": "abc\x15xy\n",
  "word erase": "one two\x17three\n",
  "a control character is a caret pair": "a\x01b\n",
  reprint: "abc\x12\n",
  "a literal DEL": "ab\x16\x7f\n",
  "erase past the start": "abc\x7f\x7f\x7f\x7fz\n",
  "a two-byte character": "a\xc3\xa9b\n",
};

async function pipeThrough(cmd: string, args: string[], input: Uint8Array): Promise<Uint8Array> {
  const p = new Deno.Command(cmd, { args, stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
  const w = p.stdin.getWriter();
  await w.write(input);
  await w.close();
  return (await p.output()).stdout;
}

const kernel = (input: Uint8Array) => pipeThrough("script", ["-qec", "cat", "/dev/null"], input);
const ours = (mode: string, input: Uint8Array) =>
  pipeThrough("python3", ["packages/tty/tools/discipline.py", mode], input);

Deno.test({
  name: "the pty harness reproduces the oracle `line.test.ts` already trusts",
  ignore: !haveTools,
  fn: async () => {
    for (const [name, text] of Object.entries(CASES)) {
      const input = enc(text);
      const theirs = await kernel(input);
      const mine = await ours("canonical", input);
      assertEquals(show(mine), show(theirs), name);
    }
    // The canary: `script` really did answer something, so the comparison above is not two empties.
    assertEquals(show(await kernel(enc("abc\n"))), show(enc("abc\r\nabc\r\n")), "script said nothing");
  },
});

Deno.test({
  name: "the three modes differ, and differ in the ways that were measured",
  ignore: !haveTools,
  fn: async () => {
    const inMode = async (mode: string, text: string) => show(await ours(mode, enc(text)));

    // Canonical: edited and drawn. `\x08 \x08` is the terminal rubbing a column out.
    assertEquals(await inMode("canonical", "ab\x7fc\n"), show(enc("ab\x08 \x08c\r\nac\r\n")));
    // **noecho still edits.** Nothing is drawn, and `ac` is still what the program reads — which is
    // the rule an implementation is most likely to get wrong, because the name suggests otherwise.
    assertEquals(await inMode("noecho", "ab\x7fc\n"), show(enc("ac\r\n")));
    // cbreak edits nothing: the DEL arrives as a byte.
    assertEquals(await inMode("cbreak", "ab\x7fc\n"), show(enc("ab\x7fc\r\n")));

    // `^U` likewise: killed and undrawn, killed, and delivered.
    assertEquals(await inMode("noecho", "abc\x15xy\n"), show(enc("xy\r\n")));
    assertEquals(await inMode("cbreak", "abc\x15xy\n"), show(enc("abc\x15xy\r\n")));

    // **`^R` stops reprinting when there is no echo**, and becomes a byte in the line. Reprint is an
    // echo feature: with nothing drawn there is nothing to draw again.
    assertEquals(await inMode("canonical", "abc\x12\n"), show(enc("abc^R\r\nabc\r\nabc\r\n")));
    assertEquals(await inMode("noecho", "abc\x12\n"), show(enc("abc\x12\r\n")));

    // And the assertion that the harness has not silently lost its mode, which is exactly what it did
    // when the mode was applied after the fork: three modes, three different answers to one input.
    const answers = new Set([
      await inMode("canonical", "ab\x7fc\n"),
      await inMode("noecho", "ab\x7fc\n"),
      await inMode("cbreak", "ab\x7fc\n"),
    ]);
    assertEquals(answers.size, 3, "the modes are not distinct — the harness is reading zero");
  },
});
