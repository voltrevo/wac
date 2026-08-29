## Strings

`string` is a built-in immutable reference type. UTF-8 encoded, backed by a
packed `i8[]` GC array. Assignment aliases (like all reference types), but
immutability makes aliasing indistinguishable from copying.

String operations (concatenation, equality, comparison, indexing, slice,
indexOf) are emitted as internal wasm functions in the module. Unused string
operations are dead-code-eliminated.

### Literals

```wac
string s = "hello";
string empty = "";
string emoji = "hello 😀";
string escaped = "line1\nline2";
```

Escape sequences: `\n`, `\t`, `\r`, `\\`, `\"`, `\0`, and `\u{H…H}`.

### Block strings

A literal opening with `"""` runs to the next `"""` and may hold newlines.

```wac
string usage = """
    usage: wac build <entry.wac> -o <stem>
           [--allow-read] [--allow-write]
    """;
```

The opening mark is followed by a newline, unconditionally: content on that
line would have no indentation to contribute to the margin below.

Escapes are cooked exactly as in `"…"`, so every character stays expressible —
the cost is that a backslash in the text is a trap, and `C:\new\table` is a
newline and a tab. Trailing whitespace is kept, so no `\s`-style escape hatch is
needed.

**The margin is the least indentation of the content lines**, and it is removed
from each. A blank line has no indentation and contributes nothing.

**The closing mark decides one thing: whether the value ends in a newline.** On
its own line it does; at the end of the last content line it does not. Its own
indentation does not enter the margin — deliberately unlike Java, where moving
the delimiter silently reindents the whole value.

`[§wac-str-block-margin-p9qk4nv]` The example above is
`"usage: wac build <entry.wac> -o <stem>\n       [--allow-read] [--allow-write]\n"`.
`[§wac-str-block-close-m2jw8rt]` With the closing mark at the end of the last
content line, the value has no trailing newline; with the mark indented less
than the content, the content is still flush.

A tab in the indentation is an error, as it is anywhere else in a literal — see
below — so no block string can mean two things to two readers.

### What may appear raw

A literal may hold any character **except** Unicode category C — `Cc` control,
`Cf` format, `Co` private-use, `Cs` surrogate — and `Zl` and `Zp`. Nothing
becomes unwriteable: every one of them is still `\u{…}`, and only the invisible
spelling goes.

**U+200C and U+200D are the exception** and may be written raw. They are `Cf`,
and they are the only invisible characters that change what a *visible*
character looks like rather than where it sits — emoji sequences are built from
them, as is correct rendering in Persian, Hindi and Malay.

`[§wac-str-raw-chars-t7kq2mw]` A raw `U+202E`, `U+0094`, `U+200B`, `U+FEFF`,
`U+E000`, `U+2028` or `U+2029` in a literal is a compile error; `"\u{202E}"` is
not, and a raw `U+200C` or `U+200D` is not.

The bidirectional formatting characters are the reason this is a rule about
safety rather than only about hygiene: `U+202E` reorders what a reviewer sees
without changing what the compiler reads, so a literal can render one way and
mean another.

`[§wac-str-raw-newline-h4mn8qv]` A newline ends the literal where it occurs,
so a missing closing quote is reported on that line rather than at the opening
quote with the rest of the file consumed.

**`Cn` — unassigned — is not part of this rule.** Whether a code point is
assigned is a fact about the compiler's Unicode tables rather than about the
program, so including it would make the same source legal under one revision
and refused under an older one.

### `\u{H…H}`

One to six hex digits, naming a Unicode scalar. In a string it encodes as UTF-8;
in a character literal it *is* the integer, so `'\u{1F600}'` is `128512`.

```wac
export i32 letterFromEscape() { return "\u{41}".toBytes()[0]; }
export i32 emojiEscapeLen()   { return "\u{1F600}".len(); }
```

`[§wac-str-uesc-j4kq8mv]` `letterFromEscape()` returns `65` and
`emojiEscapeLen()` returns `4`.

**Its bounds are `string.fromCodepoint`'s**, below: a value above `0x10FFFF` or a
surrogate in `0xD800..0xDFFF` is a compile error, exactly as it traps there. One
rule rather than two that can drift apart — a literal cannot express what the
equivalent call would refuse.

`[§wac-str-uesc-bounds-q7nw2fk]` `"\u{110000}"`, `"\u{D800}"`, `"\u{}"` and a
seven-digit escape are compile errors. `"\u{10FFFF}"` is not.

This is the escape that makes every character spellable, which is what lets a
literal forbid the raw control characters without losing any of them.

`[§wac-str-literal-k8fn2qp]` `s.len()` is `5`.
`[§wac-str-emoji-m4jw7rk]` `emoji.len()` is `10` (byte length, not char count).

