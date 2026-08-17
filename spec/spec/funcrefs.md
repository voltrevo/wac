## Function references

Function references are typed, first-class values. They map directly to wasm
GC's typed function references — `ref.func` to obtain, `call_ref` to invoke.

**In wacc a `fn[…]` value is a pair of a function and an environment**, so a lambda
can capture — see *Lambdas* below. The seed does not implement lambdas; for it, and
for any program that writes none, a `fn[…]` is a function reference and nothing
else, and the environment is null.

### Type syntax

`fn[ReturnType(ParamTypes)]` — the return type comes first, mirroring function
declaration syntax.

```wac
fn[i32(i32, i32)]           // takes two i32, returns i32
fn[bool(Point, Point)]      // takes two Points, returns bool
fn[void(string)]            // takes string, returns nothing
fn[bool()]                  // no args, returns bool
```

### Obtaining a reference

Reference an existing function by name. The compiler emits `ref.func`:

```wac
bool ascending(i32 a, i32 b) { return a < b; }
bool descending(i32 a, i32 b) { return a > b; }

fn[bool(i32, i32)] cmp = ascending;
cmp = descending;
```

`[§wac-fnref-get-t4kn7wp]` `cmp(3, 5)` returns `true` after assigning
`descending`.

### Calling through a reference

Call like a regular function — emits `call_ref`:

```wac
export i32 testCall() {
  fn[i32(i32)] f = double;
  return f(5);
}

i32 double(i32 x) { return x * 2; }
```

`[§wac-fnref-call-m8qj3xf]` `testCall()` returns `10`.

### As parameters

```wac
i32 apply(fn[i32(i32)] f, i32 x) {
  return f(x);
}

i32 double(i32 x) { return x * 2; }
i32 square(i32 x) { return x * x; }
```

`[§wac-fnref-param-k5fn2jq]` `apply(double, 5)` returns `10`.
`apply(square, 5)` returns `25`.

### As return values

```wac
fn[bool(i32, i32)] getComparator(bool reverse) {
  if (reverse) { return descending; }
  return ascending;
}
```

`[§wac-fnref-ret-p7hd4wn]` `getComparator(true)(3, 5)` returns `true`.
`getComparator(false)(3, 5)` returns `false`.

### As struct fields

```wac
struct Handler {
  fn[void(string)] callback;
}

void log(string msg) { ... }

export void testHandler() {
  Handler h = Handler(log);
  h.callback("hello");
}
```

`[§wac-fnref-field-r2km8jf]` `testHandler()` calls `log` with `"hello"`.

### Nullable function references

```wac
fn[void(i32)]? maybeCallback = null;

export i32 testNullFnref() {
  fn[void(i32)]? cb = null;
  if (cb is not null) {
    cb!(42);
  }
  return 0;
}
```

`[§wac-fnref-null-w3qn5jk]` `testNullFnref()` returns `0` without trapping.

### Static method references

Static struct methods can be referenced. The method name is qualified with the
struct name:

```wac
struct Counter {
  i32 count;

  Counter create(i32 initial) {
    return Counter(initial);
  }

  void inc(this) {
    this.count++;
  }
}

fn[Counter(i32)] factory = Counter.create;
fn[void(Counter)] increment = Counter.inc;
```

A static method has no receiver, so its reference is simply its declared
signature.

`[§wac-fnref-static-n7kq3wm]` `factory(7)` returns a Counter with count 7.

Instance method references give you the underlying function with `this` as the
first parameter:

```wac
export i32 testMethodRef() {
  Counter c = Counter.create(0);
  fn[void(Counter)] f = Counter.inc;
  f(c);
  f(c);
  return c.count;
}
```

`[§wac-fnref-method-h9pd3wn]` `testMethodRef()` returns `2`.

A method reference may also be **bound**: `c.inc` is the method with that
receiver already in it, so it is called with no receiver at all.

```wac
Counter c = Counter.create(0);
fn[void()] f = c.inc;        // bound to c
f();
f();                         // c.count is now 2
```

`[§wacc-fnref-bound]` `c.inc` is a value of the receiver-less signature.

*wacc only — the seed refuses it, and the omissions table in
[compiler/README.md](../../compiler/README.md) records why. The tag says so: a `§wacc-` clause is one
the seed does not implement, where a `§wac-` clause is the language both compilers answer for.*

