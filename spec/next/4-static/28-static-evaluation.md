# 28 — Static evaluation

Static evaluation is ordinary wac, run by the compiler. Static declarations ([27](27-static-declarations.md)),
computed types ([30](30-computed-types.md)), static control ([31](31-static-control.md)) and literal
conversion ([09](../2-types/09-numeric-literals.md)) all use it, and it is the same language a program runs —
there is no second, restricted one.

The order evaluations happen in, and what counts as a cycle, are [29](29-static-dependencies.md)'s subject.

## Calls in initialisers

```wac
// fragment
i32 square(i32 x) { return x * x; }

static i32 SIZE = square(8);    // 64
static i32 DOUBLE = SIZE * 2;   // 128
```

```wac
// expect: answers size = 64
// expect: answers doubled = 128
i32 square(i32 x) { return x * x; }

static i32 SIZE = square(8);
static i32 DOUBLE = SIZE * 2;

export i32 size() { return SIZE; }
export i32 doubled() { return DOUBLE; }
```

`[§wac-static-eval-ordinary-ba8c628]` A static initialiser may be any expression a function body may contain,
including calls, and is evaluated by the same rules a running program uses.

## Local mutation is ordinary computation

```wac
// fragment
i32[] buildTable() {
  i32[] out = i32[].filled(8, 0);
  for (i32 i = 0; i < out.len(); i++) {
    out[i] = i * i;
  }
  return out;
}

static i32[] TABLE = buildTable();
// TABLE[3] == 9
// ERROR: TABLE[3] = 0;         // deep-const access
```

```wac
// expect: answers table(3) = 9
// expect: answers table(7) = 49
i32[] buildTable() {
  i32[] out = i32[].filled(8, 0);
  for (i32 i = 0; i < out.len(); i++) {
    out[i] = i * i;
  }
  return out;
}

static i32[] TABLE = buildTable();

export i32 table(i32 i) {
  // ERROR: cannot write through a const reference
  // TABLE[3] = 0;

  return TABLE[i];
}
```

`[§wac-static-eval-mutation-i9dfzgy]` A function called during static evaluation may allocate, loop and mutate its
own values freely. Only the static binding's result is const.

No shared mutable module state is introduced.

## Arithmetic is the program's

Static evaluation computes what the program would: the same wrapping, the same rounding, the same traps. A
folded value and the same expression run at run time agree:

```wac
// expect: answers wrap = -2147483648
// expect: answers staticWrap = -2147483648
// expect: answers shiftMask = 1
// expect: answers staticShiftMask = 1
// expect: answers divNeg = -3
// expect: answers staticDivNeg = -3
// expect: answers nearest = 2
// expect: answers staticNearest = 2
export i32 wrap() { i32 a = 2147483647; return a + 1; }
export i32 shiftMask() { i32 a = 1; i32 n = 32; return a << n; }   // the count is taken mod 32
export i32 divNeg() { i32 a = -7; i32 b = 2; return a / b; }       // truncates toward zero
export i32 nearest() { f64 x = 2.5; return x as~ i32; }            // ties to even

static i32 W = wrap();
static i32 S = shiftMask();
static i32 D = divNeg();
static i32 N = nearest();

export i32 staticWrap() { return W; }
export i32 staticShiftMask() { return S; }
export i32 staticDivNeg() { return D; }
export i32 staticNearest() { return N; }
```

`[§wac-static-eval-same-arith-truzksr]` A value computed by static evaluation equals the value the same expression
produces at run time: integer wrapping, shift masking, division, rounding and conversion behave identically.

## No external handles during static evaluation

Static evaluation has no way to acquire an external handle. `Sys` has no special meaning in the core language:
its name, import origin, or appearance in a type does not restrict evaluation. A pure wac or virtual backing
could be called at compile time, including through a `Sys` imported from the standard library.

A nullable `Sys` can also simply hold `null`:

```wac
// fragment
typeref choose(bool flag, Sys? sys) {
  if (flag) { return typeref(i32); }
  sys!.log("choosing");
  return typeref(string);
}

type T = type(choose(true, null)); // i32; Sys? holds null
```

`choose(false, null)` traps at the unwrap and cannot produce a type. Calling `sys.log` is not itself forbidden;
whether it can execute depends on the actual backing, not the shape of the code.

`[§wac-static-eval-no-handles-63nmrmg]` Static evaluation is handed no capability. Code that would need one fails in
the ordinary way — a `null` unwrapped traps — and nothing about a capability's name or type is forbidden
statically.

Allocation identity, sharing across calls, and per-instantiation behaviour are specified in
[27](27-static-declarations.md).

## A limit is not proof of nontermination

```wac
// fragment
typeref forever() {
  while (true) {}
}

type T = type(forever());
// Compiler may stop: "static evaluation resource limit exceeded".
// It must not claim that reaching its limit proves nontermination.
// Alternatively, a compiler may prove this loop never terminates and report it.
```

Implementations choose when to stop trying. They may also implement nontermination proofs within a scope of their
choosing, but are not required to. Diagnostics must distinguish an evaluation limit (the answer is unknown) from
proven nontermination, a proven dependency cycle, or an executed trap.

```wac
// expect: refused
i32 forever() {
  while (true) { }                         // never finishes
}

static i32 X = forever();                  // refused: by a limit, or by a proof

export i32 readsX() { return X; }
```

`[§wac-static-eval-limit-bt6cfra]` A static evaluation the compiler stops before it finishes is an error, reported as
a resource limit — the answer is unknown — and never as nontermination unless nontermination was proven.

```wac
// expect: refused
i32 zero() { return 0; }
static i32 Y = 1 / zero();                 // traps during evaluation

export i32 readsY() { return Y; }
```

`[§wac-static-eval-trap-yiybeke]` A static evaluation that traps is an error, reported as the trap it executed.

`[§wac-static-eval-outcomes-distinct-cftntwq]` The four ways a static evaluation fails — a resource limit, proven
nontermination, a dependency cycle, an executed trap — are reported as different errors.

They mean different things to whoever reads the diagnostic: a cycle is the program's fault and always will be; a
trap is the program's fault on this input; a limit is the compiler declining to keep trying, which says nothing
about whether the computation would have finished.

## An implementation that cannot evaluate something

An implementation may lack support for evaluating some construct statically. That is a property of the
implementation, not of the program, and it is never silent: a retained static that cannot be evaluated is an
error that says so, naming the construct. It is not computed at run time instead — a `static` promises the value
was computed when the program was compiled.
