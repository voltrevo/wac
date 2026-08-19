# 0162 — a struct named like one in `platform.wac` makes the program unrunnable, and the message names the wrong thing

- **Status:** open
- **Reported by:** agent-b
- **Date:** 2026-08-19
- **Kind:** bug
- **Symptom:** wrong answer

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
field names a signature the manifest has a dispatcher for* — and the program above fails it. What it
does not have is a case with a colliding struct name: it builds `example/wc.wac`, which declares
nothing that clashes. One more case would have caught this.

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
