# 16 — Strings

`string` is an immutable sequence of bytes, taken to be UTF-8. It is a reference type, but since nothing
can change a string, sharing one is indistinguishable from copying it. Every length and offset is in
bytes.

## Literals

```wac
// expect: answers main = 15
export i32 main() {
  string s = "hello";
  string empty = "";
  string emoji = "hello 😀";
  return s.len() + empty.len() + emoji.len();   // 5 + 0 + 10
}
```

`[§wac-str-literal-k8fn2qp]` `"hello".len()` is `5`.

`[§wac-str-emoji-m4jw7rk]` `"hello 😀".len()` is `10`: the length is in bytes, not characters.

The escapes are `\n`, `\t`, `\r`, `\\`, `\"`, `\0` and `\u{…}`. Each is one character, and a resolved
escape is never rescanned:

```wac
// expect: answers main = 15
export i32 main() {
  i32 singles = "\n".len() + "\t".len() + "\0".len() + "\\".len() + "\"".len();   // 5
  i32 mid = "a\\b".len();                  // 3: a, one backslash, b
  i32 dbl = "\\\\".len();                  // 2: two backslashes
  i32 run = "[\\]^_".len();                // 5
  return singles + mid + dbl + run;
}
```

`[§wac-str-esc-h9qm3v7]` Each of `\n` `\t` `\0` `\\` `\"` is one byte.

`[§wac-str-esc-mid-w7kn3qf]` An escape is one byte wherever it sits: `"a\\b".len()` is `3`.

`[§wac-str-esc-dbl-h2mf9xp]` `"\\\\"` is two backslashes, not one.

`[§wac-str-esc-run-r5jw4kt]` A backslash escape in the middle of a run leaves the characters after it
alone: `"[\\]^_".len()` is `5`.

### `\u{…}`

One to six hex digits, naming a Unicode scalar. In a string it is encoded as UTF-8:

```wac
// expect: answers main = 69
export i32 main() {
  i32 letter = "\u{41}".toBytes()[0] as i32;   // 65
  i32 emojiLen = "\u{1F600}".len();            // 4

  // ERROR: \u{110000} is above U+10FFFF
  // string a = "\u{110000}";

  // ERROR: \u{D800} is a surrogate
  // string b = "\u{D800}";

  // ERROR: \u{} names nothing
  // string c = "\u{}";

  string max = "\u{10FFFF}";
  return letter + emojiLen;
}
```

`[§wac-str-uesc-j4kq8mv]` `"\u{41}"` is the byte `65`, and `"\u{1F600}"` is four bytes.

`[§wac-str-uesc-bounds-q7nw2fk]` An escape above `0x10FFFF`, a surrogate, an empty escape and one of more
than six digits are refused. `"\u{10FFFF}"` is not.

Its bounds are `string.fromCodepoint`'s: a literal cannot express what the equivalent call would refuse.

### What may appear raw

A literal may hold any character except Unicode category C — `Cc` control, `Cf` format, `Co`
private-use, `Cs` surrogate — and `Zl` and `Zp`. Nothing becomes unwriteable: each is still `\u{…}`; only
the invisible spelling goes. U+200C and U+200D are the exception and may be written raw — they change
what a visible character looks like rather than where it sits, and emoji sequences and correct
rendering in several scripts are built from them.

```wac
// expect: emits
export i32 main() {
  string ok = "\u{202E}";                  // spelled, so visible in the source
  // A raw U+202E, U+0094, U+200B, U+FEFF, U+E000, U+2028 or U+2029 between the quotes is refused.
  return 0;
}
```

`[§wac-str-raw-chars-t7kq2mw]` A raw `U+202E`, `U+0094`, `U+200B`, `U+FEFF`, `U+E000`, `U+2028` or `U+2029`
in a literal is refused; `"\u{202E}"` is not, and a raw `U+200C` or `U+200D` is not.

