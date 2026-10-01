# 39 — Map and hash

`Map<K, V>` is a hash map. It asks nothing of `K`: the hash and equality it uses are function values given when the map
is made, so a caller can hash a key case-insensitively, or on one field of a struct, without wrapping the key type.

## Making one

```wac
// expect: answers main = 1
import { Map, hashString, stringEq } from "core";

export i32 main() {
  Map<string, i32> m = Map.create(hashString, stringEq);
  Map<string, i32> big = Map.withCapacity(1000, hashString, stringEq);
  return m.isEmpty() && big.len() == 0 ? 1 : 0;
}
```

`[§wac-map-create-dbpymix]` `Map.create(hash, eq)` is an empty map using `hash` and `eq` on its keys;
`Map.withCapacity(n, hash, eq)` is one with room for `n` entries before it grows.

The two functions must agree: keys that `eq` calls equal must have equal hashes.

## Reading and writing

```wac
// expect: answers main = 1
import { Map, hashString, stringEq } from "core";

export i32 main() {
  Map<string, i32> m = Map.create(hashString, stringEq);
  bool fresh = !m.set("a", 1);             // false: "a" was not present
  bool again = m.set("a", 2);              // true: overwritten
  m.set("b", 3);

  i32? a = m.get("a");                     // 2
  i32? z = m.get("z");                     // null
  i32 zOr = m.getOr("z", -1);              // -1
  bool has = m.has("b");
  bool removed = m.remove("b");            // true
  bool gone = !m.has("b") && !m.remove("b");

  return fresh && again && a! == 2 && z is null && zOr == -1 && has && removed && gone && m.len() == 1
      ? 1 : 0;
}
```

`[§wac-map-set-p734737]` `set(k, v)` stores `v` under `k`, and answers whether `k` was already present.

`[§wac-map-get-nww5rzz]` `get(k)` answers the value under `k`, or `null`; `getOr(k, d)` answers `d` instead of `null`;
`has(k)` answers whether `k` is present.

`[§wac-map-remove-3b5hsf5]` `remove(k)` removes `k` and answers whether it was there.

`keys()` and `values()` answer arrays of the map's keys and values, in an unspecified order that is the same for both
calls on an unchanged map. `clear()` empties it.

## Hash and equality functions

`core` provides the common pairs:

```wac
// expect: answers main = 1
import { hashBytes, bytesEq, hashString, stringEq, hashI32, i32Eq, hashI64, i64Eq } from "core";

export i32 main() {
  bool a = bytesEq([1, 2], [1, 2]) && hashBytes([1, 2]) == hashBytes([1, 2]);
  bool b = stringEq("x", "x") && hashString("x") == hashString("x");
  bool c = i32Eq(4, 4) && hashI32(4) == hashI32(4);
  i64 big = 4;
  bool d = i64Eq(big, big) && hashI64(big) == hashI64(big);
  return a && b && c && d ? 1 : 0;
}
```

`[§wac-hash-functions-9nudhjr]` `hashBytes`/`bytesEq`, `hashString`/`stringEq`, `hashI32`/`i32Eq` and `hashI64`/`i64Eq` are
consistent pairs: equal values hash equally.

## References are comparable but not hashable

Comparing two references with `is` costs nothing. Hashing one by identity is not free, and the language does not give it
to every reference: a moving collector invalidates anything derived from an address, and there is no object header to
keep a lazily assigned hash in, so the only portable way is a field assigned when the object is made — a word on every
object.

A type that wants to be a key carries that field itself:

```wac
// expect: answers main = 7
import { Map } from "core";

struct Keyed {
  i32 id;                                  // assigned by whoever allocates it
  string name;
}

i32 hashKeyed(Keyed k) { return k.id; }
bool sameKeyed(Keyed a, Keyed b) { return a is b; }

export i32 main() {
  Map<Keyed, i32> m = Map.create(hashKeyed, sameKeyed);
  Keyed k = Keyed(1, "first");
  m.set(k, 7);
  return m.get(k)!;
}
```

`[§wac-ref-not-hashable-gv8ba4x]` No reference type has a built-in hash. A map keyed by references is given a hash function
like any other.
