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

`[§wac-diag-bool-1tayrxk]` Given:

```wac
// err.wac
export i32 bad(i32 x) {
  if (x) { return 1; }
  return 0;
}
```

Output:

```
error: condition must be bool
  --> err.wac:3:7
   |
 3 |   if (x) { return 1; }
   |       ^ expected bool, found i32
   = help: use a comparison: if (x != 0) { ... }
```

`[§wac-diag-assign-uf068k1]` Given `i32 n = 3.14;` at line 4:

```
error: type mismatch in assignment
  --> err.wac:4:11
   |
 4 |   i32 n = 3.14;
   |           ^^^^ expected i32, found f64
   = help: use `as!` for checked conversion or `as~` for truncation
```

`[§wac-diag-cast-agtm7l9]` Given `i64 a = x as~ i64;` at line 2:

```
error: lossy cast not needed
  --> file.wac:2:9
   |
 2 |   i64 a = x as~ i64;
   |           ^^^^^^^^^ i32 -> i64 is lossless
   = help: use `as` instead: i64 a = x as i64;
```

`[§wac-diag-null-cugwock]` Given `Point p = q;` where q is `Point?`:

```
error: cannot assign nullable to non-null
  --> file.wac:5:13
   |
 5 |   Point p = q;
   |             ^ expected Point, found Point?
   = help: unwrap with `!`: Point p = q!;
```

`[§wac-diag-const-ig80qzg]` Given `p.x = 5;` where p is `const Point`:

```
error: cannot write through const reference
  --> file.wac:8:3
   |
 8 |   p.x = 5;
   |   ^^^ p is const
```

`[§wac-diag-wide-3pp96ku]` When errors occur at higher line numbers, the gutter
width adjusts so the `|` characters stay aligned:

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

`[§wac-diag-parse-bad-type-m4jw9rk]` Invalid type:

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

### Soundness guarantee

The wac compiler must catch all type errors and produce well-formed WasmGC
bytecode. If the compiler emits a binary, that binary must pass wasm validation
— a wasm validation error is always a compiler bug, never a user error.

`[§wac-sound-k3fn9wp]` Any `.wasm` binary produced by the compiler must be
accepted by a conforming WasmGC runtime (V8/Deno/Chrome). A validation
rejection is a compiler bug.
