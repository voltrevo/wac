import { HOME, type FileMap } from "./file-store";

const e = (dir: string, file: string) => `${HOME}/examples/${dir}/${file}`;

export type Example = {
  name: string;
  category: string;
  files: FileMap;
  entry: string; // absolute path of the entry file
};

export const EXAMPLES: Example[] = [
  // === Basics ===
  {
    name: "Hello World",
    category: "Basics",
    entry: e("hello-world", "main.wac"),
    files: {
      [e("hello-world", "main.wac")]: `export i32 answer() {
  return 42;
}
`,
    },
  },
  {
    name: "Arithmetic",
    category: "Basics",
    entry: e("arithmetic", "main.wac"),
    files: {
      [e("arithmetic", "main.wac")]: `export i32 compute(i32 a, i32 b) {
  return a * b + a - b;
}
`,
    },
  },
  {
    name: "Floating Point",
    category: "Basics",
    entry: e("floating-point", "main.wac"),
    files: {
      [e("floating-point", "main.wac")]: `export f64 circle_area(f64 radius) {
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
    entry: e("if-else", "main.wac"),
    files: {
      [e("if-else", "main.wac")]: `export i32 classify(i32 x) {
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
    entry: e("while-loop", "main.wac"),
    files: {
      [e("while-loop", "main.wac")]: `export i32 collatz(i32 n) {
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
    entry: e("for-loop", "main.wac"),
    files: {
      [e("for-loop", "main.wac")]: `export i32 factorial(i32 n) {
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
    entry: e("switch", "main.wac"),
    files: {
      [e("switch", "main.wac")]: `export i32 dayKind(i32 day) {
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
    entry: e("gcd", "main.wac"),
    files: {
      [e("gcd", "main.wac")]: `export i32 gcd(i32 a, i32 b) {
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
    entry: e("fibonacci", "main.wac"),
    files: {
      [e("fibonacci", "main.wac")]: `export i32 fib(i32 n) {
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
    entry: e("power", "main.wac"),
    files: {
      [e("power", "main.wac")]: `export i32 pow(i32 base, i32 exp) {
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
    entry: e("imports", "main.wac"),
    files: {
      [e("imports", "main.wac")]: `import { gcd, pow } from "./math.wac";

export i32 test() {
  return gcd(48, 18) * pow(2, 3);
}
`,
      [e("imports", "math.wac")]: `export i32 gcd(i32 a, i32 b) {
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
    entry: e("point", "main.wac"),
    files: {
      [e("point", "main.wac")]: `export struct Point {
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
    entry: e("counter", "main.wac"),
    files: {
      [e("counter", "main.wac")]: `export struct Counter {
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
    entry: e("subtyping", "main.wac"),
    files: {
      [e("subtyping", "main.wac")]: `struct Shape { f64 x; f64 y; }

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
    entry: e("linked-list", "main.wac"),
    files: {
      [e("linked-list", "main.wac")]: `import { Node, makeNode, push_front, sum, len } from "./list.wac";

export i32 testBuild() {
  Node? head = null;
  head = push_front(head, 10);
  head = push_front(head, 20);
  head = push_front(head, 30);
  // list: 30 -> 20 -> 10
  return sum(head) * 100 + len(head);
}

export i32 testFront() {
  Node? head = null;
  head = push_front(head, 10);
  head = push_front(head, 20);
  head = push_front(head, 30);
  return head!.val;
}
`,
      [e("linked-list", "list.wac")]: `export struct Node {
  i32 val;
  Node? next;
}

export Node makeNode(i32 val) {
  Node n = Node();
  n.val = val;
  return n;
}

export Node push_front(Node? head, i32 val) {
  Node n = makeNode(val);
  n.next = head;
  return n;
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
`,
    },
  },

  // === Data Structures ===
  {
    name: "Buffer (Growable)",
    category: "Data Structures",
    entry: e("buffer", "main.wac"),
    files: {
      [e("buffer", "main.wac")]: `import { Buffer } from "./buffer.wac";

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
      [e("buffer", "buffer.wac")]: `export struct Buffer {
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
    name: "Array Sum",
    category: "Arrays",
    entry: e("array-sum", "main.wac"),
    files: {
      [e("array-sum", "main.wac")]: `export i32 sumArray(i32[] arr) {
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
