# Plan

**A living document.** `README.md` says what this is, `NOTES.md` records what has been measured,
and this says what happens next and why. Items move between sections rather than being deleted, so
the reasoning for a decision stays next to the decision.

Status is one of **open** (agreed, not started), **doing**, **done**, **parked** (deliberately not
now, with a reason), or **question** (needs the operator).

---

## The purpose

Until now this was an experiment: *how big is the hand-written root of a bootstrap ladder, and is a
ladder cheaper than the 19,499-line reference?* Both have answers, and the ladder reaches wacc and
lands on the same fixed point as wac's own bootstrap.

The purpose is now **to become the way wac is bootstrapped**. That changes what matters:

- **Diagnosability over line count.** An experiment is debugged by whoever wrote it last week. A
  bootstrap is debugged by somebody who has never seen it, at the moment it breaks a build.
- **Loud failure over clever recovery.** A shortcut that silently produces a wrong compiler is
  worse than one that refuses.
- **Stated constraints over discovered ones.** Anything the bootstrap needs *from* wacc has to be
  written down and enforced, not left as a property that happens to hold today.
- **No privileged runtime.** A bootstrap that works under one engine has a dependency nobody chose.

---

## Acceptance criteria

The finish line, so that improvements have somewhere to stop.

**1. The unified `wac` binary is reachable with no Deno anywhere in the path.** Today
`tools/seed.sh --bootstrap` runs `deno run packages/platform/native.ts` — the TypeScript reference
— for a clone that has no binary yet. The criterion is that it can run the ladder instead.

**2. Three independent hosts, each self-sufficient, all agreeing byte for byte.**

    rust-ladder   V8 embedded in Rust     needs no JavaScript runtime at all
    node          Node alone              node 22 runs wasm GC — verified
    deno          Deno alone              what exists today

Each builds wacc from source by itself, and the three artefacts are identical. This extends the
existing two-host comparison to three, and it is the check that keeps them honest.

**3. The bootstrap runs in a browser** — no filesystem, no host API, sources supplied by the page.

**4. All of that holds while the fixed point does:** `W1 == X1`, the same wacc that wac's own
bootstrap reaches.

---

## The port: TypeScript to JavaScript — **doing**

**Why.** TypeScript needs a TypeScript-aware runtime or a build step. Deno has one; Node does not
without a loader, and a browser does not at all. Plain JavaScript runs in all three, and the Rust
host needs none of it. Keeping TypeScript means either a build step inside the bootstrap — the kind
of dependency a bootstrap exists to avoid — or two of the three hosts being second class.

**What it costs.** Type checking over roughly 2,672 lines. Keep it with JSDoc annotations and
`deno check` or `tsc --checkJs` as a **lint**, never as a build step: the code has to run unchanged
from source in every host.

**The shape.**

    js/                portable — no host API anywhere in here
      assemble.js      the wac-L0 assembler
      ladder.js        the rungs; takes source *strings*, answers wac-L0 text or wasm bytes
      flatten.js       the module graph, given a `read(path)` callback
    hosts/
      deno.js          Deno.readTextFile, Deno.args
      node.js          node:fs, process.argv
      browser.js       fetch, or sources the page already has
    rust-ladder/       V8 embedded; uses none of the above

**The rule that makes it work: the portable core never touches a file.** `flatten` takes a reader
callback rather than a path. That is the discipline a browser forces anyway, which is why the
browser then costs almost nothing — and it is the separation the ladder already has between a rung
and its host.

**Order.** Before the local fixes below, because a fix landed in TypeScript is a fix to be ported.

---

## The browser — **done**

Mostly follows from the port. What has to be true:

- **No filesystem.** The page supplies the rung sources — fetched, or bundled at build time. The
  portable core already takes strings, so this is a shim.
- **wasm GC.** Available in current browsers; the same feature Node 22 was verified to have.
- **Memory.** wac-L5 asks for 512 pages, 32 MiB. Unremarkable.
- **No `Deno.*`, no `node:*`.** Which is the port's whole point.

**Done.** `hosts/browser.js` is `fetch` and nothing else; `web/index.html` fetches the five rung
sources, builds every rung in the page and runs the program. `ts/browser_test.ts` drives it under
Playwright's Chromium with `--dump-dom` and checks the answer — 819 ms, and it skips when that
browser is not on the machine.

Two things worth keeping from doing it:

- **`canonical` being optional earned its keep.** A browser has no notion of a real path, so it
  supplies only `read`, and a diamond is visited twice rather than once. That costs a little work
  and changes no answer.
- The browser found a bug in the page within one run: `new URL(p, "../")` is not a thing, a base
  has to be absolute. `import.meta.url` is the one absolute URL a module always has.

---

