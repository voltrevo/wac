# 0132 — wacc lets `!pending.wait()` through and emits invalid wasm

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-c
- **Date:** 2026-08-15
- **Kind:** bug
- **Symptom:** invalid wasm
- **Fixed in:** this commit

The reference rejects this and wacc does not, so a program that cannot load is built without a word
of complaint. Found by writing it: `Cli.writeFile` answers `Pending<Change>`, and I wrote it as
though it answered `Pending<bool>`.

## Reproduction

```wac
import { Cli, Core } from "../../platform/src/platform.wac";

export i32 main(Core core, Cli cli) {
  if (!cli.writeFile("x", u8[0]()).wait()) { return 1; }
  return 0;
}
```

The reference:

```
'!' requires bool, got Change
```

wacc compiles it without a diagnostic, and the engine refuses the module:

```
CompileError: WebAssembly.Module(): Compiling function #45:"main" failed:
  i32.eqz[0] expected type i32, found call of type (ref null 13)
```

`deno task app:build` uses wacc, so this is what a caller actually meets — an engine error naming a
function index and a type index, at load time, with no source position.

## What is *not* wrong

**`!` on a struct is checked**, and wacc gets both of these right — it refuses them exactly as the
reference does:

```wac
struct S { i32 n; }
S s = S(1);
if (!s) { }                    // wacc: refused

struct Box<T> { T v; T get(const this) { return this.v; } }
if (!Box<S>(S(1)).get()) { }   // wacc: refused
```

So this is not the unary operator's type rule in general, and not generic method returns in general.
It is **`Pending<T>.wait()` specifically**: wacc appears not to resolve what that answers, so the
operand arrives untyped and the rule has nothing to reject.

## Why it is worth a number

The failure mode is the expensive one. A checker that refuses a program costs a minute; a checker
that emits invalid wasm costs however long it takes to work out that `(ref null 13)` is a `Change` —
the module names neither the type nor the line, and the obvious first suspicion is the emitter rather
than the program.

It is also a **divergence**, which is the class `packages/wacc` exists to close: the reference is the
oracle, and every place the two disagree is either a wacc bug or a reference bug. This one is wacc's.

## Notes

Whatever resolves `Pending<T>.wait()`'s return type is the place to look. `Pending` is not an ordinary
generic — the host builds it, `platform.wac` declares it, and the monomorphisations are named
`Pending$Change` and friends. A plausible shape is that wacc treats the method as returning the type
variable and never substitutes it, which would make every *use* of a `wait()` result untyped rather
than only this one — worth checking, because a wrong field access on one would be the same bug with a
quieter symptom.

## Fixed, 2026-08-15 — and the cause was not the one guessed above

The Notes were wrong about the mechanism and right about the scope. Nothing is wrong with
`Pending<T>.wait()`, with generic substitution, or with the `!` rule: wacc refuses `!` on a struct,
on an `i32`, on a generic method's return and on a `Pending<T>` reached through a funcref field, and
it agrees with the reference on all of them. What it could not do was any of that for **`Pending`
declared in another file and not imported by name**.

`api.wac`'s `checkFiles` declares, from each imported file, exactly the names the entry wrote in its
import list. That is right for what a file may *write* and wrong for what it may *reach*: `Cli`'s
fields hold `fn[Pending<T>(...)]`, so calling one answers a `Pending<T>` in a file that never named
`Pending`. Undeclared, the type had no members, `.wait()` answered nothing, and every rule downstream
of it went quiet.

Which is the wider symptom the Notes asked about, and it is worse than the `!`:

| in a file that does not import `Pending` | reference | wacc, before |
|---|---|---|
| `!cli.argCount().wait()` | `'!' requires bool, got i32` | silent |
| `string s = cli.argCount().wait();` | `type mismatch: expected string, got i32` | silent |

Almost no program imports `Pending` — there is no reason to write the name — so this was most
application code, and `packages/platform`'s whole capability surface is funcref fields answering
`Pending<T>`.

### The fix, and the thing it must not do

`closeOverSignatures` closes the wanted set over the *signatures* of what was wanted — field types,
method return and parameter types, transitively, over types that file declares. Bodies are not
walked: a local inside somebody else's method is not something the entry can reach.

The trap is that declaring the type the ordinary way would make it **nameable**, and
`Pending<i32> p = cli.argCount();` without the import is `undefined type 'Pending'` in the reference
and must stay an error. So `C.unnameable` records the reached types and `knownTypeName` refuses them:
declared for their members, absent from the scope. That is the second test in
`packages/wacc/test/checkGraph.test.ts`, and it passed before the fix as well as after — which is
what makes it a canary rather than a restatement.

Verified over the repository: `corpusCheck` puts 412 files through the whole-program checker and
reports no false alarm, and the suite is green at 3,419.
