# 39 — Map and hash

`Map<K, V>` is a hash map. It asks nothing of `K`: the hash and equality it uses are function values given when the map
is made, so a caller can hash a key case-insensitively, or on one field of a struct, without wrapping the key type.

## Making one

```wac
// expect: answers startEmpty = true
import { Map, hashString, stringEq } from "core";

export bool startEmpty() {
  Map<string, i32> m = Map.create(hashString, stringEq);
  Map<string, i32> big = Map.withCapacity(1000, hashString, stringEq);
  return m.isEmpty() && big.len() == 0;
}
```

`[§wac-map-create-dbpymix]` `Map.create(hash, eq)` is an empty map using `hash` and `eq` on its keys;
`Map.withCapacity(n, hash, eq)` is one with room for `n` entries before it grows.

The two functions must agree: keys that `eq` calls equal must have equal hashes.

## Reading and writing

```wac
// expect: answers setTwice = true
// expect: answers getOf("a") = 2
// expect: answers getOf("z") = null
// expect: answers getOrOf("z") = -1
// expect: answers hasOf("b") = true
// expect: answers removeOf("b") = true
// expect: answers removeOf("z") = false
import { Map, hashString, stringEq } from "core";

Map<string, i32> sample() {                // {"a": 2, "b": 3}
  Map<string, i32> m = Map.create(hashString, stringEq);
  m.set("a", 2);
  m.set("b", 3);
  return m;
}

export bool setTwice() {
  Map<string, i32> m = Map.create(hashString, stringEq);
  bool first = m.set("a", 1);              // false: "a" was not present
  bool second = m.set("a", 2);             // true: overwritten
  return !first && second && m.get("a")! == 2;
}

export i32? getOf(string k) { return sample().get(k); }

export i32 getOrOf(string k) { return sample().getOr(k, -1); }

export bool hasOf(string k) { return sample().has(k); }

export bool removeOf(string k) {
  Map<string, i32> m = sample();
  bool removed = m.remove(k);
  return removed && !m.has(k);
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
// expect: answers consistentPairs = true
import { hashBytes, bytesEq, hashString, stringEq, hashI32, i32Eq, hashI64, i64Eq } from "core";

export bool consistentPairs() {
  bool a = bytesEq([1, 2], [1, 2]) && hashBytes([1, 2]) == hashBytes([1, 2]);
  bool b = stringEq("x", "x") && hashString("x") == hashString("x");
  bool c = i32Eq(4, 4) && hashI32(4) == hashI32(4);
  i64 big = 4;
  bool d = i64Eq(big, big) && hashI64(big) == hashI64(big);
  return a && b && c && d;
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
// expect: answers keyedByIdentity = 7
import { Map } from "core";

struct Keyed {
  i32 id;                                  // assigned by whoever allocates it
  string name;
}

i32 hashKeyed(Keyed k) { return k.id; }
bool sameKeyed(Keyed a, Keyed b) { return a is b; }

export i32 keyedByIdentity() {
  Map<Keyed, i32> m = Map.create(hashKeyed, sameKeyed);
  Keyed k = Keyed(1, "first");
  m.set(k, 7);
  return m.get(k)!;
}
```

`[§wac-ref-not-hashable-gv8ba4x]` No reference type has a built-in hash. A map keyed by references is given a hash function
like any other.
