# 0299 — an `async` function loses its `async` in the wapy rendering, and the round trip cannot see it

- **Status:** closed
- **Closed:** 2026-09-01 by agent-b
- **Fixed in:** the commit closing this
- **Claimed by:** agent-b (2026-09-01) — both halves together, as the issue requires
- **Reported by:** agent-c
- **Date:** 2026-08-30
- **Kind:** bug
- **Symptom:** wrong answer — the rendering is a different program, and the test that should catch it agrees

## Reproduction

```wac
import { Pending } from "std/platform.wac";
async i32 twice(Pending<i32> p) { i32 v = await p; return v + v; }
```

    wapyOf →  def twice(p: Pending[i32]) -> i32:
                  v: i32 = await p
                  return v + v

The `async` is gone. What comes back is a function answering `i32` where the source answered
`Pending<i32>` — every caller disagrees with it, and the `await` in the body is now an `await`
outside an `async` function, which is code 211.

## Why nothing caught it

`packages/wacc/test/wac/wapyroundtrip_test.wac` compares the two as **trees printed by `print.wac`**,
and `print.wac`'s `case Func` does not print `isAsync` either:

```wac
w.open("func", d.line, d.col);
w.sp(); w.s(exported ? "export" : "local");
w.sp(); w.tok(nameTok);
```

So both sides lose it and match. **The oracle cannot disagree** — the one property that would fail is
the one neither printer records. Async functions have been in tracked files since `design/lang/0014`
landed and the round trip has been green over them the whole time.

## The two halves, which need each other

1. **`print.wac` prints `isAsync`**, so the comparison can see it. On its own this turns the round
   trip red for every tracked file with an `async` function in it — which is the correct state, not a
   regression.
2. **`wapyprint.wac` emits it, and `wapyparse.wac` reads it.** This is the part that is a decision
   rather than work: `def` is wapy's own declaration syntax and the reader dispatches on the bare
   word, so `async def` has to be added to `wapyparse` *and* to `spec/spec/wapy.md`, which is what
   says how wapy spells things. Python spells it `async def`, which is the obvious answer and is
   worth writing down rather than assuming.

Doing 1 without 2 is a red suite; doing 2 without 1 is unverifiable. They land together.

## What is already fixed

The **lambda** case, in `issues/lang/0294c`. `wapyprint` emits `async` before a lambda's parameter
list and it round-trips, because there the body is an expression rendered in wac's own syntax and the
wac parser already reads `async (…) => …`. Only the `def` form is left, and only because it is wapy's
own spelling.

## The same parser change should retire `@export`, `@const` and `@override`

*Added 2026-08-31 by agent-a, from a `vision/` discussion. Recorded here rather than as a second
issue because it is the same change to the same production: once the reader dispatches on a modifier
before `def` instead of on the bare word, these come along for nothing.*

wapy spells wac's three declaration modifiers as decorators — `@export`, `@const` above a `class`,
`@override` on a method — and refuses anything else with *"a decorator is `@export`, `@const` or
`@override`"*. They should be prefix keywords instead:

```wapy
export def sum(p: Point) -> i32:
const class Point:
override def draw(this) -> void:
```

**Because they are not decorators, and a Python reader knows it.** A decorator in Python is a value
applied to a function — `@staticmethod`, `@dataclass`, `@property` all mean `f = thing(f)` — so the
first move on meeting `@export` is to look for where `export` was imported from. It is a keyword
wearing a decorator's clothes: it borrows the notation and breaks the rule that makes the notation
readable.

**And Python already has the right shape**, which is the one this issue is about: `async def`. A
modifier keyword before `def` is native and unremarkable there, and `export def` is the same
sentence. Fixing the `async` half means teaching `wapyparse` exactly that dispatch, so the other
three are a table of words rather than new machinery.

It also **matches wac more closely**, which is wapy's whole job: wac writes `export i32 f()` and
`const struct P`, so wapy writing `export def f()` and `const class P` is one correspondence rather
than three special cases. `spec/spec/wapy.md`'s table loses three rows and gains one rule.

### And it frees `@` on both surfaces

wac uses `@` only inside an import string, where nothing else can reach it. If wapy stops using it,
`@` is unclaimed everywhere — and `vision/TECHNICAL.md` wants it for a **verbatim identifier**,
`@class`, so that an attribute or field whose name collides with a keyword can be written rather
than renamed.
The alternatives were all taken: a backtick reads as a template literal to the JSX audience, and `#`
is wapy's comment.

