# 16 — Strings

`string` is an immutable sequence of bytes, taken to be UTF-8. It is a reference type, but since nothing
can change a string, sharing one is indistinguishable from copying it. Every length and offset is in
bytes.

## Literals

```wac
// expect: answers hello = 5
// expect: answers empty = 0
// expect: answers withEmoji = 10
export i32 hello() { return "hello".len(); }
export i32 empty() { return "".len(); }
export i32 withEmoji() { return "hello 😀".len(); }
```

`[§wac-str-literal-k8fn2qp]` `"hello".len()` is `5`.

`[§wac-str-emoji-m4jw7rk]` `"hello 😀".len()` is `10`: the length is in bytes, not characters.

The escapes are `\n`, `\t`, `\r`, `\\`, `\"`, `\0` and `\u{…}`. Each is one character, and a resolved
escape is never rescanned:

```wac
// expect: answers singles = 5
// expect: answers mid = 3
// expect: answers dbl = 2
// expect: answers run = 5
export i32 singles() { return "\n".len() + "\t".len() + "\0".len() + "\\".len() + "\"".len(); }
export i32 mid() { return "a\\b".len(); }      // a, one backslash, b
export i32 dbl() { return "\\\\".len(); }      // two backslashes
export i32 run() { return "[\\]^_".len(); }
```

`[§wac-str-esc-h9qm3v7]` Each of `\n` `\t` `\0` `\\` `\"` is one byte.

`[§wac-str-esc-mid-w7kn3qf]` An escape is one byte wherever it sits: `"a\\b".len()` is `3`.

`[§wac-str-esc-dbl-h2mf9xp]` `"\\\\"` is two backslashes, not one.

`[§wac-str-esc-run-r5jw4kt]` A backslash escape in the middle of a run leaves the characters after it
alone: `"[\\]^_".len()` is `5`.

### `\u{…}`

One to six hex digits, naming a Unicode scalar. In a string it is encoded as UTF-8:

```wac
// expect: answers letter = 65
// expect: answers emojiLen = 4
// expect: answers maxLen = 4
export i32 letter() { return "\u{41}".toBytes()[0] as i32; }
export i32 emojiLen() { return "\u{1F600}".len(); }

export i32 maxLen() {

  // ERROR: \u{110000} is above U+10FFFF
  // string a = "\u{110000}";

  // ERROR: \u{D800} is a surrogate
  // string b = "\u{D800}";

  // ERROR: \u{} names nothing
  // string c = "\u{}";

  string max = "\u{10FFFF}";
  return max.len();
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
// expect: answers spelled = 3
export i32 spelled() {
  string ok = "\u{202E}";                  // spelled, so visible in the source
  // A raw U+202E, U+0094, U+200B, U+FEFF, U+E000, U+2028 or U+2029 between the quotes is refused.
  return ok.len();
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
export string unterminated() {
  return "unterminated;
}
```

`[§wac-str-raw-newline-h4mn8qv]` A newline ends a literal where it occurs, so a missing closing quote is
reported on that line.

### Block strings

A literal opening with `"""` runs to the next `"""` and may hold newlines. The opening mark is followed by
a newline:

```wac
// expect: answers usage = true
export bool usage() {
  string usage = """
      usage: wac build <entry.wac> -o <stem>
             [--allow-read] [--allow-write]
      """;
  return usage == "usage: wac build <entry.wac> -o <stem>\n       [--allow-read] [--allow-write]\n";
}
```

`[§wac-str-block-margin-p9qk4nv]` A block string's margin is the least indentation of its content lines, and
is removed from each. A blank line contributes nothing to it.

```wac
// expect: answers closedOnLastLine = "no newline at the end"
// expect: answers closedBelow = "flush\n"
export string closedOnLastLine() {
  return """
      no newline at the end""";
}

export string closedBelow() {
  return """
      flush
    """;                                   // the mark is indented less than the content
}
```

`[§wac-str-block-close-m2jw8rt]` The closing mark decides one thing — whether the value ends in a newline:
on a line of its own it does, at the end of the last content line it does not. Its indentation does not
enter the margin.

Escapes are cooked exactly as in `"…"`, and trailing whitespace is kept. A tab in the indentation is
refused, as anywhere in a literal, so no block string can mean two things to two readers.

## Length, concatenation and comparison

```wac
// expect: answers append = "hello world"
// expect: answers concatLen("abc", "def") = 6
// expect: answers equal("hello", "hel", "lo") = true
// expect: answers equal("abc", "ab", "d") = false
// expect: answers less("abc", "abd") = true
// expect: answers less("b", "a") = false
export string append() {
  string s = "hello";
  string before = s;
  s += " world";                           // a new string, rebound to s
  return before == "hello" ? s : "";       // the string s held is unchanged
}

export i32 concatLen(string a, string b) { return (a + b).len(); }
export bool equal(string s, string a, string b) { return s == a + b && !(s != a + b); }
export bool less(string a, string b) { return a < b && b > a && a <= b && b >= a; }
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
// expect: answers count(5) = "count: 5"
export string count(i32 n) {
  // ERROR: + requires matching types — a number is not a string
  // string s = "count: " + n;

  return "count: \{n}";                    // interpolation converts, 23
}
```

`[§wac-str-noimplicit-p3jw7xf]` `string + i32` is refused: there is no implicit conversion to a string.

Interpolation is the way to put a value in a string, through core's `toString`
([23](../3-expressions/23-interpolation-and-markup.md)).

## Indexing

