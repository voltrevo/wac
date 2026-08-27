# `.wax` — an assembly format you can implement in an afternoon, twice

The point of this format is not expressiveness. It is that **two independent implementations should
agree byte for byte without either author being clever**. Every choice below is made to remove a
decision from the assembler.

## Shape

- **Line-oriented.** One directive or one instruction per line. No folded expressions, no nesting
  inside a line. The wasm stack machine is written out as it executes.
- `;` begins a comment and runs to end of line. Blank lines are ignored.
- Tokens are separated by runs of spaces or tabs. Leading and trailing whitespace is insignificant,
  so indentation is free and carries no meaning.
- Everything is named. `$name` never means an index; the assembler assigns indices and the source
  never states one. A number in the source is always a literal value, never a reference.
- **Case-sensitive**, and instruction names are exactly their wasm spec names (`i32.add`,
  `local.tee`, `br_if`) so that reading the format teaches nothing false about wasm.

## Order

Directives may appear in any order in the file; the assembler sorts them into wasm's section order.
Functions are numbered in **source order**, after imported functions, which is the only ordering rule
a reader has to hold.

## Directives

    type   $name  func <params...> -> <results...>

`<params...>` and `<results...>` are zero or more of `i32`, `i64`. `->` is always present. A type is
declared once and referred to by name; two types with the same shape are **not** merged, because
merging is a decision and the whole point is not to have decisions. The type section is written in
declaration order.

    import "module" "field" $name func <params...> -> <results...>

Declares an imported function. Imports are numbered before local functions, in source order. The type
is written inline rather than named, because an import's type is read once and never referred to.

    memory <pages>

At most one, and required if any load or store appears. `<pages>` is the initial size; the maximum is
left unset.

    global $name <i32|i64> <mut|const> = <literal>

Globals are numbered in source order. The initialiser is a literal, never an expression.

    data <offset> "<text>"

Bytes placed in the data section at a literal offset. The text is a double-quoted string with `\n`,
`\t`, `\\`, `\"` and `\xHH` escapes and nothing else. No name, because nothing refers to it: the
program knows the offset because it wrote it.

    export "name" func $fn
    export "name" memory

    func $name <params...> -> <results...>
      local <i32|i64> $name        ; zero or more, and they must come first
      <instructions...>
    end

**Parameters are declared on their own lines, and the `func` line names only the results.** This is
the one place the format departs from wat's shape, and it is deliberate: a parameter and a local are
then declared the same way, so the assembler builds one list and never has to parse a signature and a
body by different rules.

    func $add -> i32
      param i32 $a
      param i32 $b
      local.get $a
      local.get $b
      i32.add
    end

`param` lines must precede `local` lines, which must precede instructions. The function's type is
derived from its `param` lines and its `->` results; a matching `type` directive is created if one
does not already exist, **appended after all declared types**, so a file that declares no types at
all still assembles.

## Control flow

    block $label -> <results...>
    loop $label -> <results...>
    if $label -> <results...>
    else
    end

Every block-like construct is **named**, and `br`/`br_if` name the label rather than counting frames:

    loop $again ->
      local.get $i
      i32.eqz
      br_if $done
      ...
      br $again
    end

Counting relative depths is the single most error-prone thing about writing wasm by hand and the
single most likely place two assemblers disagree, so the format does not have it. The assembler keeps
a stack of open labels and converts a name to a depth.

`if` takes its condition from the stack, as in wasm. `$label` on an `if` names the *whole* construct,
so `br $label` from inside either arm branches to just past its `end`.

A `->` with no results after it means the block produces nothing, and that is the common case.

## Instructions

Only what has been needed so far. The list grows when something needs it, and never before.

**Constants and variables**

    i32.const <n>        i64.const <n>
    local.get $x         local.set $x       local.tee $x
    global.get $g        global.set $g

**i32 arithmetic and bitwise**

    i32.add  i32.sub  i32.mul  i32.div_s  i32.div_u  i32.rem_s  i32.rem_u
    i32.and  i32.or   i32.xor  i32.shl    i32.shr_s  i32.shr_u

**i32 comparison** — each answers 0 or 1

    i32.eqz
    i32.eq  i32.ne  i32.lt_s  i32.lt_u  i32.gt_s  i32.gt_u
    i32.le_s  i32.le_u  i32.ge_s  i32.ge_u

**Memory** — `<align>` is a power of two in bytes and `<offset>` is added to the address

    i32.load     <align> <offset>
    i32.store    <align> <offset>
    i32.load8_u  <align> <offset>
    i32.load8_s  <align> <offset>
    i32.store8   <align> <offset>
    memory.size
    memory.grow

Both operands are written out because leaving them implicit is a default, and a default is a place
two implementations can differ.

**Control and calls**

    call $fn
    return
    drop
    select
    unreachable
    nop

## What the assembler does not do

It does not validate types, fold constants, merge duplicate types, infer block results, or reorder
anything. A `.wax` file that produces an invalid module is the author's mistake, and the engine's
error is the diagnostic. This is a format for a program somebody wrote once and froze, not a
compilation target — and every one of these omissions is a decision the two implementations would
otherwise have to make identically.
