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

## The rules are measured

Every rule is read off **the kernel's own line discipline** — `script -qec cat /dev/null` puts a pty
between the test and `cat`, and `example/ttycat.wac` is the same arrangement with our `Line` in place of
the pty. Thirty-one sequences, byte for byte, in `test/line.test.ts`.

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

## What is not here

**No terminal modes.** Canonical with echo, always. There is no `stty`, no `ICANON` off, no raw mode — so
a program that wants a keystroke at a time, like an editor or a pager, cannot have one. That switch is
the next thing this module wants; it is **not implemented**, rather than approximated.

**No job control.** `^Z` is delivered as an ordinary control character. There is nothing to suspend until
design/0001 step 3 puts a process table in.

**No cursor movement.** Arrows, `^A`, `^E` are control characters and escape sequences here, as they are
to the kernel: moving about inside a line is readline's job, in the program. Erase is backwards-only,
which is what a line discipline is.

**`sshd` uses it.** It used to refuse `pty-req` — accepting one makes the client stop echoing locally
and expect the server to do it, so a server needs this module before it can say yes. It says yes now:
`packages/ssh/src/sshd.wac` imports `Line`, and a session gets `$TERM` from what the client asked for,
with `$COLUMNS` and `$LINES` following a `window-change`. A session with *no* pty gets no `$TERM` rather
than a guessed one, which is what lets a program tell "no terminal" from "a terminal I have never heard
of".

**The browser's `keydown` loop now speaks this module's language**, which was the thing in the way: a
`keydown` used to reach a program as the browser's `ev.key` — "a", "Enter", "ArrowUp" — and `feed` takes
a *byte*. `host/entryBrowser.ts` translates at the edge now, so `Ctrl-C` is 3 and Backspace is DEL, and
`platform/test/keydown.test.ts` asserts that every byte this module branches on is producible from a
keystroke. What is still not wired is the *editing*: `box/example/term.wac` uses an `<input>` and the
browser does it, and taking that over costs the block caret, IME composition and paste — a decision
with a price, written up beside the loop there.

**Delivery is done and the criterion is still not met, and those are two different sentences.** `^C`
sets a signal on a row and `packages/sh` collects it before every command and on every turn of a loop,
so `kill -INT $$` ends a script with 130 and `kill %1` ends a background job. The step's own criterion —
`^C` ends a running `yes` — needs something *else*: the keystroke has to be **read while the command is
running**, and nothing does.

That is not one blocker. It is two, and they want different answers:

- **Over ssh it needs concurrency.** `sshd`'s session loop calls `runScript`, which blocks, so nothing
  reads the channel until the command has finished — and nothing else can read it, because the bytes
  are encrypted and `Conn` holds the cipher state. No poll fixes that; a second thread or worker
  reading the channel does.
- **In a page it needs a capability an applet can reach.** The event queue is the host's, not an
  encrypted stream, so it *can* be polled — `Pending.isDone` is exactly that and needs no closures. But
  a running `yes` is inside `dispatch`, so the shell's own check points are not reached, and an applet
  is handed `Core`, `Cli`, `Fs` and `Args` and never a `Page`. The seam therefore belongs on the
  **capability** — something every applet already holds — rather than on the shell.

Worth stating because the obvious plan is to give `Shell` a `Page` and poll at its check points. That
would make `^C` work at the prompt, which it already does, and do nothing at all for a running command,
which is the whole criterion.
