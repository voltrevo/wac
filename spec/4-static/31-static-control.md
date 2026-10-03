# 31 — Static control

The `static_` statements make a decision when the program is compiled. `static_if` keeps one branch,
`static_for` unrolls a loop, `static_match` chooses an arm, and `static_trap` refuses an instantiation. Their
conditions are evaluated statically ([28](28-static-evaluation.md)), and every branch is still checked.

## `static_if` drops the branch not taken

```wac
// fragment — inside a generic struct with a Slot<T>[] data field
T get(const this, i32 i) {
  static_if (typeref(Slot<T>) == typeref(T)) {
    return this.data[i];
  } else {
    return this.data[i]!;        // not compiled where Slot<T> is T
  }
}
```

```wac
// expect: answers fromI32Slot = 5
// expect: answers fromNodeSlot = 4
typeref slot(typeref t) { return t.isRef() && !t.isNullable() ? t.pushNull() : t; }
type Slot<T> = type(slot(typeref(T)));

struct Node { i32 v; }

T fromSlot<T>(Slot<T> s) {
  static_if (typeref(Slot<T>) == typeref(T)) {
    return s;                              // i32: the slot is the value
  } else {
    return s!;                             // Node: the slot is Node?, unwrapped
  }
}

// T is written: it cannot be read back out of Slot<T>
export i32 fromI32Slot() { return fromSlot<i32>(5); }

export i32 fromNodeSlot() {
  Slot<Node> n = Node(4);
  return fromSlot<Node>(n).v;
}
```

`[§wac-static-if-cphqxuz]` `static_if (c) { … } else { … }` evaluates `c` statically and compiles only the selected
branch into the program.

The dropped branch is checked at the definition like any generic body. Only the per-instantiation pass skips it,
so what a drop can hide is a type error that needed a `T` to see:

```wac
// expect: answers pickI32 = 1
i32 pick<T>() {
  static_if (typeref(T) == typeref(i32)) {
    return 1;
  } else {
    T x = 7;                               // depends on T: checked only where this branch is selected

    // ERROR: expected i32, got string — checked at the definition, whichever branch is selected
    // i32 y = "foo";

    return 0;
  }
}

export i32 pickI32() { return pick<i32>(); }
```

`[§wac-static-if-checks-all-ifec63p]` Every branch of a `static_if` is checked at its definition, with type parameters
opaque. A mistake that does not depend on them is refused even in a branch that is never selected. Only the
selected branch is checked per instantiation.

So a dropped branch is not a place where anything may be written: it cannot name what does not exist, or contain
a type error, just because it is dropped. What it may contain is code that is valid only for some instantiations.

And a static branch that is not taken still retains what it names ([05](../1-programs/05-reachability.md)).

## A `static_` condition must be known statically

```wac
// expect: answers f(1) = 0
export i32 f(i32 n) {
  // ERROR: condition is not known statically — n is a runtime value
  // static_if (n > 0) { return 1; }
  return 0;
}
```

`[§wac-static-cond-known-bfmhguj]` A `static_if`, `static_for` or `static_match` whose condition, bounds or subject
cannot be evaluated statically is refused. There is no run-time fallback for choosing which code to compile.

## `static_for` unrolls

```wac
// fragment
bool same<Ts>(Ts a, Ts b) {
  static_for (i32 i = 0; i < typeref(Ts).members().len(); i++) {
    if (a.[i] != b.[i]) { return false; }
  }
  return true;
}

same(("a", 1 as i32), ("a", 1 as i32));    // true
same(("a", 1 as i32), ("a", 2 as i32));    // false
```

`a.[i]` is a `string` at 0 and an `i32` at 1, so the body is checked once per iteration rather than once. A runtime
`i` would leave it with no type at all.

```wac
// expect: answers unrolledTotal = 10
export i32 unrolledTotal() {
  i32 total = 0;
  static_for (i32 i = 1; i <= 4; i++) {
    static i32 square = i * i;             // i is static in each unrolled copy
    total += i;
  }
  return total;
}
```

`[§wac-static-for-8sn4iuq]` `static_for (init; cond; update) { … }` evaluates its head statically and compiles one copy
of its body per iteration, in which the loop variable is a static value.

An implementation may cap how many iterations it unrolls; reaching the cap is a resource limit
([28](28-static-evaluation.md)). A `break` or `continue` that acts on the `static_for` itself would mean stopping
the unrolling, and is refused:

```wac
// expect: emits
export i32 noBreak() {
  static_for (i32 i = 0; i < 3; i++) {
    // ERROR: break cannot leave a static_for
    // break;
  }
  return 0;
}
```

`[§wac-static-for-no-break-5mdxkf7]` `break` and `continue` whose target would be a `static_for` are refused.

## `static_match` chooses an arm

```wac
// expect: answers widthU32 = 4
// expect: answers widthU64 = 8
i32 width<T>() {
  return static_match (T) {
    u32:     4,
    u64:     8,
    default: static_trap "width is defined for u32 and u64",
  };
}

export i32 widthU32() { return width<u32>(); }
export i32 widthU64() { return width<u64>(); }
```

`[§wac-static-match-ybv9j9x]` `static_match (T) { … }` selects, at compile time, the arm whose type is `T`, or
`default`. Only the selected arm is compiled per instantiation; every arm is checked at the definition.

`static_trap` is `never`, so it satisfies an arm like any other, and it fires only where that arm is chosen.

## `static_trap` refuses an instantiation

```wac
// expect: refused
i32 width<T>() {
  return static_match (T) {
    u32:     4,
    default: static_trap "width is defined for u32",
  };
}

export i32 widthF64() { return width<f64>(); }
```

`[§wac-static-trap-37c96dy]` A `static_trap "message"` that is compiled — in a selected branch or arm — is a compile
error carrying the message. One in a branch that is not selected has no effect.

## An ordinary `if` folds too

An ordinary `if` whose condition is constant is folded and its dead branch removed — but, unlike `static_if`, both
branches are checked at every instantiation:

```wac
// expect: answers sizeOfAb = 2
i32 size<T>(T x) {
  if (typeref(T).isRef()) { return x.len(); }
  return 0;
}

export i32 sizeOfAb() {
  i32 a = size("ab");                      // 2

  // ERROR: no method 'len' on i32 — the branch is dead here, and still checked
  // i32 b = size(5 as i32);

  return a;
}
```

`[§wac-if-folds-checks-both-795w3wt]` An ordinary `if` checks both branches at every instantiation, even where its
condition is constant there.

That is the difference between them: `static_if` is for code that is valid only for some instantiations.

A condition that is constant regardless of type parameters may warn; one that is constant only at an
instantiation does not:

```wac
// expect: answers tagOfI32 = 1
i32 tag<T>() {
  if (typeref(T).isRef()) { return 0; }    // constant per instantiation: no warning
  return 1;
}

export i32 tagOfI32() {
  if (false) { return 9; }                 // may warn: always false
  return tag<i32>();
}
```

`[§wac-constant-cond-may-warn-kz8d6m6]` An implementation may warn about a condition that is constant independently of
any type parameter. A condition constant only at an instantiation is not warned about.

## Statements only

The `static_` constructs are statements and expressions inside function bodies. There is no module-level
`static_if`: nothing is conditionally declared.
