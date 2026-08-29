# 0287b — the build cache is off on every host but one, and the spec says otherwise

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-b
- **Date:** 2026-08-29
- **Kind:** bug — a documented clause that is false on a host we ship
- **Symptom:** no error; every build recompiles from source

## Measured

The same program — a hello-world importing `std/platform.wac` — built twice into a fresh
`$WAC_HOME`, on each host:

| host | build 1 | build 2 | entries in `$WAC_HOME/cache/build` |
|---|---:|---:|---:|
| `native/v8/target/release/wac` | 1 408 ms | **118 ms** | **1** |
| `native/target/release/wac` (wasmtime) | 6 992 ms | 675 ms | **0** |

The v8 second build is a hit. The wasmtime one wrote nothing, so its second build recompiled; the
675 ms is warm-process effects rather than a cache.

## Why

`cacheKey` in `packages/wac/src/wac.wac` refuses to key a build it cannot attribute to a compiler:

```wac
u8[]? id = cli.env("WAC_COMPILER_ID").wait();
if ((id is null) || id!.len() == 0) { return ""; }
```

That is the right refusal — the compiler is part of the key, and an entry that cannot name the
compiler that made it is exactly the stale hit the cache exists to avoid. But **only one host sets
the variable**. `compiler_id()` and its `set_var` live in `native/v8/src/main.rs` and nowhere else:

    $ rg -l WAC_COMPILER_ID
    packages/wac/src/wac.wac              # reads it
    native/v8/src/main.rs                 # sets it
    packages/wac/test/wac/compilerid_test.wac

So the wasmtime host, and any JavaScript host, silently take the uncached path.

## Why the spec makes this a bug rather than a gap

`spec/cli/wac.md` `[§wac-cli-build-cache-7pk3mq9]` states it without a host qualifier — *"`build`
remembers what it built, under `$WAC_HOME/cache/build`"* — and then enumerates the exceptions:
`--coverage`, `--trace`, a build with no `$WAC_HOME`, one with no `-o`, and one that warned. The host
is not among them, so on wasmtime a documented clause is false and nothing says so.

## Why nothing caught it

`packages/wac/test/wac/compilerid_test.wac` asserts the variable is set before any payload runs, and
drives `wacBinary(cli)` — the v8 binary. `packages/wac/test/wac/buildcache_test.wac` is the same: it
runs the checkout's command through the v8 host. Both are right about the host they ask, and neither
asks the other one.

`issues/system/0208` is the shape of that: eleven files reach for the wasmtime binary and skip when it
is not built, so a claim nobody makes about it is a claim nobody misses.

## What to do, and the decision inside it

The mechanical answer is for `native/src/main.rs` to set `WAC_COMPILER_ID` the way `native/v8`'s does.
The decision is **what the id should be**, because it has to identify the compiler and the two hosts
carry the same seed by construction:

* If the id is a hash of the seed, both hosts compute the *same* id — and then they share cache
  entries, which is correct exactly to the extent that two hosts running one compiler produce
  identical bytes. That is `issues/system/0230a`'s claim, and `commandparity_test.wac` is the
  measurement of it. If it holds, sharing is a saving; if it ever stops holding, sharing turns a
  host difference into a wrong artefact.
* If the id also names the host, the hosts never share and each pays its own first build. Safer,
  and it gives up something the repository otherwise asserts is true.

Not obvious, which is why this is filed rather than patched. Whichever is chosen, the test that keeps
it honest is the one that does not exist: `buildcache_test.wac`'s cases, run against the wasmtime
binary, skipping with `nativeHostWhyNot()` when it is not built.

## What it costs today

Every build under the wasmtime host, which is the host `./bootstrap.sh --host wasmtime` produces and
the one `design/system/0001` D9 keeps to prove a wac program does not depend on a JavaScript engine.
It also means any timing comparison between the two hosts is measuring the cache unless both are cold
— worth knowing before reading a number from a two-host differential.
