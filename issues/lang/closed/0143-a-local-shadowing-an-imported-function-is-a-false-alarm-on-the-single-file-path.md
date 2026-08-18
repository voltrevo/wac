# 0143 — a non-funcref local captures a call position, so shadowing an imported function is a false error

- **Status:** closed, 2026-08-17
- **Fixed in:** the commit closing this
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-08-17
- **Kind:** bug
- **Symptom:** wrong answer

## The bug

```wac
import { helper } from "./other.wac";

export i32 main() {
  i32 helper = helper();   // code 47: "this is not something that can be called"
  return helper;
}
```

`helper()` should call the import. The checker binds it to the `i32` local instead.

## The rule it breaks

`spec/spec/functions.md`, `[§wac-param-shadows-func-5nkq2wp]`:

> A bare name in call position resolves to a local or parameter **of funcref type** before any
> function.

`i32` is not a funcref, so the local should not take the call.

## Four programs that locate it

```wac
// 1. reports code 47 — WRONG
import { helper } from "./other.wac";
export i32 main() { i32 helper = helper(); return helper; }
```

```wac
// 2. silent — right, the local is a funcref
import { helper } from "./other.wac";
export i32 main(fn[i32()] helper) { return helper(); }
```

```wac
// 3. reports code 47 — WRONG, and the call is nowhere near the initialiser
import { helper } from "./other.wac";
export i32 main() { i32 helper = 1; return helper(); }
```

```wac
// 4. silent — right, and this is why nobody hit it before
i32 helper() { return 1; }
export i32 main() { i32 helper = helper(); return helper; }
```

3 rules out "the local is not finished being declared in its own initialiser".
4 rules out the single-file slice: a same-file function wins anyway, so only an **imported** one
exposes the missing condition.

Run them with `dumpTypeErrors`, which is what the failing test calls:

```ts
const mod = await wacBind("packages/wacc/src/api.wac");
const dump = mod.dumpTypeErrors as (src: Uint8Array) => Int32Array;
Array.from(dump(new TextEncoder().encode(src)));   // (code, line, col) triples
```

## The fix

In call position, a local shadows a function **only if the local's type is a funcref**.

Then 1 and 3 resolve to the function, find none in this file, and stay silent about an unresolved
import — which the checker already does for every unshadowed one.

Where: `packages/wacc/src/check.wac`, the callee `else:` arm around line 3405. It is downstream of
the mistake — `naturalTypeOf` correctly answers `"i32"` and the arm correctly says an `i32` is not
callable. The name should not have resolved to the local.

**Land two `spec/cases` programs with it**: 1 and 2 above. The tag has prose and no case that fails
when the condition is dropped, which is how it went missing.

## Fixed 2026-08-17

`checkCallee` deferred instead of reporting, and the discrimination it needed did not exist:

```wac
i32 arity = funcrefArity(t);
if (arity < 0) {
  if (c.shadowsOuterName(name)) { return; }   // the outer binding takes the call
  c.report(errNotCallable(), call.line, call.col);
  return;
}
```

`shadowsOuterName` is new and counts entries in the name table. An `import` puts the name there too,
so a local of the same name makes two, and that count is the only thing available that separates *a
local shadowing an imported function* from *a local and nothing else*.

**The second half matters as much as the first.** `i32 x = 1; return x();` with no `x` anywhere is
genuinely not callable and the reference says so — so silencing on the local's type alone would have
traded this disagreement for a new one in the other direction. Both are asserted.

### What guards it, which is not where I first put it

`spec/cases/0195` and `0196` were written first and **do not catch it**: cases run the full path,
where the import is visible and `funcAt` finds the function before the local is consulted. Disabling
the fix left them at 196 of 196. They document the rule on the path that works.

The guard is a new test in `packages/wacc/test/wac/typecheck_test.wac`, on the single-file path that
broke. It asserts only *our* silence — unlike `CLEAN` beside it, the reference is not consulted,
because its single-file path throws outright on a program containing an import. Canaried: disabling
the fix reddens it and the corpus sweep together, restoring it greens all 51.

## Not the fix

"The single-file slice should stay silent when a name is both a local and an unresolved import."
That is what this issue said first. It treats the one path where the symptom shows and leaves the
rule wrong in the resolver, which the full path shares.

## It has master red

`packages/wacc/test/wac/typecheck_test.wac` — *"rung 3: the whole repo stays silent"*:

```
we report diagnostics in 1 file(s) that type-check cleanly:
  packages/tor/test/wac/hsdescgen_test.wac: 200:15, 369:19, 370:22, 372:21, 376:28, 417:15
```

All six are `u8[] cert = cert(cli);` and its siblings. Checked against a pristine worktree at
`origin/master`, so every agent's gate is refusing.

Arrived with `1bd021a4`, which is not at fault: that file is legal and both compilers build it. It is
the first in the corpus to write the pattern.

**Stopgap, not taken:** rename the four locals in `hsdescgen_test.wac`. One word each, greens master,
and deletes the only file exercising the pattern.
