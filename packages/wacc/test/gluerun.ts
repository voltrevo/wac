#!/usr/bin/env -S deno run -A
// Run generated glue and check it answers — the half of `bindgen` a reader cannot check.
//
// **Not an oracle.** It compares nothing against a second implementation; it is a JavaScript *host*,
// which is what generated JavaScript glue needs in order to be more than text. `test/wac/bindgenwac_test.wac`
// holds the two generators to the same bytes; this asks whether those bytes work, and a generator that
// dropped a cast it needed would still look like JavaScript to any amount of reading.
//
// Kept as a script rather than folded into a batched oracle because it is one exchange, not a sweep:
// import a module, call three things, say `ok`.
//
//     deno run -A packages/wacc/test/gluerun.ts <path/to/m.gen.js>
//
// Prints `ok` and exits 0, or prints what disagreed and exits 1.

const path = Deno.args[0];
if (path === undefined) {
  console.error("usage: gluerun.ts <glue.js>");
  Deno.exit(2);
}

const mod = await import(path.startsWith("/") ? path : `${Deno.cwd()}/${path}`) as {
  origin(x: number, y: number): { sum(): number; x: number };
  greet(who: string): string;
  apply(f: (n: number) => number, x: number): number;
};

const wrong: string[] = [];
// A struct class and a method on it: the class is built from the module's own metadata, so a
// generator that emitted the fields and forgot the methods produces an object that looks right.
if (mod.origin(4, 5).sum() !== 9) wrong.push(`origin(4,5).sum() = ${mod.origin(4, 5).sum()}, want 9`);
// A field accessor, which is a different code path from a method.
if (mod.origin(4, 5).x !== 4) wrong.push(`origin(4,5).x = ${mod.origin(4, 5).x}, want 4`);
// A string in and a string out — both directions across the staging buffer.
if (mod.greet("world") !== "hi world") {
  wrong.push(`greet("world") = ${JSON.stringify(mod.greet("world"))}, want "hi world"`);
}

// A JavaScript function passed *into* the module, which is the only export shape whose glue is a
// function definition rather than a call — and the shape whose annotations were emitted even in
// JavaScript mode, so the file did not parse. Calling it is what says the slot table forwards.
if (mod.apply((n) => n * 3, 7) !== 21) {
  wrong.push(`apply(n => n * 3, 7) = ${mod.apply((n) => n * 3, 7)}, want 21`);
}

if (wrong.length > 0) {
  console.error(wrong.join("; "));
  Deno.exit(1);
}
console.log("ok");
