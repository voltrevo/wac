# box — a measurement, and one thing the language can do about it

Written 2026-09-04. Read [../README.md](../README.md) first: not vetted, does not compile,
disposable.

The real package is `packages/box`: 7,502 lines, 63 applets, a dispatcher. It began as *nothing
rewritten* — `head` is `head`, and what is here is what 63 programs measure about *no ambient
capabilities*, which no single package could.

**Four applets have since been written, and none of them for their own sake.** Each turned out to be
the first code anywhere to use a capability that had been designed and never consumed, which is why
they are here rather than in the fifty-eight that would have said nothing new:

| | first consumer of | and it found |
|---|---|---|
| [`src/echo.wac`](src/echo.wac) | `Out` | the narrowest signature in the box: `echo(Out, Args)` against `(Core, Cli, Fs, Args)` |
| [`src/cat.wac`](src/cat.wac) | `In`, then `Files.open`, then `In.stream` | three versions of one complaint; only reframing `In` as a stream fixed it |
| [`src/tee.wac`](src/tee.wac) | `Files.create` | the applet whose shipped header says it cannot be written |
| [`src/gunzip.wac`](src/gunzip.wac) | `Err(is T):`, and a union inside a union | the shipped one returns an `i32` and prints nothing for nine distinct failures |

`tee` is the one to read. Its shipped header — *"the one applet that still buffers by nature rather
than for want of an API"* — is the projections audit arriving from the other end, six weeks earlier,
written up as a property of `tee` rather than of the capability it comes from.

`gunzip` is the one that moved a construct. `Err(is Corrupt):` had no user anywhere and its grammar
rule was one of those whose removal changed nothing; the applet needed exactly it, because
`@/packages/gzip`'s fault union splits *somebody else's disk* from *a statement about the archive*
and the whole point is that a caller may retry one and not the other.

---

## What the signatures say

Every applet, measured rather than sampled:

```
export i32 <name>(Core core, Cli cli, Fs fs, Args a)
```

**63 of 63, not one varying.** And **10 of 63 never mention `fs` anywhere outside that signature** —
`basename`, `date`, `dirname`, `echo`, `get`, `nc`, `seq`, `serve`, `uuid`, `yes`. Ten programs are
handed a whole filesystem they demonstrably do not touch.

That is not carelessness and the uniformity is why: a dispatcher calls all 63 through one shape, so
every applet's signature is the widest applet's signature. The breadth is a property of the dispatch,
not of any program in it.

**And it is wider than `Fs`.** Counting the methods each applet calls on what it was handed:

| what it calls | applets |
|---|---:|
| only output — `cli.write`, `core.warn` | **17** |
| a filesystem method directly | 37 |
| **a network method** | **5** |

Every applet mentions `cli`, which is why an earlier count of *"never mentions it"* returned zero:
`cli.write` **is** how a program prints. So `yes` and `echo` are handed `Cli` — which carries
`connect`, `listen`, `accept` and `bindDatagram` — in order to reach standard output. **58 of 63
never call a network method and all 63 hold the capability that has one.**

(37 is a floor: an applet that passes `fs` to a helper in `lib/` is not counted, since the call is in
the helper. The network figure does not have that problem, as nothing in `lib/` opens a socket.)

## The dispatcher already says the rest

`box.wac`, before anything else:

> **A multicall binary weakens the permission story**, and that is worth saying rather than hiding.
> `box`'s grants are the *union* of what its applets need, so running `box echo` carries the
> filesystem *and network* access `box cp` and `box get` would want. One applet per file means each
> could also be built alone, with only what it needs — `bin/` does exactly that for four of them.

Seven now. So the finding is known, stated at the right place, and mitigated by building seven
programs twice.

## What the language can do, and what it cannot

**It cannot fix the grant.** A module's authority is granted at instantiation, one set per instance,
so a module containing 63 programs holds the union of 63 programs' needs. No signature changes that.
This is the same fact `sh` met from the other side — there, a capability could not cross *into* a
spawned child; here, authority cannot be subdivided *within* a module. One underlying thing:
**authority is per-instance, and the language's per-function authority stops at the module edge.**

**It can stop the code reaching it, and `std` now says how.** The host's 50 capabilities fall into
five groups — file 14, net 9, process 8, env 4, io 3 — so `vision/std/platform.wac` makes the groups
values, and a function takes the ones it needs: `echo(Out out, Args a)` reaches standard output and
nothing else. A projection has no way back — no field on `Out` answers anything wider — so an
applet handed one **cannot** open a socket however it is written.

