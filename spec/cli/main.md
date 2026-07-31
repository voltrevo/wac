## wacx — unified CLI

Implemented in `atoms/wac/wacx.ts`, with `atoms/wac/wacxMain.ts` as the entry point. Run it with
`deno task wacx` or `deno run -A atoms/wac/wacxMain.ts`.

Every capability is injected — file reads and writes, stdout, stderr — so the CLI is tested over an
in-memory filesystem with no process involved. `wacxMain` is the only part that touches `Deno`, and
`wacx` returns an exit code rather than calling `exit`, which is what makes that possible.

### Exit codes

| code | meaning |
|---:|---|
| 0 | success |
| 1 | a compile error, or a usage error |
| 2 | the program compiled, ran, and trapped |

`[§wac-cli-run-7jnq2mv]` A trap is distinguished from a compile failure because a script needs to
tell "did not compile" from "ran and did something wrong".

Warnings print on every command and never change the exit code.
`[§wac-cli-usage-3nkq8wj]` A warning nobody sees is not a warning, so they are not held back for
`check`.

### Commands

```sh
wacx check  main.wac          # type-check only, report errors
wacx run    main.wac fn args   # compile + instantiate + call fn
wacx compile main.wac          # write main.wasm
wacx bindgen main.wac          # write main.wac.ts
```

### check

Type-checks the entry file and its import graph. Prints structured diagnostics
(see [../spec/errors.md](../spec/errors.md)) to stderr. Exits 0 if no errors,
1 otherwise.

`[§wac-cli-check-4mkq8wp]` A valid file prints nothing. A broken one names the file and the line. An
error in an *imported* file is reported, since the graph is walked — and the walk lexes rather than
pattern-matching the text, so an import specifier inside a comment cannot send it looking for a file
that does not exist. A missing file is a usage error that names the path.

### run

Compiles the entry file to wasm, instantiates it, and calls the named exported
function with the given arguments. Prints the return value to stdout.

```sh
wacx run math.wac gcd 48 18
# output: 6
```

`[§wac-cli-run-7jnq2mv]` That example is a test.

Arguments are coerced by the parameter's **declared type**, not guessed from the text: an `i64` takes
a BigInt and a `bool` accepts `true` or `1`. A `string` parameter takes the argument exactly as
written, which is the whole point of a command line — `wacx run greet.wac greet world` prints
`hi world`. `[§wac-cli-run-7jnq2mv]` A value that cannot be coerced
is a usage error naming it.

A `string` return prints as itself, an array as its space-separated elements, and a `void` function
prints nothing. `[§wac-cli-run-7jnq2mv]` A wrong function name lists what the module does export; a
wrong argument count shows the signature.

### compile

Compiles the entry file and writes a `.wasm` binary beside it — `main.wac` gives `main.wasm` — and
prints the path it wrote. `[§wac-cli-compile-9wkn3pq]`

### bindgen

Generates a `.ts` file of typed wrapper functions beside the source — `main.wac` gives
`main.wac.ts` — and prints the path. `[§wac-cli-bindgen-5tqm7wn]`

See [../spec/bindgen.md](../spec/bindgen.md) for type mapping and output
examples.

## Compiler architecture

```
wacLex        — source string -> token array
wacParse      — tokens -> AST
wacResolve    — entry path + readFile cap -> symbol table
                (cycle-safe depth-first import walk; assigns mangled function
                indices)
wacTypeCheck  — symbol table + AST -> validated (or errors)
                (full type system: primitives, refs, nullability, const,
                subtyping, struct methods, naming collisions)
wacEmitFunc   — function + symbol table -> wasm bytecode
                (GC instructions: struct.new, struct.get, struct.set,
                array.new, array.get, array.set, array.len, ref.cast,
                ref.test, ref.is_null, ref.as_non_null, ref.i31, i31.get_s)
wasmBuildBin  — symbol table + bytecode -> .wasm binary
                (type section with GC types, function section, export section,
                code section, GC type definitions)
wacCompile    — entry path + cap -> WacCompiled
                (wires all of the above)
wacInstance   — WacCompiled -> live JS object
                (instantiates wasm, wraps exports)
wacBindTs     — WacCompiled -> standalone .ts with typed wrappers
```

### Compiler types

```typescript
export type WacParam    = { name: string; type: string };
export type WacExport   = { name: string; params: WacParam[]; ret: string };
export type WacCompiled = { wasm: Uint8Array; exports: WacExport[] };
```

### Two-pass compilation

**Pass 1 — symbol collection (wacResolve).** Walk the import graph depth-first,
visiting each file at most once (cycle-safe). Parse function signatures and
struct declarations. Build a flat symbol table with mangled names.

**Pass 2 — code generation (wacEmitFunc + wacTypeCheck).** Compile each function
body with the full symbol table in hand. Struct methods are compiled as regular
functions with the struct ref as first parameter.

### Wasm binary sections emitted

- Type section (id=1): GC struct types, array types, function signatures
- Function section (id=3): maps each function to its type index
- Export section (id=7): exported function names + indices
- Code section (id=10): one entry per function with GC instructions
- No memory section (no linear memory in v1)
