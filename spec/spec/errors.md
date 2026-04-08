## Error reporting

The type checker emits structured errors with source location (file, line,
column), the relevant source fragment, and an explanation.

### Format

```
error: <message>
  --> <file>:<line>:<col>
   |
 N |   <source line>
   |   <underline> <explanation>
   = help: <suggestion>
```

### Examples

### Required CompileError fields

```typescript
type CompileError = {
  message: string;
  file: string;
  line: number;
  col: number;
  phase: "lex" | "parse" | "resolve" | "typecheck";
  span: number;            // number of source characters to underline
  annotation?: string;     // text after the underline (e.g. "expected i32, found f64")
  hint?: string;           // help text (e.g. "use `as!` for checked conversion")
};
```

### Diagnostic spec tags

Each tag below specifies the exact diagnostic the compiler must emit,
including span width, annotation text, and help text where shown. These
must be present on the `CompileError` objects returned by `wacCompile`,
not just in formatted output.

`[§wac-diag-bool-r8kn4wp]` Given:

```wac
// err.wac
export i32 bad(i32 x) {
  if (x) { return 1; }
  return 0;
}
```

The compiler must emit a `CompileError` with `span: 1`,
`annotation: "expected bool, found i32"`,
`hint: "use a comparison: if (x != 0) { ... }"`. Rendered:

```
error: condition must be bool
  --> err.wac:3:7
   |
 3 |   if (x) { return 1; }
   |       ^ expected bool, found i32
   = help: use a comparison: if (x != 0) { ... }
```

`[§wac-diag-assign-j3qm7xf]` Given `i32 n = 3.14;` at line 4:

The compiler must emit `span: 4`, `annotation: "expected i32, found f64"`,
`hint: "use \`as!\` for checked conversion or \`as~\` for truncation"`. Rendered:

```
error: type mismatch in assignment
  --> err.wac:4:11
   |
 4 |   i32 n = 3.14;
   |           ^^^^ expected i32, found f64
   = help: use `as!` for checked conversion or `as~` for truncation
```

`[§wac-diag-cast-p5fn2rk]` Given `i64 a = x as~ i64;` at line 2:

The compiler must emit `span: 9`, `annotation: "i32 -> i64 is lossless"`,
`hint: "use \`as\` instead: i64 a = x as i64;"`. Rendered:

```
error: lossy cast not needed
  --> file.wac:2:9
   |
 2 |   i64 a = x as~ i64;
   |           ^^^^^^^^^ i32 -> i64 is lossless
   = help: use `as` instead: i64 a = x as i64;
```

`[§wac-diag-null-h6kp9wn]` Given `Point p = q;` where q is `Point?`:

The compiler must emit `span: 1`, `annotation: "expected Point, found Point?"`,
`hint: "unwrap with \`!\`: Point p = q!;"`. Rendered:

```
error: cannot assign nullable to non-null
  --> file.wac:5:13
   |
 5 |   Point p = q;
   |             ^ expected Point, found Point?
   = help: unwrap with `!`: Point p = q!;
```

`[§wac-diag-const-w2jm5xf]` Given `p.x = 5;` where p is `const Point`:

The compiler must emit `span: 3`, `annotation: "p is const"`. Rendered:

```
error: cannot write through const reference
  --> file.wac:8:3
   |
 8 |   p.x = 5;
   |   ^^^ p is const
```

`[§wac-diag-wide-k4rn8wp]` When errors occur at higher line numbers, the gutter
width adjusts so the `|` characters stay aligned. The compiler must emit
`span: 7`, `annotation: "expected i32, found bool"`,
`hint: "use \`(sum > 0) as i32\` to convert"`. Rendered:

```
error: return: expected i32, found bool
   --> algo.wac:47:10
    |
 47 |   return sum > 0;
    |          ^^^^^^^ expected i32, found bool
    = help: use `(sum > 0) as i32` to convert
```

`[§wac-diag-multiline-ic7x2hq]` Multi-line spans:

```
error: incompatible argument type
   --> algo.wac:12:5
    |
 12 |     i32 result = compute(
 13 |       x,
 14 |       3.14
    |       ^^^^ expected i32, found f64
 15 |     );
```

### Parse errors

`[§wac-diag-parse-unexpected-q3kn8wp]` Unexpected token:

```
error: unexpected token
  --> main.wac:5:11
   |
 5 |   i32 x = ;
   |           ^ expected expression
```

`[§wac-diag-parse-missing-semi-r7jm4xf]` Missing semicolon:

```
error: expected ';'
  --> main.wac:3:16
   |
 3 |   i32 x = 5 + 2
   |                ^ expected ';' after statement
 4 |   i32 y = 3;
```

`[§wac-diag-parse-missing-brace-w5hd2jk]` Missing closing brace:

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

`[§wac-diag-parse-missing-paren-k8fn3qp]` Missing closing paren:

```
error: expected ')'
  --> main.wac:3:19
   |
 3 |   i32 x = add(1, 2;
   |                   ^ expected ')' to close argument list
```

`[§wac-diag-parse-bad-type-n7qm3xf]` Invalid type. The compiler must emit
`span: 3`, `annotation: "unknown type 'foo'"`. Rendered:

```
error: expected type
  --> main.wac:2:3
   |
 2 |   foo x = 5;
   |   ^^^ unknown type 'foo'
```

`[§wac-diag-parse-bad-struct-h9pd5wn]` Struct syntax error:

```
error: expected field or method declaration
  --> main.wac:3:3
   |
 3 |   = 5;
   |   ^ expected type name
```

The compiler returns an array of diagnostics — each with file, line,
column, span length, message, and optional help text.

Each `CompileError` must carry span, annotation, and help fields where
specified by the diagnostic spec tags below. These fields are populated by
the compiler phases (lex, parse, resolve, typecheck) — not added after the
fact by a formatting layer. A diagnostic formatter can render them, but the
structured data must originate from the compiler itself.

### Soundness guarantee

The wac compiler must catch all type errors and produce well-formed WasmGC
bytecode. If the compiler emits a binary, that binary must pass wasm validation
— a wasm validation error is always a compiler bug, never a user error.

`[§wac-sound-k3fn9wp]` Any `.wasm` binary produced by the compiler must be
accepted by a conforming WasmGC runtime (V8/Deno/Chrome). A validation
rejection is a compiler bug.