## The unified wac binary — **doing**

`tools/seed.sh --bootstrap` exists for a clone with no binary, and today it reaches for Deno. To
replace that, the Rust host needs:

1. ~~**A `build` mode.**~~ **Done.** `-o FILE` in all three hosts, plus `--flat` and `--dump-flat`
   in the Rust one.
2. ~~**The flattener, in Rust.**~~ **Done.** `rust-ladder/src/flatten.rs`, hand-written parsers
   rather than a regex crate, so that somebody comparing it against `js/flatten.js` reads two
   statements of one rule. It agrees byte for byte — on the fixture, as a test, and on wacc's whole
   18-module graph. The Rust host now goes from wacc's *source tree* to 659,236 bytes of wasm in
   828 ms with no JavaScript anywhere, identical to what Deno and Node build.

   It cost two bugs, both from the port dropping something the regular expression said. The names
   in an import may span lines, and `\{([^}]*)\}` crosses a newline where a line-by-line scan does
   not. And `from` has to be *required* between the brace and the quote — without it, a line merely
   starting with `import` matched a string thousands of lines away.
3. ~~**To pin down what the seed actually is.**~~ **Answered.** `native/v8/build.rs` says it: the
   file is named `wacc.wasm` for historical reasons and is the whole CLI, produced by

       wac task app:native packages/wac/src/wac.wac --allow-read --allow-write -o .../seed/wacc.wasm

   **And a compiled module is not yet that artefact.** `packages/platform/native.ts` — the path
   `seed.sh --bootstrap` takes — compiles, then builds a manifest and appends it as a `wac.manifest`
   *custom section* (`withManifestSection`, wasm section id 0). So replacing Deno needs three
   things and only the first exists: the module, the manifest, and the section.

   The manifest is metadata about a program's exports, and **wacc itself can answer for it** —
   `api.wac` exports `exportSigsFiles`, `bindTypesFiles` and `describeFiles`. So the ladder builds
   wacc, that wacc describes the CLI, and the host assembles the section. Nothing has to
   reimplement what the reference knows.

### Where it stands

**The module is reached, with no JavaScript in the path.** `ladder <wacc> --with-wacc <entry>`
builds wacc with wac-L5 and then uses *that wacc* to compile the entry:

    wacc built packages/wac/src/wac.wac: 1,620,620 bytes, 8.8 s

which is the same size the Deno path produces for the same entry. Past the first step the compiler
doing the work is the real one, which is what a bootstrap is for.

**Driving it is byte at a time, and that is where the 8.8 s goes.** The natural move is the
`$bind$` layer every wacc-built module exports — but the wacc *wac-L5* builds has none, because
wac-L5 does not emit bindgen. The first compiler in the chain is the one that has to be driven
without help, so `drivers/spec_cases.wac` is concatenated onto its source and every value crosses
as an i32. Four million V8 calls for a 1.6 MB answer.

**The manifest is written, and checked rather than trusted.** `rust-ladder/src/manifest.rs`
assembles the `wac.manifest` section — everything in it is answered by wacc (`exportSigsFiles`) or
read off the module's own export list, which is where `native.ts` reads the `bind` table from too.
`ts/manifest_test.ts` builds one program both ways and compares the two manifests byte for byte,
so a change to wac's format fails here rather than downstream of a bootstrap.

**Its limit, stated:** a program with no structs and no callbacks. Filling those needs
`bindTypesFiles`' `S`/`E`/`M` lines parsed, which is the next piece and is what the `wac` CLI —
which hands the host both — will need.

**The boundary question is answered by having done it.** wacboot writes the manifest because that
is the only way to close the loop without Deno: wac's own pipeline is `native.ts`, and that is
TypeScript run by Deno. The drift that a copied format invites is handled by the differential
rather than by hoping.

---

## Now — the rungs themselves

Host-independent, so they can land before or during the port. Ordered by what each costs when it is
missing.

### 1. A refusal should name its line — **open**

`struct Tok { kind; start; len; val }` carries a byte offset and never turns it into a line, so a
refusal says *what* but never *where*. Two instruments exist only to work around this:
`first_refusal.ts` finds the enclosing function by scanning the *output*, and `bisect_real_wac.ts`
binary-searches the *input*. Counting newlines from `src` to `tstart()` is one loop.

### 2. A refusal should stop or synchronise — **open**

`oops()` neither advances the cursor nor stops the file, so a construct the parser cannot get past
is re-reported until the output buffer fills. One missing operator produced **19,417 refusals** in
`check.wac`; the corpus census counted **2,972,653 refusal sites** from a handful of causes. The
overflow then truncates the marker itself, which is where `!! wac-L5end` comes from. An earlier
version had recovery — skip to `;` or `}` — and it was replaced by a one-liner.

