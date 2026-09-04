# wac — one slice rewritten

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/wac`: 8,973 lines over 27 files — the `wac` command itself. **Two
functions are rewritten**, both found the same way, and how they were chosen is half the point.

---

## Found by looking for the longest argument

[../../QUESTIONS.md](../../QUESTIONS.md) has an entry saying that six times over, the place a
package argues hardest has been the place a type would have said the same thing. This slice was
picked by running that as a **search** rather than reading it as an observation: every doc comment
of 150 words or more in the un-rewritten packages, sorted, mid-file only — 52 of them.

The second-longest, and the longest that argues for a *representation*, is
`packages/wac/src/wac.wac:217`, 359 words on `buildCachePath`. Its first line:

> Where this build's artefact would be cached, **or `""` when it must not be**.

The method works. It is worth saying that it also produced a list where the top entries are file
headers — orienting prose, which is long for a good reason — so the filter that matters is
*mid-file*, where a comment is defending one decision rather than introducing a subject.

## Nine reasons, one empty string

The function has **nine `return "";` sites** and every one is a different reason:

| | why not cached |
|---|---|
| 1–2 | `test` with no target, `app` with no stem — no name to key on |
| 3 | not `build`, or `build` with no `-o` |
| 4 | `--coverage` or `--trace` — the build writes a table this cache does not hold |
| 5 | `--no-cache` |
| 6 | an unknown flag, because keying an unvalidated command line let `wac build --nonsense` pass on a warm cache |
| 7 | `$WAC_BUILD_CACHE_KEEP` is zero |
| 8 | no `$WAC_HOME` |
| 9 | the host did not say which compiler this is |

Each was added after being bitten — the doc records the measurements: `wac run p.wac --check` at 803
then 822 ms because `--check` read as an unknown flag; a self-build back in 160 ms with the bound at
zero; `wac app` recompiling identically a moment after itself.

**And a hit is reported while a miss is silent.** `wac.wac:1463` logs
`"<name>.wasm: N bytes from cache"` when it works. When it does not, nothing is said. So a person
asking *why is this recompiling every time* has nine candidates, no way to ask, and one lever —
`$WAC_BUILD_CACHE_KEEP` — which is one of the nine.

That is the payoff of a reason being a value, and it is not hypothetical. `tools/push.sh` sets that
variable around the fixpoint rounds, and the paragraph in `CLAUDE.md` explaining why the honest
bootstrap figure is 27.2s rather than 12.2s is prose somebody had to write because the tool could
not say it.

## What else changed

**Eight parameters become one `Build`.** `(Cli cli, i32 argc, string cmd, string entry, string[]
paths, string[] texts, string stem, string target)` — four strings in a row, and `paths`/`texts` are
the parallel-array pair this exercise keeps meeting: same length by convention, indexed together in
one loop, nothing saying so. `@/packages/regex` decided to *keep* that shape for its character
classes and had a measured layout reason; there is none here.

## What could not be written

**The nine reasons are not disjoint and nothing orders them.** A `wac run --coverage` with no
`$WAC_HOME` and an unknown flag is three of them at once; the shipped code returns at the first, so
which one a caller sees is the order the checks are written in. For a *diagnostic* the useful answer
is all of them — fixing one and recompiling to find the next is the loop this is supposed to end.
`Result` has one `Err`, and a union of one-or-more is not a shape this language has.

**`--no-cache` serves two callers with opposite needs.** `packages/wacc/test/wac/selfhost_test.wac`
builds wacc twice and requires byte equality — *"served from cache that is one file compared with
itself"* — and `bootstrap.sh`'s fixpoint loop is the same shape. Both are *a build that must prove
something about the compiler*. A person turning the cache off because they suspect a stale hit is
not that, and the two want opposite things from a warning: silence, and a line. One arm covers both,
and splitting it would invent a distinction nobody has asked for — recorded rather than taken.

**A cache path is a `string`.** `home + "/cache/build/" + h.hex() + ".wasm"`, assembled here and
taken apart by whoever reads it. Neither `@/packages/fs` nor `vision/std` has a path type, and every
package in this exercise that touches the filesystem has built one with `+` — four now. It is the
same request as a refinement of an integer, one layer up, and this is the place where the shipped
tree's own vocabulary — `stem`, `baseName`, `outStem` — is already a set of operations with no type
under them.


---

# The second: a capability table whose default is every capability

`grants.wac`'s `forCommand` was the next hit on the same list — 210 words, and the subject is the
system's own first principle:

> **One program means one manifest, and the manifest is the union.** … a `wac check` that asks for
> nothing at all is running inside a program that could open a socket. Nothing exploits that — but
> **"a program reaches only what it was handed" is the whole argument of this system, and the binary
> handing itself more than the command needs is exactly the shape the system is against.**

The table that implements it ends:

```wac
if (cmd == "self")   { return Asked(true, true, false, true, false); }
return Asked(true, true, true, true, true);
```

**The default is every grant.** A command added to the dispatcher without a line here gets read,
write, net, env and run — silently, in the function that exists to stop precisely that.

Four commands do legitimately keep everything: `run`, `test`, `app-run` and `task`, each with its
reason written out, because a child cannot be handed what its parent does not hold. So *the answer*
"everything" is right four times. What is wrong is that it is also the answer to a question nobody
asked.

## The fix needs nothing the language has not got

Measured through `bootstrap/ts/ask_wacc.ts`:

| written | today |
|---|---|
| `match` over an enum with an arm missing, no `else` | **1 type error** — and traps `unreachable` if run anyway |
| the same with every arm | clean |
| an arm missing **with** `else:` | clean, and answers the default |

So `Command` as an enum and a `match` with no default makes a forgotten command **a compile error**,
today. Worth saying plainly because most of this directory is asking for something and this is not:
the guarantee exists, it is exactly the guarantee wanted, and it is unavailable in `grants.wac` only
because the key is a `string`.

## Also in that file, and smaller

**`Asked(true, true, false, true, false)`** — five positional bools, eleven call sites, differing
from each other in one or two positions. Named construction is available today and would be correct
and long; a *set* is what this is, and `Grants.of(Read, Write)` needs a variadic static wac cannot
declare — which [`@/packages/ens/src/answer.wac`](../ens/src/answer.wac) already found from the other
side.

**The same five facts are also a bitmask.** `grantsIn` answers *"the five bits that go into the
manifest"*, so one closed set has three spellings in this program: an enum of commands, a struct of
five bools, and five bits. Nothing relates them.

**Nothing checks that a command's grants are narrower than the process's.** `forCommand` answers what
a command *should* have; the intersection is the caller's, and the only place it is written down is
`wac task`'s comment about not widening. A `Grants` constructible only by narrowing another `Grants`
would make the direction structural — and would need the process's own grants to be a value this
code can reach, which is [../../QUESTIONS.md](../../QUESTIONS.md)'s entry on whether the whole grant
is a thing that exists.
