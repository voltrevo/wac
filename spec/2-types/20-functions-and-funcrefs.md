# 20 — Functions and function values

A function declares its return type first, then its name and typed parameters. There is no overloading:
a name is declared once in its scope ([01](../1-programs/01-names-and-identity.md)). A function is also a
value, of type `fn<R(A, B, …)>`, and a lambda writes one inline.

## Declaring and returning

```wac
// expect: answers pointX = 1.0
// expect: answers arrayLength(5) = 5
struct Point { f64 x; f64 y; }

export void greet() { }                    // void: no return statement needed
Point makePoint(f64 x, f64 y) { return Point(x, y); }
i32[] makeArray(i32 n) { return i32[].filled(n, 0); }

export f64 pointX() { return makePoint(1.0, 2.0).x; }
export i32 arrayLength(i32 n) { return makeArray(n).len(); }
```

`[§wac-ret-void-ezw2lqp]` A `void` function with no return statement compiles.

`[§wac-ret-struct-kpjs5dg]` A function may return a struct: `makePoint(1.0, 2.0).x` is `1.0`.

`[§wac-ret-array-mptjuer]` A function may return an array: `makeArray(5).len()` is `5`.

A function may call one declared after it, and functions may call each other:

```wac
// expect: answers factorial(10) = 3628800
// expect: answers isEven(42) = 1
// expect: answers isEven(17) = 0
export i32 factorial(i32 n) {
  if (n <= 1) { return 1; }
  return n * factorial(n - 1);
}

export i32 isEven(i32 n) {
  if (n == 0) { return 1; }
  return isOdd(n - 1);
}

i32 isOdd(i32 n) {
  if (n == 0) { return 0; }
  return isEven(n - 1);
}
```

`[§wac-factorial-lzkw61q]` `factorial(10)` answers `3628800`.

`[§wac-mutual-exg2t9c]` Mutually recursive functions need no forward declaration: `isEven(42)` is `1` and
`isEven(17)` is `0`.

## Every path returns

A `void` function may return early with `return;`, or fall off its end. Any other function must return a
value on every path:

```wac
// expect: answers ok(true) = 1
export void earlyReturn(bool flag) {
  if (flag) { return; }
}

export i32 ok(bool x) {
  if (x) { return 1; }
  else { return 0; }
}

// ERROR: not every path returns a value
// export i32 bad(bool x) {
//   if (x) { return 1; }
// }
```

`[§wac-void-return-h7qm4xf]` `return;` in a `void` function compiles.

`[§wac-missing-return-k4fn8wp]` A non-`void` function in which a path reaches the end without returning is
refused.

`[§wac-all-paths-return-m7qj3xf]` A function that returns on every path compiles: `ok(true)` answers `1`.

A function of type `never` may not return at all ([11](11-never-and-uninhabited.md)). A function whose return
type is `auto` infers it from its returns ([34](../5-inference/34-recursive-inference.md)).

## Arguments match exactly

An argument's type must be the parameter's type. There is no widening at a call any more than anywhere
else:

```wac
// expect: answers taken = 2
struct A { i32 x; }
struct B { i32 y; }
struct P { i32 take(const this, A a) { return a.x; } }

f64 root(f64 x) { return x; }

export i32 taken() {
  f32 approx = 3.14;

  // ERROR: expected f64, got f32
  // f64 r = root(approx);

  f64 r = root(approx as f64);

  P p = P();
  B b = B(1);

  // ERROR: expected A, got B
  // i32 n = p.take(b);

  return p.take(A(2));
}
```

`[§wac-paramatch-84zc2km]` An argument whose type is not the parameter's type is refused.

`[§wac-method-argmatch-9tq4mz2]` The same holds for a method's arguments, including a method of a generic
read at its instantiation: `set(this, T x)` on a `Box<i32>` takes an `i32`.

A parameter may be `const` ([17](17-const.md)). What a function can reach in the world is what its
parameters hand it ([07](../1-programs/07-programs.md)).

## Functions are values

`fn<R(A, B)>` is the type of a function taking an `A` and a `B` and returning an `R`. A function's name in
value position is a value of that type, and calling a value calls the function:

```wac
// expect: answers compared = false
// expect: answers doubled(5) = 10
bool ascending(i32 a, i32 b) { return a < b; }
bool descending(i32 a, i32 b) { return a > b; }
i32 double(i32 x) { return x * 2; }

export bool compared() {
  fn<bool(i32, i32)> cmp = ascending;
  cmp = descending;
  return cmp(3, 5);                        // descending: 3 > 5
}

export i32 doubled(i32 n) {
  fn<i32(i32)> f = double;
  return f(n);
}
```

`[§wac-fnref-get-t4kn7wp]` A function's name is a value of its function type, and may be reassigned to another
function of that type.

`[§wac-fnref-call-m8qj3xf]` Calling a function value calls the function it holds.

Function values go everywhere values go — parameters, returns, fields, arrays, nullables:

```wac
// expect: answers applied = 35
// expect: answers reversed = false
// expect: answers throughField = 10
// expect: answers throughArray = 30
// expect: answers absentNotCalled = true
i32 double(i32 x) { return x * 2; }
i32 square(i32 x) { return x * x; }
i32 negate(i32 x) { return -x; }
bool ascending(i32 a, i32 b) { return a < b; }
bool descending(i32 a, i32 b) { return a > b; }

i32 apply(fn<i32(i32)> f, i32 x) { return f(x); }

fn<bool(i32, i32)> getComparator(bool reverse) {
  if (reverse) { return descending; }
  return ascending;
}

struct Handler { fn<i32(i32)> callback; }

export i32 applied() { return apply(double, 5) + apply(square, 5); }   // 10 + 25

export bool reversed() {
  fn<bool(i32, i32)> c = getComparator(true);
  return c(3, 5);                                                       // descending
}

export i32 throughField() {
  Handler h = Handler(double);
  return h.callback(5);
}

export i32 throughArray() {
  i32 total = 0;
  fn<i32(i32)>[] transforms = [double, square, negate];
  for (fn<i32(i32)> t in transforms) { total += t(5); }                 // 10 + 25 - 5
  return total;
}

export bool absentNotCalled() {
  fn<void(i32)>? none = null;
  if (none is not null) { none!(42); }
  return none is null;
}
```

`[§wac-fnref-param-k5fn2jq]` A function value may be a parameter: `apply(double, 5)` answers `10`, so `applied()`
answers `10 + 25`.

`[§wac-fnref-ret-p7hd4wn]` A function value may be returned: `getComparator(true)(3, 5)` is `false`.

`[§wac-fnref-field-r2km8jf]` A function value may be a field, and called through it.

`[§wac-fnref-array-n8qm4jf]` An array of function values is an ordinary array: applying `[double, square,
negate]` to `5` sums to `30`.

`[§wac-fnref-null-w3qn5jk]` A function type may be nullable, and absent is not a function that does nothing.

```wac
// expect: answers doubledThenSummed = 30
i32 double(i32 x) { return x * 2; }
i32 add(i32 a, i32 b) { return a + b; }

i32[] map(i32[] arr, fn<i32(i32)> f) {
  i32[] result = i32[].filled(arr.len(), 0);
  for (i32 i = 0; i < arr.len(); i++) { result[i] = f(arr[i]); }
  return result;
}

i32 reduce(i32[] arr, i32 init, fn<i32(i32, i32)> f) {
  i32 acc = init;
  for (i32 x in arr) { acc = f(acc, x); }
  return acc;
}

export i32 doubledThenSummed() { return reduce(map([1, 2, 3, 4, 5], double), 0, add); }
```

`[§wac-fnref-higher-p4jn7wq]` Functions taking functions compose: doubling `[1, 2, 3, 4, 5]` and summing gives
`30`.

A generic function may take a function parameter whose type mentions its type parameters:

```wac
// expect: answers firstBig = 3
T? find<T>(T[] xs, fn<bool(T)> p) {
  for (T x in xs) {
    if (p(x)) { return x; }
  }
  return null;
}

bool big(i32 x) { return x > 2; }

export i32 firstBig() {
  i32[] xs = [1, 3, 5];
  return find(xs, big)!;                   // T = i32, from xs and from big
}
```

`[§wac-generic-fn-param-eehvj9m]` A generic function's parameter may have a function type that mentions its type
parameters, and those parameters may be inferred through it.

## Methods as values

A method is a value too. Through the type, its receiver is its first parameter; through an object, the
receiver is bound and the value takes the remaining parameters:

