# 34 — Recursive inference

An `auto` function's result is inferred from its returns, and an `auto` may depend on another, or on itself. This
chapter says how such dependencies are followed. Scope and origins are [33](33-placeholders.md)'s subject, and
union-only cycles [18](../2-types/18-unions.md)'s.

## The dependency is a placeholder, not necessarily a function

Infer each placeholder from its own root. Exclude a dependency path when it
revisits the same `auto` placeholder in the same generic instantiation.
Encountering a distinct placeholder, including one in a different instantiation
of the same declaration, does not itself constitute a cycle. Retain contributions
on independent paths.
A cycle containing both `auto` and bare `union` is still cut at the repeated
`auto`. Union-only cycles instead follow [18](../2-types/18-unions.md).

```wac
// fragment
struct Pair<A, B> {
  void seedA(A value) {}
  void seedB(B value) {}

  void connect(A a, B b) {
    Pair.seedA(b); // B contributes to A.
    Pair.seedB(a); // A contributes to B.
  }

  void seed() { Pair.seedA(1 as i32); }
}

void example() {
  Pair<auto, auto> p;
  // Both infer i32 from the independent seed.
  // Every method is subsequently checked against those candidates.
}
```

This is not a search for mutually satisfying types. Each root gathers its
permitted contributions, chooses a candidate, then ordinary checking reports
errors where those candidates fail. There is no retry or candidate revision.

`[§wac-auto-no-search-fi5i58b]` Each `auto` placeholder chooses its candidate from its own contributions, and is then
checked. No search is made for types that would make every use succeed, and a failed check revises nothing.

## Partial collections are not prematurely widened

The following helpers stand for values with the indicated concrete types.

```wac
// fragment
union<i32, string> makeUnion() {
  return 7;
}

auto a(bool c) {
  if (c) { return makeUnion(); } // Declared result: union<i32, string>.
  return b();
}

auto b() {
  if (first()) { return makeI32(); }
  if (second()) { return makeString(); }
  return a(true);
}
// Both candidates: union<i32, string>.
```

`auto` does not create a union from b's i32 and string returns:

```text
widen(i32, string) = error
```

The explicit return type of `makeUnion()` supplies the existing union. Following
that contribution through the calls lets each root gather:

```text
widen(union<i32, string>, i32, string) = union<i32, string>
```

The ordinary i32 and string inputs already fit that union. They do not add new
alternatives to it: `widen(union<i32>, i32, string)` would be an error.

From root `a`, traversal of `b` retains i32 and string as separate partial
contributions after cutting the path back to a. It does not attempt to widen
that partial collection before combining it with a's explicit union contribution.
From root `b`, traversal of a reaches makeUnion's explicit result before cutting
the path back to b. Both roots therefore receive the existing union contribution.

Do not reject a partial collection based on a pairwise widening order. Final
checking still checks each expression in its own context; collecting contributions
does not exempt a ternary from checking.

`[§wac-auto-partial-cxjrewg]` Contributions gathered along different paths are combined all at once, not widened
pairwise as they are found.

## Inferred return types

```wac
// fragment
auto choose(bool cond, i32 value, i32? maybe) {
  if (cond) { return value; }
  return maybe;
}                            // result: i32?

auto literalAlongside(i64 value, bool cond) {
  if (cond) { return 2; }
  return value;
}                            // result: i64; 2 adopts i64

// auto unresolved() { return 7; }
// Infer never, then reject 7 against never; no i32 fallback
```

The return expressions collectively determine one result type. This is the
explicit collection point for return inference, not permission to infer local
variable types from later statements. An explicitly declared result type instead
supplies the expected type to each return expression.

```wac
// fragment
auto wrong() {
  auto x = 7;                // ERROR here: unresolved local initializer
  return x as i64;            // cannot retroactively type x
}
```

Infer generic results per instantiation. Existing definition-time checking still
applies.

`[§wac-auto-return-vm59825]` An `auto` return type is the widening of the function's return expressions, per generic
instantiation. Returns excluded by instantiation-time static branch selection do not
contribute to that instantiation's result. Ordinary runtime branches contribute
even if later optimisation proves one unreachable.

```wac
// fragment
auto forward<T>(T value) { return value; }
// forward<i32> returns i32; forward<string> returns string.
```

## Collect a candidate, then check the body

1. Collect explicit return contributions without runtime reachability analysis.
   Follow type dependencies, including calls with `auto` results. Exclude paths
   that revisit the same auto placeholder in the same generic instantiation already on the current inference path; retain independent
   contributions. Unconstrained numeric literals contribute nothing. An explicit
   `void` contribution is an error.
2. Infer the common type of the contributions. An empty collection yields `never`;
   `never` itself adds no value cases to the common type.
3. Check the entire body against the candidate signature, including every explicit
   return and whether control can reach the end. Failure does not retry inference
   or widen the candidate.