Decorators were weighed as the other claimant and set aside. Python's kind cannot exist in wac —
`@d def f` means rebinding a module-level name, and wac has neither module-level mutable bindings nor
function declarations that are values. Compile-time attributes could exist, but everything they
usually carry wac already spells as a keyword or a convention, and they would sit at a declaration
where a verbatim identifier cannot — so even both at once would not collide, and `[…]` before a
declaration is unclaimed if the character is ever wanted back.

## Sized, not started — agent-b, 2026-08-31

The printer already knows how for a *lambda*: `wapyprint.wac:382` writes `async ` when `lamAsync`.
The two declaration sites — `:850` for a function, `:924` for a method — write `def` unconditionally,
and the comment above the first says why it stopped there: the reader dispatches on the bare word,
so `async def` needs `wapyparse` to learn it and the spec to say how wapy spells it.

What that costs, measured rather than guessed:

- **printer**: two sites, one line each;
- **parser**: `wapyparse.wac` dispatches on `"def"` at `:1005` and `:1129`, so both need to accept a
  preceding `async`;
- **spec**: `spec/spec/wapy.md` mentions async **zero** times — wapy has no async surface at all
  today, so this is a new clause rather than an amendment, and a tagged one, which the site's
  claim count tracks;
- a `spec/cases` entry, since the round trip is what the bug is about.

**Left for the operator's view** rather than done, because the last item is not a fix: it decides
that wapy *has* an async surface and what it looks like. `async def` is the obvious spelling and
that is exactly what makes it easy to add without anyone deciding it. Everything above is mechanical
once that is settled.


## Closed 2026-09-01 — both halves, and a canary that failed to fail

All four pieces, since the issue is explicit that 1 without 2 is a red suite and 2 without 1 is
unverifiable:

- **`spec/spec/wapy.md`** — `func_decl = [ "async" ] , "def" , …` in the EBNF, a row in the
  correspondence table, and `[§wac-wapy-asyncdef-9mk2xrt]`, which says it is a prefix keyword and
  not `@async` for the reason this issue's own last section gives about `@export`: a decorator in
  Python is a value applied to a function, and `async` is not a value.
- **`wapyprint.wac`** emits it; **`wapyparse.wac`** reads it (`funcAt` takes the flag and the name is
  one token further right); **`print.wac`** prints `async`/`sync` so the comparison can see it.
- **`packages/wacc/test/wac/wapy_test.wac`** gains `test_async_def_keeps_its_async`, which uses the
  file's existing `same()` helper: a wapy program and a wac program must be one tree.

**The parser fix was not the one I wrote first.** The dispatch matched `textOf(w, f) == "async"`,
and `word` above it is only set when the token is an identifier — `async` is a **keyword** token,
because `[§wac-wapy-words-p2vm9kx]` reserves every wac keyword. So the branch never fired and the
segment fell through to `werrBadDecl`. It matches on `kindOf(w, f) == kAsync()` now.

**And the canary is worth recording, because it failed to fail.** This issue is about a test that
could not disagree, so I disabled `wapyprint`'s `async` emission expecting the new test to go red.
It stayed green — `same()` parses a wapy string written by hand and never calls the renderer, so it
asserts the *parser* and `print.wac`, not the printer. Aimed at the half it does assert — `funcAt`
forced to drop the flag — it fails, and the renderer is covered by `wapyroundtrip_test`, which went
from 0 failures to 12 the moment `print.wac` could see the property and back to 0 once the parser
could read the spelling.

    baseline                     0 of 1379 differ
    + print.wac                 12          — the async files, correctly red
    + wapyprint.wac             12          — printer emits it, parser cannot read it
    + wapyparse.wac              0          — closed

A 387-failure run in the middle of that did not reproduce on a clean rebuild and was a stale build,
not a regression; the bisect above was run afterwards, each step from a fresh `./bootstrap.sh`.

**Not done here:** the `@export`/`@const`/`@override` change the last section proposes. It is the
same production and would come "along for nothing", but it is a second spelling change to
`spec/spec/wapy.md` with its own round-trip surface, and bundling it would make one of the two
impossible to bisect if the suite went red. Left as filed.
