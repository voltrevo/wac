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

## The port: TypeScript to JavaScript — **done**

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

**Done.** Nothing in `js/`, `hosts/` or `web/` reaches into `ts/` — the bootstrap path is JavaScript
throughout, and `node hosts/node.js prog.wac` and `deno run -A hosts/deno.js prog.wac` each answer
on their own. What remains in `ts/` is tests and instruments, which are Deno's and are not on the
path a clone with no binary takes.

Criterion 2 is now checked rather than claimed: `ts/hosts_agree_test.ts` has Deno, Node and Rust
each build **wacc** — 659,236 bytes, the eighteen-module graph, not the 47-line probe the other
test in that file uses — and compares the three byte for byte. Three seconds. It had been verified
by hand and written into this document, which is where a claim goes to stop being true.

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

## The unified wac binary — **done, bar the wiring**

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

**And the whole seed matches.** `ts/seed_matches.ts` builds `packages/wac/src/wac.wac` both ways
and compares: **1,731,572 bytes, identical** — module, manifest and section. The CLI's manifest is
110,935 bytes of it, with 64 callbacks, 703 bind entries and 31 structs, and every one of them
agrees. So `native/v8/build.rs` can embed either, and the artefact no longer needs a JavaScript
runtime to exist.

    wac's own path, with Deno        451 ms
    the ladder, no Deno           16,836 ms

Two things that cost a wrong answer first. The `bind` table excludes `$bind$m_` and `$bind$sm_` —
methods, which a host reaches through the struct's entry — and *not* `$bind$fnref_`, which is
exactly the sort of thing a host needs to find by name. And a module's exports have to be read out
of its export section rather than by instantiating it: the CLI *imports* its callback dispatchers,
so instantiating it wants an import object nobody has.

**What is left is wiring, not building.** `tools/seed.sh --bootstrap` still reaches for Deno; it
would reach for the ladder instead. That is a change in wac's repo, and the same conversation as
the flattener's fifteen edits.

**The boundary question is answered by having done it.** wacboot writes the manifest because that
is the only way to close the loop without Deno: wac's own pipeline is `native.ts`, and that is
TypeScript run by Deno. The drift that a copied format invites is handled by the differential
rather than by hoping.

---

## Blocked — the ladder no longer builds wacc

**`WVec.create()` in `packages/wacc/src/wapytok.wac`**, which arrived upstream on 2026-08-27 and
wac-L5 refuses:

    !! wac-L5: line 19390: unexpected token ( before ) ) ;

    export Toks toksNew() { return Toks(WVec.create()); }

A **static method on a generic template**, with the instantiation nowhere in the call. wacc's own
`emit.wac` describes the shape: *"The instantiation is not in the call — it is in the slot the
answer goes into, which is the language's own spelling: `Vec<i32> w = Vec.create();`"*. This is the
harder variant of it: the slot is a struct field's type, reached through the `Toks(...)` constructor
one level out, so the wanted type comes from the field of the struct being built.

**This is the ladder growing to follow wacc, which was expected** — *"it is possible the ladder will
grow in future so that wacc can use more features"* — and it is the first time it has happened
since the fixed point was reached. It is not caused by the wacc edits above: the same refusal, at
the same construct, is there with them stashed.

What it blocks: the ladder building wacc at all, so every acceptance criterion downstream of it.
Six tests, measured rather than guessed:

    ts/hosts_agree_test.ts    Deno, Node and Rust each build wacc alone
    ts/ladder_test.ts         the ladder compiles wacc, and that wacc compiles wac
    ts/manifest_test.ts       the manifest matches the one wac's own build writes
    ts/same_fixed_point_test  the ladder and wac's bootstrap reach the same wacc
    ts/selfhost_test.ts       the wacc wac-L5 built builds wacc, and they agree
    ts/spec_cases_test.ts     every spec case comes out as its expectation says

229 of the other tests stay green, so the rungs themselves are unaffected — it is one construct in
one file at the top of the ladder.

**And one flake, which is not this.** `ts/browser_test.ts` fails in a full-suite run while the wac
gate is running and passes on its own in a second. It drives headless Chromium with
`--virtual-time-budget` and `--dump-dom`, and under contention the browser is slow to reach the
point where the DOM is worth dumping. A test that fails when the machine is busy is a test that will
cry wolf on a shared box; worth fixing, not yet filed.

---

## Now — the rungs themselves

