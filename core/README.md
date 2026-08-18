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
