# 0354a — 658 constants are spelled as function calls, and the compiler says why in a comment that stopped being true on 2026-07-31

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-09-05
- **Kind:** missing feature
- **Symptom:** none at run time on v8, measured — 658 declarations of a workaround for a gap the language closed five weeks ago

`packages/wacc/src/kinds.wac`, above 89 declarations:

> Every one of these is a zero-argument function because wac has no module-level constants. A
> 85-variant enum therefore costs 85 declarations, which is the clearest measurement so far of that
> gap.

**wac has module-level constants.** `spec/spec/variables.md`'s *Module-level constants* section
landed **2026-07-31**:

```wac
const i32 BLOCK = 64;
const i32 TWO_BLOCKS = BLOCK * 2;      // constants may build on constants
export const u32 POLY = 0xEDB88320;    // and may be imported
```

`[§wac-modconst-import-p7fm2wj]` — an exported constant can be imported by name. The worked example
is the CRC-32 polynomial, which is `packages/gzip/src/crc32.wac`'s constant.

Compiled and run today to be sure it is not spec-only: `export const i32`, `export const u32`, and a
constant built on a constant all work, and the value arrives at the use site.

## The count

Zero-argument functions whose body is `return <integer literal>;`, over `packages/*/src`:

**658 across 89 files.** Against **281** `const` declarations tree-wide — the workaround outnumbers
the feature by more than two to one.

| file | declarations |
|---|---:|
| `packages/wacc/src/check.wac` | 99 |
| `packages/wacc/src/kinds.wac` | 89 |
| `packages/quic/src/frame.wac` | 26 |
| `packages/tor/src/relay.wac` | 24 |
| `packages/tor/src/cell.wac` | 21 |
| `packages/tls/src/record.wac` | 21 |

The compiler is 188 of the 658, 29%.

They are what they look like: token kinds (`kAsBang() { return 33; }`), protocol message types
(`msgDisconnect() { return 1; }`), ABI tags (`T_TUPLE() { return 9; }`), encode-set indices
(`SET_C0() { return 0; }`).

## Why this is worth a number

Same shape as `issues/system/0352a` — *a design justified by a limitation outlives the limitation* —
with one difference that makes it sharper. `copyFrom` was merely **unknown** to the 750 loops that
predate it. Here the limitation is **written down, in the compiler, as the reason**, so every reader
of `kinds.wac` since 31 July has been told the gap is open.

### Corrected after filing, and the correction changes the ask

The first version of this issue implied nobody had noticed, and proposed converting a file as the
smallest useful step. **Both were wrong, and `packages/gzip/src/tables.wac` had already got it
right** — including the part I had not:

> They live in a struct built once per call, and **the reason given for that has expired.** This
> said "wac has no top-level constants"; it has them, including arrays — `const i32[] LEN_BASE =
> i32[](…)` at file scope compiles, and is hoisted rather than rebuilt: 200,000 reads of a 29-entry
> top-level const measured 0 ms against 6 ms for 200,000 constructions of the equivalent struct.
>
> **Measured before changing anything, and then not changed.** `Tables.create()` has three call
> sites … So the cost the workaround carries is about thirty nanoseconds per gzip operation, and
> rewriting four tables to save it would be churn. Threading it explicitly is arguably the better
> shape anyway: nothing here reads a table it was not handed.
>
> What was wrong was the *reason*, and **a false constraint in a comment is worth more than the
> thirty nanoseconds: the next person to need a table at file scope reads this and believes they
> cannot.**

That last sentence is this issue, stated better and a month earlier, by someone who then measured
the conversion and declined it.

**So the ask is not a sweep of 658 declarations.** The sweep is churn by exactly the argument above,
and `vision/bench/constcall.wac` puts the scalar case at *zero* — 178 ms across all four arms — which
is even weaker than the 30 ns `tables.wac` measured for the struct case. **The ask is that the false
constraint stops being written down.** That is two comments, not 89 files.

### The cleanup is real and this is what it has not reached

The repository corrects stale language claims in place, and this exact claim is one it has fixed
twice already:

    packages/gzip/src/gzip.wac:19      "This said '(wac has no top-level constants, so this is a function.)'"
    packages/gzip/src/tables.wac:9     "'wac has no top-level constants'; it has them, including arrays"
    packages/wacc/src/lex.wac:41       "The reason here said 'wac has no generics' and that is wrong twice."
    packages/bytes/src/buf.wac:6       "This said 'wac has no generics' and that has expired"
    packages/git/src/pack.wac:645      "(This said **wac has no closures**…)"
    packages/sh/src/exec.wac:4762      "a lambda has captured since 2026-08-16"
    packages/wacc/src/coretext.wac:777 "This comment used to say 'wac has no closures…'"

