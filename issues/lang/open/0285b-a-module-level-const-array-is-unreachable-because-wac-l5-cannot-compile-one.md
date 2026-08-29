# 0285b — a module-level `const` array is unusable in wacc, because wac-L5 cannot compile one

- **Status:** open — the name resolves now and the refusal is legible; honouring an initialiser is not done
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-28
- **Kind:** missing feature — in the bootstrap ladder, not in wac
- **Symptom:** the whole build refuses, or the module traps

## What

`packages/wacc` cannot hold a generated lookup table, because the only shape a table can take at
module scope is one the top rung of the bootstrap ladder does not implement. wac itself is fine with
it — `packages/unicode/src/printable.wac` is exactly this and compiles — but that package is not in
wacc's import graph, so wac-L5 never sees it.

## Reproduction

Put a `const` array at module scope in any file `packages/wacc/src/api.wac` reaches, then build:

```wac
const i32[] LIT_KEYS = i32[](32, 160, 174);
export bool f(i32 cp) { return cp <= LIT_KEYS[LIT_KEYS.len() - 1]; }
```

    $ ./bootstrap.sh --host v8 --no-install
    wac-L5 refused 10 things in wacc
      !! wac-L5: line 32: unexpected token . before len ( )
      !! wac-L5: line 33: unexpected token i32 before found = 0
      !! wac-L5: line 36: unexpected token [ before mid ] <=

Dropping `const` gets past the parser and fails later and worse:

```wac
i32[] T = i32[](1, 2, 3);
export i32 main() { return T[1] + T.len(); }
```

    $ bootstrap/rust-ladder/target/release/ladder t.wac
    thread 'main' panicked at src/main.rs:87:46:
    the module trapped

## This is documented, and the documentation predicted it exactly

`bootstrap/README.md`, under the shortcuts wac-L5 takes:

> **A module-level `const` is refused**, and refused badly: `const` is not consumed at the top level,
> so `const u32[] K = …` is read as a global named `u32` and `K` is lost, which surfaces as an
> unresolved name wherever it is used. 251 declarations in the corpus are written this way and
> **none in wacc or `core`**, which is exactly why it went unnoticed. Doing it properly needs a
> `start` section and a function per initialiser, because wac's initialiser is an expression and
> wasm's global takes a constant.

So the gap was known and latent. What is new is that it is now *reachable*: nothing in wacc's graph
had ever wanted a table.

## What wanted one

`design/lang/0013` D3 — the rule for what a literal may contain. Six of its seven categories need 29
disjoint ranges between them and fit in a function of comparisons, which is what
`packages/wacc/src/litchars.wac` is. The seventh, `Cn` (unassigned), needs **707** ranges and a
generated table, and that is what hit this.

`Cn` is deferred for reasons of its own, written down in that file's header — chiefly that whether a
code point is assigned is a fact about the compiler's Unicode tables rather than about the program.
So nothing is blocked today. This is filed because the *next* table will hit the same wall, and
because a compiler that cannot hold a lookup table is a constraint worth knowing before designing
around it rather than after.

## What it would take

The README says: a `start` section and a function per initialiser. That is wac-L5's work — the rung
written in wac-L4 — and it is the sort of change the fixed-point check covers well, since a wrong
initialiser shows up as a compiler that cannot rebuild itself.

## Not a wac bug

`wacc` compiles a module-level `const` array correctly; `packages/unicode/src/printable.wac` is 733
ranges of exactly this shape and is used by `packages/box`'s `wc`. The language is fine. The rung
that has to compile the compiler is what is missing it, which is why this is filed against the
ladder rather than against the checker or the emitter.

## Measured, and it is not about arrays — agent-b, 2026-08-29

The title says *array*, and the reproduction uses one. Neither is the boundary. Put each piece
through wac-L5 on its own — `deno run -A bootstrap/ts/l5run.ts <file>`:

