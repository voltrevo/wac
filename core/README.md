# core

`core` — the declarations that ship inside the compiler, reached as `import { Read } from core;`.

**Why anything at all is in here.** wac has nominal types, and a `fn[…]` value does not capture —
`spec/spec/funcrefs.md` — so two identical declarations of a type are two types and no adapter can
convert between them.

That sentence used to cite `[§wac-fnref-nocapture-j4wk8pm]`, which said `c.inc` is a compile error.
It is a value now (`§wacc-fnref-bound`, `design/lang/0002` tier one), and the tag went with it. The
argument here is untouched: a bound reference captures a *receiver*, not an enclosing scope, so
there is still nothing that could adapt one nominal type to another. That is fine while everything is one tree — the two sides can
import the same file. It stops being fine across repositories: a streaming transform names the
exact type its source produces (`gunzipStream(fn[Read()] read, …)`), so a `Read` declared in the
transform's repo and a `Read` declared in the caller's repo cannot meet, and there is nothing
either author can write to make them.

So the admission test is narrow, and is a test rather than a taste: **does a value of this type
have to cross a repository boundary through a funcref signature?** If not, it is a library and
belongs in a package. Today `Read` is the only type that passes, which is why this file holds one
enum and no functions.

**Why it is embedded rather than fetched.** The same no-closures property makes a version diamond
unresolvable rather than merely awkward, so `core` has to be one thing everywhere. Shipping it
with the compiler makes its version the compiler's version, which is the only story that has no
diamond in it. See `design/0001` for the whole argument.

## The tree, and who gets which file

`core` is a directory because the two compilers embed different parts of it, and **which file a
declaration is in is how that is said**:

| file | reference | wacc |
|---|---|---|
| `read.wac` | yes | yes |
| `jsx.wac` | no — no JSX frontend | yes |

`tools/genCore.ts` holds those two lists and writes both embeddings: `compiler/wacCore.ts` and
`packages/wacc/src/coretext.wac`. Neither is edited by hand, and `deno task gen:core --check` fails
when either is out of step. `compiler/README.md` carries the same omission as a row, which is where
it was recorded before this directory existed.

The alternative was a marker inside one shared file. That is a third thing to invent, to parse and
to keep true, for a distinction a directory already draws.

## This directory and the specifier `core` are not the same thing

`core/read.wac` here is the **source**. What a program imports is the copy embedded in whichever
compiler is running, which `tools/genCore.ts` writes from this directory and
`tools/wac/genCore_test.wac` keeps in step.

Today the two cannot be confused, because the only specifier that reaches the embedded tree is the
bare `core` and a quoted `"core/read.wac"` is an ordinary relative path — in a directory with no
`core/` it answers *cannot read core/read.wac*. After `design/lang/0009` D5 quotes every specifier
that changes: `"core/read.wac"` has to mean the built-in, because D4 reserves `core`, `core/`, `std`
and `std/` and says they cannot be remapped. A project with its own `core/` directory then cannot
name it, which is what "reserved" costs and is the intended trade.

Worth knowing here because **this repository is such a project**. From the root, that spelling will
name the embedded copy rather than these files. It is benign — the embedded copy is generated from
exactly these files and the check fails if it drifts — but the identity is a build step rather than
a rule, and the reservation has to happen in the resolver *before* the filesystem is consulted or it
holds in one project and not another.

## The collections

**This section was packages/std/README.md, and the package it described is gone.** D4 says `core`
holds "the whole of today's packages/std" — `Option`, `Result`, `Vec`, `Map`, hashing, equality —
and it does now, so the argument moves here rather than being deleted with the directory. What D4
means by `std` from here on is the *capability* half: `Core`, `Cli`, filesystem, network, processes.
That tree does not exist yet.

Containers and the two sum types every program ends up wanting.

```wac
import { Vec } from "core/vec.wac";
import { Map } from "core/map.wac";
import { Option } from "core/option.wac";
import { Result } from "core/result.wac";
import { hashString, stringEq } from "core/hash.wac";
```

| type | what |
|---|---|
| `Vec<T>` | growable array; `push`/`pop`/`get`/`insert`/`remove`, amortised O(1) append |
| `Map<K, V>` | hash map, open-addressed with linear probing; hash and equality as funcrefs |
| `Option<T>` | a value or nothing, taken apart with `match` |
| `Result<T, E>` | a value or an error, with the error type up to the caller |
| `hash.wac` | ready-made hash and equality for `string`, `i32` and `i64` |

This package exists because wac gained generics ([wac issue
0034](../issues/lang/closed/0034-generics.md)). Before that a container could only be
written once per element type, which is why this repo had three hand-rolled ones.

## Vec

```wac
Vec<i32> v = Vec.create();
v.push(10);
v.push(20);
i32 first = v.get(0);              // traps if out of range
i32 safe = v.at(5).orElse(-1);     // None instead of a trap
Option<i32> last = v.pop();
```

`create()` allocates nothing; the first push allocates four slots and capacity doubles from
there. `withCapacity(n, fill)` presizes.

