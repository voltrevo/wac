# tty — rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/tty`: one file, 430 lines, a line discipline — echo, erase, kill, word
erase, `^C`, `^D`. It is one of the best-evidenced files in the repository. Every rule was read off a
real pty (`script -qec cat`, and `tools/discipline.py` for the modes `script` cannot hold), 44
sequences byte for byte, and three of the rules are not what anyone would have written down.

**None of the rules change here.** Everything below is about the types the rules answer with.

---

## The four-field record, and the sentence that grouped the wrong three

`Typed` is `(u8[] echo, u8[] line, bool hasLine, bool eof, i32 signal)`, and the header defends the
shape:

> Four things can happen at once — a byte can be echoed, complete a line, and end the input — so this
> is a record rather than an enum.

One of the four is orthogonal and three are not. Counting the ten `return Typed(…)` sites in that
file: `echo` is set by nine of them, `hasLine`+`line` by four, `signal` by four, `eof` by one — and
**no site sets more than one of the last three.** Nor could one: a newline delivers the line, `^D` on
an empty line ends the input, `^C` throws the line away and signals. Each of those is what happens
*instead of* holding on to what has been typed.

So the echo genuinely co-occurs with everything and the rest are three arms of one choice:

```wac
struct Typed { Bytes echo; Effect effect; }
enum Effect { Nothing, Delivered(Bytes bytes), Eof, Signal(Sig sig) }
```

The cost of the record is the usual one, and it is three facts the type could have stated: read
`hasLine` before `line`, `signal == 0` means no signal, `eof` and `hasLine` are never both true.

**The interesting part is why the header got it wrong**, because it is not carelessness — the
sentence is *true of `echo`* and then keeps going. A record of N fields invites "can these co-occur?"
as one question about N things, and the answer here is yes for one of them and no for the other
three. Asking it per field is what splits them, and nothing about the shape of a struct prompts that.

## The number kept twice

`render(b)` says what a byte looks like on a terminal and `columns(b)` says how much room it takes,
and the file records what happened when they disagreed:

> **DEL is a caret pair too, and this said it was one column of itself.** `columns` has always
> answered 2 for 0x7f and this answered a bare DEL byte, so the two halves of the same module
> disagreed about the same character: a `^V DEL` echoed one raw byte where the kernel echoes `^?`,
> and the erase arithmetic then rubbed out two columns for something that had drawn one.

**They are the same function.** `columns(b)` equals `glyph(b).len()` for every one of the 256 byte
values — tab is one byte and one column, DEL and the control characters are two and two, printable
bytes and everything above 127 are one and one. So `render.wac` here has one table and `columns` is
a call, and the disagreement is not a bug that was fixed but a bug that cannot be written.

Worth stating in those terms. The bug *was* caught, by a pty comparison, which is an excellent oracle
and an expensive one — a process per case, and 23 seconds of the suite until the answers were
captured to a file. A derived `columns` needs no oracle at all. **The measured-against-the-kernel
discipline this package is built on is what found the fault; it is not what would have prevented
it.**

## What else changed

**`signal` is an `enum Sig` with two members.** The original's comment argues its own last change —
*"A number rather than the `bool interrupt` this was, because there are two of them and they are not
the same signal"* — and is right and one step short. A `bool` holds two things and there are three;
an `i32` holds four billion and there are three, with `0` meaning *nothing happened*: a value drawn
from the range of the answer, which is the fifth instance of that shape this exercise has found,
after `Read.code`, `search`'s `NO_MATCH`, `decode`'s `-2` and `Socket`'s negative handle. POSIX's
number is a *rendering* for whoever delivers the signal, so it is `Sig.number()` rather than the
representation.

**Eight control characters are `const u8` rather than `i32 ERASE() { return 127; }`.** Functions
returning literals, third package running.

**A mode is a value.** The original has two `bool` fields on `Line` and three constructors; here
`Mode` is a `const struct` with the same two flags and the same three presets, and `Line.setMode`
swaps it and **answers the one it replaced**. That last part is the half that makes it useful: an
editor taking a terminal into `cbreak` has to hand it back the way it found it, and a program that
assumes *canonical with echo* is wrong for anyone who was in a password prompt.

**`feedAll` is a generator.** It answered a `Typed[]` as long as its input — a 4 KB `CHANNEL_DATA`
payload allocates 4,096 records, of which all but a handful are `Typed.nothing()`, two empty arrays
each. It is also the first **synchronous** generator in this directory: every other one is an
`async gen` over a capability, and this one suspends against nothing. Which is the case that shows
`gen` is not a coroutine-over-IO feature — [../../QUESTIONS.md](../../QUESTIONS.md) frames stepping
in terms of awaiting throughout, and this wants the stepping without the awaiting.

## What could not be written

**`Buf` cannot drop a byte off the end, and the shipped file pays `O(n²)` for it.**
`packages/bytes/src/buf.wac` has `push`, `pushAll`, `dropFront`, `take` and `bytes`, and nothing that
shortens from the back — `dropFront` is this operation from the other end and has been there all
along. So `line.wac`'s `dropLast` takes the whole buffer, copies all but the last byte into a new
one, and replaces it: one full copy per backspace, and `^W` calls it once per byte of the word.
Erasing a ten-character word at the end of a 4,000-byte line copies about 40,000 bytes to remove ten.

`Buf.truncate(n)` is written into `@/packages/bytes` here and is four lines — the array stays, `len`
moves. Not added to the shipped package: `packages/bytes` is under everything and the gate has had no
memory to run in all day. Filed with the measurement, and this is the consumer that wanted it.

**Nothing can ask for a mode**, which is the gap the original's README names precisely:

> So an editor still cannot have a keystroke at a time — not because the discipline cannot do it, but
> because nothing can say so.

`Mode` being a value is half of it. The other half is that a *program* under a terminal holds an `In`
and the discipline is held by `sshd` or by the browser loop, with nothing between them. In
`vision/std` that is one member on `In`:

```wac
Result<Mode, NotATerminal> setMode(Mode m);   // answering the mode it was in
```

and it is **the first capability in this exercise that has to answer what it was**, because
restoring is the caller's job. Which makes it the first that wants `defer` for a reason nothing else
has had: not to release something acquired, but to put something back.

**And the mode is the exception to *no ambient authority*.** Two programs sharing one terminal — a
shell and the editor it spawned — hold two `In` values over one discipline, and a mode set through
either is visible to both. That is what a terminal *is*: `stty` in one shell changes what the next
program sees. Every other piece of state in `vision/std` is reachable only through the capability
that owns it, and this one is not, because the thing it describes is shared hardware. Promoted, as
the place where the principle has a real exception rather than a missing feature.

**No job control, still**, and the reason has moved: the original says `^Z` is delivered as an
ordinary character *"because there is nothing to suspend until design/0001 step 3 puts a process
table in"*, and its README already records that the table went in and the missing half is now that
suspending needs a signal a running child can be made to stop on. Nothing in `vision/std` has one
either — `Proc` can start a child and read it to the end, and the only thing it can do to a running
one is let it finish.
