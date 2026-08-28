// The prompt's two claims, checked: that a definition survives to the next line, and that a value
// comes back looking the way it was written.

import { Sx } from "./repl.ts";

function eq(got: string, want: string) {
  if (got !== want) throw new Error(`got ${got}, want ${want}`);
}

Deno.test("state persists between evaluations, which is what a prompt is", async () => {
  const sx = await Sx.create();
  sx.eval("(def fact (fn (n) (if (< n 2) 1 (* n (fact (- n 1))))))");
  eq(sx.show(sx.eval("(fact 10)")), "3628800");
  sx.eval("(def xs (quote (10 20 30)))");
  eq(sx.show(sx.eval("(cdr xs)")), "(20 30)");
  // ...including a mutation, which is a different mechanism from a definition.
  sx.eval("(set! xs (cons 5 xs))");
  eq(sx.show(sx.eval("xs")), "(5 10 20 30)");
});

Deno.test("values print the way they were written", async () => {
  const sx = await Sx.create();
  eq(sx.show(sx.eval("42")), "42");
  eq(sx.show(sx.eval("-7")), "-7");
  eq(sx.show(sx.eval("(quote ())")), "()");
  eq(sx.show(sx.eval("(quote (a (b c) d))")), "(a (b c) d)");
  eq(sx.show(sx.eval("(cons 1 (cons 2 (quote (3 4))))")), "(1 2 3 4)");
  // A `cons` can build an improper list, and a printer that dropped the tail would be lying.
  eq(sx.show(sx.eval("(cons 1 2)")), "(1 . 2)");
  eq(sx.show(sx.eval("(fn (n) n)")), "#<fn (n)>");
});

Deno.test("a fresh interpreter knows nothing of the last one", async () => {
  const a = await Sx.create();
  a.eval("(def only-in-a 1)");
  const b = await Sx.create();
  let trapped = false;
  try { b.eval("only-in-a"); } catch { trapped = true; }
  // An unbound name answers NIL rather than trapping — `$lookup` says so — so the check is that it
  // is *not* 1, which is the thing that would mean two instances shared a heap.
  if (!trapped) eq(b.show(b.eval("only-in-a")), "()");
});
