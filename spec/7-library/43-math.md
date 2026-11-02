# 43 — Math

`math` is `core`'s namespace of mathematical functions on `f64`: the logarithms, the exponentials and the
power. It is a namespace of its own rather than names at `core`'s root, so `math.log(x)` says where `log`
comes from and a program's own `log` does not meet it.

```wac
// expect: lnE() = 1.0
// expect: decades(1000.0) = 3.0
// expect: cube(2.0) = 8.0
import { math } from "core";
import { math.pow } from "core";

export f64 lnE() { return math.log(math.exp(1.0)); }
export f64 decades(f64 x) { return math.log10(x); }
export f64 cube(f64 x) { return pow(x, 3.0); }
```

`[§wac-math-namespace-ztanttb]` `core` exports `math` as a namespace: `import { math } from "core"` binds it, and
`import { math.log } from "core"` binds the one member ([03](../1-programs/03-namespaces.md)).

| Function | What it answers |
|---|---|
| `log(x)` | the natural logarithm of `x` |
| `log2(x)` | the base-2 logarithm, exact at every power of two |
| `log10(x)` | the base-10 logarithm |
| `log1p(x)` | `log(1 + x)`, accurate when `x` is near zero |
| `exp(x)` | `e` to the power `x` |
| `expm1(x)` | `exp(x) − 1`, accurate when `x` is near zero |
| `pow(x, y)` | `x` to the power `y` |

## The same answer everywhere

`[§wac-math-pure-wac-dkdh7z8]` The functions are written in wac, in `core`, and use nothing of the host's. Float arithmetic is
the same bits on every engine, so each function answers the same bits on every host, and a static whose
initialiser calls one is folded to those bits ([28](../4-static/28-static-evaluation.md)).

```wac
// expect: folded() = true
import { math } from "core";

static f64 L = math.log(10.0);
f64 ten() { return 10.0; }
export bool folded() { return L == math.log(ten()); }
```

`[§wac-math-ulp-04v0hmt]` Each answer is within one unit in the last place of the true value. Which of the two nearest
doubles it is, where the true value lies between them, is the implementation's — the functions are not
required to be correctly rounded, and a program must not depend on more than the one ulp.

## Special values

The special cases are those of C99's Annex F, so a program ported from C or JavaScript meets the answers
it expects at the edges.

`[§wac-math-log-special-m9vknv5]` The logarithms of `±0.0` are `-inf`, of a negative are NaN, of `+inf` are `+inf`, and of `1.0`
are `+0.0`. `log1p(-1.0)` is `-inf` and `log1p` below `-1.0` is NaN. A NaN answers a NaN.

`[§wac-math-exp-special-sxgvhcg]` `exp(-inf)` is `0.0` and `exp(+inf)` is `+inf`; `exp` overflows to `+inf` above about `709.78` and
underflows to `0.0` below about `-745.13`. `expm1(-inf)` is `-1.0`, and `expm1` keeps the sign of a zero.

```wac
// expect: edges() = true
import { math } from "core";

export bool edges() {
  f64 inf = 1.0 / 0.0;
  return math.log(0.0) == -inf && math.exp(-inf) == 0.0 && math.exp(710.0) == inf
      && math.log(1.0) == 0.0 && math.log2(8.0) == 3.0;
}
```

`[§wac-math-pow-special-0ugwjou]` `pow(x, ±0.0)` is `1.0` for every `x`, a NaN included, and so is `pow(1.0, y)` for every `y`.
A negative `x` to a `y` that is not an integer is NaN; to an odd integer the result is negative, and
`pow(-0.0, y)` for an odd `y` keeps the zero's sign. `pow(-1.0, ±inf)` is `1.0`; otherwise `pow(x, +inf)`
is `+inf` when `|x| > 1` and `0.0` when `|x| < 1`, and the reverse for `-inf`.

```wac
// expect: powEdges() = true
import { math } from "core";

export bool powEdges() {
  f64 nan = 0.0 / 0.0;
  f64 inf = 1.0 / 0.0;
  bool odd = math.pow(-2.0, 3.0) == -8.0;
  bool fractional = math.pow(-8.0, 1.0 / 3.0) != math.pow(-8.0, 1.0 / 3.0);
  return math.pow(nan, 0.0) == 1.0 && math.pow(1.0, nan) == 1.0 && odd && fractional
      && math.pow(0.5, inf) == 0.0 && math.pow(-1.0, inf) == 1.0;
}
```

## Open

- **`f32` versions.** These take and answer `f64`; an `f32` is widened and the answer narrowed with `as~`,
  which is within an ulp of the `f32` answer but not always the nearest.
- **The trigonometric functions** — `sin`, `cos`, `tan` and their inverses, `atan2`, the hyperbolic ones —
  and `cbrt` and `hypot` are not here yet.
