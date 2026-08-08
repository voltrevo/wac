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

**Nothing is wired to it yet.** `packages/ssh`'s `sshd` refuses `pty-req` deliberately — accepting one
makes the client stop echoing locally and expect the server to do it — and this module is what a server
needs before it can accept one. That edge, and the browser's `keydown` loop, are what step 5 is for; the
step's own criterion (`^C` ends a running `yes`) also needs something that can interrupt a running
program, which is step 3's process table.