`s[i]` is the character whose UTF-8 encoding begins at byte `i`, as a one-character string. In the middle
of a sequence, or at a byte that begins none, it is `""`. Outside the string it traps:

```wac
// expect: answers at("hello", 1) = "e"
// expect: answers at("a😀b", 1) = "😀"
// expect: answers at("a😀b", 2) = ""
// expect: answers lenAt("a😀b", 2) = 0
// expect: traps at("abc", 5)
export string at(string s, i32 i) { return s[i]; }
export i32 lenAt(string s, i32 i) { return s[i].len(); }
```

`[§wac-str-idx-r7kf4mb]` `"hello"[1]` is `"e"`.

`[§wac-str-idx-emoji-w3qn8jk]` Indexing the first byte of a multi-byte character answers the whole
character.

`[§wac-str-idx-mid-h5pd2wn]` Indexing a byte in the middle of a sequence answers `""`.

`[§wac-str-idx-midlen-f9km3xq]` …whose length is `0`.

`[§wac-str-oob-j4wk7pm]` Indexing outside the string traps.

Strings cannot be written to:

```wac
// expect: answers first = "h"
export string first() {
  string s = "hello";

  // ERROR: strings are immutable
  // s[0] = "H";

  return s[0];
}
```

`[§wac-str-immut-m3hd7qz]` Assigning to a string index is refused.

## Slicing and searching

```wac
// expect: answers slice("hello world", 6, 11) = "world"
// expect: answers indexOf("hello world", "world") = 6
// expect: answers indexOf("hello", "xyz") = -1
export string slice(string s, i32 start, i32 end) { return s.slice(start, end); }
export i32 indexOf(string s, string t) { return s.indexOf(t); }
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
// expect: answers fromCodepoint(65) = "A"
// expect: answers byteLen(128512) = 4
// expect: traps fromCodepoint(55296)
// expect: traps fromCodepoint(-1)
export string fromCodepoint(i32 cp) { return string.fromCodepoint(cp); }
export i32 byteLen(i32 cp) { return string.fromCodepoint(cp).len(); }   // 128512 is U+1F600
```

`[§wac-str-fromcp-k8nf3wq]` `string.fromCodepoint(65)` is `"A"`.

`[§wac-str-fromcp-utf8-r4mj7xt]` The result is UTF-8, one to four bytes according to the scalar.

`[§wac-str-fromcp-trap-h6qw2np]` A negative value, a value above `0x10FFFF` or a surrogate traps — there is
no correct string to return, and a silent U+FFFD would hide the mistake.

`string.fromBytes(bytes)` is a string holding a copy of `bytes`, taken to be UTF-8. `s.toBytes()` is a
fresh array of a string's bytes:

```wac
// expect: answers copies = true
// expect: answers utf8 = true
export bool copies() {
  u8[] b = ['h', 'i'];
  string s = string.fromBytes(b);
  b[0] = 'x';                              // s is unaffected: it is a copy

  u8[] out = "hi".toBytes();
  out[0] = 'x';                            // and so is "hi"

  return s == "hi" && "hi".toBytes()[0] == 104;
}

export bool utf8() {
  return string.fromBytes([0xC3, 0xA9]) == "é" && "é".toBytes().len() == 2;
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
// expect: answers badLead = ""
// expect: answers badLen = 2
export string badLead() { return string.fromBytes([0xFF, 0x41])[0]; }
export i32 badLen() { return string.fromBytes([0xFF, 0x41]).len(); }
```

`[§wac-str-badlead-7kvq2mn]` Indexing a byte that begins no UTF-8 sequence answers `""`.

### Validity is a question, and a repair

`string.isUtf8(bytes)` asks whether bytes are well-formed UTF-8, and `s.isUtf8()` asks it of a string —
a real question, since `fromBytes` does not validate:

```wac
// expect: answers isUtf8([0xC3, 0xA9]) = true
// expect: answers isUtf8([0xFF, 0x41]) = false
// expect: answers stringIsUtf8("é") = true
// expect: answers fromBytesIsUtf8([0xFF, 0x41]) = false
export bool isUtf8(u8[] b) { return string.isUtf8(b); }
export bool stringIsUtf8(string s) { return s.isUtf8(); }
export bool fromBytesIsUtf8(u8[] b) { return string.fromBytes(b).isUtf8(); }
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
// expect: answers repairedLen([0xFF]) = 3
// expect: answers toUtf8([0xC3, 0xA9]) = "é"
// expect: answers stringRepairedLen([0xFF, 0x41]) = 4
// expect: answers toUtf8([0xE1, 0x80, 0x41]) = "\u{FFFD}A"
export string toUtf8(u8[] b) { return string.toUtf8(b); }
export i32 repairedLen(u8[] b) { return string.toUtf8(b).toBytes().len(); }          // [0xFF]: one U+FFFD
export i32 stringRepairedLen(u8[] b) { return string.fromBytes(b).toUtf8().toBytes().len(); }
```

`[§wac-str-toutf8-w7kd2mq]` `string.toUtf8` replaces each ill-formed part with U+FFFD and leaves well-formed
bytes unchanged.

`[§wac-str-toutf8-value-t6bz4hx]` `s.toUtf8()` does the same for a string's own bytes.

`[§wac-str-toutf8-maximal-n3qv8jf]` One replacement per maximal ill-formed subpart, not one per byte:
`[0xE1, 0x80, 0x41]` becomes U+FFFD followed by `A`.

That is the WHATWG rule — the one Rust, Python and every browser agree on.