The counts above are what that is worth here: **17 applets would take `Out` and nothing else**, and
58 would never see the network. `Out` is exactly the projection this package needs and exactly the
one the current split does not have — `Cli` bundles printing with connecting, so there is no way to
hand over the first without the second.

That is the language half. The dispatch table is the other, and it is uniform only because it holds
function pointers; a closure would not have to be:

```wac
// each entry captures what that applet needs, and nothing else
Map<string, fn<i32(Args)>> applets;
applets.put("echo",  (a) => echo(core, cli, a));          // no fs in scope at all
applets.put("cat",   (a) => cat(core, cli, fs, a));
```

`echo` then cannot touch a filesystem because there is not one in its scope — a fact about the
program rather than about the grant. The host still granted the union; what changed is that 10 of 63
can no longer reach it by accident or by edit.

**Which is half of it, and the half worth having**, because the other half is a build decision that
`bin/` already makes correctly. Saying so is the point: *no ambient capabilities* is enforced inside
a module and negotiated outside one, and this package is where the two meet.

## Sorting, and the first gap that is not the language's

[`src/lines.wac`](src/lines.wac) is the third file taken from the 264 shipped sources nobody
predicted anything about, picked because sorting is the one thing in this package that is not I/O.

`sort -n` needs **two** comparisons over the same lines, and `packages/box/src/lib/lines.wac` has
both: `cmpNumeric` is the *key* — *are these the same line for `-u`*, where `1` and `01` are — and
`cmpNumericThenBytes` is the *order*, total, falling back to the whole line. The second **refines**
the first, that relation is what makes `sort -nu` correct, and it is written nowhere but two function
names and a paragraph. Hand the sort the order and drop adjacent equals, and `1` and `01` both
survive.

Every sorting library has this hole — `sortBy` takes one comparator, `distinctBy` takes a key,
nothing takes the pair. And the answer is a **library** type:

```wac
struct SortSpec<T> { fn<i32(T, T)> key; fn<i32(T, T)> tieBreak; }
```

The language has to add nothing. Which makes it the first finding in 127 entries where the
conclusion is *somebody should write the type* rather than *the type could say it if the language
allowed* — worth separating, because a list that only ever reaches the second reads as a list of
language requests, and one of them was not.

### A saturating key, which fixes a bug by moving it

`leadingNumber` saturates at `i64`, and the reason is measured: in `i32` it wrapped, and *"`-nu`
merged `4294967296` with `0` because both keys came out the same — a distinct line silently
dropped."* The bug was two distinct lines getting one key; the fix gives two distinct lines one key,
for every integer past `i64` max. What changed is the threshold and the monotonicity — wrapping
breaks the order, saturation does not — so it is right for `sort` and the class survives for `-u`,
which the file says.

[`@/packages/bignum`](../bignum/) is in this tree and unreachable from a sort key, because **a key
that allocates is a key you cannot compare in a loop.**

## What could not be written

**Nothing new** from the measurement. Lambdas, `Map`, `fn<…>` are all already proposed. The finding
there is a measurement, not a missing construct — and after twelve packages the measurements were
turning up more than the constructs were.

The four applets added later each found something and each is written up where it happened rather
than repeated here: `cat` on why *sum versus sentinel* was a question about the wrong thing; `tee` on
`defer` being two unanswered questions, on a write failure that can only be reported as `NotGranted`
when the real cause is a full disk, and on `tee -a` — **the first gap this exercise has found where
projecting the host faithfully reproduces a real hole** rather than narrowing one, since `openOut`
truncates deliberately and the host has no append; and `gunzip` on a payload matched by type being
unable to *read* what it matched, and on a union inside a union being the thing that makes its two
arms two rather than nine.

And one thing about this directory rather than about the language. `["-"]` — a one-element list
literal — is what `cat` wants and cannot have, so it keeps a four-line branch. That is the first line
in nine days to want a construct the grammar has carried on the strength of appearing on a page, and
it took writing a third applet to produce it.

**The measurements stopped being the productive half once the capabilities started being consumed**,
and the four applets are the evidence: sixty-three signatures counted in one afternoon said one thing,
and four programs written against the result have said six.