### 3. A comparison against a cast is refused — **open**

`d == 3.0 as~ f32` refuses, where `f32 d = 3.0; d == 3.0` and `f32 d = 3.0 as~ f32` are each fine.
Found by writing the first of the pinning tests. Nothing in wacc does this, but it is a wrong
answer rather than a missing feature.

### 4. A buffer should carry its own bound — **open**

`emit_room()` decides how much room a buffer has by comparing `dst` against an address:

    if (dst == realout) { return 12000000; }
    if (dst == TYPEBUF) { return 3000000; }
    if (dst == BODY) { return 1000000; }
    return 120000;

That is what caused the `realout` bug — 12 MB granted to a 1 MB buffer because the comparison
matched the wrong thing — and nothing asserts the buffers do not overlap, which is how the scratch
stack came to sit exactly on `TYPEBUF`. Make a buffer a base-and-limit pair and assert the layout
once at startup.

### 5. One seam, declared by the module — **open, promoted**

Three conventions across the rungs:

    wac-L1   source at 8192, `run_at(at)` answers an *address*, text runs to a NUL
    wac-L3   source at 2097152, `compile(src, out)` answers a *length*
    wac-L4   the same, same addresses
    wac-L5   the same, different addresses — 16777216 and 4194304

This was last on the list when there were two hosts. With **four** — Rust, Node, Deno, browser —
every magic number is written four times. The module should export its own buffer addresses as
globals so a host reads them instead of knowing them; then a new host is a page of code with
nothing to get wrong.

---

## The flattener, and what it wants from wacc — **question**

`flatten` will be about 190 lines of the portable core: resolving specifiers, ordering modules,
undoing `import { x as y }`, and renaming the colliding private declarations of two modules. That
is compiler behaviour outside the ladder — and under the acceptance criteria it now has to be
written **twice**, in JavaScript and in Rust. Shrinking it is worth more than it was.

**Measured, in wacc's 18-module graph, 1,095 top-level names:**

- **15 names declared by more than one module**, which are two different things.
  - **Ten are one fact.** `files.wac` re-exports five functions from `path.wac` and `coretext.wac`
    as pure identity forwarders — `export bool isBuiltinSpec(string s) { return
    coreIsBuiltinSpec(s); }`. That is 5 collisions *and* all 5 aliases, since an alias exists only
    so a wrapper can reach what it wraps. `path.wac`'s header says it was extracted *from*
    `files.wac`, so these are compatibility leftovers. Exactly **three import lines in the whole
    corpus** use them; `isBuiltinSpec`'s wrapper is imported by nobody.
  - **Nine are copy-paste that has drifted.** `endsWith` has two *different* implementations, one
    byte-wise in `check.wac` and one using `slice` in `bindgen.wac`. `orVoid` is byte-identical in
    both its homes. Also `startsWith`, `trimmed`, `tokenLine`, `tokenCol`, `templateOf`,
    `bindTypeParams`, `isRefType`.
- **5 aliased imports**, all in `files.wac`, all part of the ten above.

**The change to wacc is about 15 edits**: delete 5 forwarders, repoint 3 import lines, dedupe or
rename 9 helpers, rename `lex.wac`'s private `emit`.

**What it buys.** The 191 lines are `gather` 32, `resolve` 17 and `type Mod` 9 — irreducible host
work — plus `flatten` 56 (collision policy), `topLevelDecls` 40 (detection), `unalias` 37
(renaming).

| | lines | if a collision is reintroduced |
|---|---|---|
| today: rename silently | 191 | handled, invisibly |
| **detect and refuse** | **~114** | the build stops and says which name |
| assume clean | ~74 | silently produces a wrong compiler |

**Take the middle.** Collision-freedom is not a property anyone keeps by accident, and the failure
mode of *assume clean* is the worst outcome available: a compiler that builds and is subtly wrong.
Detection costs 40 lines and turns a silent behaviour into a stated constraint with a check behind
it. Two implementations of ~114 lines is a better trade than two of 191.

**Not a risk, and worth recording as such:** the renaming is already witnessed. If the flattener
renamed something wrongly, `W0` would be a subtly wrong wacc and `W1 = W0(S)` would stop matching
`X1`. The fixed-point differential covers it.

**Open because it is not ours alone:** the wacc edits are in a public repo shared with other agents,
and they have to land *before* the flattener change or the build breaks in between.

**If it goes ahead**, the constraint belongs in wacc's README — *a module-private name must be
unique across a program* — with the flattener's refusal as its enforcement.

---

## What is worth keeping