Host-independent, so they can land before or during the port. Ordered by what each costs when it is
missing.

### 1. A refusal should name its line — **done**

`struct Tok { kind; start; len; val }` carries a byte offset and never turns it into a line, so a
refusal says *what* but never *where*. Two instruments exist only to work around this:
`first_refusal.ts` finds the enclosing function by scanning the *output*, and `bisect_real_wac.ts`
binary-searches the *input*. Counting newlines from `src` to `tstart()` is one loop.

`line_of(off)` counts them. A refusal now reads `!! wac-L5: line 412: unexpected token ...`.

### 2. A refusal should stop or synchronise — **done**

`oops()` neither advances the cursor nor stops the file, so a construct the parser cannot get past
is re-reported until the output buffer fills. One missing operator produced **19,417 refusals** in
`check.wac`; the corpus census counted **2,972,653 refusal sites** from a handful of causes. The
overflow then truncates the marker itself, which is where `!! wac-L5end` comes from. An earlier
version had recovery — skip to `;` or `}` — and it was replaced by a one-liner.

Recovery is back — skip to `;` or `}` — with a 50-refusal cap after which the file stops. One bad
token in a six-line file went from 18,349 refusals and 45,892 lines of output to 1 refusal and 24
lines. The cascade had been hiding crashes: traps across the corpus rose from 21 files to 56 once
it stopped. `ts/trace_l5.ts` names the `boot/l5.l4` function a trap *inside the compiler* came
from, which found an unguarded table append, an unbounded token cursor and a type index of `-1`
reaching a member lookup. Traps are back down to 39.

### 3. A comparison against a cast is refused — **done**

`d == 3.0 as~ f32` refuses, where `f32 d = 3.0; d == 3.0` and `f32 d = 3.0 as~ f32` are each fine.
Found by writing the first of the pinning tests. Nothing in wacc does this, but it is a wrong
answer rather than a missing feature.

It was not about comparison, or about floats: `parse_type` ate the ternary's `?` as a nullable
marker, so *any* `x as T ? a : b` was refused at the token after the `?`. wac had the same bug —
`issues/lang/closed/0124` — and had already settled the ambiguity toward the ternary. wac-L5 now
resolves it the same way and by the same test: the last thing the type ate was a `?` and what
follows can begin an expression. Reading the oracle's rule was cheaper than inventing one, and it
means the two parsers cannot disagree about which reading is right.

### 4. A buffer should carry its own bound — **done**

`emit_room()` decides how much room a buffer has by comparing `dst` against an address:

    if (dst == realout) { return 12000000; }
    if (dst == TYPEBUF) { return 3000000; }
    if (dst == BODY) { return 1000000; }
    return 120000;

That is what caused the `realout` bug — 12 MB granted to a 1 MB buffer because the comparison
matched the wrong thing — and nothing asserts the buffers do not overlap, which is how the scratch
stack came to sit exactly on `TYPEBUF`. Make a buffer a base-and-limit pair and assert the layout
once at startup.

Done, both halves. `to_buf(base, cap)` is the only way to move between buffers and sets the bound
with the base, so `emit1` compares `dp` against `dstcap` and nothing asks which buffer it is in.
`layout_check` derives every size from the addresses once per compile — the output buffer's from
the distance to whatever the host put above it, so a host that moves the source gets a bound that
moves with it — and refuses if the fixed regions overlap or run past the end of memory.

Two things came out of it. Two corpus files that trapped with `memory access out of bounds` now
refuse and say which buffer, which is the whole point. And a bound of zero before `layout_check`
runs turned out to be reachable: `collect` refuses, and a refusal emits, so every program carried
a spurious overflow marker until the output buffer was bounded before collection rather than after.
The version this replaces answered a default 120000 for an unrecognised `dst` and those bytes went
to address 0.

The end of memory is `MEMBYTES`, written in `l5.l4` and again as `memory 512` by wac-L4. wasm has
`memory.size` and the assembler emits it, but wac-L4 cannot name it, and growing the rung below to
settle a question in the rung above is the trade this ladder exists to avoid. So it is written
twice and pinned by a test that reads both.

### 5. One seam, declared by the module — **done**

Three conventions across the rungs:

    wac-L1   source at 8192, `run_at(at)` answers an *address*, text runs to a NUL
    wac-L3   source at 2097152, `compile(src, out)` answers a *length*
    wac-L4   the same, same addresses
    wac-L5   the same, different addresses — 16777216 and 4194304