**Why `withCapacity` wants a `fill` value.** WasmGC arrays are initialised when they are
created, and wac will not invent a value for a `T` it knows nothing about — a struct or an
enum has no default. `push` never needs one because the element being pushed is available at
exactly the moment growth happens; `withCapacity` has no such value to hand, so it asks. The
slots above `len()` are unreachable through the API, so what you pass is never read.

**`clear()` and `pop()` do not release elements.** There is nothing to overwrite a slot
with, so a popped or cleared element stays reachable from the backing array until something
is pushed over it. It matters only for a long-lived Vec of large elements.

## Map

```wac
Map<string, i32> counts = Map.create(hashString, stringEq);
counts.set("apple", 1);
bool existed = counts.set("apple", 2);      // true — it overwrote
Option<i32> got = counts.get("apple");
i32 orZero = counts.getOr("pear", 0);
counts.remove("apple");
```

**Hash and equality are funcrefs, not a requirement on `K`.** wac has no traits, so there is
no `K: Hash` to ask for. This turns out better than a trait would have been: `hash.wac` has
the ready-made ones, and hashing case-insensitively, or on one field of a struct, needs no
wrapper type — just a different pair of functions.

```wac
i32 hashPoint(Point p) { return hashI32(p.x * 31 + p.y); }
bool pointEq(Point a, Point b) { return a.x == b.x && a.y == b.y; }
Map<Point, string> labels = Map.create(hashPoint, pointEq);
```

A hash may return any `i32`; the table masks it. A poor distribution costs collisions rather
than correctness — `test_collisions` runs a table where every key hashes to zero.

`hashBytes`/`bytesEq` are the `u8[]` pair, and `hashString` delegates to `hashBytes` rather than
repeating FNV-1a. Not tidiness: two copies of a hash can drift into disagreeing about the same
bytes, and nothing would catch it — a Map answers every query correctly as long as *one* hash is
used per map, so it would surface only where something hashed a key one way and looked it up the
other. `json` holds member names as bytes on purpose, so it needs the byte-level pair; the test
asserts the two agree (wac-mono issue 0004, reported by agent-b).

**Linear probing with backward-shift deletion**, not chaining and not tombstones. One array
rather than one per bucket, and a table that is filled and emptied repeatedly does not
degrade — `test_fill_and_empty_repeatedly` asserts that 400 insert/remove pairs leave the
table no larger than 32 slots.

`keys()` and `values()` are in slot order, which is to say **an order you must not rely on**:
it depends on the hash, the capacity and the insertion history. They correspond to each
other index by index.

## Option and Result

```wac
Option<i32> found = m.get(k);
match (found) {
  case Some(v): return v;
  case None:    return 0;
}
```

`T?` works for every type, primitives included ([wac issue
0045](../issues/lang/closed/0045-nullable-primitives-are-not-boxed.md)), and for a
*reference* it is cheaper — one word, no allocation. So `Point?` is the right thing to write and
`Option<Point>` is not.

`Option` earns its place on two narrower grounds. **A nested absence:** `T??` does not exist, so
a container of nullables cannot distinguish "no entry" from "an entry holding null" — which is
why `Map.get` returns an Option rather than a `V?`, since `Map<string, JsonValue?>` is a real
shape. **An absent case that is a compile error to forget:** `match` is exhaustive, and a
missing null check is not.

A nullable primitive is boxed and so is an Option, so between `i32?` and `Option<i32>` there is
nothing to choose on cost. Pick by which of those two reasons applies.

`mapOption(o, f)` is a free function rather than a method because a method cannot introduce a
type parameter of its own — `U` is not the enum's:

```wac
Option<string> described = mapOption(count, describe);   // T from the Option, U from describe
```

`Result<T, E>` leaves the error type to the caller, because the useful error differs: a
parser wants a message and a position, an arithmetic routine wants a code, and a caller that
only branches wants `Result<T, bool>`.

## What is not here yet

- **`Set<T>`.** `Map<T, bool>` is the whole implementation, and a wrapper is worth writing
  when something wants one.
- **Iteration without copying.** `keys()` and `values()` allocate. wac has no iterator
  protocol, so the shape a lazy iterator would take is not settled; index-based loops over
  `keys()` are what this repo does. It *did* also say "and no closures", which stopped being
  true on 2026-08-16 — a wacc lambda captures, so a callback-shaped `each` is now writable and
  the open question is which of the two shapes this package should offer.
- **`sort`.** A generic sort over a `fn[bool(T, T)]` comparator belongs here. `gzip` and
  `bignum` both sort by hand today.
- **A string builder.** `bytes`' `Buf` is the byte-level answer; repeated `s + t` is
  quadratic and nothing here fixes that.

## Testing

`test/wac/*_test.wac` are unit tests written in wac. `test/traps.test.ts` is host-side
because a trap aborts the module, so no wac test can assert one — which is where the bounds
checks are covered, including the case a wac test cannot reach: an index inside the
allocation but past the length.

`map_test.wac` ends with a **differential test**: the same pseudo-random operation sequence
run against `Map` and against a naive association list of two parallel `Vec`s, compared after
every operation. Six deliberate mutations of `Map` were tried against these tests and all six
were caught, five of them by the differential run — a probe-sequence bug needs a specific
interleaving of insertions, overwrites and removals that no hand-written case is going to hit.

