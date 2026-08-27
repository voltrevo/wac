# Plan

**A living document.** `README.md` says what this is, `NOTES.md` records what has been measured,
and this says what is going to happen next and why. Items move between the sections rather than
being deleted, so the reasoning for a decision stays next to the decision.

Status is one of **open** (agreed, not started), **doing**, **done**, **parked** (deliberately not
now, with a reason), or **question** (needs the operator).

---

## The change of purpose

Until now this was an experiment: *how big is the hand-written root of a bootstrap ladder, and is a
ladder cheaper than the 19,499-line reference?* Both have answers, and the ladder reaches wacc and
lands on the same fixed point as wac's own bootstrap.

The purpose is now **to become the way wac is bootstrapped**. That changes what matters:

- **Diagnosability over line count.** An experiment can be debugged by whoever wrote it last week.
  A bootstrap is debugged by somebody who has never seen it, at the moment it breaks a build.
- **Loud failure over clever recovery.** A shortcut that silently produces a wrong compiler is
  worse than one that refuses.
- **Stated constraints over discovered ones.** Anything the bootstrap needs *from* wacc has to be
  written down and enforced, not left as a property that happens to hold today.

The shortcuts themselves are not the problem and mostly stay — see *What stays as it is*.

---

## Now

### 1. A refusal should name its line — **open**

`struct Tok { kind; start; len; val }` carries a byte offset and never turns it into a line, so a
refusal says *what* but never *where*. Two of the instruments in `ts/` exist only to work around
this: `first_refusal.ts` finds the enclosing function by scanning the *output*, and
`bisect_real_wac.ts` binary-searches the *input*.

Counting newlines from `src` to `tstart()` is one loop. Highest value per line of change in the
repo, and it makes both instruments mostly redundant.

### 2. A refusal should stop or synchronise — **open**

`oops()` neither advances the cursor nor stops the file, so a construct the parser cannot get past
is re-reported until the output buffer fills. One missing operator produced **19,417 refusals** in
`check.wac`; the corpus census counted **2,972,653 refusal sites** from a handful of causes. The
overflow then truncates the marker itself, which is where `!! wac-L5end` comes from.

An earlier version had recovery — skip to `;` or `}` — and it was replaced by a one-liner. Restore
it, or stop the file on the first refusal. Either is better than the cascade.

### 3. A buffer should carry its own bound — **open**

`emit_room()` decides how much room a buffer has by comparing `dst` against an address:

    if (dst == realout) { return 12000000; }
    if (dst == TYPEBUF) { return 3000000; }
    if (dst == BODY) { return 1000000; }
    return 120000;

That is what caused the `realout` bug — 12 MB of room granted to a 1 MB buffer because the
comparison matched the wrong thing. Nothing anywhere asserts the buffers do not overlap either,
which is how the scratch stack came to sit exactly on `TYPEBUF`. Make a buffer a base-and-limit
pair, and assert the layout once at startup.

### 4. One seam, declared by the module — **open**

Three conventions across the rungs, and two hosts implementing each:

    wac-L1   source at 8192, `run_at(at)` answers an *address*, text runs to a NUL
    wac-L3   source at 2097152, `compile(src, out)` answers a *length*
    wac-L4   the same, same addresses
    wac-L5   the same, different addresses — 16777216 and 4194304

Six places to get a magic number wrong. The module should export its own buffer addresses as
globals so the host reads them instead of knowing them.

---

## The flattener, and what it wants from wacc — **question**

`ts/l5.ts` is 262 lines of which **191 are a linker**: resolving specifiers, concatenating in
dependency order, undoing `import { x as y }`, and renaming the colliding private declarations of
two modules. That is compiler behaviour in TypeScript, inside the trusted root, outside the
differential — the piece I would least want unwitnessed if this is the real bootstrap.

**Measured, in wacc's 18-module graph, 1,095 top-level names:**

- **15 names declared by more than one module**, and they are two different things.
  - **Ten are one fact.** `files.wac` re-exports five functions from `path.wac` and `coretext.wac`
    as pure identity forwarders — `export bool isBuiltinSpec(string s) { return
    coreIsBuiltinSpec(s); }`. That is 5 collisions *and* all 5 aliases, since the aliases exist
    only so a wrapper can reach what it wraps. `path.wac`'s header says it was extracted *from*
    `files.wac`, so these are compatibility leftovers. Exactly **three import lines in the whole
    corpus** use them; `isBuiltinSpec`'s wrapper is imported by nobody.
  - **Nine are copy-paste that has drifted.** `endsWith` has two *different* implementations, one
    byte-wise in `check.wac` and one using `slice` in `bindgen.wac`. `orVoid` is byte-identical in
    both its homes. Also `startsWith`, `trimmed`, `tokenLine`, `tokenCol`, `templateOf`,
    `bindTypeParams`, `isRefType`.