A bound reference captures a receiver and nothing else — no local, no enclosing scope. A *lambda*
captures the locals around it; the two are the same kind of value and differ only in what is in the
environment half of the pair.

The two spellings differ in arity, and that is the whole of the difference: `Counter.inc` is an
`fn[void(Counter)]` and `c.inc` is an `fn[void()]`. Both are ordinary `fn[…]` values, so either can
go anywhere one is expected.

### Lambdas

`[§wacc-lambda]` A lambda is a `fn[…]` value written inline: `(i32 a) => a + 1`. Parameters carry
their types; the return type comes from the `fn[…]` it is used as, which the language always supplies
because there is no `var`. An expression body is sugar for a block one — `() => e` is
`() => { return e; }` — and `return` inside a lambda returns from the lambda.

```wac
fn[i32()] answer = () => 42;
fn[i32(i32,i32)] add = (i32 a, i32 b) => a + b;
btn.onClick = () => { count = count + 1; render(); };
```

`[§wacc-lambda-capture]` A lambda **captures by reference**, primitives included: a captured local is
shared with the enclosing function rather than copied, so a write on either side is seen by the other.

```wac
i32 n = 0;
fn[void()] bump = () => { n = n + 1; };
bump();
bump();
// n is 2
```

Parameters are captured the same way as locals, and capture reaches through nesting: a lambda inside a
lambda that reads a name from outside both makes the outer one carry it too. Two lambdas capturing the
same local share it.

`[§wacc-lambda-generic]` A lambda may be written **inside a generic**, and is emitted once per
instantiation — one hoisted function, capture record and cell type for each, closing over that
instantiation's types:

```wac
T hold<T>(T v) { fn[T()] get = () => v; return get(); }

export i32 f() {
  i32 a = hold(40);
  string b = hold("xx");     // a second copy, capturing a `string` rather than an `i32`
  return a + b.len();
}
```

The copies are told apart by the instantiation, not by where the lambda is written: one position
names one expression per *template*, and a template is not what gets emitted. What is still refused is
a generic taking a funcref **parameter** — `T twice<T>(T v, fn[T(T)] f)` — which has no lambda in it
at all.

*wacc only, as the tags say — `design/lang/0002` records the design, and the seed implements none of
it.*

### Inline call syntax

Since method references produce regular functions, you can call them inline:

```wac
(Counter.inc)(counter);       // same as counter.inc()
(Counter.create)(0);          // same as Counter.create(0)
```

`[§wac-fnref-inline-f7km2xq]` `(Counter.inc)(c)` is equivalent to `c.inc()`.

### Arrays of function references

```wac
i32 double(i32 x) { return x * 2; }
i32 square(i32 x) { return x * x; }
i32 negate(i32 x) { return -x; }

export i32 testFnArray() {
  fn[i32(i32)][] transforms = fn[i32(i32)][](double, square, negate);
  i32 total = 0;
  for (i32 i = 0; i < transforms.len(); i++) {
    total += transforms[i](5);
  }
  return total;
}
```

`[§wac-fnref-array-n8qm4jf]` `testFnArray()` returns `30` (10 + 25 + -5).

### Higher-order example

```wac
i32[] map(i32[] arr, fn[i32(i32)] f) {
  i32[] result = i32[arr.len()]();
  for (i32 i = 0; i < arr.len(); i++) {
    result[i] = f(arr[i]);
  }
  return result;
}

i32 reduce(i32[] arr, i32 init, fn[i32(i32, i32)] f) {
  i32 acc = init;
  for (i32 i = 0; i < arr.len(); i++) {
    acc = f(acc, arr[i]);
  }
  return acc;
}

i32 add(i32 a, i32 b) { return a + b; }

export i32 testHigherOrder() {
  i32[] data = i32[](1, 2, 3, 4, 5);
  i32[] doubled = map(data, double);
  return reduce(doubled, 0, add);
}
```

`[§wac-fnref-higher-p4jn7wq]` `testHigherOrder()` returns `30`
(2 + 4 + 6 + 8 + 10).

### Wasm mapping

| wac | wasm |
|-----|------|
| `fn[T(A, B)]` | `(ref (func (param A B) (result T)))` |
| `fn[T(A, B)]?` | `(ref null (func (param A B) (result T)))` |
| `functionName` in value position | `ref.func $mangled_name` |
| `f(args)` where f is funcref | `call_ref` |
