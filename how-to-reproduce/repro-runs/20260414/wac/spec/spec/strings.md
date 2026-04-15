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

Escape sequences: `\n`, `\t`, `\r`, `\\`, `\"`, `\0`.

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

### String methods

```wac
string s = "hello world";
string sub = s.slice(6, 11);     // "world" — byte offsets [start, end)
i32 pos = s.indexOf("world");    // 6 — byte offset, -1 if not found
```

`[§wac-str-slice-h8wd4pm]` `"hello world".slice(6, 11)` returns `"world"`.
`[§wac-str-indexof-j2fn5rk]` `"hello world".indexOf("world")` returns `6`.
`[§wac-str-indexof-miss-k4mf8js]` `"hello".indexOf("xyz")` returns `-1`.
