## wacx — unified CLI

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

### run

Compiles the entry file to wasm, instantiates it, and calls the named exported
function with the given arguments. Prints the return value to stdout.

```sh
wacx run math.wac gcd 48 18
# output: 6
```

### compile

Compiles the entry file and writes a `.wasm` binary.

### bindgen

Generates a self-contained `.ts` file with the wasm binary base64-encoded
inline and typed wrapper functions.

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
