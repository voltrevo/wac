// The language's example snippets, in one place because two pages print them.
//
// The staging rewrite in `src/next/` shows the same tour as the live site, and for a while both
// exist. Two copies of a snippet is two things to keep true — and `site/tools/site.test.ts` compiles
// these by name, so the copy it did not find would be the one that quietly stopped compiling.
// One file, imported by both.


export const EX_ENUM = `enum Shape {
  Circle(f64 r), Rect(f64 w, f64 h)

  f64 area(const this) {
    return match (this) {
      case Circle(r): 3.14159 * r * r,
      case Rect(w, h): w * h
    };
  }
}

export f64 circle(f64 r) { return Shape.Circle(r).area(); }
export f64 rect(f64 w, f64 h) { return Shape.Rect(w, h).area(); }`;

export const EX_GENERIC = `struct Pair<T> {
  T a;
  T b;

  Pair<T> of(T a, T b) { return Pair<T>(a, b); }
  T left(const this) { return this.a; }
}

export i32 leftInt(i32 x, i32 y) {
  Pair<i32> p = Pair.of(x, y);
  return p.left();
}

export string leftStr(string x, string y) {
  Pair<string> p = Pair.of(x, y);
  return p.left();
}`;

// ── The two surfaces ─────────────────────────────────────────────────────────
//
// `EX_SURFACE_WAPY` is not hand-written. It is what `wapyPrint.ts` emits for `EX_SURFACE_WAC`,
// pasted here — so the pair cannot drift into a claim the compiler would not make. Both were
// compiled through `wacx` before being put here, and the two binaries are byte-identical, which
// `wapySpec.test.ts` asserts so the sentence below stays true.

export const EX_SURFACE_WAC = `export struct Histogram {
  i32[] bins;

  /// A histogram with \`n\` empty bins.
  Histogram of(i32 n) { return Histogram(i32[n]()); }

  void add(this, i32 v) {
    i32 i = v < 0 ? 0 : v;
    this.bins[i % this.bins.len()]++;
  }

  i32 peak(const this) {
    i32 best = 0;
    for (i32 i = 0; i < this.bins.len(); i++) {
      if (this.bins[i] > best) { best = this.bins[i]; }
    }
    return best;
  }
}`;

export const EX_SURFACE_WAPY = `@export
class Histogram:
    bins: i32[]

    ## A histogram with \`n\` empty bins.
    def of(n: i32) -> Histogram:
        return Histogram(i32[n]())

    def add(this, v: i32) -> void:
        i: i32 = 0 if v < 0 else v
        this.bins[i % this.bins.len()]++

    def peak(const this) -> i32:
        best: i32 = 0
        for i in range(0, this.bins.len()):
            if this.bins[i] > best:
                best = this.bins[i]
        return best`;

// Editable and runnable, in wapy, compiled by the same `wacCompile` call as every other demo on
// the page — the only difference is that the file is called `.wapy`. Run through `wacx` first;
// `fizzbuzz(15)` gives `1 2 Fizz 4 Buzz Fizz 7 8 Fizz Buzz 11 Fizz 13 14 FizzBuzz`.
export const EX_WAPY_LIVE = `@export
def fizzbuzz(n: i32) -> string:
    out: string = ""
    for i in range(1, n + 1):
        if i % 15 == 0:
            out = out + "FizzBuzz "
        elif i % 3 == 0:
            out = out + "Fizz "
        elif i % 5 == 0:
            out = out + "Buzz "
        else:
            out = out + itoa(i) + " "
    return out

def itoa(v: i32) -> string:
    if v == 0:
        return "0"
    s: string = ""
    n: i32 = v
    while n > 0:
        s = DIGITS[n % 10] + s
        n = n / 10
    return s

const DIGITS: string[] = string[]("0", "1", "2", "3", "4", "5", "6", "7", "8", "9")`;