The absence of contributions is not an inference error. It does not establish
that the body is valid either:

```wac
// fragment
auto seven() { return 7; }
// No contributions -> never. Body checking rejects 7 against never.

auto empty() {}
// No contributions -> never. Body checking rejects reachable normal completion.

auto earlyExit() { return; }
// Explicit void contribution -> inference error; declare void instead.
```

Implicit fallthrough is not a contribution. Inference does not determine whether
the end is reachable; subsequent body checking must. `void` is never inferred,
including from an explicitly void-typed return expression.

`[§wac-auto-empty-never-6k7ndms]` An `auto` return with no contributions is `never`, and the body is then checked against
it. An explicit `return;` is an inference error, and `void` is never inferred.

## Follow auto dependencies; exclude recursive paths

```wac
// fragment
auto value() { return 1 as i32; }
auto forwarded() { return value(); }
// Both infer i32; ordinary forwarding works.
```

Infer each function from its own root. Follow the dependencies needed to determine
its return expressions' types. When a path revisits the same auto placeholder in the same generic instantiation already on that
path, exclude that path's contribution. Continue collecting contributions from
other paths. Explicitly declared result types contribute directly without
traversing their bodies. The same rules apply to symbol-named methods.

Exclusion means no contribution, not a provisional `never` type. Only when
finalising a root's complete collection does an empty collection yield `never`.
A nested traversal with no contributions must not manufacture `never[]` when
wrapped in an array.

```wac
// fragment
auto wrapped() {
  return [wrapped()];
}
// Inferring wrapped: the inner call revisits this same return placeholder,
// so its contribution is excluded. The array has no element-type contribution.
// It contributes nothing, not never[].
// The root's empty collection gives candidate never.
// This illustrates candidate selection; the body must still be checked
// using the final candidate, as usual.
```

The array constructor cannot turn an absent contribution into a concrete element
type. In particular, choosing never[] here would incorrectly use a provisional
never for the excluded call, then wrap that provisional type in an array.

An already computed inferred result must not bypass recursive-path exclusion.
Contributions are defined as if inference traversed the dependencies afresh from
each root. Declaration order, compilation order, and previously computed results
must not change the outcome.

`[§wac-auto-path-exclusion-ffs3tt5]` A dependency path that returns to the same `auto` placeholder in the same
instantiation contributes nothing; other paths still contribute. The result does not depend on declaration order,
compilation order, or results inferred earlier.

Suppose AsNullable<T> adds an outer nullable layer only when T is not already
nullable. Its computed-type implementation is omitted; these equations specify
the transformation used by this example:

```text
AsNullable<i32>  = i32?
AsNullable<i32?> = i32?
```

```wac
// fragment
AsNullable<T> optional<T>(T value) {
  return value;
}

auto a(bool stop) {
  if (stop) { return 1 as i32; }
  return b(stop);
}

auto b(bool stop) {
  return optional(a(stop));
}
```

With recursive-path exclusion, a receives only its independent i32 contribution:
the path through b cannot determine optional's T after excluding the repeated a.
Its candidate is i32. Starting from b instead retains a's independent i32
contribution, then applies AsNullable, giving b candidate i32?. Checking rejects
a's return of b's i32? against its candidate i32.

Under an alternate rule that permits reusing completed inferred results,
inferring b first and then reusing its candidate while inferring a gives:

```text
b: i32?
a: widen(i32, i32?) = i32?
```

Both bodies then check successfully, so the program compiles under that alternate
rule with b inferred first. Since AsNullable is idempotent, optional(a(stop))
still returns i32? after a's candidate becomes i32?.

That successful interpretation makes it tempting to allow reuse of completed
candidates. But inferring a first gives a candidate i32 and then b candidate i32?, causing
checking to fail. Acceptance would depend on compilation order.

The successful interpretation is internally consistent, but this inference rule
must reject the program rather than search for it or discover it accidentally
through compilation order. Explicitly declaring a's result as i32? makes that
interpretation available reliably.

## A base case supplies an independent contribution

```wac
// fragment
auto factorial(i32 n) {
  if (n == 0) { return 1 as i32; }
  return n * factorial(n - 1);
} // Infer i32 from the base case; check the entire body against i32.
```

## Dependencies across statements

```wac
// fragment
auto a(bool cond) {
  auto x = b(cond);
  if (cond) { return 1 as i32; }
  return x;
}

auto b(bool cond) { return a(cond); }
// Both infer i32. Body checking subsequently determines x as i32.
```

Determining the contribution of `x` follows its type dependency back to its
initializer, including recursive-path exclusions. The local does not erase that
dependency or replace an excluded contribution with `never`. This follows types
across statements; it does not infer an initializer from constraints supplied by
later uses. `auto x = 7;` still cannot be repaired by a later typed use.