The bidirectional formatting characters are why this is a rule about safety and not only hygiene:
`U+202E` reorders what a reviewer sees without changing what the compiler reads. Unassigned code points
(`Cn`) are not part of the rule — whether one is assigned depends on the compiler's Unicode tables, and
the same source must not be legal under one revision and refused under another.

```wac
// expect: refused
export string main() {
  return "unterminated;
}
```

`[§wac-str-raw-newline-h4mn8qv]` A newline ends a literal where it occurs, so a missing closing quote is
reported on that line.

### Block strings

A literal opening with `"""` runs to the next `"""` and may hold newlines. The opening mark is followed by
a newline:

```wac
// expect: answers main = 1
export i32 main() {
  string usage = """
      usage: wac build <entry.wac> -o <stem>
             [--allow-read] [--allow-write]
      """;
  return usage == "usage: wac build <entry.wac> -o <stem>\n       [--allow-read] [--allow-write]\n"
      ? 1 : 0;
}
```

`[§wac-str-block-margin-p9qk4nv]` A block string's margin is the least indentation of its content lines, and
is removed from each. A blank line contributes nothing to it.

```wac
// expect: answers main = 1
export i32 main() {
  string a = """
      no newline at the end""";
  string b = """
      flush
    """;                                   // the mark is indented less than the content
  return a == "no newline at the end" && b == "flush\n" ? 1 : 0;
}
```

`[§wac-str-block-close-m2jw8rt]` The closing mark decides one thing — whether the value ends in a newline:
on a line of its own it does, at the end of the last content line it does not. Its indentation does not
enter the margin.

Escapes are cooked exactly as in `"…"`, and trailing whitespace is kept. A tab in the indentation is
refused, as anywhere in a literal, so no block string can mean two things to two readers.

## Length, concatenation and comparison

```wac
// expect: answers main = 1
export i32 main() {
  string s = "hello";
  s += " world";                           // a new string, rebound to s
  bool lengths = "abc".len() == 3 && ("abc" + "def").len() == 6;
  bool equal = "hello" == "hel" + "lo" && "abc" != "def";
  bool ordered = "abc" < "abd" && "b" > "a";
  return s == "hello world" && lengths && equal && ordered ? 1 : 0;
}
```

`[§wac-str-len-p2hd9xf]` `s.len()` is the byte length.

`[§wac-str-concat-n8qm5jf]` `a + b` is a new string, `a` followed by `b`.

`[§wac-str-concat-len-k2fn8wp]` `("abc" + "def").len()` is `6`.

`[§wac-str-append-q5km7wn]` `s += t` rebinds `s` to `s + t`; it does not change the string `s` held.

`[§wac-str-eq-p4jn2wq]` `==` compares strings by content.

`[§wac-str-neq-r8kf3mb]` `!=` is its negation.

`[§wac-str-lt-w5hm9qf]` `<` and `<=` order strings lexicographically by bytes.

`[§wac-str-gt-c7jw3kf]` `>` and `>=` likewise.

`+` takes two strings and nothing else:

```wac
// expect: emits
export i32 main() {
  // ERROR: + requires matching types — a number is not a string
  // string s = "count: " + 5;

  string t = "count: \{5 as i32}";         // interpolation converts, 23
  return 0;
}
```

`[§wac-str-noimplicit-p3jw7xf]` `string + i32` is refused: there is no implicit conversion to a string.

Interpolation is the way to put a value in a string, through core's `toString`
([23](../3-expressions/23-interpolation-and-markup.md)).

## Indexing

`s[i]` is the character whose UTF-8 encoding begins at byte `i`, as a one-character string. In the middle
of a sequence, or at a byte that begins none, it is `""`. Outside the string it traps:

```wac
// expect: traps main
export i32 main() {
  string s = "a😀b";
  bool a = "hello"[1] == "e";
  bool b = s[1] == "😀";                   // the start of a four-byte sequence
  bool c = s[2] == "" && s[2].len() == 0;  // mid-sequence
  string bad = "abc"[5];                   // traps
  return a && b && c ? 1 : 0;
}
```

`[§wac-str-idx-r7kf4mb]` `"hello"[1]` is `"e"`.

