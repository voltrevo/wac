# B — Diagnostics

Every chapter says what is *refused*. This appendix says what a refusal looks like: the fields a diagnostic carries,
how it renders, and, for the commonest mistakes, the exact words.

## A diagnostic

A diagnostic is a structured value, produced by the phase that found the problem — not text assembled afterwards by a
formatter:

| Field | |
|---|---|
| `severity` | `error` or `warning` |
| `message` | the headline: what rule was broken |
| `file`, `line`, `col` | where — in the file that holds the mistake, not the entry ([45](../8-tooling/45-cli.md)) |
| `span` | how many characters to underline |
| `annotation` | the text after the underline: what was found |
| `hint` | optional: what to write instead |
| `phase` | `lex`, `parse`, `resolve` or `check` |

A compile answers its diagnostics in every case, an empty list included. It fails if and only if one of them is an
error: warnings come back beside a module, never instead of one.

`[§wac-diag-severity-22f6seg]` A program with only warnings compiles, and its module is the one it would have been without them.

Every rule a chapter states as *refused* is an error. A chapter that says an implementation *may warn* permits a warning
and requires none; no warning is mandatory unless a tag below says so.

A headline names the rule, not the symptom: two faults sharing one code get two headlines. A hint, where there is one, is a program fragment that compiles when pasted in.

## Rendering

```
error: <message>
  --> <file>:<line>:<col>
   |
 N |   <source line>
   |   <underline> <annotation>
   = help: <hint>
```

```wac
// ---- err.wac ----
export i32 bad(i32 x) {
  if (x) { return 1; }
  return 0;
}
```

```
error: condition must be bool
  --> err.wac:2:7
   |
 2 |   if (x) { return 1; }
   |       ^ expected bool, found i32
   = help: use a comparison: if (x != 0) { ... }
```

`[§wac-diag-bool-r8kn4wp]` A non-`bool` condition is reported with `span: 1`, `annotation: "expected bool, found i32"` and
`hint: "use a comparison: if (x != 0) { ... }"`.

`[§wac-diag-wide-k4rn8wp]` The gutter widens with the line number so the `|` stay aligned:

```
error: return: expected i32, found bool
   --> algo.wac:47:10
    |
 47 |   return sum > 0;
    |          ^^^^^^^ expected i32, found bool
    = help: use `(sum > 0) as i32` to convert
```

`[§wac-diag-multiline-ic7x2hq]` A span inside a construct over several lines shows the lines leading to it:

```
error: incompatible argument type
   --> algo.wac:14:7
    |
 12 |     i32 result = compute(
 13 |       x,
 14 |       y
    |       ^ expected i32, found f64
 15 |     );
```

## Types

```
error: a float literal is not an i32
  --> err.wac:4:11
   |
 4 |   i32 n = 3.14;
   |           ^^^^ 3.14 has a fractional part
   = help: write an integer, or convert a float value with `as~` for the nearest
```

`[§wac-diag-literal-fraction-33zp6u3]` A literal with a fractional part where an integer type is expected is refused with
`span` covering the literal, `annotation: "3.14 has a fractional part"`. There is no `f64` value here to convert, since a
literal has no type of its own ([09](../2-types/09-numeric-literals.md)).

```
error: lossy cast not needed
  --> file.wac:2:11
   |
 2 |   i64 a = x as~ i64;
   |           ^^^^^^^^^ i32 -> i64 is lossless
   = help: use `as` instead: i64 a = x as i64;
```

`[§wac-diag-cast-p5fn2rk]` A lossy cast operator on a lossless conversion is refused with `span: 9`,
`annotation: "i32 -> i64 is lossless"` and `hint: "use \`as\` instead: i64 a = x as i64;"`
([24](../3-expressions/24-casts.md)).

```
error: cannot assign nullable to non-null
  --> file.wac:5:13
   |
 5 |   Point p = q;
   |             ^ expected Point, found Point?
   = help: unwrap with `!`: Point p = q!;
```

`[§wac-diag-null-h6kp9wn]` Assigning a `T?` where `T` is wanted is refused with `span: 1`,
`annotation: "expected Point, found Point?"` and `hint: "unwrap with \`!\`: Point p = q!;"`.

```
error: cannot write through const reference
  --> file.wac:8:3
   |
 8 |   p.x = 5;
   |   ^^^ p is const
```

`[§wac-diag-const-w2jm5xf]` A write through a `const` reference is refused with `span: 3` and `annotation: "p is const"`.

## Lexical errors

```
error: unterminated string literal
  --> main.wac:2:10
   |
 2 |   return "hello;
   |          ^ string literal is never closed
```

`[§wac-diag-lex-unterm-str-m9fk2wq]` An unterminated string is a `lex` error pointing at its opening quote.

```
error: unterminated block comment
  --> main.wac:2:3
   |
 2 |   /* oops, forgot to close
   |   ^ block comment is never closed
```

`[§wac-diag-lex-unterm-comment-r4jn8xq]` An unterminated block comment is a `lex` error pointing at its `/*`.

Neither runs silently to the end of the file.

## Parse errors

```
error: unexpected token
  --> main.wac:5:11
   |
 5 |   i32 x = ;
   |           ^ expected expression
```

`[§wac-diag-parse-unexpected-q3kn8wp]` A token where none of its kind can stand is reported with what was expected.

```
error: expected ';'
  --> main.wac:3:16
   |
 3 |   i32 x = 5 + 2
   |                ^ expected ';' after statement
 4 |   i32 y = 3;
```

`[§wac-diag-parse-missing-semi-r7jm4xf]` A missing `;` is reported at the end of the statement that lacks it, not at the next
token.

```
error: expected '}'
  --> main.wac:7:1
   |
 2 | export i32 foo() {
   |                   - block opened here
...
 7 |
   | ^ expected '}' to close block
```

`[§wac-diag-parse-missing-brace-w5hd2jk]` A missing `}` is reported with the line that opened the block.

```
error: expected ')'
  --> main.wac:3:19
   |
 3 |   i32 x = add(1, 2;
   |                   ^ expected ')' to close argument list
```

`[§wac-diag-parse-missing-paren-k8fn3qp]` A missing `)` names the list it was to close.

```
error: expected type
  --> main.wac:2:3
   |
 2 |   foo x = 5;
   |   ^^^ unknown type 'foo'
```

`[§wac-diag-parse-bad-type-n7qm3xf]` An unknown type name is reported with `span: 3` and `annotation: "unknown type 'foo'"`.

```
error: expected field or method declaration
  --> main.wac:3:3
   |
 3 |   = 5;
   |   ^ expected type name
```

`[§wac-diag-parse-bad-struct-h9pd5wn]` A struct member that is neither a field nor a method is reported where it begins.

## Soundness

Every program error is a diagnostic before any code is emitted; a module the engine rejects is a compiler bug, never the
program's fault ([26](../3-expressions/26-errors-and-results.md)).
