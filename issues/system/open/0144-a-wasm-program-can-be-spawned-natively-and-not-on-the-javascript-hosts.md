# 0144 — a wasm program can be spawned on the native hosts and not on the JavaScript ones

- **Status:** open
- **Claimed by:** agent-c, 2026-08-15 — the runtime marshaller first
- **Reported by:** agent-b
- **Date:** 2026-08-12
- **Kind:** missing feature
- **Symptom:** not implemented

## What changed, and the split it left

`Cli.spawn` takes `u8[]` now rather than `string`, because a program is not text: every caller
reached it through `string.fromBytes(prog.bytes)`, which is lossless only while a program happens to
be a UTF-8 JavaScript bundle. A module carries its own manifest in a `wac.manifest` custom section,
so one artefact describes a program, and `native/v8` starts a child from those bytes alone:

    $ ./wacv8 runner.wasm child.wasm "hello from a spawned child"
    1 5 27

The JavaScript hosts still start **worker bundles** and say so by name when handed a module. So the
same wac program — one that reads a file and spawns it — works under `wacv8` and fails under Deno,
which is a portability split rather than a missing convenience. `packages/sh` searching `$WACPATH`
is the case that will find it first: a `.wasm` there runs on one host and not another.

## What the JavaScript hosts are missing, exactly

Not the capabilities — `denoWorld`, `provider.ts` and the bridge already serve every one. What they
lack is the thing the *generated glue* does per program, done generically from the manifest instead:

| what the glue does today | what a generic driver would do |
| --- | --- |
| presents `AppModule` — `Core.of`, `Cli.of`, `Pending$i64.of`, … | build the same objects from the manifest's structs, calling `$bind$sm_<bind>_of` |
| one import per callback signature, converting arguments | one import per `C` line, converting from its `params`/`ret` |
| `$strTo`/`$strFrom`, `$arrTo_*`/`$arrFrom_*` per type | the same conversions, chosen at run time by the type string |

The first row is small — the manifest already names every constructor's export, and
`Pending$i64` ← `Pending<i64>` is the mangling `native.ts` resolves. The third is the bulk: runtime
marshalling driven by type strings, which is what `native/v8/src/main.rs`'s `read_string`,
`write_bytes`, `build_stat` and their neighbours are, in TypeScript.

## How much marshalling, measured rather than guessed

Across every manifest in this repository, **211 distinct type strings** cross the boundary — and
they are only **seven shapes**:

| shape | examples |
| --- | --- |
| scalars | `i32` (1,512), `bool` (519), `i64` (91), `void` |
| text | `string` (803) |
| byte arrays | `u8[]` (340), `u8[][]` (45) |
| other arrays | `string[]` (73), `i32[]` (56) |
| funcrefs | `fn[...]` — the callback machinery, not value conversion |
| named types | `Pending<T>`, `Read`, `Stat`, `Change`, `Socket`, `Buf`, `Cli`... |
| nullable | the same with `?` |

Everything in the last two rows is an **opaque reference the host passes straight back**: it never
looks inside a `Stat` it did not build, and the ones it does build have named constructors in the
manifest. So the conversions a driver must implement are the seven in `native/v8/src/main.rs` and
not two hundred.

**A worked reference exists.** `native/v8/src/main.rs` is 2,498 lines, of which the marshalling and
module-driving is perhaps a third; the rest is capability implementation the JavaScript hosts
already have. `packages/wacc/tools/waccBindgen.ts` is 632 lines and generates exactly these
conversions — reading it as a specification for the runtime version is the cheapest way in.

## Why it is worth doing rather than living with

One artefact instead of two, for every host. The bundle is 1,307 KB for `boxsh` against 649 KB of
wasm carrying a 389 KB manifest, so the pair is smaller than what ships today. And a program that
spawns stops caring which host it is on, which is the property this whole platform is for.

## What not to do

Do not make `spawn` sniff the bytes and accept either. The JavaScript hosts should keep starting
bundles until the driver exists — and then stop, in one change, rather than carrying two paths whose
difference nobody remembers.

## 2026-08-15: the three rows above are done, as `packages/platform/host/marshal.ts`

The table in "What the JavaScript hosts are missing, exactly" is now implemented, with tests whose
oracle is a real module rather than a list of expected names.

| the row | what exists now |
| --- | --- |
| present `AppModule` — `Core.of`, `Cli.of`, … | `structBridge`: derives `$bind$sm_<bind>_<name>` / `$bind$m_…`, converts arguments and results, checks arity where the method still has a name |
| one import per callback signature | `callbackBridge`: one import per `C` line, slot table per signature, deduplicated by identity, funcref from the module's own `$bind$fnref_N` |
| `$strTo`/`$arrTo_*` per type | `shapeOf` + `fromWasm`/`toWasm`, chosen at run time from the type string |

**`Core` is built from eight funcrefs through the manifest alone**, which is the demonstration that
matters: that object is what a program's `main` takes, and nothing generated was involved.

The estimate in this issue held. Seven shapes, and everything named is opaque — 31 distinct type
strings in `boxsh`'s manifest and ten array-helper families, all resolved from the string.

### What is left

Wiring it into the hosts: `deno.ts`, `node.ts` and `browser.ts` still start worker bundles, and
`spawn` still refuses a module by name. That is where this issue's "and then stop, in one change"
applies — the driver should replace the bundle path rather than sit beside it.

### Three things worth knowing before continuing

- **`$bind$arr_<suffix>_new`'s arity is not uniform.** A defaultable element gets `_new(len)` and
  fills itself; a reference gets `_new(len, fill)` *and* a `_new0()`. Passing a fill to the arity-1
  form is silently accepted and ignored, which drops element zero. `_new0`'s existence is the
  observable form of the compiler's `needsFill`, and is what the marshaller branches on.
- **`$bind$str_new(n)` allocates n bytes; `$bind$str_from_mem(n)` reads them.** Both answer `n` to
  `str_len`, so a probe that checks the length is happy with either.
- **A stub instance is enough to test all of this.** Every import is a function and none is reached
  by the `$bind$` helpers, so a real 800 KB module can be instantiated with throwing stubs and
  driven with no host, no capabilities and no grants.

### A program runs, 2026-08-15

`packages/platform/test/wac/driver_probe.wac`, compiled and then run with **no generated glue in the
path**: instantiated on the bridge's imports, `Core` and `Cli` built from their manifest fields
sharing one slot table, `main` located from `exports` and called, the answer converted back. It
returns 21 rather than 0, so a driver that called the wrong export or built a world that trapped
cannot produce the right answer by accident.

The probe calls nothing, deliberately. Every capability answers `Pending<T>`, and *waiting* on one is
the host's asynchronous bridge — the SharedArrayBuffer and the ticket table — rather than anything
the marshaller does. So this is the largest end-to-end claim available before that bridge is wired
in, and it establishes that everything except the bridge is done: 45 signatures, 43 capabilities, two
worlds, an export read from a string.

**What is left is exactly the wiring**, and its shape is now clear: reuse each host's existing
capability implementations and its Pending machinery, and give `spawn` the module path instead of the
bundle path — in one change, as this issue says, rather than two routes whose difference nobody
remembers.