`[§wac-str-idx-emoji-w3qn8jk]` Indexing the first byte of a multi-byte character answers the whole
character.

`[§wac-str-idx-mid-h5pd2wn]` Indexing a byte in the middle of a sequence answers `""`.

`[§wac-str-idx-midlen-f9km3xq]` …whose length is `0`.

`[§wac-str-oob-j4wk7pm]` Indexing outside the string traps.

Strings cannot be written to:

```wac
// expect: emits
export i32 main() {
  string s = "hello";

  // ERROR: strings are immutable
  // s[0] = "H";

  return 0;
}
```

`[§wac-str-immut-m3hd7qz]` Assigning to a string index is refused.

## Slicing and searching

```wac
// expect: answers main = 1
export i32 main() {
  string s = "hello world";
  bool sub = s.slice(6, 11) == "world";
  bool found = s.indexOf("world") == 6;
  bool missing = "hello".indexOf("xyz") == -1;
  return sub && found && missing ? 1 : 0;
}
```

`[§wac-str-slice-h8wd4pm]` `s.slice(start, end)` is the bytes `[start, end)`: `"hello world".slice(6, 11)`
is `"world"`.

`[§wac-str-indexof-j2fn5rk]` `s.indexOf(t)` is the byte offset of the first occurrence of `t`.

`[§wac-str-indexof-miss-k4mf8js]` …or `-1` when there is none.

`slice` clamps; it never traps. The result is the overlap of the requested range with the string:

| call on `"hello"` | result | why |
|---|---|---|
| `slice(3, 99)` | `"lo"` | the end clamps to the length |
| `slice(9, 99)` | `""` | the start clamps to the length, leaving nothing |
| `slice(3, 1)` | `""` | a reversed range is empty, not an error |
| `slice(-2, 3)` | `"hel"` | a negative start clamps to 0 |
| `slice(2, 2)` | `""` | an empty range |

`[§wac-str-slice-clamp-3qnv7wk]` All five hold.

This differs deliberately from indexing. `slice` asks for the part of the string in a range, and every
range has an overlap, possibly empty. `s[i]` asks for one character, and where there is none there is no
answer to give. A negative start does not count from the end: nothing in the language does.

## Building and taking apart

`string.fromCodepoint(cp)` is the one-character string whose scalar is `cp`. It is the only way to make a
character that is not already written somewhere:

```wac
// expect: traps main
export i32 main() {
  bool a = string.fromCodepoint(65) == "A";
  bool b = string.fromCodepoint(128512).len() == 4;
  string bad = string.fromCodepoint(0xD800);   // traps: a surrogate
  return a && b ? 1 : 0;
}
```

`[§wac-str-fromcp-k8nf3wq]` `string.fromCodepoint(65)` is `"A"`.

`[§wac-str-fromcp-utf8-r4mj7xt]` The result is UTF-8, one to four bytes according to the scalar.

`[§wac-str-fromcp-trap-h6qw2np]` A negative value, a value above `0x10FFFF` or a surrogate traps — there is
no correct string to return, and a silent U+FFFD would hide the mistake.

`string.fromBytes(bytes)` is a string holding a copy of `bytes`, taken to be UTF-8. `s.toBytes()` is a
fresh array of a string's bytes:

```wac
// expect: answers main = 1
export i32 main() {
  u8[] b = ['h', 'i'];
  string s = string.fromBytes(b);
  b[0] = 'x';                              // s is unaffected: it is a copy

  u8[] out = "hi".toBytes();
  out[0] = 'x';                            // and so is "hi"

  bool copies = s == "hi" && "hi".toBytes()[0] == 104;
  bool utf8 = string.fromBytes([0xC3, 0xA9]) == "é" && "é".toBytes().len() == 2;
  return copies && utf8 ? 1 : 0;
}
```

`[§wac-str-frombytes-p3kq7wn]` `string.fromBytes(['h', 'i'])` is `"hi"`.

