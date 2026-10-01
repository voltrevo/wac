# 37 — Core

`core` is the package that ships with the toolchain and needs nothing from the host. It holds the types and symbols
the language itself refers to, and the ordinary data structures a program should not have to find a package for.
Anything that reaches the world is in `std` ([44](44-std.md)) instead.

It is reached like any package — by its name, through its entry module — and a project cannot replace it
([02](../1-programs/02-modules-and-imports.md)).

## What `core` exports

| Name | What it is | Chapter |
|---|---|---|
| `operators` | namespace of the operator symbols, and their `FromLeft` reverses | [22](../3-expressions/22-operators.md) |
| `toString`, `toNode` | the conversion symbols interpolation and markup use | [23](../3-expressions/23-interpolation-and-markup.md) |
| `fromNumber`, `NumberLiteral` | literal conversion for a type of the program's own | [09](../2-types/09-numeric-literals.md) |
| `Vec<T>` | a growable array | [38](38-vec.md) |
| `Map<K, V>`, the hash and equality functions | a hash map | [39](39-map-and-hash.md) |
| `Option<T>`, `Result<T, E>` | presence, and success or failure | [40](40-option-and-result.md) |
| `Read` | the answer of a read that can end or fail | [41](41-read.md) |
| `Buf` | a growable byte buffer | [42](42-buf.md) |
| `Node`, `Attr`, `html` | the markup tree, and the HTML tag functions | [43](43-markup-types.md) |
| `Ticket<T>`, `TicketBase`, `Continuation`, `Queue<T>` | tickets and the scheduling they need | [35](../6-concurrency/35-tickets-and-await.md) |
| `Step`, `Coroutine`, `Generator`, `AsyncGenerator` | the machine under `async` and `gen` | [36](../6-concurrency/36-coroutines-and-generators.md) |

```wac
// expect: answers main = 2
import { Vec, Result, operators, toString } from "core";
import { operators.add } from "core";

export i32 main() {
  Vec<i32> v;
  v.push(1);
  v.push(2);
  Result<i32, string> r = Result.Ok(v.len());
  return r.orElse(0);
}
```

`[§wac-core-exports-v8uuuut]` Every name in the table above is exported by `core`'s entry module, at its root or — for
`operators` and `html` — as a namespace.

Families of related names are namespaces — the operator symbols, the HTML tag functions — and everything else is at
the root.

## Why these are in `core`

A name belongs in `core` when the language needs one agreed declaration of it. Types are nominal, so two declarations of
the same shape are two types with nothing to convert between them: a tree built in one repository and a renderer in
another must name one `Node` or nothing composes, and the compiler itself builds `Node`s for markup and calls
`toString` for interpolation. Those are the strongest cases.

The data structures are here for a weaker but still real reason: a program that wants a map should not have to find a
package first, and two hand-written maps are two places for the same bugs.

Nothing in `core` holds a capability, so nothing in it can reach the world. A program that imports only `core` can
compute and answer, and do nothing else ([07](../1-programs/07-programs.md)).

## Open

- **Where `core`'s data structures sit.** This chapter puts them at the root, and families in namespaces. Whether they
  should instead live in namespaces of their own (`collections.Vec`) is not decided.
