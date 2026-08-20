# 0162b — a struct named like one in `platform.wac` makes the program unrunnable, and the message names the wrong thing

- **Status:** closed
- **Fixed in:** the message and the wiring, both this commit
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer
- **Note:** filed as `0162` and renumbered `0162b` on 2026-08-19 — `issues/lang/closed/0162` was taken by another agent the same morning, and the suffix is the convention for exactly that (`issues/system/0191`). Nothing but this file referenced the old number.

## Reproduction

```wac
import { Core, Cli } from "../../packages/platform/src/platform.wac";

struct Stat { i32 n; }

export i32 main(Core core, Cli cli) {
  Stat s = Stat(1);
  core.log("n=" + (s.n == 1 ? "1" : "?"));
  return 0;
}
```

```
$ wac run --allow-read p.wac
wac: main wants a Cli and the manifest describes none
```

Expected: `n=1`. Rename the struct to anything `platform.wac` does not declare and it prints that.

Actual: the program does not start. It **compiles cleanly** — `wac check` reports no diagnostics — and
`wac build` writes a module and a manifest without complaint.

## What is actually wrong, which is not what the message says

The manifest **does** describe a `Cli`; it is entry 1 of `structs`. What has happened is one level in:

```
$ jq -r '.structs[] | select(.name=="Cli") | .fields[] | select(.name=="stat") | .type' p.json
fn[Pending<Stat__packages_platform_src_platform>(string)]

$ jq -r '.callbacks[].type | select(test("Stat__"))' p.json      # nothing
```

Two files declare `Stat`, so the linker qualifies `platform.wac`'s by its declaring file — which is
right, and is what file-scoped names are for. But `Cli.stat` and `Cli.linkStat` are funcref fields
whose *signature strings* now carry the qualified spelling, and **no callback is emitted under that
signature**. `native/src/manifest.rs` resolves a funcref field by looking its type string up among the
callbacks (`callback_index(ty)`), finds nothing, and cannot wire the struct — so the host reports it as
absent.

So the message is a misdiagnosis in the direction that costs the most: it sends a reader to look for a
missing struct, and the struct is there.

## The check for this already exists and nothing drives it

`packages/platform/test/wac/native_manifest_test.wac` asserts exactly this property — *every funcref
field names a signature the manifest has a dispatcher for*. Run that check by hand over the manifest
above and it fails three times:

```
unresolved funcref fields: 3
Cli.stat:       fn[Pending<Stat__packages_platform_src_platform>(string)]
Cli.linkStat:   fn[Pending<Stat__packages_platform_src_platform>(string)]
Pending<Stat__packages_platform_src_platform>.resolve: fn[Stat__…(i32)]
```

What the test does not have is a case with a colliding struct name: it builds `example/wc.wac`, which
declares nothing that clashes. One more case would have caught this — and the case is not added here,
because a red test in the tree is worse than a note in an issue while this is open.

## Notes

The names that do it are whatever `platform.wac` declares, which today includes `Stat`, `Change`,
`Exec`, `Child`, `Socket`, `Read`, `Captured`, `FileResult` and `Datagram` — all ordinary words a
program might reach for. `Stat` cost about twenty minutes here: `packages/crypto/tools/ct.wac` declared
one for `wac tracestat`'s three numbers, and the failure looked like a platform or manifest problem
rather than a name.

Two things would each be enough on their own:

  - **Emit the callback under the qualified signature too**, so `callback_index` finds it. That is the
    smaller change and keeps file-scoped names doing what they are for.
  - **Say what is wrong.** "`Cli.stat` names `fn[Pending<Stat__…>(string)]` and no dispatcher was
    emitted for it" is a sentence a reader can act on; "the manifest describes none" is not, and is
    false besides.

Related: `issues/lang/0089` is the same family — a mangled name that reaches the glue in a spelling
nothing else produces. `issues/lang/0106` is the `Pending<u8[]?>` alias, which is the case where the
manifest carries *both* spellings pointing at one type; that is the shape the fix here probably wants.

## The message is fixed — 2026-08-20

The second of the two things above. It now says what is wrong:

    $ wac run --allow-read p.wac
    wac: main wants a Cli and this host could not build one: Cli.stat names
    fn[Pending<Stat__std_platform>(string)], which no dispatcher serves and which the manifest
    does not describe

**The sentence already existed** — `build_struct` produces exactly that text — and `main.rs` threw it
away one line later:

```rust
let cli = match build_struct(…) {
    Ok(v) => Some(v),
    Err(_) => None,          // ← the reason, discarded
};
```

The tolerance is deliberate and is kept: the comment above it says a `Cli` this host cannot finish must
not stop a program that never touches the missing capability. What was wrong was losing the *reason*, so
a program whose `main` does take a `Cli` got a sentence that was both useless and false. The error is now
carried and printed at the point where it matters, and nowhere else — a program that does not ask for a
`Cli` still runs.

So this is the same shape as `issues/lang/0170a`'s `funcWhy`: the diagnostic was written, stored, and
never read.

**The program still does not run**, because the first bullet — emitting the callback under the qualified
signature so `callback_index` finds it — is untouched. That remains the fix; this is the part that stops
it costing twenty minutes to find.

Verified: the renamed control still prints `n=1`, `native_manifest_test.wac` passes, and
`packages/platform/test/platform.test.ts` is green.

## The wiring is fixed too — and it was not what this issue said

The issue reads: *"no callback is emitted under that signature"*, which suggested the callback was
**unqualified** while the field was qualified. Reading the manifest out of the module says otherwise:

    field:    fn[Pending<Stat__std_platform>(string)]
    callback: fn[Pending<Stat@1>(string)]

Both are qualified. They use **two different qualification schemes** for one type — the field goes
through `metaTypeSpelling`, which turns a linker key into `Stat__std_platform`, and the callback carried
the raw key `Stat@1`. `callback_index` matches by string, so it found nothing.

`@N` is an internal linker key and had no business in a manifest a host reads. One call:

```wac
out = out + line + "\t" + metaTypeSpelling(env, cb) + "\n";   // was: + cb +
```

The program now prints `n=1`. Canaried by reverting that call — the new test fails with *"a struct named
like one in platform.wac stopped the program"*.

**And the case the issue withheld is now in.** It said *"one more case would have caught this — and the
case is not added here, because a red test in the tree is worse than a note in an issue while this is
open"*. That was the right call and the ordering it implies is fix first, case second:
`native_manifest_test.wac` now builds and **runs** a program declaring `struct Stat`, asserting the
output rather than the manifest — the manifest agreeing with itself is what the older test in that file
is for.

Verified: `packages/platform/test/wac/` 34 of 34 files (with `--allow-net`, which the socket tests need
and I forgot the first time), `packages/box/test/wac/` 17 of 17, bindgen and jsBindgen 12 of 12, specEmit
419/419, 221 of 221 cases, and `wacc/example/wacc.wac` still compiles a program through itself.