export const EX_MIXED_WAC = `import { Histogram } from "./hist.wapy";

export i32 tallest(i32[] xs, i32 n) {
  Histogram h = Histogram.of(n);
  for (i32 i = 0; i < xs.len(); i++) {
    h.add(xs[i]);
  }
  return h.peak();
}`;

// From packages/crypto/src/layout.wac, unabridged. On the page because it is the shortest
// illustration of the per-word tax entry 2 of the wishlist describes.
export const EX_BEWORD = `// packages/crypto/src/layout.wac
export u32 beWord32(u8[] b, i32 i) {
  return ((b[i] << 24) | (b[i + 1] << 16)
        | (b[i + 2] << 8) | b[i + 3]) as@ u32;
}`;

export const EX_MIXED_WAPY = `from "./stats.wac" import tallest

@export
def busiest(xs: i32[]) -> i32:
    return tallest(xs, 24)`;

// ── Example code ─────────────────────────────────────────────────────────────

export const EX_HELLO = `export string hello() {
  return "Hello, world!";
}`;

export const EX_MATH = `export i32 gcd(i32 a, i32 b) {
  while (b != 0) {
    i32 t = b;
    b = a % b;
    a = t;
  }
  return a;
}`;

export const EX_ERROR = `// What if you write while(b) instead of while(b != 0)?
//
// error: condition must be bool
//   --> main.wac:2:10
//    |
//  2 |   while (b) {
//    |          ^ expected bool, found i32
//    = help: use a comparison: if (b != 0) { ... }`;

export const EX_STRUCT = `export struct Point {
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
}`;

export const EX_NULLABLE = `struct Node {
  i32 val;
  Node? next;
}

export i32 sum(Node? head) {
  i32 total = 0;
  Node? cur = head;
  while (cur is not null) {
    total += cur!.val;
    cur = cur!.next;
  }
  return total;
}`;

export const EX_ARRAYS = `export i32 sumArray(i32[] arr) {
  i32 total = 0;
  for (i32 i = 0; i < arr.len(); i++) {
    total += arr[i];
  }
  return total;
}`;

export const EX_IMPORTS_MAIN = `import { gcd, pow } from "./math.wac";

export i32 test() {
  return gcd(48, 18) * pow(2, 3);
  // 6 * 8 = 48
}`;

export const EX_IMPORTS_MATH = `export i32 gcd(i32 a, i32 b) {
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
    if (exp % 2 == 1) {
      result = result * base;
    }
    base = base * base;
    exp = exp / 2;
  }
  return result;
}`;

// The root of the tree the compiler ships. Two files that never mention each other, meeting through
// a type neither declares — which is the whole point, and is why the pair is checked by
// site/tools/site.test.ts rather than being prose. Bare here rather than `"core"` because the
// playground compiles this with whichever compiler the page loaded, and the deployed asset can be
// older than this file; both spellings work in the current one.
export const EX_CORE_MAIN = `import { Read } from "core";
import { describe } from "./report.wac";

export string demo() {
  return describe(Read.Data(u8[](1, 2, 3)))
    + " | " + describe(Read.End)
    + " | " + describe(Read.Failed("disk went away"));
}`;

export const EX_CORE_LIB = `import { Read } from "core";

export string describe(Read r) {
  match (r) {
    case Data(bytes): return "read some bytes";
    case End:         return "finished";
    case Failed(why): return "failed: " + why;
  }
}`;

export const EX_BINDGEN = `// Generated by wacBindgen — zero dependencies
const _wasm = Uint8Array.from(
  atob("AGFzbQEAAAA..."),
  (c) => c.charCodeAt(0),
);

const _instance =
  await WebAssembly.instantiate(_wasm);
const _exports =
  _instance.instance.exports;

export function sumArray(
  arr: Int32Array,
): number {
  const _w_arr = _arrayToWasm_i32(arr);
  return (_exports.sumArray as
    CallableFunction)(_w_arr) as number;
}`;
