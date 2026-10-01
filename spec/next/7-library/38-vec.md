# 38 — Vec

`Vec<T>` is a growable array. It owns a backing array larger than it needs and doubles it when full, so appending is
amortised constant time.

## Making one

```wac
// expect: answers main = 6
import { Vec } from "core";

export i32 main() {
  Vec<i32> a;                              // empty: a Vec has a default
  Vec<i32> b = Vec.create();               // the same
  Vec<i32> c = Vec.withCapacity(100);      // room for 100 before it grows; still empty
  Vec<i32> d = Vec.fromArray([1, 2, 3]);   // takes the array as its storage
  return a.len() + b.len() + c.len() + d.len() + 3;
}
```

`[§wac-vec-create-8zprdms]` A `Vec<T>` is empty when declared without an initialiser, from `create()`, or from
`withCapacity(n)`; `fromArray(xs)` holds `xs`'s elements.

`withCapacity` takes no element to fill with. The slots past the length are never read before they are written, so
nothing observable has to be put there.

## Reading and writing

```wac
// expect: traps main
import { Vec } from "core";

export i32 main() {
  Vec<i32> v = Vec.fromArray([10, 20, 30]);
  v.set(1, 25);
  i32 a = v.get(1);                        // 25
  i32? b = v.at(7);                        // null: no element 7
  i32? f = v.first();                      // 10
  i32? l = v.last();                       // 30
  bool empty = v.isEmpty();                // false
  return v.get(7);                         // traps
}
```

`[§wac-vec-get-rpaf5uj]` `get(i)` answers element `i` and traps outside `0 … len() - 1`; `set(i, v)` writes it, with the same
bounds.

`[§wac-vec-at-3dehker]` `at(i)`, `first()` and `last()` answer `T?`: `null` where there is no such element.

## Growing and shrinking

```wac
// expect: answers main = 1
import { Vec } from "core";

export i32 main() {
  Vec<i32> v;
  v.push(1);
  v.push(2);
  v.push(4);
  v.insert(2, 3);                          // [1, 2, 3, 4]
  i32 removed = v.remove(0);               // 1; [2, 3, 4]
  i32 swapped = v.swapRemove(0);           // 2; the last moves in: [4, 3]
  Vec<i32> more = Vec.fromArray([5, 6]);
  v.extend(more);                          // [4, 3, 5, 6]
  i32[] arr = v.toArray();                 // a copy
  v.clear();
  return removed == 1 && swapped == 2 && arr.len() == 4 && arr[2] == 5 && v.len() == 0 ? 1 : 0;
}
```

`[§wac-vec-push-5y7xxv8]` `push(v)` appends; `insert(i, v)` puts `v` at `i` and moves the rest up; `remove(i)` takes element
`i` out and moves the rest down; `swapRemove(i)` takes it out and moves the last element into its place;
`extend(other)` appends every element of `other`; `clear()` empties the `Vec`; `toArray()` answers a copy of its
elements.

## `pop` answers an absence rather than trapping

```wac
// expect: answers main = 1
import { Vec } from "core";

export i32 main() {
  Vec<i32> v;
  bool a = v.pop() is null;                // empty
  v.push(3);
  i32 b = v.pop()!;                        // 3
  bool c = v.pop() is null;
  return a && b == 3 && c ? 1 : 0;
}
```

`[§wac-vec-pop-yszir66]` `pop()` answers the last element and removes it, or `null` when the `Vec` is empty.

Because `pop` answers `T?` for any `T`, it separates an empty `Vec` from a `null` element — at `T = Node?` it answers a
`Node??`, and a popped `null` arrives present ([10](../2-types/10-nullability.md)):

```wac
// expect: answers main = 1
import { Vec } from "core";

struct Node { i32 v; }

i32 example(Vec<Node?> v) {
  Node?? got = v.pop();
  if (got is null)  { return 0; }          // the Vec was empty
  if (got! is null) { return 1; }          // it held a null
  return 2;
}

export i32 main() {
  Vec<Node?> v;
  v.push(null);
  return example(v);
}
```

`[§wac-vec-pop-nested-rgci8id]` At `T = U?`, `pop()` on an empty `Vec` answers the outer `null`, and popping a `null` element
answers a present `U??` holding `null`.

Under flattening the two would arrive as one value, and nothing the caller wrote could tell them apart again.

A slot a `pop` or `remove` vacates is cleared where it could hold a reference, so the `Vec` does not keep the removed
value alive.

## Iterating

A `Vec` can be walked with `for … in` ([25](../3-expressions/25-control-flow.md)):

```wac
// expect: answers main = 6
import { Vec } from "core";

export i32 main() {
  Vec<i32> v = Vec.fromArray([1, 2, 3]);
  i32 total = 0;
  for (i32 x in v) { total += x; }
  return total;
}
```

`[§wac-vec-for-in-3n8kkpg]` `for (T x in v)` visits a `Vec`'s elements in order.
