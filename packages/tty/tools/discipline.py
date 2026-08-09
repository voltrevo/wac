#!/usr/bin/env python3
"""Linux's own line discipline, in a named mode, as bytes in and bytes out.

`packages/tty` exists because every rule in it was measured against the kernel rather than remembered
from a manual, and `test/line.test.ts` is that comparison. Its oracle is `script -qec cat`, which works
for exactly one configuration: **`script` will not hold an `stty`.** `stty -echo; cat` echoes anyway,
and `-icanon` leaves the oracle waiting for an end-of-input that raw mode does not deliver.

That made terminal modes — the module's own named next step — look blocked on the oracle rather than on
the code, and it was written into design/system/0001's open questions as such. It is not blocked: this
repository already drives reference implementations from Python to capture their behaviour, which is
what every `packages/tor/tools/capture-*.py` does against C tor. A pty is three lines of `termios`
away in a language that has it, and Deno's inability to allocate one is a fact about Deno.

## What it does

Allocates a pty, sets the mode on it *before* the program starts, runs `cat`, writes the bytes given on
standard input, and prints what came back — the echo and the program's own output interleaved exactly
as a terminal would show them, which is what the module's `Typed.echo` plus its delivered line have to
add up to.

    printf 'ab\\x7fc\\n' | python3 packages/tty/tools/discipline.py canonical

Modes, named for the `stty` that produces them:

    canonical   the default: ICANON and ECHO, which is what `script -qec cat` gives
    noecho      ICANON without ECHO — what a password prompt wants. **Editing still happens**:
                `ab<DEL>c` still delivers `ac`, it is just not drawn. Measured, and not what the
                name suggests to most readers.
    cbreak      ICANON and ECHO both off, ISIG and IEXTEN left on — a keystroke at a time, with
                `^C` still meaning interrupt. This is what a pager or an editor wants.

**`cbreak`, not `raw`**, and the distinction is measured rather than pedantic: `stty raw` also clears
ISIG and IEXTEN, so `^C` becomes an ordinary byte. Here it still flushes the input, which is visible —
`abc^Cdef` delivers `def`. Naming this `raw` would have been a claim about two flags nobody set.

## Why `cat` and why the timeout

`cat` adds nothing of its own, so everything read back is either the discipline's echo or the bytes it
decided to deliver.

**Signals are not delivered here.** The child gets the pty as its standard streams but never calls
`TIOCSCTTY`, so the pty is not its controlling terminal and `^C` raises nothing. What *is* measured is
the line discipline's own half — that `^C` throws the pending input away — which is the half
`packages/tty` implements; it reports a signal number and leaves delivering it to the caller. In `cbreak` there is no `^D` to end input — that is the whole point of the mode — so
the master is closed after writing and the child is given a moment to drain, then reaped. A mode that
cannot end the program is not a reason to hang; it is a reason to say when to stop reading.

Output is written raw to standard output so a caller compares bytes. Nothing is decoded, because a
name and a line are bytes (design/system/0001 D-byte-exact-paths).
"""

import os
# **Not named `pty.py`**, and that is not a style choice: a file of that name shadows the standard
# library module it needs, so `import pty` imports itself and `pty.fork` does not exist. The failure
# reads as "module 'pty' has no attribute 'fork'", which sounds like a Python version problem.
import pty
import select
import sys
import termios
import time

MODES = ("canonical", "noecho", "cbreak")


def apply_mode(fd: int, mode: str) -> None:
    """Set `mode` on the pty, from the flags `stty` would set.

    Named constants rather than a shell out to `stty`, because `stty` needs the pty to be its
    controlling terminal and this process's is somewhere else entirely — which is the same reason
    `script -qec 'stty -echo; cat'` does not do what it reads as.
    """
    attrs = termios.tcgetattr(fd)
    iflag, oflag, cflag, lflag, ispeed, ospeed, cc = attrs
    if mode == "canonical":
        lflag |= termios.ICANON | termios.ECHO
    elif mode == "noecho":
        lflag |= termios.ICANON
        lflag &= ~termios.ECHO
    elif mode == "cbreak":
        # `ICANON` off is the mode; `ECHO` off with it, because a program taking a keystroke at a time
        # draws its own screen. ISIG and IEXTEN are deliberately *left alone* — see the header.
        lflag &= ~(termios.ICANON | termios.ECHO)
        # VMIN 1, VTIME 0: a read returns as soon as one byte is there, rather than waiting for a
        # line that will never come.
        cc = list(cc)
        cc[termios.VMIN] = 1
        cc[termios.VTIME] = 0
    else:
        raise SystemExit(f"unknown mode {mode!r}; one of {', '.join(MODES)}")
    termios.tcsetattr(fd, termios.TCSANOW, [iflag, oflag, cflag, lflag, ispeed, ospeed, cc])


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in MODES:
        raise SystemExit(f"usage: discipline.py <{'|'.join(MODES)}>  (bytes on stdin)")
    mode = sys.argv[1]
    data = sys.stdin.buffer.read()

    # **The mode is set before anything is written, and before the child exists.** The first version
    # used `pty.fork()` and applied the mode in the child after the fork, then wrote from the parent
    # immediately — a race the parent won every time, so every byte was processed under the default
    # and all three modes produced byte-identical output. Three modes agreeing perfectly is not a
    # result, it is an instrument reading zero.
    #
    # A pty's termios belongs to the *line discipline*, not to either end, so setting it on the slave
    # here is setting it for the child that will inherit it.
    master, slave = pty.openpty()
    apply_mode(slave, mode)

    pid = os.fork()
    if pid == 0:
        os.setsid()
        # The slave becomes this process's controlling terminal and all three of its streams.
        os.dup2(slave, 0)
        os.dup2(slave, 1)
        os.dup2(slave, 2)
        if slave > 2:
            os.close(slave)
        os.close(master)
        os.execvp("cat", ["cat"])
        os._exit(127)

    os.close(slave)
    os.write(master, data)
    out = bytearray()
    deadline = time.monotonic() + 5.0
    while time.monotonic() < deadline:
        ready, _, _ = select.select([master], [], [], 0.25)
        if not ready:
            # **Quiet only counts as the end once something has arrived.** The first version broke out
            # of this loop on the first idle quarter-second and returned nothing at all, every time:
            # `cat` had not finished starting. In canonical mode the program eventually sees its `^D`
            # and goes; in cbreak there is no end-of-input to send — that is the mode — so a quiet
            # moment after output is the only end there is.
            if out:
                break
            continue
        try:
            chunk = os.read(master, 65536)
        except OSError:
            break
        if not chunk:
            break
        out += chunk

    os.close(master)
    try:
        os.kill(pid, 9)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
    sys.stdout.buffer.write(bytes(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