**The goal is not a smaller ladder.** It is one worth trusting that can grow when wacc wants more.
So "wacc does not use it" is the wrong test; the right one is **"is anything exercising it?"**,
because an implemented-but-unexercised feature is worse than either alternative — subtly wrong on
the day somebody needs it, and looking supported until then.

    feature            used by wacc   exercised by                       verdict
    generics                      0   core/ — map 21, vec 11, result 5   keep, it has an oracle
    funcrefs                      0   core/ — map 4, option 1, vec 1     keep, it has an oracle
    f64 / f32                     4   nothing — now pinned               keep
    copyFrom / fill               0   nothing — now pinned               keep
    .trim()                       0   nothing — now pinned               keep

**Pinning the three — done.** Six cases in `ts/l5_test.ts`. It found a defect within a minute,
which is the argument for pinning in one line: item 3 above.

**Not: make compiling `core/` a test.** Considered and rejected. `core/` is idiomatic wac and
should be free to use every feature wac has; gating on it means that the next time it reaches for
something wac-L5 lacks, the suite goes red and the pressure is to grow wac-L5 to match — exactly
the accident this rung should avoid. `ts/against_real_wac.ts` already says in its own header that
it is *deliberately not a test*, so `core/` stays a **signal**: if it grows past wac-L5 the number
moves from 24 to 23 and we decide whether to care.

**The growth rule.** wac-L5 grows when **wacc** needs something. Not core, not the corpus, not a
spec case — all signals worth reading, none a reason on its own.

**Its trigger is the subset guard, which already half exists.** `ts/ladder_test.ts` asserts wacc
compiles with zero refusals, so a wacc change that leaves the subset already turns *this* suite
red. What is missing is only *where* it surfaces: today, whenever someone next runs wacboot, rather
than in front of the person who changed wacc. Closing that means wac's own checks running the
ladder — a consequence of the acceptance criteria above rather than a separate task.

Keeping generics and funcrefs is then honest rather than aspirational, as long as it is said
plainly: **present, regression-tested by our own cases, not certified against all of wac.** If wacc
adopts generics, the first move is to run wacc through and find out what is missing.

---

## The shape of the ladder — **parked, with the reasoning**

Recorded so it is not re-derived.

**Could wac-L1 be a compiler rather than an interpreter, deleting wac-L2?** `boot/l1.l0` is 1,630
instructions: 785 the evaluator, and 845 reader, symbols, objects, allocation, fixnums — the second
group needed either way. An emitter for the same syntax needs a symbol table and a text buffer,
perhaps 400–450 rather than 785. That would make the hand-written rung smaller *and* delete a
language and its 200-line compiler; wac-L3's compiler would then be written in s-expressions and
cost maybe 40% more. Roughly 1,620 to reach wac-L3 instead of 2,288.

**Parked anyway, and not on size.** The interpreter is what makes the hand-written rung — the one
rung with no second witness — testable by hand. There is a REPL in this repo because there is an
interpreter. You can poke a wrong evaluator interactively; you cannot poke a wrong emitter.

**wac-L4 → wac-L5 is the biggest jump at 2.9×**, and the only place worth *adding* a rung — except
that wac-L5's shape is the one we do not control, so another rung would not shrink it.

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
  **none in wacc or `core`**.

Smaller confusions, noted but not worth a change alone: `TY_NULL` is a struct type created solely
to occupy an index so `types[TY_NULL]` does not trap; `strty`/`strbase` is a type deliberately
never declared with `tyname` silently remapping it; `overflowed` stops the parser by assigning
`tp = ntok`, which is control flow disguised as data.

---

## Done

- The ladder reaches wacc, and the wacc it builds compiles wac.
- All 252 of wac's `spec/cases` come out as their expectations say.
- The same fixed point as wac's own TypeScript bootstrap, byte for byte: `W1 == X1 == 681,417`.
- Two hosts — Deno, and V8 embedded in Rust — producing identical wac-L0, with a test.
- Two benchmarks, one per host, including the assemble step.
- The three unexercised features pinned, which found one defect.
- Node 22 verified to run wasm GC, so the Node host is feasible.
- **Acceptance criterion 3 is met.** The ladder builds and runs a wac program inside Chromium,
  with no filesystem and no host API, and it is a test.
- The assembler, the ladder and the flattener are portable JavaScript. `js/` touches no file;
  `flatten` takes the host as two methods rather than a filesystem.
- **Acceptance criterion 2 is met.** `hosts/deno.js`, `hosts/node.js` and `rust-ladder/` each
  build wacc by themselves, and the three modules are byte for byte identical — 659,236 bytes,
  `sha256 532902cd…`. Checked by `ts/hosts_agree_test.ts`, which compares the wac-L0 *and* the
  wasm, so the two assemblers are now differentialled against real compiler output rather than
  only against the fixtures in `tests/l0/`.
