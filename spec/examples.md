## Examples

### Example 1: geometry with structs and subtyping

```wac
// geometry.wac
export struct Point {
  f64 x;
  f64 y;

  Point create(f64 x, f64 y) {
    return Point(x, y);
  }

  f64 distanceSq(const this, Point other) {
    f64 dx = this.x - other.x;
    f64 dy = this.y - other.y;
    return dx * dx + dy * dy;
  }
}

export struct Shape {
  f64 x;
  f64 y;
}

export struct Rect : Shape {
  f64 w;
  f64 h;

  f64 area(const this) {
    return this.w * this.h;
  }
}

export struct Circle : Shape {
  f64 radius;

  f64 area(const this) {
    return 3.14159265358979 * this.radius * this.radius;
  }
}

export Point midpoint(Point a, Point b) {
  return Point.create(
    (a.x + b.x) / 2.0,
    (a.y + b.y) / 2.0
  );
}

export f64 totalArea(Shape[] shapes) {
  f64 total = 0.0;
  for (i32 i = 0; i < shapes.len(); i++) {
    if (shapes[i] is Rect) {
      Rect r = shapes[i] as! Rect;
      total += r.area();
    }
    if (shapes[i] is Circle) {
      Circle c = shapes[i] as! Circle;
      total += c.area();
    }
  }
  return total;
}
```

```wac
// main.wac
import { Point, midpoint } from "./geometry.wac";

export f64 run() {
  Point a = Point.create(0.0, 0.0);
  Point b = Point.create(3.0, 4.0);
  Point m = midpoint(a, b);
  return a.distanceSq(b);
}
```

```
run() = 25.0  (3*3 + 4*4)
midpoint((0,0), (3,4)) = (1.5, 2.0)
```

### Example 2: linked list with nullable refs

```wac
// list.wac
export struct Node {
  i32 val;
  Node? next;

  Node create(i32 val) {
    Node n = Node();
    n.val = val;
    return n;
  }

  void prepend(this, i32 val) {
    Node n = Node.create(val);
    n.next = this;
  }
}

export i32 sum(Node? head) {
  i32 total = 0;
  Node? cur = head;
  while (cur is not null) {
    total += cur!.val;
    cur = cur!.next;
  }
  return total;
}

export i32 len(Node? head) {
  i32 count = 0;
  Node? cur = head;
  while (cur is not null) {
    count++;
    cur = cur!.next;
  }
  return count;
}
```

```
n1 = Node.create(10), n2 = Node.create(20), n3 = Node.create(30)
n2.next = n1, n3.next = n2
sum(n3) = 60
len(n3) = 3
sum(null) = 0
```

### Example 3: pure computation (no GC types)

```wac
// math.wac
export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}

export i32 pow(i32 base, i32 exp) {
  i32 result = 1;
  while (exp > 0) {
    if (exp % 2 == 1) { result = result * base; }
    base = base * base;
    exp = exp / 2;
  }
  return result;
}

export i32 fib(i32 n) {
  if (n < 2) { return n; }
  i32 a = 0;
  i32 b = 1;
  for (i32 i = 2; i <= n; i++) {
    i32 t = a + b;
    a = b;
    b = t;
  }
  return b;
}

export i32 collatz(i32 n) {
  i32 steps = 0;
  while (n != 1) {
    if (n % 2 == 0) { n = n / 2; }
    else { n = n * 3 + 1; }
    steps++;
  }
  return steps;
}
```

```
gcd(48, 18) = 6
pow(2, 10) = 1024
fib(20) = 6765
collatz(27) = 111
```

### Example 4: arrays and sorting

```wac
// sort.wac
export void bubbleSort(i32[] arr) {
  for (i32 i = 0; i < arr.len(); i++) {
    for (i32 j = 0; j < arr.len() - 1 - i; j++) {
      if (arr[j] > arr[j + 1]) {
        i32 tmp = arr[j];
        arr[j] = arr[j + 1];
        arr[j + 1] = tmp;
      }
    }
  }
}

export i32 isSorted(i32[] arr) {
  for (i32 i = 0; i < arr.len() - 1; i++) {
    if (arr[i] > arr[i + 1]) { return 0; }
  }
  return 1;
}
```

```
arr = { 5, 3, 8, 1, 2 }
bubbleSort(arr)
isSorted(arr) = 1
arr[0] = 1, arr[4] = 8
```

### Example 5: diamond imports

```wac
// shared.wac
export i32 base() { return 100; }
```

```wac
// left.wac
import { base } from "./shared.wac";
export i32 left() { return base() + 10; }
```

```wac
// right.wac
import { base } from "./shared.wac";
export i32 right() { return base() + 20; }
```

```wac
// top.wac
import { left } from "./left.wac";
import { right } from "./right.wac";
export i32 combined() { return left() + right(); }
```

```
combined() = 230
```

### Example 6: type testing with anyref and i31ref

```wac
// dynamic.wac
export struct Box {
  anyref value;
}

export i32 unbox(anyref val) {
  if (val is i31ref) {
    return val as! i31ref as i32;
  }
  return -1;
}

export i32 sumBoxed(anyref[] items) {
  i32 total = 0;
  for (i32 i = 0; i < items.len(); i++) {
    if (items[i] is i31ref) {
      total += items[i] as! i31ref as i32;
    }
  }
  return total;
}
```

```
unbox(42 as! i31ref) = 42
unbox(Box(0 as! i31ref)) = -1
items = { 10 as! i31ref, 20 as! i31ref, 30 as! i31ref }
sumBoxed(items) = 60
```

### Example 7: counter with const fields and methods

```wac
// counter.wac
export struct Counter {
  i32 count;
  const i32 id;

  Counter create(i32 id) {
    return Counter(0, id);
  }

  i32 getCount(const this) {
    return this.count;
  }

  void inc(this) {
    this.count += 1;
  }

  void reset(this) {
    this.count = 0;
  }
}

export i32 test() {
  Counter c = Counter.create(1);
  c.inc();
  c.inc();
  c.inc();
  i32 before = c.getCount();   // 3
  c.reset();
  i32 after = c.getCount();    // 0
  return before * 10 + after;
}
```

```
test() = 30
```
