# 0387a — `Vec<fn<…>?>` emits an `at` the engine refuses

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-20
- **Kind:** bug
- **Symptom:** invalid wasm

## Reproduction

```wac
import { Vec } from "core";
export i32 f() {
  Vec<fn<i32()>?> v = Vec.create();
  fn<i32()> g = () => 7;
  v.push(g);
  v.push(null);
  fn<i32()>? h = v.get(0);
  i32 n = 0;
  if (h is not null) { n = h!(); }
  if (v.get(1) is null) { n = n + 1; }
  return n;
}
```

Expected: `8`.
Actual: `wac build` writes the module and the engine refuses it — *Compiling function
"Vec<fn[i32()]?>.at" failed: type error in return[0] (expected (ref null 263), got (ref 16))*.

## Notes

`Vec<P?>` for a struct `P` works, `at` included (its `T?` is a `P??`, a box, as spec ch38
`§wac-vec-pop-nested-rgci8id` says). With a nullable *function* type the signature of `at` is the box
— `fn[i32()]??` — and the value returned is the bare pair, unboxed, so the nested-nullable path loses
the box somewhere for a funcref and not for a struct. `get`, which answers `T`, is fine; every method of
the instance is emitted, so the refusal does not depend on calling `at`.

Found building `packages/web`'s `element.wac`, whose handlers were a `Vec<fn<void(ElementEvent)>?>`; it
holds an inert function for "none" instead.
