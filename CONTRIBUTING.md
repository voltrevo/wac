# Contributing to wac

The compiler in [`compiler/`](compiler/) follows an "atom" methodology:
small, single-purpose, pure-TypeScript units with disciplined testing. Follow
these rules when adding or changing atoms.

## Atom rules

1. **One value export.** Exactly one function, class, const, or enum per atom
   (file). No `export default`. Type exports (`export type`, `export
   interface`) are unlimited and don't count.
2. **No `export let`** — use `const`.
3. **Keep atoms small.** An atom shouldn't do too much.
4. **High quality code.** Use a strong coding style. No fluff, but make sure
   the code is readable. Use inline comments where appropriate. Use balanced
   variable naming (not minified nonsense, not word salad either).

## Pure TypeScript

Atoms must be platform-independent. No runtime-specific APIs unless injected.

The rule is simple:

- **ECMA standard and deterministic?** Use it directly. (`Array`, `Map`,
  `Math.sqrt`, `BigInt`, `TextEncoder`, `JSON`, `Uint8Array`, etc.)
- **Everything else?** Inject as an argument.

`Math.random()` and `Date.now()` are ECMA standard but non-deterministic —
they must be injected. `crypto.subtle` is not ECMA standard — it must be
injected (but see "build, don't import" below).

**Build, don't import** these:

- Crypto (SHA, AES, HMAC, x25519, etc.)
- Compression (deflate, inflate, gzip)
- WebSocket framing
- HTTP client/server framing
- TLS

## Cap convention

When an atom needs injected capabilities, accept them as a `cap` parameter
(first argument of function or constructor). Export the `Cap` type so
importers can compose:

```ts
// ./compiler/demo/trivia.ts
export type Cap = { Date: { now(): number } };

export function trivia(cap: Cap) {
  return `${cap.Date.now()}ms since epoch`;
}
```

Compose caps from dependencies with intersection types:

```ts
// ./compiler/demo/moreTrivia.ts
import { type Cap as TriviaCap, trivia } from "./trivia.ts";

export type Cap = TriviaCap & { Math: { random(): number } };

export function moreTrivia(cap: Cap) {
  return `${cap.Math.random()} — ${trivia(cap)}`;
}
```

If no external capabilities are needed, skip cap entirely (most of the wac
compiler is pure functions over ASTs and doesn't need one).

## Main atoms (CLIs)

A CLI's main atom exports a `main` function typed to the subset of
`globalThis` it needs, so even the entry point is testable:

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

Run it for real by calling it with `globalThis`. Keep `main` thin — parse
args, call library atoms, print output. Logic belongs in the library atoms.

## Testing

Every atom must have tests.

```ts
// ./compiler/gcd.test.ts
import { gcd } from "./gcd.ts";

Deno.test("gcd: coprime inputs return 1", () => {
  if (gcd(7, 13) !== 1) throw new Error("expected gcd(7,13) = 1");
});
```

If testing something that accepts `cap`, the test provides a fake:

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

Tests are pure TypeScript, same as atoms — never platform APIs in `./atoms`.

**Test quality matters more than test quantity.** Use independently verified
complex outputs — values that are hard to get right by accident. Use external
tools (Python, reference implementations, official test vectors) to generate
and verify test values; don't eyeball outputs and assume they're correct.

Do not cheat: no tests that merely check "it runs" or "it returns something."

Use `deno coverage`. An atom should be 100% branch-covered before you move on.

## Spec tags and coverage

The [language spec](spec/) contains tagged requirements — backtick-wrapped
identifiers starting with `§`, like `[§c32-sort-28f6sz7]`. Each tag defines a
specific testable behavior.

- Write test atoms whose name starts with the tag:
  ```ts
  Deno.test("[§c32-sort-28f6sz7] sort_test returns 12345", () => {
    // ...
  });
  ```
- **The spec is the source of truth.** It describes what the code should do,
  not what existing code happens to do. If existing atoms don't match the
  spec, fix or replace them — no matter how much change that requires.
- **The test must actually verify the behavior the tag describes.** A tag
  that says "error at line 4" requires the test to assert the line number is
  4, not just that an error occurred. If the implementation doesn't produce
  line numbers, fix the implementation — a weaker test that skips the check
  is not acceptable. A test that doesn't verify what the tag describes is
  worse than no test: it gives false confidence.
- Some tags describe behavior that can only be verified interactively (e.g.
  real network tests).
- If a spec tag can't be satisfied because of a bug in the spec itself (e.g.
  a wrong expected value), write a test for the intention behind the tag
  *without* including the tag in the test name, and explain why in the PR /
  commit description.

## Keep the repo clean

Almost everything belongs in `./atoms` and follows the atom rules. Never
commit codegen or other build outputs (`dist/`, `*.tsbuildinfo`, etc.).

## Workflow

Change one atom at a time. For anything non-trivial:

1. Look for an existing atom to build on before writing a new one.
2. Draft the atom, then exercise it with real inputs (a scratch script is
   fine) before writing tests — this surfaces edge cases early.
3. Verify any non-obvious expected values independently (an external tool,
   reference implementation, or hand computation) before using them as test
   vectors. `137 * 429 = 58773` is hard to get right by accident; use values
   like that, not round numbers that could pass by coincidence.
4. Add tests to 100% branch coverage. Note in the commit message why you're
   confident the tests actually prove correctness, not just that the code
   runs.
5. Commit the atom on its own.

If you took a shortcut or aren't sure a test really proves what it claims,
say so rather than letting it slide — a weak test is worse than an honest
gap.