**38 corrections of that shape across 23 files** under `packages/*/src`, counting only `used to say`,
`this said`, `has expired` and `is wrong twice` — a floor, since nothing standardises the phrasing.

So: **a sustained cleanup exists, and `kinds.wac` is the largest site it has not reached** — 89
declarations, in the compiler, still asserting the constraint as live. That is a better argument for
acting than *nobody noticed* was, and a cheaper one: correct the comment, and let whoever needs a
file-scope constant next know they can have one.

### The sweep that would find the rest cannot be a grep

Two live claims turned up, and **the first pass found neither**: `packages/fmt/src/atof.wac:402`
wraps between *"wac has"* and *"no generics"*, and `kinds.wac`'s wraps in the middle of
*"module-level | constants"*. A line-oriented pattern misses both, and allowing one break after the
verb still misses the second. **Two is a floor**, and an instrument for this must read a doc comment
as a paragraph.

And one thing to carry into any such sweep: **a stale reason does not imply a stale conclusion.**
`atof.wac`'s `bisect32` is separate from `bisect` because *"wac has no generics"*, which is false —
but generics monomorphise and the body calls `f64.fromBits`, a primitive named on a type, with no way
to write `T.fromBits`. Correcting the comment and merging the two functions produces a body that does
not compile. Check each conclusion, not only each reason.

## What has to be settled before sweeping

**1. Whether it costs anything — measured, and mostly no.** `vision/bench/constcall.wac` times the
shape these are consumed in: a chain of eight equality tests, which is
`packages/wacc/src/wapyrewrite.wac:105`, with the eight spelled as `const`, as private functions, and
as exported functions.

        tests     konst     priv   export    again
    536870912       178      178      178      178

A dead tie to the millisecond, at about one comparison per cycle. **So this is a readability and
line-count change and must be argued as one — there is no performance case here.**

With one caveat that should not be dropped. The compiler did *not* remove the call: grepping
`emit.wac` for inlining finds only constant scalars — *"Scalars are inlined at every use rather than
given a global"* — and no function-inlining pass. The module contains a real `call`, and **v8 erases
it at run time**. `--host wasmtime` is the engine with no JavaScript under it and
`design/system/0001` D9 says its purpose is to test exactly the claim that a wac program does not
depend on one, so a cost only a JIT removes is a cost that host still pays. This checkout has no
wasmtime binary to ask (`issues/system/0208`), so that half is unmeasured. It does not change the
recommendation; it changes what may be claimed.

**2. What `kinds.wac` is actually waiting for, which is not this.** Its comment names the change it
wants: *"wac now has enums — this file is a candidate for becoming one, once an enum can be used
where an i32 is expected."* Token kinds are compared, stored in arrays, and **ranged over** — *"the
keyword kinds `kImport`(5)..`kMatch`(32) are contiguous and `parse.wac` tests that range rather than
listing them"* — and an enum does none of those today. So `kinds.wac` should not be swept to `const`
if the enum change is close; it should be swept if it is not. Those 89 are the only sites where the
question arises, and `issues/lang/0346a` (a payload-free variant is a `struct.new`) is the other half
of it.

**3. Ordering.** A `const` initialiser must be a compile-time constant expression, so a constant
built from another constant is fine and one built from a call is a compile error
(`[§wac-notconst-r4jn9kq]`). None of the 658 has a call in its body, so nothing blocks the
substitution — but a file that converts halfway will have `const`s and functions naming the same
kind of thing, which is worse than either.

## The smallest useful step

**Correct the two comments.** `packages/wacc/src/kinds.wac` and `packages/fmt/src/atof.wac:402`, in
the house style the other seven sites already use. That is the whole of what this issue needs to be
acted on, and by `tables.wac`'s argument it is also most of the value.

Everything below is what a *conversion* would cost, kept because someone will ask.

`packages/url/src/percent.wac` has seven declarations that are compared and nothing else — no array
indexing, no ranges, no arithmetic — which makes it the easiest file in the tree. Sized exactly:
**seven declarations and 35 call sites across six files**, since the `()` has to come off every use.

    packages/url/src/percent.wac            13
    packages/url/test/wac/url_test.wac      12
    packages/url/src/url.wac                 6
    packages/url/test/cov_exercise.wac       2
    packages/box/src/applets/urlencode.wac   1
    packages/url/src/host.wac                1

So even the easiest file in the tree is a six-file commit crossing a package boundary and two test
files, to save a measured zero. That ratio — seven declarations, 35 uses — is why 658 of these are
still here, and why the conversion is not what is being asked for.

`vision/packages/url/src/percent.wac` records the same file's other two problems, which are unrelated
and worse: the encode sets are named by bare integers with no default guard, and the header's account
of how they relate is contradicted by the package's own test file.