- **5 aliased imports**, all in `files.wac`, all part of the ten above.

**The change to wacc is about 15 edits**: delete 5 forwarders, repoint 3 import lines, dedupe or
rename 9 helpers, rename `lex.wac`'s private `emit`.

**What it buys.** The flattener's 191 lines are `gather` 32 and `resolve` 17 and `type Mod` 9 —
all irreducible host work — plus `flatten` 56 (collision policy), `topLevelDecls` 40 (detection)
and `unalias` 37 (renaming).

| | lines | if a collision is reintroduced |
|---|---|---|
| today: rename silently | 191 | handled, invisibly |
| **detect and refuse** | **~114** | the build stops and says which name |
| assume clean | ~74 | silently produces a wrong compiler |

**Take the middle.** Collision-freedom is not a property anyone keeps by accident, and the failure
mode of *assume clean* is the worst outcome this project has: a compiler that builds and is subtly
wrong. Keeping detection costs 40 lines and turns a silent behaviour into a stated constraint with
a check behind it.

**Open, because it is not ours to decide alone:** the wacc edits are in a public repo shared with
other agents, and they have to land *before* the flattener change or the build breaks in between.
Options are to prepare it as a patch to propose, or to do the four items above first, which are
self-contained here.

**If it goes ahead**, the constraint belongs in wacc's README as a rule — *a module-private name
must be unique across a program* — with the flattener's refusal as its enforcement.

---

## The shape of the ladder — **parked, with the reasoning**

Reflections, not planned work. Recorded so they are not re-derived.

**Could L1 be a compiler rather than an interpreter, deleting L2?** `boot/l1.l0` is 1,630
instructions: 785 the evaluator, and 845 reader, symbols, objects, allocation, fixnums — the
second group you need either way. An emitter for the same syntax needs a symbol table and a text
buffer, which I would guess at 400–450 rather than 785. That would make the hand-written rung
smaller *and* delete a language and its 200-line compiler; L3's compiler would then be written in
s-expressions and cost maybe 40% more lines. Roughly 1,620 to reach L3 instead of 2,288.

**Parked anyway, and not on size.** The interpreter is what makes the hand-written rung — the one
rung with no second witness — testable by hand. There is a REPL in this repo because there is an
interpreter. You can poke a wrong evaluator interactively; you cannot poke a wrong emitter.

**Could L2 be skipped on its own?** It buys a language that exactly one program is written in. On
lines it is close to a wash; on concepts it is one fewer syntax to hold in your head. Worth doing
only alongside the question above, not by itself.

**L4 → L5 is the biggest jump at 2.9×**, and the only place worth *adding* a rung — except that
L5's shape is the one we do not control, so an extra rung would not shrink it.

---

## What stays as it is

Deliberate, and not to be tidied up:

- **`import` is ignored** and the host flattens. Resolving a path is a file read and no wac-L4
  program can do one.
- **No type checker.** wasm validation is one, and it is total.
- **`?` is dropped** except where it decides a sized array's default element.
- **`const` is read and discarded** on locals, parameters and `this` — it is a permission, and
  violating one is an error this rung does not diagnose anyway.
- **A module-level `const` is refused.** 251 declarations in the corpus are written that way and
  **none in wacc or `core`**. wac-L5 is the minimum that compiles wacc; a feature added here has to
  be paid for in the rung below too.

Smaller confusions, noted but not worth a change on their own: `TY_NULL` is a struct type created
solely to occupy an index so `types[TY_NULL]` does not trap; `strty`/`strbase` is a type
deliberately never declared with `tyname` silently remapping it; `overflowed` stops the parser by
assigning `tp = ntok`, which is control flow disguised as data.

---

## Done

- The ladder reaches wacc, and the wacc it builds compiles wac.
- All 252 of wac's `spec/cases` come out as their expectations say.
- The same fixed point as wac's own TypeScript bootstrap, byte for byte: `W1 == X1 == 681,417`.
- Two hosts — Deno, and V8 embedded in Rust — producing identical wac-L0, with a test.
- Two benchmarks, one per host, including the assemble step.