This was last on the list when there were two hosts. The module should export its own buffer
addresses so a host reads them instead of knowing them; then a new host is a page of code with
nothing to get wrong.

**Correcting this entry: it was written twice, not four times.** The three JavaScript hosts share
`js/ladder.js`, so the copies were there and in `rust-ladder/src/main.rs`. Two unchecked copies of a
fact neither of them owns is still the defect; the count was wrong and the reason it counted was
not.

**Done.** Each rung exports `seam_src()` and `seam_out()` — wac-L1 `seam_at()` — and both hosts ask.
Exported *functions* rather than globals: wac-L3 and wac-L4 already export every top-level function,
so the rungs cost two lines each and nothing below them had to grow. An exported global would have
needed the assembler and wac-L4 both taught a new form, to state the same fact.

For wac-L5 the declaration and `layout_check` are now the two halves of one statement: the module
says where it wants the source and the output, and then checks the host used them.

**Two shapes remain and are written down rather than fixed.** wac-L1 is handed one address and
answers another with the text running to a NUL; every rung above is handed two and answers a length.
Unifying that means rewriting the seam of the one rung written by hand in wac-L0, which costs more
than it buys now that no host carries an address.

---

## The flattener, and what it wants from wacc — **done, and the conclusion was wrong**

This section proposed shrinking the flattener from 191 lines to ~114 by making it **refuse** a
collision instead of renaming one apart, once wacc's source had none left. The wacc half is done.
The flattener half is not, because the measurement that would have justified it was never taken and
is the opposite of what the section assumed.

**What was done to wacc.** Eighteen names were declared by more than one of its eighteen modules —
not fifteen; the earlier count came from grepping the flattener's *output* for `name_module`, which
invented `endsWith` and missed four, three of them in a `wapyparse.wac` that arrived in the
meantime. Five were re-export wrappers in `files.wac` and are deleted, with six importers repointed
(not three — each line also imported names that genuinely live there, so they split rather than
move). Two were byte-identical copies: `startsWith` joins `endsWith` in `path.wac`, `orVoid` is
exported from `manifest.wac` across an edge `bindgen.wac` already had. Eleven were one name for two
different functions and are renamed to say which. wacc's graph now flattens by pure concatenation:
no renames, and no aliased imports either.

**Why the flattener keeps its renaming anyway.** Because collisions are not scar tissue. Measured
across this repository: **90 of 309 entry points collide somewhere**, and the worst — `wac.wac`,
the unified binary, whose graph is about forty packages — has **135**. They are things like `rotl`
in `chacha20`, `keccak` and `xxh64`: three correct, independent implementations of one primitive.
Demanding globally unique private names across unrelated packages is asking a program not to have
modules. Refusing would turn 90 corpus programs that compile today into refusals.

The trade table below was built on the belief that a collision is a mistake somebody made. For one
package written by one team it usually is; across a corpus it is the normal state, and the earlier
reasoning never looked past wacc's own eighteen modules to find that out.

**What replaces it.** The flattener renames, as it did, and gained an optional `onRename` callback —
so the thing that can quietly produce a wrong compiler can be watched. wacboot's `ts/l5_test.ts`
asserts wacc's graph needs none of it, and `packages/wacc/README.md` states the constraint on wacc's
side and names the check. The benefit the section wanted — a reintroduced collision is caught
loudly, on the one program where renaming is most dangerous — is kept; the 77-line reduction is not.

**Where the renaming is on the path at all.** Building wacc, and nothing else. `--with-wacc` hands
wacc a *file set* and wacc resolves its own imports, so the unified binary's 135 collisions never
meet the flattener. It is only the general "compile this program with the ladder" mode — the corpus
census, `hosts/node.js prog.wac` — that flattens an arbitrary graph, and that is the mode refusing
would have broken.

**Not a risk, and worth recording as such:** the renaming is witnessed. If the flattener renamed
something wrongly, `W0` would be a subtly wrong wacc and `W1 = W0(S)` would stop matching `X1`. The
fixed-point differential covers it.

| | lines | if a collision is reintroduced | **verdict** |
|---|---|---|---|
| today: rename silently | 191 | handled, invisibly | **kept, plus a callback and a test** |
| detect and refuse | ~114 | the build stops and says which name | **rejected: breaks 90 of 309** |
| assume clean | ~74 | silently produces a wrong compiler | rejected |

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
