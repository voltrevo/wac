// A browser keystroke, as the bytes a terminal would send — design/0001 step 5's shared vocabulary.
//
// A `keydown` used to reach a program as the browser's `ev.key`: the strings "a", "Enter", "ArrowUp",
// "Control". That is a vocabulary nothing else in this system speaks. `packages/tty`'s line discipline
// consumes **bytes**, because a terminal is a byte stream and every rule in that module — echo, erase,
// `^U`, `^W`, `^C`, `^D`, `^V` — was read off the kernel's own discipline through a pty. So a page
// built on key names could not reach it at all, and `box/example/term.wac` grew its own editing out of
// an `<input>` instead. design/0001 step 5 asks for "one module for both the ssh channel and the
// browser's keydown loop", and two disciplines is what there was.
//
// Translating at the edge is what lets everything above it be bytes. This is that translation, tested
// where it can be tested exactly — a table of keystrokes against a table of bytes — rather than only
// through a real browser, where a wrong byte shows up as a terminal that behaves oddly.
//
// **The values are `infocmp`'s and `stty`'s, not guesses**, and the two worth knowing are:
//
//   - **Backspace sends DEL (0x7f), not BS (0x08).** This is the one every terminal emulator is asked
//     about. `packages/tty` erases on 0x7f and deliberately does *not* erase on 0x08, because the
//     kernel does not — `^H` is a distinct thing you can type. A page that sent 0x08 for Backspace
//     would have a backspace key that does nothing, and the module would be right.
//   - **Enter sends CR (0x0d), not LF.** The discipline is what turns it into a newline; sending LF
//     here would skip a rule that module implements.

import { terminalBytes } from "../host/entryBrowser.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** A keydown, as the host sees one. `target` is irrelevant to the translation and is null. */
const key = (k: string, ctrl = false) =>
  terminalBytes({ target: null, key: k, ctrlKey: ctrl, preventDefault: () => {} });

Deno.test("an ordinary key is itself", () => {
  assertEquals(key("a"), "a");
  assertEquals(key("Z"), "Z");
  assertEquals(key("7"), "7");
  // A space is spelled " " by `ev.key`, and a terminal sends a space. It is easy to miss because it
  // is the one single-character key whose name is not obviously a character.
  assertEquals(key(" "), " ");
  assertEquals(key("é"), "é", "a non-ASCII character is itself");
});

Deno.test("`Ctrl` with a letter is that letter's control code", () => {
  // `uppercase - 64`, which is the whole rule. `^C` being 3 is what makes an interrupt reach a line
  // discipline at all, and `^D` being 4 is what makes end-of-input reach one.
  assertEquals(key("c", true), "\x03");
  assertEquals(key("C", true), "\x03", "the shift state does not change the control code");
  assertEquals(key("d", true), "\x04");
  assertEquals(key("a", true), "\x01");
  assertEquals(key("u", true), "\x15");
  assertEquals(key("w", true), "\x17");
  assertEquals(key("v", true), "\x16");
  assertEquals(key("z", true), "\x1a");
  // The two beyond the letters that are ordinary enough to type.
  assertEquals(key("?", true), "\x7f");
  assertEquals(key(" ", true), "\x00");
  // And a `Ctrl` chord with no control code sends nothing rather than the bare character — `Ctrl-1`
  // is not "1" on a terminal, and passing it through would put a digit in the line.
  assertEquals(key("1", true), "");
});