```wac
export i32 testEscapes() {
  string nl = "\n";
  string tab = "\t";
  string nul = "\0";
  string bs = "\\";
  string qt = "\"";
  return nl.len() + tab.len() + nul.len() + bs.len() + qt.len();
}
```

`[§wac-str-esc-h9qm3v7]` `testEscapes()` returns `5` — each escape is a single
byte.

An escape is one byte wherever it sits, including with text after it. The
resolved character is never rescanned, so a `\\` does not consume what follows
it:

```wac
export i32 escMid()    { return "a\\b".len(); }
export i32 escDouble() { return "\\\\".len(); }
export i32 escRun()    { return "[\\]^_".len(); }
```

`[§wac-str-esc-mid-w7kn3qf]` `escMid()` returns `3` — `a`, one backslash, `b`.
`[§wac-str-esc-dbl-h2mf9xp]` `escDouble()` returns `2` — two backslashes, not one.
`[§wac-str-esc-run-r5jw4kt]` `escRun()` returns `5` — a backslash mid-run leaves
the following characters alone.

These are separate requirements from the one above because a literal whose only
escape sits at the very end cannot distinguish a correct implementation from one
that rescans: there is nothing after the escape left to lose.

### Interpolation

`\{` inside a double-quoted literal begins an embedded expression, ended by the
matching `}`. It is **exactly sugar for `+`**: `"a\{e}b"` is the same program as
`"a" + e + "b"`, with the same type rules, the same evaluation order and the same
diagnostics. Nothing about it is deferred to run time and there is no formatting
language — the expression is whatever `+` accepts on the right of a string.

The braces balance, so an expression may contain its own braces and its own
string literals, including further interpolation.

```wac
string two() { return "xy"; }
export i32 interp()      { return "a\{two()}b".len(); }
export i32 interpAlone() { return "\{two()}".len(); }
export i32 interpNest()  { return "\{two() + "\{two()}"}".len(); }
```

`[§wac-str-interp-sugar-k3nq7wm]` `interp()` returns `4` — the same answer as
`("a" + two() + "b").len()`, which is the program it stands for.
`[§wac-str-interp-alone-d8mf2xq]` `interpAlone()` returns `2`. A literal may be
nothing but an interpolation, and the empty segments each side contribute
nothing.
`[§wac-str-interp-nest-r4kw9np]` `interpNest()` returns `4`. A literal inside an
interpolation is an ordinary literal and may interpolate in turn; the braces are
matched, not counted from the outside.

`\{` is the only new spelling. A literal backslash before a brace is written
`\\{`, which is the escaped backslash of `[§wac-str-esc-dbl-h2mf9xp]` followed by
an ordinary `{`, and means what it always did.

### Length

`.len()` returns byte length.

```wac
export i32 strLen() {
  string s = "abc";
  return s.len();
}
```

`[§wac-str-len-p2hd9xf]` `strLen()` returns `3`.

### Compound assignment

`+=` appends to a string variable, creating a new string.

```wac
export string strAppend() {
  string s = "hello";
  s += " world";
  return s;
}
```

`[§wac-str-append-q5km7wn]` `strAppend()` returns `"hello world"`.

Since strings are immutable, `s += t` is equivalent to `s = s + t` — it
rebinds `s` to a new string, it does not mutate the original.

### Indexing

`s[i]` decodes the UTF-8 codepoint starting at byte index `i` and returns it
as a single-character string. Returns `""` if `i` is in the middle of a
multi-byte sequence. Traps if `i < 0` or `i >= s.len()`.

```wac
export string strIdx() {
  string s = "hello";
  return s[1];
}

export string strEmoji() {
  string s = "a😀b";
  return s[1];            // start of 😀 (4-byte sequence)
}

export string strMid() {
  string s = "a😀b";
  return s[2];            // mid-sequence
}

export i32 strMidLen() {
  string s = "a😀b";
  return s[2].len();
}
```

`[§wac-str-idx-r7kf4mb]` `strIdx()` returns `"e"`.
`[§wac-str-idx-emoji-w3qn8jk]` `strEmoji()` returns `"😀"`.
`[§wac-str-idx-mid-h5pd2wn]` `strMid()` returns `""`.
`[§wac-str-idx-midlen-f9km3xq]` `strMidLen()` returns `0`.

```wac
export string strOob() {
  string s = "abc";
  return s[5];
}
```

`[§wac-str-oob-j4wk7pm]` `strOob()` traps: index out of bounds.

### Concatenation

`+` concatenates two strings, returning a new string.

```wac
export string strConcat() {
  string a = "hello";
  string b = " world";
  return a + b;
}
```