| source | wac-L5 |
| --- | --- |
| `const i32[] T = i32[](1,2,3);` and never read it | **accepted** |
| `const i32 N = 7;` and never read it | **accepted** |
| `const i32[] T = …; return T[1];` | refused at `[` |
| `const i32[] T = …; return T.len();` | refused at `.` |
| `const i32 N = 7; return N;` | refused at `;` |
| `const i32 N = 7; return N + 1;` | refused at `+` |
| `return ZZZ;` — a name nothing declares | refused at `;`, **identically** |
| `i32[] T = i32[](1,2,3); return T[1];` — a local | accepted |
| `const i32 N = 7;` *inside* a function | accepted |

So the gap is **module-level `const` bindings of any type**, not arrays: a plain `const i32` is as
unusable as a table. And the last two rows say what the mechanism is — a declared module-level const
fails exactly the way an undefined name does, so wac-L5 parses the declaration, **drops it**, and
then meets an unknown name. Its parser reports that as a token error rather than as an unknown name,
which is why the messages in the reproduction above point at `.len(`, at a local's type and at a `[`:
every one of them is the token *after* the name, and none of them is the const.

### What this changes about fixing it

**The declaration being accepted is the first thing to fix and the cheapest.** wac-L5 takes a
`const` it cannot honour and says nothing, so the failure surfaces somewhere else entirely. Refusing
it outright would cost a few lines and is safe today: **no file in `packages/wacc/src` declares a
module-level `const`** — the constraint has been worked around for so long that `kinds.wac` spells
its constants as `i32 kGt() { return 46; }`, which is the shape this issue's absence produced.

**Then the two halves are not the same size.** A scalar `const` needs no wasm global at all — its
value is known at compile time and can be inlined at each use, which is a symbol-table entry and a
substitution. An array needs a real global plus a start function to fill it, which is the
`i32[](1,2,3)` initialiser problem and the reason the non-`const` version panics the Rust ladder.
Anyone doing this should take the scalar half first: it is most of the ergonomic win and none of the
initialiser risk.

**And do `issues/lang/0287b` first.** The step above — "record the const in the symbol table" —
would make this *worse*, not better. wac-L5 emits every global as zero and skips its initialiser, so
resolving the name would turn today's parse error into a silent `0`, which is the one failure a
`const` cannot recover from: the program cannot assign it. Measured and demonstrated there.

**Not attempted here.** `bootstrap/boot/l5.l4` is about four thousand lines of wac-L4 and every rung below has to
keep building it; that is bootstrap surgery rather than a sitting, and it wants to be somebody's
whole afternoon rather than the tail of somebody else's.


## Half of it is fixed: `const` is consumed, so the name exists — agent-b, 2026-08-29

`bootstrap/boot/l5.l4` did not consume `const` at module scope, so `parse_type` took `const` for the
type and the *name* for the type's name. `const u32[] K = …` registered a global called `u32` and
lost `K`. That is what the measured table above was really showing: every row that *reads* the name
is refused and every row that only declares it is accepted, because the declaration parses into
something and the name is simply not there.

Both passes walk the declaration and **only `collect` registers**, which is worth knowing before
trying this: consuming `const` in the emitting pass alone changes nothing observable.

    const i32 N = 0;  export i32 f() { return N; }      before: unexpected token ; before }
                                                         after: 0

    const i32[] T = i32[](1,2,3); … return T[1];        before: line 2, unexpected token [ before 1
                                                         after: line 1, refused for the initialiser

The second is still refused, and correctly: this rung honours no initialiser but `= 0` — a global
emits as a mutable zero and its initialiser is not run, `issues/lang/0287b`. What changed is that the
refusal names the declaration that cannot be honoured, on its own line, instead of surfacing as a
parse error at the first *use* two lines away. `const` is ignored rather than enforced, which is
right for a rung whose globals are mutable zeroes anyway: enforcing immutability would be a promise
about a value it does not carry.

Cases in `bootstrap/ts/l5.test.ts` beside the other three global ones.

## What is still open

The original want — a **table**. `const i32[] LIT_KEYS = i32[](32, 160, 174);` needs the initialiser
to run, which is the `start` section and a function per initialiser that `bootstrap/README.md`
predicted. Nothing above touches that; it makes the wall legible rather than moving it.
