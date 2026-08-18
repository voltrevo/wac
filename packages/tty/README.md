# tty — a line discipline

What a terminal does to your keystrokes before a program sees them: echo, erase, kill, word erase,
`^C`, `^D`. design/0001 step 5.

A program that reads a line has always been able to take this for granted, because the kernel did it.
Nothing here does it for us. An ssh channel hands over raw bytes and so does a browser's `keydown`, so
both ends of this system need the same module — which is why it is a package rather than a corner of
`packages/ssh`.

```wac
Line l = Line.create();
Typed t = l.feed(byte);
// t.echo       what to write back to the terminal
// t.line       a finished line, with its newline, when t.hasLine
// t.eof        ^D on an empty line
// t.interrupt  ^C
```

Both ends do use it — [`sshd` and the browser](#both-ends-use-it) — and the one thing it is *for*,
ending a running command with `^C`, [works on both](#c-ends-a-running-command-in-a-page-and-over-ssh)
— by two different routes, for reasons that are written down rather than left as a gap.

## The rules are measured

Every rule is read off **the kernel's own line discipline** — `script -qec cat /dev/null` puts a pty
between the test and `cat`, and `example/ttycat.wac` is the same arrangement with our `Line` in place of
the pty. Thirty-eight sequences, byte for byte, in `test/line.test.ts`.

That is not a formality. Three of the rules are not what you would write down:

| what | the guess | what it does |
|---|---|---|
| erasing `^A` | one backspace | **two** — it is shown as `^A` and occupies two columns |
| `^H` | erase, like backspace | an ordinary control character. Only DEL erases |
| `^W` | back to the previous space | back over letters and digits: `ls /usr/bin^W` leaves `ls /usr/` |

The first of those is invisible to any test that compares the *lines a program receives*, and is the
first thing a person sees: a stray caret left on the screen.

Two rules cannot be asked that way, because they act on the timing of a program that is reading — `^C`
kills `cat` while bytes are still in the pty's buffer, and `^D` delivers a partial line to a `cat` that
has not been scheduled. Those are asserted directly, and the test says why.

## Three modes, and nothing that selects one

`Line.create()` is canonical with echo, `Line.noEcho()` is `ICANON` without `ECHO` for a password
prompt, and `Line.cbreak()` is a byte at a time for a pager or an editor. **One `Line` with two
flags** rather than a second implementation of the rules, which is what `test/modes.test.ts` asserts
by running the same program in all three.

Each was measured against a pty *in that setting*, which needed a second oracle:
`packages/tty/tools/discipline.py` is a pty with `termios` set before the child starts, so the comparison this
module lives by extends to `noecho` and `cbreak` — which `script -qec cat` could not hold. The test
pins that it reproduces the existing oracle byte for byte in canonical mode, and records what the
kernel does in the other two.

**What is missing is anything that *selects* one.** `sshd` constructs `Line.create()` and never
changes it, the browser terminal likewise, and there is no `stty` for a program to ask with. So an
editor still cannot have a keystroke at a time — not because the discipline cannot do it, but because
nothing can say so.

That last paragraph is the second version of this one. The first said "no terminal modes… not
implemented", and went on saying it for as long as it took somebody to open `line.wac`, which is the
failure mode a *What is not here* section has: it is written when the gap is real and nothing makes it
false when the gap closes. The gap that is left is one step further in.

## Both ends use it

**`sshd`.** It used to refuse `pty-req` — accepting one makes the client stop echoing locally
and expect the server to do it, so a server needs this module before it can say yes. It says yes now:
`packages/ssh/src/sshd.wac` imports `Line`, and a session gets `$TERM` from what the client asked for,
with `$COLUMNS` and `$LINES` following a `window-change`. A session with *no* pty gets no `$TERM` rather
than a guessed one, which is what lets a program tell "no terminal" from "a terminal I have never heard
of".

**The browser's `keydown` loop speaks this module's language**, which was the thing in the way: a
`keydown` used to reach a program as the browser's `ev.key` — "a", "Enter", "ArrowUp" — and `feed` takes
a *byte*. `host/entryBrowser.ts` translates at the edge now, so `Ctrl-C` is 3 and Backspace is DEL, and
`platform/test/keydown.test.ts` asserts that every byte this module branches on is producible from a
keystroke. What is still not wired is the *editing*: `box/example/term.wac` uses an `<input>` and the
browser does it, and taking that over costs the block caret, IME composition and paste — a decision
with a price, written up beside the loop there.

## `^C` ends a running command, in a page and over ssh

The step's own criterion is that `^C` ends a running `yes`. **It is met on both halves**, and they
failed for different reasons, which is why they were finished separately and by different means.

- **In a page.** `Core.askInterrupt` is the seam, answered by the page because its keydown listener
  and its bridge service are the same thread — so while the worker is parked *asking*, the page has
  already seen the keystroke. `^C` ends a running `yes` in a real Chromium
  (`platform/test/browser_live.test.ts`), canaried both ways.
- **Over ssh**, where this said the opposite for as long as it took somebody to run the test: "over
  ssh it needs concurrency, and no poll fixes it… a second thread or worker reading the channel
  does." The obstacle was described correctly — `sshd`'s session loop calls `runScript`, which
  blocks, so nothing reads the channel until the command has finished, and nothing else *can* read
  it, because the bytes are encrypted and `Conn` holds the cipher state. What was wrong is that this
  needs another thread. It needs the shell to be able to **ask while it is busy**:
  `Shell.askInterrupt` is a funcref and an `anyref` context — the session itself, since wac has no
  closures — and `Conn.ready` is `waitAny(ids, 0)` over a read the connection already has
  outstanding, which costs one look in this worker's own memory. `packages/ssh/test/wac/wacsshd_test.wac`
  drives it with OpenSSH's own client: `while true; do :; done`, a `^C`, and then `echo alive=$?`
  printing **130** on a session that is still there.

Delivery, which is a different sentence, is done on both: `^C` sets a signal on a row and
`packages/sh` collects it before every command and on every turn of a loop, so `kill -INT $$` ends a
script with 130 and `kill %1` ends a background job.

Worth stating because the obvious plan is to give `Shell` a `Page` and poll at its check points. That
would make `^C` work at the prompt, which it already does, and do nothing at all for a running command,
which is the whole criterion. The page half was solved on the **capability** instead — something every
applet already holds — because a running `yes` is inside `dispatch`, so the shell's own check points
are not reached, and an applet is handed `Core`, `Cli`, `Fs` and `Args` and never a `Page`.

## What is not here

**No job control.** `^Z` is delivered as an ordinary control character. design/0001 step 3 has put a
process table in since this was written, so the missing half is no longer the table — it is that
suspending needs a signal a running child can be made to *stop* on, and `closeSocket` is termination
rather than suspension.

**No cursor movement.** Arrows, `^A`, `^E` are control characters and escape sequences here, as they are
to the kernel: moving about inside a line is readline's job, in the program. Erase is backwards-only,
which is what a line discipline is.