`[§wac-str-concat-n8qm5jf]` `strConcat()` returns `"hello world"`.

```wac
export i32 strConcatLen() {
  return ("abc" + "def").len();
}
```

`[§wac-str-concat-len-k2fn8wp]` `strConcatLen()` returns `6`.

```wac
string s = "count: " + 5;    // error: + requires matching types
```

`[§wac-str-noimplicit-p3jw7xf]` string + i32 is a compile error — no implicit conversion.

### Equality

`==` and `!=` compare by content (byte equality).

```wac
export bool strEq() {
  string a = "hello";
  string b = "hel" + "lo";
  return a == b;
}

export bool strNeq() {
  return "abc" != "def";
}
```

`[§wac-str-eq-p4jn2wq]` `strEq()` returns `true`.
`[§wac-str-neq-r8kf3mb]` `strNeq()` returns `true`.

### Comparison

`<`, `<=`, `>`, `>=` compare lexicographically by bytes.

```wac
export bool strLt() {
  return "abc" < "abd";
}

export bool strGt() {
  return "b" > "a";
}
```

`[§wac-str-lt-w5hm9qf]` `strLt()` returns `true`.
`[§wac-str-gt-c7jw3kf]` `strGt()` returns `true`.

### Immutability

Strings cannot be modified. There is no `s[i] = ...` or `.set()`.

```wac
string s = "hello";
s[0] = "H";              // error: strings are immutable
```

`[§wac-str-immut-m3hd7qz]` Assigning to a string index is a compile error.

### Building a string from a codepoint

`string.fromCodepoint(cp)` returns the one-character string whose Unicode scalar
is `cp`, UTF-8 encoded.

This is the only way to reach a character that is not already written down
somewhere. Literals, `+` and `slice` can only produce characters that appear in
the source or in an input, so without it text whose content is computed — a
`\uXXXX` escape decoder, a codepoint arithmetic routine — cannot be expressed.

```wac
export string letterA()  { return string.fromCodepoint(65); }
export i32    emojiLen() { return string.fromCodepoint(128512).len(); }
```

`[§wac-str-fromcp-k8nf3wq]` `letterA()` returns `"A"`.
`[§wac-str-fromcp-utf8-r4mj7xt]` The result is UTF-8, so its `len()` is 1, 2, 3 or
4 bytes according to the scalar: `128512` gives 4.

It traps rather than substituting a replacement character when the value has no
encoding, because there is no correct string to return and a silent U+FFFD would
hide the caller's mistake.

`[§wac-str-fromcp-trap-h6qw2np]` A negative value, a value above `0x10FFFF`, or a
surrogate in `0xD800..0xDFFF` traps.

### Building a string from bytes

`string.fromBytes(bytes)` returns a string holding a copy of `bytes`, which are
taken to be UTF-8.

```wac
export string hi() { return string.fromBytes(u8[]('h', 'i')); }
```

`[§wac-str-frombytes-p3kq7wn]` `hi()` returns `"hi"`.
`[§wac-str-frombytes-utf8-m9fj2xr]` The bytes are copied verbatim, so
`u8[](0xC3, 0xA9)` gives `"é"` — one character, two bytes.

**It does not validate.** The bytes are taken to be UTF-8 and are not checked, so a string can
hold sequences that are not valid UTF-8. That is deliberate: validating would cost a pass over
every string built this way, and the callers that need it — a decoder, a parser — are better
placed to check than the constructor is.

What that means for the operations: `len()` counts bytes, so it is unaffected. Indexing a byte
that **begins no UTF-8 sequence** yields `""`, the same as indexing into the middle of a
sequence. `[§wac-str-badlead-7kvq2mn]` So `string.fromBytes(u8[](0xFF, 0x41))[0]` is `""`.

That agreement is newer than it looks. A continuation byte (`0x80`–`0xBF`) always yielded `""`,
but `0xF8`–`0xFF` — which begin no sequence either — fell through the sequence-length logic and
decoded as one-byte characters. Two equally un-indexable cases behaved differently, and only one
was written down. See issue 0038.

It is a copy, not a view. Writing to the array afterwards does not change the
string, which is what lets `string` stay immutable.

`[§wac-str-frombytes-copy-w4nk8dt]` After `string s = string.fromBytes(b);`,
assigning to `b[0]` leaves `s` unchanged.

`s.toBytes()` is the other direction: a fresh `u8[]` of the string's UTF-8 bytes,
also a copy — handing out the string's own storage would give the caller a
writable view of an immutable value.

```wac
export i32 firstByte() { return "hi".toBytes()[0]; }
```