```wac
// expect: answers incrementedThreeWays = 10
struct Counter {
  i32 count;

  Counter create(i32 initial) { return Counter(initial); }
  void inc(this) { this.count++; }
}

export i32 incrementedThreeWays() {
  fn<Counter(i32)> factory = Counter.create;      // no receiver
  Counter c = factory(7);

  fn<void(Counter)> f = Counter.inc;              // receiver as first parameter
  f(c);

  fn<void()> g = c.inc;                           // bound to c
  g();

  (Counter.inc)(c);                               // the same as c.inc()
  return c.count;                                 // 7 + 3
}
```

`[§wac-fnref-static-n7kq3wm]` A method with no receiver is a value of its declared signature: `factory(7)` is a
`Counter` with count 7.

`[§wac-fnref-method-h9pd3wn]` `T.m` for a method taking `this` is a function whose first parameter is the
receiver.

`[§wacc-fnref-bound]` `x.m` is the method with its receiver bound: a value of the signature without the
receiver.

`[§wac-fnref-inline-f7km2xq]` `(Counter.inc)(c)` is the same call as `c.inc()`.

## Lambdas

A lambda writes a function value inline. Its parameters carry their types; its return type comes from the
function type it is written into. An expression body is sugar for a block that returns it:

```wac
// expect: answers answer = 42
// expect: answers sum(1, 1) = 2
// expect: answers absolute(-3) = 3
export i32 answer() {
  fn<i32()> f = () => 42;
  return f();
}

export i32 sum(i32 a, i32 b) {
  fn<i32(i32, i32)> add = (i32 x, i32 y) => x + y;
  return add(a, b);
}

export i32 absolute(i32 n) {
  fn<i32(i32)> abs = (i32 x) => {
    if (x < 0) { return -x; }              // returns from the lambda
    return x;
  };
  return abs(n);
}
```

`[§wacc-lambda]` `(T a, …) => e` is a function value whose body is `e`, or a block. Its return type is the
expected function type's, and `return` inside it returns from the lambda.

A lambda captures by reference, primitives included: a captured local is shared with the enclosing function,
so a write on either side is seen by the other:

```wac
// expect: answers bumpedTwice = 2
export i32 bumpedTwice() {
  i32 n = 0;
  fn<void()> bump = () => { n = n + 1; };
  bump();
  bump();
  return n;
}
```

`[§wacc-lambda-capture]` A lambda captures the locals and parameters it uses by reference. Capture reaches
through nesting, and two lambdas capturing one local share it.

```wac
// expect: answers addedThroughReceiver = 5
struct Counter {
  i32 n;
  void bump(this, i32 by) { this.n = this.n + by; }
  fn<void(i32)> adder(this) { return (i32 by) => { this.bump(by); }; }
}

export i32 addedThroughReceiver() {
  Counter c = Counter(0);
  fn<void(i32)> add = c.adder();
  add(2);
  add(3);
  return c.n;                              // the same object
}
```

`[§wacc-lambda-capture-this]` A lambda inside a method captures `this` by reference, so a function value it
hands back still acts on the receiver its caller holds.

A lambda may be written inside a generic, and closes over that instantiation's types:

```wac
// expect: answers heldTwice = 42
T hold<T>(T v) {
  fn<T()> get = () => v;
  return get();
}

export i32 heldTwice() {
  i32 a = hold(40 as i32);
  string b = hold("xx");
  return a + b.len();
}
```

`[§wacc-lambda-generic]` A lambda inside a generic is a separate function for each instantiation, capturing that
instantiation's types.

A lambda passed as an argument takes its type from the parameter it fills, however the callee is reached —
through a method, or through a function value held in a field:

```wac
// expect: answers fetchThenDouble(3) = 6
struct Pending { i32 v; i32 then(const this, fn<i32(i32)> k) { return k(this.v); } }
struct Source { fn<Pending(i32)> fetch; }

Pending make(i32 n) { return Pending(n); }

export i32 fetchThenDouble(i32 n) {
  Source s = Source(make);
  return s.fetch(n).then((i32 x) => x * 2);   // a call through a field, then a method
}
```

`[§wacc-lambda-after-a-funcref-call]` A lambda argument is typed from the method or function it is passed to,
including when the receiver is the result of a call through a function value.
