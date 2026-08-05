import { HOME, type FileMap } from "./file-store";

const p = (rel: string) => `${HOME}/examples/${rel}`;

export type Example = {
  name: string;
  category: string;
  files: FileMap;
  entry: string;
};

export const EXAMPLES: Example[] = [
  // === Basics ===
  {
    name: "Hello World",
    category: "Basics",
    entry: p("hello-world.wac"),
    files: {
      [p("hello-world.wac")]: `export i32 answer() {
  return 42;
}
`,
    },
  },
  {
    name: "Arithmetic",
    category: "Basics",
    entry: p("arithmetic.wac"),
    files: {
      [p("arithmetic.wac")]: `export i32 compute(i32 a, i32 b) {
  return a * b + a - b;
}
`,
    },
  },
  {
    name: "Floating Point",
    category: "Basics",
    entry: p("floating-point.wac"),
    files: {
      [p("floating-point.wac")]: `export f64 circle_area(f64 radius) {
  return 3.14159265358979 * radius * radius;
}

export f64 lerp(f64 a, f64 b, f64 t) {
  return a + (b - a) * t;
}
`,
    },
  },

  // === Control Flow ===
  {
    name: "If / Else",
    category: "Control Flow",
    entry: p("if-else.wac"),
    files: {
      [p("if-else.wac")]: `export i32 classify(i32 x) {
  if (x < 0) {
    return -1;
  } else if (x == 0) {
    return 0;
  } else {
    return 1;
  }
}
`,
    },
  },
  {
    name: "While Loop",
    category: "Control Flow",
    entry: p("while-loop.wac"),
    files: {
      [p("while-loop.wac")]: `export i32 collatz(i32 n) {
  // The sequence is only defined for positive n: 0 and negatives never reach 1,
  // so without this the loop does not terminate — and an empty box means 0.
  if (n < 1) { return -1; }

  i32 steps = 0;
  while (n != 1) {
    if (n % 2 == 0) { n = n / 2; }
    else { n = n * 3 + 1; }
    steps++;
  }
  return steps;
}
`,
    },
  },
  {
    name: "For Loop",
    category: "Control Flow",
    entry: p("for-loop.wac"),
    files: {
      [p("for-loop.wac")]: `export i32 factorial(i32 n) {
  i32 result = 1;
  for (i32 i = 1; i <= n; i++) {
    result = result * i;
  }
  return result;
}
`,
    },
  },
  {
    name: "Switch",
    category: "Control Flow",
    entry: p("switch.wac"),
    files: {
      [p("switch.wac")]: `export i32 dayKind(i32 day) {
  switch (day) {
    case 0: return 0;
    case 6: return 0;
    default: return 1;
  }
}
`,
    },
  },

  // === Functions ===
  {
    name: "GCD (Euclidean)",
    category: "Functions",
    entry: p("gcd.wac"),
    files: {
      [p("gcd.wac")]: `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}
`,
    },
  },
  {
    name: "Fibonacci",
    category: "Functions",
    entry: p("fibonacci.wac"),
    files: {
      [p("fibonacci.wac")]: `export i32 fib(i32 n) {
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
`,
    },
  },
  {
    name: "Power (Fast)",
    category: "Functions",
    entry: p("power.wac"),
    files: {
      [p("power.wac")]: `export i32 pow(i32 base, i32 exp) {
  i32 result = 1;
  while (exp > 0) {
    if (exp % 2 == 1) { result = result * base; }
    base = base * base;
    exp = exp / 2;
  }
  return result;
}
`,
    },
  },
  {
    name: "Multi-file Imports",
    category: "Functions",
    entry: p("imports.wac"),
    files: {
      [p("imports.wac")]: `import { gcd, pow } from "./util/math.wac";

export i32 test() {
  return gcd(48, 18) * pow(2, 3);
}
`,
      [p("util/math.wac")]: `export i32 gcd(i32 a, i32 b) {
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
`,
    },
  },

  // === Structs ===
  {
    name: "Point Struct",
    category: "Structs",
    entry: p("point.wac"),
    files: {
      [p("point.wac")]: `export struct Point {
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

export f64 run() {
  Point a = Point.create(0.0, 0.0);
  Point b = Point.create(3.0, 4.0);
  return a.distanceSq(b);
}
`,
    },
  },
  {
    name: "Counter (Methods)",
    category: "Structs",
    entry: p("counter.wac"),
    files: {
      [p("counter.wac")]: `export struct Counter {
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
  i32 before = c.getCount();
  c.reset();
  i32 after = c.getCount();
  return before * 10 + after;
}
`,
    },
  },
  {
    name: "Subtyping",
    category: "Structs",
    entry: p("subtyping.wac"),
    files: {
      [p("subtyping.wac")]: `struct Shape { f64 x; f64 y; }

struct Rect : Shape {
  f64 w;
  f64 h;
  f64 area(const this) { return this.w * this.h; }
}

struct Circle : Shape {
  f64 radius;
  f64 area(const this) {
    return 3.14159265358979 * this.radius * this.radius;
  }
}

// downcast dispatch via is/as!
f64 totalArea(Shape[] shapes) {
  f64 total = 0.0;
  for (i32 i = 0; i < shapes.len(); i++) {
    if (shapes[i] is Rect) { total += (shapes[i] as! Rect).area(); }
    if (shapes[i] is Circle) { total += (shapes[i] as! Circle).area(); }
  }
  return total;
}

export f64 run(f64 rectWidth, f64 rectHeight, f64 circleRadius) {
  Shape[] shapes = Shape[2]();
  shapes[0] = Rect(0.0, 0.0, rectWidth, rectHeight);
  shapes[1] = Circle(0.0, 0.0, circleRadius);
  return totalArea(shapes);
}
`,
    },
  },

  // === Nullable Refs ===
  {
    name: "Linked List",
    category: "Nullable Refs",
    entry: p("linked-list.wac"),
    files: {
      [p("linked-list.wac")]: `import { LinkedList } from "./util/list.wac";

export i32 testPushBack() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  return l.sum() * 100 + l.len();
}

export i32 testPushFront() {
  LinkedList l = LinkedList.create();
  l.push_front(10);
  l.push_front(20);
  l.push_front(30);
  // head is 30 -> 20 -> 10
  return l.front() * 100 + l.back();
}

export i32 testPopFront() {
  LinkedList l = LinkedList.create();
  l.push_back(10);
  l.push_back(20);
  l.push_back(30);
  i32 first = l.pop_front();
  return first * 100 + l.len();
}
`,
      [p("util/list.wac")]: `struct Node {
  i32 val;
  Node? next;
}

export struct LinkedList {
  Node? head;
  Node? tail;
  i32 count;

  LinkedList create() {
    return LinkedList();
  }

  void push_back(this, i32 val) {
    Node n = Node(val, null);
    if (this.tail is not null) {
      this.tail!.next = n;
    } else {
      this.head = n;
    }
    this.tail = n;
    this.count++;
  }

  void push_front(this, i32 val) {
    Node n = Node(val, this.head);
    this.head = n;
    if (this.tail is null) {
      this.tail = n;
    }
    this.count++;
  }

  i32 pop_front(this) {
    if (this.head is null) { trap; }
    i32 val = this.head!.val;
    this.head = this.head!.next;
    if (this.head is null) {
      this.tail = null;
    }
    this.count--;
    return val;
  }

  i32 front(const this) {
    if (this.head is null) { trap; }
    return this.head!.val;
  }

  i32 back(const this) {
    if (this.tail is null) { trap; }
    return this.tail!.val;
  }

  i32 len(const this) {
    return this.count;
  }

  i32 sum(const this) {
    i32 total = 0;
    Node? cur = this.head;
    while (cur is not null) {
      total += cur!.val;
      cur = cur!.next;
    }
    return total;
  }
}
`,
    },
  },

  // === Data Structures ===
  {
    name: "Buffer (Growable)",
    category: "Data Structures",
    entry: p("buffer.wac"),
    files: {
      [p("buffer.wac")]: `import { Buffer } from "./util/buffer.wac";

// Push 20 bytes into a buffer starting with capacity 4.
// It grows automatically. Returns last_value * 100 + length.
export i32 testGrow() {
  Buffer b = Buffer.create(4);
  for (i32 i = 0; i < 20; i++) {
    b.push(i);
  }
  return b.get(19) * 100 + b.len;
}

// Push, overwrite, read back.
export i32 testOverwrite() {
  Buffer b = Buffer.create(4);
  b.push(0);
  b.push(0);
  b.set(0, 255);
  b.set(1, 128);
  return b.get(0) * 256 + b.get(1);
}

// Push and pop.
export i32 testPop() {
  Buffer b = Buffer.create(4);
  b.push(10);
  b.push(20);
  b.push(30);
  i32 last = b.pop();
  return last * 100 + b.len;
}
`,
      [p("util/buffer.wac")]: `export struct Buffer {
  i8[] data;
  i32 len;
  i32 cap;

  Buffer create(i32 cap) {
    return Buffer(i8[cap](), 0, cap);
  }

  i32 get(const this, i32 idx) {
    if (idx < 0 || idx >= this.len) { trap; }
    return this.data[idx];
  }

  void set(this, i32 idx, i32 val) {
    if (idx < 0 || idx >= this.len) { trap; }
    this.data[idx] = val;
  }

  void push(this, i32 val) {
    if (this.len == this.cap) {
      i32 newCap = this.cap * 2;
      if (newCap == 0) { newCap = 8; }
      i8[] next = i8[newCap]();
      for (i32 i = 0; i < this.len; i++) {
        next[i] = this.data[i];
      }
      this.data = next;
      this.cap = newCap;
    }
    this.data[this.len] = val;
    this.len++;
  }

  i32 pop(this) {
    if (this.len == 0) { trap; }
    this.len--;
    return this.data[this.len];
  }

  void clear(this) {
    this.len = 0;
  }
}
`,
    },
  },

  // === Arrays ===
  {
    name: "Arrays (Sort + Sum)",
    category: "Arrays",
    entry: p("array-sum.wac"),
    files: {
      [p("array-sum.wac")]: `export i32[] quicksort(i32[] arr) {
  qsort(arr, 0, arr.len() - 1);
  return arr;
}

void qsort(i32[] arr, i32 lo, i32 hi) {
  if (lo >= hi) { return; }
  i32 pivot = arr[hi];
  i32 i = lo;
  for (i32 j = lo; j < hi; j++) {
    if (arr[j] <= pivot) {
      i32 tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
      i++;
    }
  }
  i32 tmp = arr[i];
  arr[i] = arr[hi];
  arr[hi] = tmp;
  qsort(arr, lo, i - 1);
  qsort(arr, i + 1, hi);
}

export i32 sumArray(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}

export i32 run() {
  i32[] arr = i32[](10, 20, 30, 40, 50);
  return sumArray(arr);
}
`,
    },
  },
  {
    name: 'Enums and match',
    category: 'Enums',
    entry: p('enums.wac'),
    files: {
      [p('enums.wac')]: `// A variant may carry values, and \`match\` must cover every case — a missing arm is a
// compile error rather than a fallthrough.

enum Shape {
  Circle(f64 r), Rect(f64 w, f64 h), Point

  f64 area(const this) {
    return match (this) {
      case Circle(r): 3.141592653589793 * r * r,
      case Rect(w, h): w * h,
      case Point: 0.0
    };
  }

  /** Payload-less variants are values, not calls: \`Shape.Point\`, never \`Shape.Point()\`. */
  bool isFlat(const this) {
    return match (this) { case Point: true, case Circle(_): false, case Rect(_, _): false };
  }
}

export f64 circleArea(f64 r) { return Shape.Circle(r).area(); }
export f64 rectArea(f64 w, f64 h) { return Shape.Rect(w, h).area(); }
export bool pointIsFlat() { return Shape.Point.isFlat(); }
`,
    },
  },
  {
    name: 'Option<T>',
    category: 'Enums',
    entry: p('option.wac'),
    files: {
      [p('option.wac')]: `// \`Option<T>\` is an ordinary generic enum — nothing built in. This is what \`std\` gives you,
// and the reason a missing value does not have to be a null.

enum Option<T> {
  Some(T v), None

  T orElse(const this, T fallback) {
    return match (this) { case Some(v): v, case None: fallback };
  }

  bool isSome(const this) {
    return match (this) { case Some(_): true, case None: false };
  }
}

/** Search, without a sentinel index or a nullable return. */
Option<i32> find(i32[] xs, i32 want) {
  for (i32 i = 0; i < xs.len(); i++) {
    if (xs[i] == want) { return Option.Some(i); }
  }
  return Option.None;
}

export i32 indexOf(i32 want) {
  i32[] xs = i32[](4, 8, 15, 16, 23, 42);
  Option<i32> at = find(xs, want);
  return at.orElse(-1);
}
`,
    },
  },
  {
    name: 'Stack<T>',
    category: 'Generics',
    entry: p('generics.wac'),
    files: {
      [p('generics.wac')]: `// A struct may take type parameters. \`Stack<i32>\` and \`Stack<string>\` are separate types the
// compiler stamps out — no boxing, and nothing erased, so the i32 one holds machine integers.

struct Stack<T> {
  T[] items;
  i32 n;

  /** The type argument comes from what you assign it to: \`Stack<i32> s = Stack.create(...)\`. */
  Stack<T> create(T zero) { return Stack<T>(T[4](fill: zero), 0); }

  void push(this, T v) {
    if (this.n == this.items.len()) {
      T[] bigger = T[this.items.len() * 2](fill: v);
      for (i32 i = 0; i < this.n; i++) { bigger[i] = this.items[i]; }
      this.items = bigger;
    }
    this.items[this.n] = v;
    this.n = this.n + 1;
  }

  T pop(this) {
    this.n = this.n - 1;
    return this.items[this.n];
  }

  i32 len(const this) { return this.n; }
}

export i32 lastPushed(i32 a, i32 b, i32 c) {
  Stack<i32> s = Stack.create(0);
  s.push(a);
  s.push(b);
  s.push(c);
  return s.pop();
}

/** The same template, holding strings. One definition, two machine representations. */
export string joinTwo(string a, string b) {
  Stack<string> s = Stack.create("");
  s.push(a);
  s.push(b);
  string second = s.pop();
  return s.pop() + "-" + second;
}
`,
    },
  },
  {
    name: 'Strings and bytes',
    category: 'Strings',
    entry: p('strings.wac'),
    files: {
      [p('strings.wac')]: `// Strings are GC objects with a length, and they convert to and from bytes — which is where
// most of wac's real work happens, because a protocol is bytes and a message is a string.

export i32 length(string s) { return s.len(); }

export string shout(string name) { return "hello, " + name + "!"; }

/** Byte-level access, by going through \`u8[]\`. */
export i32 countVowels(string s) {
  u8[] b = s.toBytes();
  i32 n = 0;
  for (i32 i = 0; i < b.len(); i++) {
    // \`i32\`, not \`u8\`: a packed type is an array element, never a variable. Reading one
    // widens it, which is why the comparisons below are ordinary integer comparisons.
    i32 c = b[i];
    if (c == 'a' || c == 'e' || c == 'i' || c == 'o' || c == 'u') { n = n + 1; }
  }
  return n;
}

/** And back again: bytes to a string, in reverse. */
export string reverse(string s) {
  u8[] b = s.toBytes();
  u8[] out = u8[b.len()](fill: 0);
  for (i32 i = 0; i < b.len(); i++) { out[i] = b[b.len() - 1 - i]; }
  return string.fromBytes(out);
}
`,
    },
  },
  {
    name: 'Four casts',
    category: 'Casts',
    entry: p('casts.wac'),
    files: {
      [p('casts.wac')]: `// Four casts, spelt differently on purpose. A narrowing conversion has to say which one it
// meant, so choosing wrong is a diagnostic rather than a silent result.

/** \`as\` — lossless, and refused if it could ever lose anything. */
export i64 widen(i32 x) { return x as i64; }

/** \`as!\` — checked at run time: it traps rather than wrapping when the value does not fit. */
export i32 checked(i64 big) { return big as! i32; }

/**
 * \`as~\` — the *nearest* value, not a truncation. \`3.9\` becomes 4 and \`-3.9\` becomes -4.
 *
 * Worth reading twice, because "lossy" invites the assumption that it chops: it rounds, and on
 * overflow it clamps to the range rather than wrapping. If you want the C behaviour — toward
 * zero — that is \`as@\` for a float, and there is a separate spelling precisely so the choice is
 * visible at the call site.
 */
export i32 nearest(f64 x) { return x as~ i32; }

/** Out of range clamps rather than wrapping: 2^32 + 2 as an i32 is i32's maximum, not 2. */
export i32 clamped(i64 x) { return x as~ i32; }

/**
 * \`as@\` — the bits, reinterpreted. No conversion happens at all.
 *
 * This is the one that matters for byte work: \`1.0\` as an f32 is \`0x3f800000\`, and reading those
 * bits as an integer is how a float gets serialised. Writing \`as~\` here would give you 1, which
 * compiles and is wrong — four spellings exist so that mistake cannot be silent. For a float it
 * is also the cast that truncates toward zero, which \`as~\` does not.
 *
 * Note what is *not* here: there is no cast to a packed type. \`u8\` is an array element, never a
 * variable, and storing into a \`u8[]\` truncates on store — so byte work needs no cast at all.
 */
export i32 bitsOfFloat(f32 f) { return f as@ i32; }
`,
    },
  },
  {
    name: 'Callbacks',
    category: 'Functions',
    entry: p('callbacks.wac'),
    files: {
      [p('callbacks.wac')]: `// A function can be a value: \`fn[i32(i32, i32)]\` is "takes two i32s, returns an i32".
//
// This is the whole of how wac reaches outside itself. There is no \`extern\` and no declaration
// form, so a module can only call what it was handed — and when the caller is JavaScript, what
// it hands over is an ordinary closure. A module that takes no \`fn[…]\` parameter has no wasm
// imports at all.

// Not exported, on purpose: a funcref is not something the panel on the right can build a
// value for, so fold is called by the two exports below instead. From JavaScript it *is*
// callable — that is what bindgen is for, and the site's landing page shows this same
// function taking an ordinary closure.
i32 fold(fn[i32(i32, i32)] f, i32[] xs) {
  i32 acc = 0;
  for (i32 i = 0; i < xs.len(); i++) { acc = f(acc, xs[i]); }
  return acc;
}

i32 add(i32 a, i32 b) { return a + b; }
i32 larger(i32 a, i32 b) { return a > b ? a : b; }

/** The same fold, two different functions, chosen at the call site. */
export i32 sumOf(i32 a, i32 b, i32 c) {
  return fold(add, i32[](a, b, c));
}

export i32 maxOf(i32 a, i32 b, i32 c) {
  return fold(larger, i32[](a, b, c));
}
`,
    },
  },
  // === Two surfaces ===
  //
  // The same language written with indentation. Each of these was run through `wacx` before
  // being put here: `longest`, `circle`, `rect`, `totalArea` and `name` all answer, and the
  // mixed pair compiles as one program across both extensions.
  {
    name: "wapy: classes and loops",
    category: "Two surfaces",
    entry: p("vec2.wapy"),
    files: {
      [p("vec2.wapy")]: `# The same language, laid out with indentation instead of braces.
#
# This is not Python: it does not accept Python, and it is not trying to.
# It borrows the shapes — def, class, and/or/not, None, self — and stops there.
# The file's extension is the only thing that selects this surface.

@export
class Vec2:
    x: f64
    y: f64

    ## Length, without the square root.
    def lenSq(const self) -> f64:
        return self.x * self.x + self.y * self.y

    def scale(self, k: f64) -> void:
        self.x = self.x * k
        self.y = self.y * k

@export
def longest(pts: f64[]) -> f64:
    best: f64 = 0.0
    for i in range(0, pts.len() / 2):
        v: Vec2 = Vec2(pts[i * 2], pts[i * 2 + 1])
        d: f64 = v.lenSq()
        if d > best:
            best = d
    return best
`,
    },
  },
  {
    name: "wapy: enums and match",
    category: "Two surfaces",
    entry: p("shape.wapy"),
    files: {
      [p("shape.wapy")]: `# \`match\` destructures an enum and must cover every variant — a missing
# arm is a compile error. An open bracket continues the line, which is how
# the match expression below spans four of them.

@export
class Shape(enum):
    Circle(r: f64)
    Rect(w: f64, h: f64)

    def area(const self) -> f64:
        return match self {
          case Circle(r): 3.14159 * r * r,
          case Rect(w, h): w * h
        }

@export
def circle(r: f64) -> f64:
    return Shape.Circle(r).area()

@export
def rect(w: f64, h: f64) -> f64:
    return Shape.Rect(w, h).area()
`,
    },
  },
  {
    name: "wapy + wac in one program",
    category: "Two surfaces",
    entry: p("mixed.wapy"),
    files: {
      [p("mixed.wapy")]: `# A .wapy file importing a .wac file. Neither surface is privileged: the
# extension picks the parser, and nothing after that knows which one ran.
# The two files below compile to one module.

from "./shapes.wac" import Shape, describe

@export
def totalArea(n: i32) -> f64:
    total: f64 = 0.0
    for i in range(1, n + 1):
        total = total + Shape.Circle(i as f64).area()
    return total

@export
def name(w: f64, h: f64) -> string:
    return describe(Shape.Rect(w, h))
`,
      [p("shapes.wac")]: `export enum Shape {
  Circle(f64 r), Rect(f64 w, f64 h)

  f64 area(const this) {
    return match (this) {
      case Circle(r): 3.14159 * r * r,
      case Rect(w, h): w * h
    };
  }
}

export string describe(Shape s) {
  return match (s) {
    case Circle(r): "circle",
    case Rect(w, h): "rectangle"
  };
}
`,
    },
  },
];

/** Merge all example files into a single FileMap. */
export function allExampleFiles(): FileMap {
  const all: FileMap = {};
  for (const ex of EXAMPLES) {
    for (const [k, v] of Object.entries(ex.files)) {
      all[k] = v;
    }
  }
  return all;
}
