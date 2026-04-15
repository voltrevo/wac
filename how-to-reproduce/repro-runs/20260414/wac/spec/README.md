# wac — A C-Family Language for WasmGC

wac is a readable surface syntax for WebAssembly GC. It maps faithfully to
WasmGC constructs — structs, arrays, references, subtyping, null — with
C-family syntax. No hidden magic; every feature compiles to obvious wasm
instructions.

Targets real .wasm binary format with GC extensions — output runs via
WebAssembly.instantiate in Deno. No custom VM or interpreter. The compile-to-run
loop: wac source -> lex -> parse -> type check -> emit wasm bytecode -> assemble
binary -> instantiate and call.

## Language spec

- [spec/types.md](spec/types.md) — primitive types, reference types, nullability
- [spec/variables.md](spec/variables.md) — declarations, const, mutability
- [spec/structs.md](spec/structs.md) — struct types, fields, methods, construction, subtyping
- [spec/arrays.md](spec/arrays.md) — GC arrays, construction, defaults
- [spec/casts.md](spec/casts.md) — numeric casts (as/as!/as~), reference casts (is/as)
- [spec/operators.md](spec/operators.md) — type rules, precedence, compound assignment
- [spec/control.md](spec/control.md) — if/else, while, for, do-while, break/continue, switch, ternary
- [spec/functions.md](spec/functions.md) — declarations, exports, void, return types
- [spec/imports.md](spec/imports.md) — file-based imports, renaming with as
- [spec/naming.md](spec/naming.md) — naming collisions, shadowing rules
- [spec/funcrefs.md](spec/funcrefs.md) — function references, higher-order functions
- [spec/grammar.md](spec/grammar.md) — formal EBNF grammar
- [spec/strings.md](spec/strings.md) — string type, literals, indexing, concatenation
- [spec/bindgen.md](spec/bindgen.md) — TypeScript bindgen: type mapping, output examples
- [spec/errors.md](spec/errors.md) — structured error reporting format
- [spec/buffer.md](spec/buffer.md) — Buffer: growable byte buffer example with spec tests
- [spec/linkedlist.md](spec/linkedlist.md) — LinkedList: singly-linked list example with spec tests

## CLI

- [cli/main.md](cli/main.md) — wacx: unified CLI (check, run, compile, bindgen)

## Verification

- [examples.md](examples.md) — example programs and expected outputs
- [done.md](done.md) — completion criteria

## For later

- **Pipeline operator** — `x |> f(_, y)` with explicit `_` placeholder
- **Slices / sub-arrays** — views into arrays without copying
- **Enum sugar** — `enum Shape { Circle(f64), Rect(f64, f64) }` generating
  struct hierarchies automatically
- **Better host interop** — passing GC refs across the JS boundary
- **Bindgen JSON sugar** — automatic JSON<->struct/array serialization in
  generated TypeScript wrappers
- **Match expression** — exhaustive pattern matching on enums/types
- **Linear memory** — `mem.i32[addr]` / `mem.u8[addr]` syntax for direct
  wasm memory access, `memory` declarations, data segments
- **Unsigned types** — `u32`, `u64` as distinct types with unsigned operators
- **Generics** — `struct List<T>`, `T[] map<T, U>(T[] arr, fn[U(T)] f)`
- **Host function imports** — `import { readFile } from "host";` passing
  functions in at the top level
- **Closures** — function references that capture variables from enclosing scope
- **Immutable globals** — module-level constants, compile-time evaluated
- **Abstract ref types** — `structref`, `arrayref`, `eqref` as parameter types
- **Bulk array ops** — `array.copy`, `array.fill` exposed as methods
- **Final structs** — prevent subtyping with `final` keyword
- **Type aliases and type algebra** — `type Comparator = fn[bool(i32, i32)]`
- **JS + d.ts bindgen** — emit `.js` + `.d.ts` instead of `.ts`
