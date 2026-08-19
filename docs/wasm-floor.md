# What a wac module requires

MVP plus non-trapping float→int conversions, reference types, typed function references, garbage
collection, and **bulk memory** — Chrome 119+, Firefox 120+, Safari 18.2+, Node 22+, Deno. All
shipped, none behind a flag.

Bulk memory is the newest entry here and the oldest proposal in it: it shipped in 2020, years before
GC, so it moves no engine off this list. It arrived on 2026-08-19 with `issues/lang/0162`, which made
a string literal a data segment and an `array.new_data` rather than one `i32.const` per byte — and a
data segment brings a datacount section, which is bulk memory. A program with no string literal in it
still does not use the feature.

That is the floor, and it is deliberate: nothing is emitted from a proposal that is not broadly
supported.

**An optimised build is held to the same floor, by construction.** `deno task app:build --optimize`
runs the module through `wasm-opt`, and an optimiser is entitled to emit anything its feature set
allows — so `packages/platform/build.ts` hands it exactly the features above and no others. It
briefly handed over three more (bulk memory, tail calls, stringref), which the emitter did not use
and which would have let an optimised artifact require more of an engine than the plain one, in a
way nothing would notice on an engine that supports both. Two of those three are still out.

**Bulk memory went back on the list on 2026-08-19, and the way it was noticed is the argument for
keeping the list narrow.** `issues/lang/0162` moved the emitter past what the optimiser had been
told, and `wasm-opt` refused every module containing a string with *Data segment operations require
bulk memory*. Nothing else caught it: the plain build was fine, the tests were green, and the only
thing that objected was the component holding the tighter contract. A wider feature set would have
optimised happily and said nothing. There are no exception-handling, tail-call or SIMD opcodes in the emitter. A
feature that would cross this line — JSPI, for instance, which the callback design happens to make
available to a host that wants it — is a decision to take explicitly, not a convenience to adopt
because an engine you have to hand supports it.

## The other direction

[`WASM-WISHLIST.md`](../WASM-WISHLIST.md) is a running list of what wac wanted from WebAssembly and
could not have, each with the code that works around it and what the workaround costs.

It exists because this project sits in an unusual corner. WasmGC's rough edges get reported by
object-graph languages; linear memory's get reported by C and Rust. A GC-first language doing
byte-heavy systems work — TLS, SSH, Tor, compression, pairings — hits gaps neither of them would,
starting with the fact that **nothing in WebAssembly copies between a GC array and linear memory**,
which is enough on its own to lock a GC-first language out of SIMD.