Deno.test("the named keys send what a terminal sends", () => {
  assertEquals(key("Enter"), "\r", "CR, not LF: the discipline makes the newline");
  assertEquals(key("Backspace"), "\x7f", "DEL, not BS — `packages/tty` erases on 0x7f");
  assertEquals(key("Tab"), "\t");
  assertEquals(key("Escape"), "\x1b");
  assertEquals(key("ArrowUp"), "\x1b[A");
  assertEquals(key("ArrowDown"), "\x1b[B");
  assertEquals(key("ArrowRight"), "\x1b[C");
  assertEquals(key("ArrowLeft"), "\x1b[D");
  assertEquals(key("Home"), "\x1b[H");
  assertEquals(key("End"), "\x1b[F");
  assertEquals(key("Delete"), "\x1b[3~");
  // **Paging, added 2026-08-15.** These were in the list below — grouped with `Shift` and `F1` under
  // "no sequence for it" — and a program could not tell `PageUp` from a modifier being pressed on
  // its own. `packages/box/example/rasterterm.wac` scrolls its scrollback with them, which is what
  // needed them to arrive at all.
  //
  // The list below is about a key's *name* reaching a line as text; it is not an argument that
  // paging should be silent. The arrows already send `ESC [ A` and friends, so a discipline that can
  // cope with one escape sequence coming from a keystroke already had to cope.
  assertEquals(key("PageUp"), "\x1b[5~");
  assertEquals(key("PageDown"), "\x1b[6~");
});

Deno.test("a key that puts nothing on the wire sends nothing", () => {
  // A modifier pressed by itself, and a function key this has no sequence for. The empty string is
  // the answer rather than the key's name: a program feeding these into a line discipline would
  // otherwise get the word "Shift" typed into its line.
  for (const k of ["Shift", "Control", "Alt", "Meta", "CapsLock", "F1", "Insert"]) {
    assertEquals(key(k), "", `${k} should send nothing`);
  }
  assertEquals(terminalBytes({ target: null, preventDefault: () => {} }), "", "a keydown with no key");
});

Deno.test("what `packages/tty` needs is exactly what arrives", () => {
  // The point of the whole exercise, stated as an assertion rather than left to a comment: every byte
  // the line discipline branches on is producible from a keystroke. `line.wac` names INTR 3, EOF 4,
  // ERASE 0x7f, KILL 0x15, WERASE 0x17 and LNEXT 0x16 — if any of these could not be typed in a page,
  // the module would be shared in name only.
  // **Both lists are derived, and the typed version had already fallen two behind.** It named six
  // characters; `line.wac` gained `QUIT` (`^\`) and `REPRINT` (`^R`) one tick later and this did not
  // notice — a test whose entire purpose is to catch that drift, drifting. Worse, `^\` would have
  // failed if it *had* been listed, because the keys tried below were `a-z?` and a backslash is
  // neither: the enumeration of what a person can type was as hand-made as the list it checked.
  //
  // So: the discipline's own declarations on one side, and every key a keyboard has on the other.
  const source = Deno.readTextFileSync("packages/tty/src/line.wac");
  const needed = [...source.matchAll(/^i32 ([A-Z]+)\(\) \{ return (\d+); \}/gm)]
    // `SIGINT` and `SIGQUIT` are signal *numbers* that `feed` answers with, not bytes it reads. They
    // are the one thing in that block a keyboard is not expected to produce, and the prefix is how
    // `line.wac` itself distinguishes them.
    .filter(([, name]) => !name.startsWith("SIG"))
    .map(([, name, code]) => [String.fromCharCode(Number(code)), name] as [string, string]);
  assertEquals(needed.length >= 8, true, `only ${needed.length} control characters found in line.wac`);

  const producible = new Set<string>();
  // Every printable ASCII, with and without the control key — which is what a keyboard offers, rather
  // than the letters somebody thought of. `\` is 92, so `Ctrl-\` is 28, which is `QUIT`.
  for (let c = 0x20; c < 0x7f; c++) {
    const ch = String.fromCharCode(c);
    producible.add(key(ch));
    producible.add(key(ch, true));
  }
  for (const k of ["Enter", "Backspace", "Tab", "Escape", "Delete"]) producible.add(key(k));
  producible.delete("");

  const missing = needed.filter(([byte]) => !producible.has(byte)).map(([, name]) => name);
  assertEquals(missing.join(", "), "", "control characters the discipline reads and a page cannot type");
});
