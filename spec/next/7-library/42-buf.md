# 42 — Buf

`Buf` is a growable byte buffer: the linear way to build bytes, or a string, a piece at a time. Its capacity doubles, so
appending `n` bytes costs amortised `O(n)`.

It is not `Vec<u8>` for a reason of shape: `len` is a public field, read once per pushed byte in a codec's inner loop,
and the single-byte `push` checks for exactly one byte of room.

## Building bytes

```wac
// expect: answers built = "hi wac!"
// expect: answers builtLen = 7
// expect: answers byteAt(0) = 'h'
// expect: traps byteAt(7)
import { Buf } from "core";

Buf sample() {
  Buf b = Buf.create();
  b.push('h');
  b.push('i');
  b.pushAll([' ', 'w']);
  b.pushBytes(['x', 'a', 'c', 'y'], 1, 2);       // "ac"
  b.pushStr("!");
  return b;
}

export string built() { return sample().toStr(); }

export i32 builtLen() { return sample().len; }

export u8 byteAt(i32 i) { return sample().get(i); }
```

`[§wac-buf-push-pw83mxx]` `push(byte)` appends one byte; `pushAll(bytes)` appends an array; `pushBytes(bytes, start, count)`
appends `count` bytes from `start`; `pushStr(s)` appends a string's UTF-8 bytes. `len` is the number of bytes held, and
`get(i)` reads one, trapping outside `0 … len - 1`.

`Buf.withCapacity(n)` makes one with room for `n` bytes before it grows, which saves the doubling when the final length is
known.

## Text

```wac
// expect: answers text = "-2147483648 é\u{FFFD}"
import { Buf } from "core";

export string text() {
  Buf b = Buf.create();
  b.pushDecimal(-2147483648);              // the minimum, which negation cannot write
  b.push(' ');
  b.pushCodepoint(0xE9);                   // é, two bytes of UTF-8
  b.pushCodepoint(0xD800);                 // a surrogate: U+FFFD instead
  return b.toStr();
}
```

`[§wac-buf-decimal-ynah2br]` `pushDecimal(n)` appends `n` in decimal, a minus sign if negative, for every `i32` including the
minimum.

`[§wac-buf-codepoint-e5uyr6y]` `pushCodepoint(cp)` appends `cp` as UTF-8. Anything that is not a Unicode scalar — negative,
above U+10FFFF, or a surrogate — is appended as U+FFFD, so what a `Buf` holds from this method is always valid UTF-8.

Building a string with `+` in a loop copies the string so far at every step, which is quadratic in the output. A `Buf`
and `toStr()` is the linear way.

## Taking the result

```wac
// expect: answers takeEmpties = true
import { Buf } from "core";

export bool takeEmpties() {
  Buf b = Buf.create();
  b.pushAll([1, 2, 3]);
  u8[] copy = b.bytes();                   // a copy: b is still usable
  b.push(4);
  string s = b.toStr();                    // a copy, as a string
  u8[] owned = b.take();                   // the contents, possibly without a copy; b is now empty
  return copy.len() == 3 && owned.len() == 4 && b.len == 0;
}
```

`[§wac-buf-take-p5uiewe]` `bytes()` and `toStr()` answer copies of the contents. `take()` answers the contents — the buffer's
own storage when it is exactly full — and empties the buffer, so nothing can write through an array already handed away.

## Back-references and dropping

```wac
// expect: answers backReference = "cabcab"
import { Buf } from "core";

export string backReference() {
  Buf b = Buf.create();
  b.pushAll(['a', 'b', 'c']);
  b.pushRepeat(0, 5);                      // copy 5 bytes from position 0, overlapping: "abcab"
  b.dropFront(2);                          // remove the first 2 bytes
  return b.toStr();
}
```

`[§wac-buf-repeat-y952a7g]` `pushRepeat(at, count)` appends `count` bytes copied from position `at` onward, one at a time, so a
copy that overlaps what it is writing repeats the pattern — the shape an LZ77 back-reference needs.

`[§wac-buf-drop-front-mevddnn]` `dropFront(n)` removes the first `n` bytes, moving the rest to the front.
