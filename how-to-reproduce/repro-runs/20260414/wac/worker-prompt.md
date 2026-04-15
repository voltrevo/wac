## Environment

You are running in a sandbox container with passwordless sudo. You have full
shell access for exploratory work — running code, inspecting output, generating
test vectors. Don't break the container (no rm -rf /, no killing system
processes), but otherwise use it freely.

**Always prefix shell commands with `timeout <N>`** — especially `deno run`,
and anything that could loop forever. Use a low timeout (5–30s) for
exploration and tests.

```sh
timeout 10 deno run -A ./tmp/explore.ts
```

## Reminders

This is long running work. Make sure you never drift from this prompt. Set
a reminder for every 15 minutes via a simple background bash script. It
should simply say "Are you still following worker-prompt.md? If you don't
remember exactly what it says, read it again and follow it."

(If that background task is already running, don't start a new one.)

## Atom rules

1. **One value export.** Exactly one function, class, const, or enum per atom.
   No `export default`. Type exports (`export type`, `export interface`) are
   unlimited and don't count.
2. **No `export let`** — use `const`.
3. **Keep atoms small**. An atom shouldn't do too much.
4. **High quality code.** Use a strong coding style. No fluff, but make sure
   your code is readable. Use inline comments where appropriate. Use balanced
   variable naming (not minified nonsense, not word salad either).

## Pure TypeScript

Atoms must be platform-independent. No runtime-specific APIs unless injected.

The rule is simple:

- **ECMA standard and deterministic?** Use it directly. (`Array`, `Map`,
  `Math.sqrt`, `BigInt`, `TextEncoder`, `JSON`, `Uint8Array`, etc.)
- **Everything else?** Inject as an argument.

`Math.random()` and `Date.now()` are ECMA standard but non-deterministic — they
must be injected. `crypto.subtle` is not ECMA standard — it must be injected
(but see "build, don't import" below).

**Build, don't import** these:

- Crypto (SHA, AES, HMAC, x25519, etc.)
- Compression (deflate, inflate, gzip)
- WebSocket framing
- HTTP client/server framing
- TLS

## Cap convention

When an atom needs injected capabilities, accept them as a `cap` parameter
(first argument of function or constructor). Export the `Cap` type so importers
can compose:

```ts
// ./atoms/demoGoal/trivia.ts
export type Cap = { Date: { now(): number } };

export function trivia(cap: Cap) {
  return `${cap.Date.now()}ms since epoch`;
}
```

Compose caps from dependencies with intersection types:

```ts
// ./atoms/demoGoal/moreTrivia.ts
import {
  type Cap as TriviaCap,
  trivia,
} from "./trivia.ts";

export type Cap = TriviaCap & { Math: { random(): number } };

export function moreTrivia(cap: Cap) {
  return `${cap.Math.random()} — ${trivia(cap)}`;
}
```

If no external capabilities are needed, skip cap entirely.

## Main atoms (CLIs)

Goals often require a runnable CLI. A main atom
exports a `main` function that takes `cap` typed as the subset of `globalThis`
it needs:

```ts
import { httpGet } from "../../ab/cd/efghijklmnopqrstuvw.ts";

export type Cap = {
  Deno: { args: string[] };
  console: { log(s: string): void };
};

export function main(cap: Cap): void | Promise<void> {
  const url = cap.Deno.args[0];
  const body = httpGet(url);
  cap.console.log(body);
}
```

This ensures even the main atom is testable. To run it 'for real', just call
it with `globalThis`:

```ts
import { main } from './src/main.ts';

main(globalThis);
```

The main atom is usually thin — it parses args,
calls library atoms, and prints output. Keep logic in the library atoms, not in
main.

## Testing

Every atom must have tests.

```ts
// ./atoms/<goal>/**/gcd.test.ts
import { gcd } "./gcd.ts";

Deno.test("gcd: coprime inputs return 1", () => {
  if (gcd(7, 13) !== 1) throw new Error("expected gcd(7,13) = 1");
});
```

If testing something that accepts cap, the test provides a fake:

```ts
import { type Cap } from "./trivia.ts";

Deno.test("trivia: known timestamp", () => {
  const cap: Cap = { Date: { now: () => 1774207146202 } };
  const result = trivia(cap);
  if (result !== "It has been 1774207146202ms since epoch") {
    throw new Error("wrong output");
  }
});
```

Tests are Pure TypeScript (see subheading) just like atoms. Never include
platform APIs in the `./atoms` dir.

**Test quality matters more than test quantity.** Use independently verified
complex outputs — values that are hard to get right by accident. Use external
tools (python, reference implementations, official test vectors) to generate and
verify test values. Do not eyeball outputs and assume they're correct.

Do not cheat. Do not write tests that merely check "it runs" or "it returns
something."

Use code coverage tools when testing. Every time you make an atom, make sure
it is 100% tested before moving on.

## Spec tags and coverage

Some goals contain tagged requirements — backtick-wrapped identifiers starting
with `§`, like `[§c32-sort-28f6sz7]`. Each tag defines a specific testable
behavior. If the goal has tags:

- Write test atoms whose name starts with the tag:
  ```typescript
  Deno.test("[§c32-sort-28f6sz7] sort_test returns 12345", () => {
    ...
  });
  ```
- **The goal spec is the source of truth.** The spec describes what the code
  should do, not what existing code happens to do. If existing atoms don't match
  the spec, they need to be fixed or replaced — no matter how much change is
  required.
- **The test must actually verify the behavior described by the tag.** A tag
  that says "error at line 4" requires the test to assert the line number is 4,
  not just that an error occurred. If the current implementation doesn't produce
  line numbers, the implementation needs to be fixed — writing a weaker test
  that skips the check is not acceptable. A test that doesn't verify what the
  tag describes is worse than no test — it gives false confidence.
- Some tags describe behavior that can only be verified interactively (e.g. real
  network tests).
- If you discover a spec tag cannot be satisfied due to a bug in the spec itself
  (e.g. a wrong expected value), write a test for the intention behind the tag
  _without_ including the tag in the test name. Explain your reasoning in your
  summary — what the spec says, what you believe is correct, and why.

Not all goals use tags. If the goal has no `§` markers, the standard workflow
applies — write tests as usual.

## Keep the repo clean.

Almost everything should be in `./atoms` and follow the rules for atoms. If
other files are appropriate, put them somewhere else in the repo. NEVER include
codegen or other build outputs in version control.

---

## Iteration Workflow

Pursue the goal iteratively as described below. Don't plan ahead too much, don't
try to do too much in one iteration. One iteration produces at most one atom that
makes progress.

An iteration can also fail and produce nothing. It is always better to complete
nothing than to complete something that might be wrong. If you can't finish your
atom, explain what blocked you in your summary so the next iteration can benefit.

### Step 1: Decide what atom to build

Evaluate what atom would be best to build next.

Here's a complete example. The goal is "arithmetic — basic operations built from
add" and the repo already has an `add` atom. This example is deliberately
simplified — in real work you would use the `*` operator, not rebuild
multiplication.

### Step 2. Draft and Explore

Search for an existing atom to build on:

```
$ cat ./atoms/arithmetic/add.ts
// Adds two numbers and returns the sum, works with negative numbers and zero
export function add(a: number, b: number): number {
  return a + b;
}
```

Simple interface. Draft multiply as repeated addition:

```
$ cat ./atoms/arithmetic/multiply.ts
// Multiplies two integers using repeated addition
import { add } from "./add.ts";
export function multiply(a: number, b: number): number {
  const neg = b < 0;
  if (neg) b = -b;
  let result = 0;
  for (let i = 0; i < b; i++) result = add(result, a);
  return neg ? -result : result;
}
```

Explore with real inputs:

```
$ cat ./tmp/explore.ts
import { multiply } from "<repo>/atoms/arithmetic/multiply.ts";

console.log("3 * 4 =", multiply(3, 4));
console.log("0 * 99 =", multiply(0, 99));
console.log("-3 * 7 =", multiply(-3, 7));
console.log("5 * -4 =", multiply(5, -4));
console.log("137 * 429 =", multiply(137, 429));
```

```
$ timeout 10 deno run -A ./tmp/explore.ts
3 * 4 = 12
0 * 99 = 0
-3 * 7 = -21
5 * -4 = -20
137 * 429 = 58773
```

Verify against an independent source before trusting these as test vectors:

```
$ python3 -c "print(3*4, 0*99, -3*7, 5*-4, 137*429)"
12 0 -21 -20 58773
```

All match. 137 * 429 = 58773 is hard to get right by accident.

**If exploration reveals a dependency is broken**, that's a valuable finding. Move
the dependency and the new atom you drafted to `/tmp/<somewhere>`. Skip to step 4.

### Step 3. Add tests

```
$ cat ./atoms/arithmetic/multiply.test.ts
import { multiply } from "./multiply.ts";

Deno.test("multiply: known products including negatives and zero", () => {
  if (multiply(3, 4) !== 12) throw new Error("3*4");
  if (multiply(0, 99) !== 0) throw new Error("0*99");
  if (multiply(-3, 7) !== -21) throw new Error("-3*7");
  if (multiply(5, -4) !== -20) throw new Error("5*-4");
  if (multiply(137, 429) !== 58773) throw new Error("137*429");
  if (multiply(1, 1) !== 1) throw new Error("1*1");
});
```

Ensure your test is comprehensive. Never write tests of the form 'it runs' or
'the function exists'. Tests must be meaningful - they must actually verify what
is interesting about them. Use deno coverage and make sure your atom gets 100%
branch coverage before proceeding. (No excuses.)

### Step 4. Write your summary

Write your summary to `./notes/yyyymmdd-hhmmss.md`.

Include:

- What you built, or what you tried and why it failed
- Why you're confident it's correct (what do the tests prove?)

Example:

> Built multiply — multiplies two integers via repeated addition,
> importing the add atom. Handles negative multipliers.
>
> Confident because: test covers positive, negative, zero, identity, and a large
> product (137 * 429 = 58773) verified against python.

Publishing one atom and stopping is a good outcome — describe what you did and
what would be logical to do next.

Did you take shortcuts or cheat? If so, include them in your summary. Then go
back to the appropriate step and do it correctly.

### Step 5: Commit

Make a git commit.

### Step 6: Stop or loop.

Is the goal done? Stop.

Otherwise: Return to step 1.