## Partial contributions survive calls and transformations

A traversal can retain useful contributions without resolving every path. Those
partial contributions flow through calls and local type dependencies. Extracting
a branch into an `auto` helper preserves its independent contribution:

```wac
// fragment
auto a(bool cond) {
  return helper(cond);
}

auto helper(bool cond) {
  return cond ? 1 as i32 : a(cond);
}
// Both infer i32. The recursive branch is excluded, not the whole helper.
```

A transformation can use a surviving partial type to choose a candidate result.
If its required type information is entirely excluded, it contributes nothing.
Array construction keeps the array layer; operator and generic resolution use
the ordinary rules on the available partial types.

```wac
// fragment
auto a(bool cond) {
  return [helper(cond)];
}

auto helper(bool cond) {
  return cond ? 1 as i32 : a(cond);
}
// Root a: helper contributes i32 after cutting its path back to a;
//         array construction gives candidate i32[].
// Root helper: a's dependent array has no contribution after cutting the
//              path back to helper; the independent branch gives i32.
// Final checking rejects helper's i32[] alternative against candidate i32.
```

Partial contributions choose candidates; they do not certify complete expressions.
Check every body using the final root signatures, with no retry, candidate
revision, or search for alternative operator implementations after failure.

Candidate signatures allow callers to be checked before callee bodies have been
validated. Every callee body must still be checked; using its candidate signature
does not establish its correctness. Report errors where checking fails.

## Ternary alternatives contribute independently

Look through ternary result alternatives even when the whole expression has no
resolved type. This preserves the inference behaviour of separate returns:

```wac
// fragment
auto example(i32 n) {
  if (n == 0) { return 0 as i32; }
  return n == 1 ? null : example(n - 1);
} // Contributions: i32 and null -> i32?. Then check the complete body.
```

```wac
// fragment
auto example(i32 n) {
  if (n == 0) { return 0 as i32; }
  if (n == 1) { return null; }
  return example(n - 1);
} // Also i32?.
```

`null` contributes its concrete type `never?`; it is not omitted like an
unconstrained numeric literal. Widening its base `never` with `i32` and taking
the greater depth gives `i32?`. The example needs neither a symbolic `T?` nor
a recursive fixed-point solver. Transformations retain their meaning; array
elements are not themselves return alternatives:

```wac
// fragment
auto grow(i32 n) {
  if (n == 0) { return 0 as i32; }
  return [grow(n - 1)];
} // Candidate i32; ERROR: the recursive return produces i32[].
```

## Recursion and never

```wac
// fragment
auto forever() { return forever(); } // Infer never; checking succeeds.
auto forever() { forever(); }        // Infer never; no normal fallthrough.
never forever() { return forever(); } // Also valid with an explicit signature.
```

A return type constrains normal completion; it does not promise termination.

`[§wac-auto-recursion-never-fvt6ex2]` Mutually or self-recursive `auto` functions with no other contribution infer
`never`, and check.
For the explicit recursive example, a normally returning call would require its
inner call to have returned first, indefinitely. No finite execution can complete
normally. A trap is not normal completion. Checking the body against its own
signature is therefore sound without a separate termination proof.

Mutual recursion uses the same path-exclusion rule. Each root follows dependencies
and retains partial contributions; there is no shared result type or iterative
fixed-point inference for the group. Check bodies against their final signatures.

```wac
// fragment
auto a() { return b(); }
auto b() { return a(); }
// Both infer never; both bodies pass checking.
```

```wac
// fragment
auto a(bool stop) {
  if (stop) { return 1 as i32; }
  return b(stop);
}

auto b(bool stop) { return a(stop); }
// Starting from either root, the i32 contribution survives.
// Both infer i32; both bodies pass checking.
```

```wac
// fragment
i32 a(bool stop) {
  if (stop) { return 1; }
  return b(stop);
}
auto b(bool stop) { return a(stop); }
// b infers i32 from a's explicit signature; both bodies pass checking.
```

## Unreachable returns still count and must type-check

```wac
// fragment
auto forever() { forever(); return "hi"; }
// The explicit string contribution determines string. Accepted.

auto forever() { forever(); return; }
// Explicit void contribution -> inference error.

never forever() { forever(); return; }
// ERROR: explicit void return does not match never, despite being unreachable.

never forever() { forever(); return "hi"; }
// ERROR: string does not match never, despite being unreachable.
```

There is no search for a different signature that makes an inconvenient return
unreachable.

`[§wac-auto-unreachable-counts-ff9ffde]` A return statement contributes, and is checked, whether or not control can reach
it. Instantiation-time static branch exclusion remains as specified
above; ordinary control-flow unreachability exempts no explicit return from
contribution collection or type checking. Valid dead code may still be removed
by optimisation.

