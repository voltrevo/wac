## Function references

Function references are typed, first-class values. They map directly to wasm
GC's typed function references — `ref.func` to obtain, `call_ref` to invoke.
No closures — function references cannot capture variables from enclosing scope.

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

Calling a method reference as if it captured `this` is not allowed — there are
no closures:

```wac
Counter c = Counter.create(0);
fn[void()] f = c.inc;        // error: cannot capture this
```

`[§wac-fnref-nocapture-j4wk8pm]` `c.inc` as a value is a compile error.

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