`[§wac-str-frombytes-utf8-m9fj2xr]` The bytes are taken verbatim: `[0xC3, 0xA9]` is `"é"`, one character in
two bytes.

`[§wac-str-frombytes-copy-w4nk8dt]` Writing to the array afterwards does not change the string.

`[§wac-str-tobytes-k7mq4wp]` `"hi".toBytes()` is `[104, 105]`.

`[§wac-str-tobytes-utf8-r2nf8jt]` `"é".toBytes()` is `[0xC3, 0xA9]`.

`[§wac-str-tobytes-copy-h5wk3qm]` Writing to the returned array does not change the string, and a second
`toBytes()` gives the original bytes again.

`fromBytes` does not validate: a string may hold bytes that are not UTF-8. Indexing a byte that begins no
sequence answers `""`, as indexing the middle of one does:

```wac
// expect: answers main = 1
export i32 main() {
  string s = string.fromBytes([0xFF, 0x41]);
  return s[0] == "" && s.len() == 2 ? 1 : 0;
}
```

`[§wac-str-badlead-7kvq2mn]` Indexing a byte that begins no UTF-8 sequence answers `""`.

### Validity is a question, and a repair

`string.isUtf8(bytes)` asks whether bytes are well-formed UTF-8, and `s.isUtf8()` asks it of a string —
a real question, since `fromBytes` does not validate:

```wac
// expect: answers main = 1
export i32 main() {
  bool a = string.isUtf8([0xC3, 0xA9]);
  bool b = !string.isUtf8([0xFF, 0x41]);
  bool c = "é".isUtf8() && !string.fromBytes([0xFF, 0x41]).isUtf8();
  return a && b && c ? 1 : 0;
}
```

`[§wac-str-isutf8-k4mq7vn]` `string.isUtf8` is true of well-formed UTF-8 and false otherwise.

`[§wac-str-isutf8-value-r2nk8fq]` `s.isUtf8()` asks the same of a string's own bytes.

It is strict. Rejected as well as the obviously malformed:

`[§wac-str-isutf8-strict-p9wj3xd]` an overlong encoding — `[0xC0, 0x80]` and `[0xE0, 0x80, 0x80]`; a
surrogate — `[0xED, 0xA0, 0x80]`; anything above U+10FFFF — `[0xF4, 0x90, 0x80, 0x80]`, and any lead byte
above `0xF4`; and a sequence truncated at the end — `[0xE2, 0x82]`. The boundaries either side —
`[0xC2, 0x80]`, `[0xE0, 0xA0, 0x80]`, `[0xED, 0x9F, 0xBF]`, `[0xF0, 0x90, 0x80, 0x80]`,
`[0xF4, 0x8F, 0xBF, 0xBF]` — are accepted.

A validator that accepts what a decoder would reject is worse than none.

`string.toUtf8(bytes)` repairs instead of reporting: it replaces what it cannot decode with U+FFFD, and
`s.toUtf8()` does the same for a string:

```wac
// expect: answers main = 1
export i32 main() {
  bool one = string.toUtf8([0xFF]).toBytes().len() == 3;          // one U+FFFD
  bool kept = string.toUtf8([0xC3, 0xA9]) == "é";
  bool value = string.fromBytes([0xFF, 0x41]).toUtf8().toBytes().len() == 4;
  bool maximal = string.toUtf8([0xE1, 0x80, 0x41]).toBytes().len() == 4;
  return one && kept && value && maximal ? 1 : 0;
}
```

`[§wac-str-toutf8-w7kd2mq]` `string.toUtf8` replaces each ill-formed part with U+FFFD and leaves well-formed
bytes unchanged.

`[§wac-str-toutf8-value-t6bz4hx]` `s.toUtf8()` does the same for a string's own bytes.

`[§wac-str-toutf8-maximal-n3qv8jf]` One replacement per maximal ill-formed subpart, not one per byte:
`[0xE1, 0x80, 0x41]` becomes U+FFFD followed by `A`.

That is the WHATWG rule — the one Rust, Python and every browser agree on.