`[§wac-str-tobytes-k7mq4wp]` `firstByte()` returns `104`, and
`"hi".toBytes().len()` is `2`.
`[§wac-str-tobytes-utf8-r2nf8jt]` `"é".toBytes()` is `{ 0xC3, 0xA9 }` — the UTF-8
bytes, so the length is the byte count.
`[§wac-str-tobytes-copy-h5wk3qm]` Writing to the returned array does not change
the string, and a second `toBytes()` call gives the original bytes again.

The two together round-trip: `string.fromBytes(s.toBytes()) == s` for any `s`.

The bytes are **not validated**. Ill-formed UTF-8 produces a string whose
indexing returns `""` at the bad offset — the same thing that happens when
`slice` lands in the middle of a character — and whose `len()` is still the byte
count. Validating on every call would cost a second pass for a guarantee the type
does not otherwise make; a caller that needs one should check before converting.

`string.isUtf8(bytes)` is that check, and `s.isUtf8()` asks it of a string's own
bytes — which is a real question rather than a constant `true`, precisely because
`fromBytes` does not validate.

```wac
export bool ok() { return string.isUtf8(u8[](0xC3, 0xA9)); }
```

`[§wac-str-isutf8-k4mq7vn]` `ok()` returns `true`, and
`string.isUtf8(u8[](0xFF, 0x41))` is `false`.
`[§wac-str-isutf8-value-r2nk8fq]` `"é".isUtf8()` is `true` and
`string.fromBytes(u8[](0xFF, 0x41)).isUtf8()` is `false` — the same question
about a value, answered without copying its bytes out.

**It is strict, and that is the point of it.** A validator that accepts what a
decoder would reject is worse than none, because the callers that reach for this
are the ones the constructor already declined to help. Rejected as well as the
obviously malformed:

`[§wac-str-isutf8-strict-p9wj3xd]` an **overlong** encoding — `{ 0xC0, 0x80 }`
and `{ 0xE0, 0x80, 0x80 }` are `false`, being non-shortest spellings of U+0000; a
**surrogate** — `{ 0xED, 0xA0, 0x80 }` is `false`, U+D800 not being a scalar
value; anything **above U+10FFFF** — `{ 0xF4, 0x90, 0x80, 0x80 }` is `false`, and
so is any lead byte above `0xF4`; and a **truncated** sequence at the end of the
array — `{ 0xE2, 0x82 }` is `false`.

The boundaries either side are accepted, which is what makes those rejections a
range rather than a blanket: `{ 0xC2, 0x80 }`, `{ 0xE0, 0xA0, 0x80 }`,
`{ 0xED, 0x9F, 0xBF }`, `{ 0xF0, 0x90, 0x80, 0x80 }` and
`{ 0xF4, 0x8F, 0xBF, 0xBF }` are all `true`.

### String methods

```wac
string s = "hello world";
string sub = s.slice(6, 11);     // "world" — byte offsets [start, end)
i32 pos = s.indexOf("world");    // 6 — byte offset, -1 if not found
```

`[§wac-str-slice-h8wd4pm]` `"hello world".slice(6, 11)` returns `"world"`.

**`slice` clamps; it never traps.** The result is the overlap of the requested range with the
string, so every combination of arguments has an answer:

| call on `"hello"` | result | why |
|---|---|---|
| `slice(3, 99)` | `"lo"` | the end clamps to the length |
| `slice(9, 99)` | `""` | the start clamps to the length, leaving nothing |
| `slice(3, 1)` | `""` | a reversed range is empty, not an error |
| `slice(-2, 3)` | `"hel"` | a negative start clamps to 0 |
| `slice(2, 2)` | `""` | an empty range |

`[§wac-str-slice-clamp-3qnv7wk]` All five hold.

This differs deliberately from indexing, which **traps** out of range (see below). The two are
not inconsistent by accident: `slice` asks "give me the part of this string in that range", and
every range has an overlap, including an empty one — clamping is the answer to the question
asked. `s[i]` asks for one specific character, and if there is no such character there is no
answer to give, so it traps.

The negative start is the case worth being explicit about, because a reader may expect two other
behaviours and gets neither. It does **not** trap, even though the equivalent arithmetic mistake
in `s[i]` would; and it does **not** count from the end — `"hello".slice(-2, 3)` is `"hel"`, not
Python's `"lo"`. wac has no from-the-end indexing anywhere, and introducing it only in `slice`
would be worse than clamping.

The cost of clamping is real and is accepted: a caller who computes an offset wrongly gets a
plausible short string rather than a trap. If that becomes a source of bugs, the fix is a
separate checked operation, not changing this one.
`[§wac-str-indexof-j2fn5rk]` `"hello world".indexOf("world")` returns `6`.
`[§wac-str-indexof-miss-k4mf8js]` `"hello".indexOf("xyz")` returns `-1`.
