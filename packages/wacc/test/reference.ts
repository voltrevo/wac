// The reference compiler, as a batched oracle.
//
// Rungs 1 to 5 are differentials against `compiler/`'s TypeScript — the lexer, the parser, the
// checker and the emitter — and none of that is reachable from wac. Through `Cli.exec` an oracle
// call costs a process, so the shape that works is the one every other oracle here uses: compute
// everything, hand it over once, and let the answers come back together.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   runfn <src-hex> <name> [<arg>…]   →  `runfn <value>`, or `runfn ERR <why>`
//
// `runfn` compiles the source with the reference, instantiates it, and calls one export. **Values are
// decimal text, not numbers on a wire**: an `i64` crosses as a `bigint` and JSON would round it, and
// the whole point of asking is that the answer is exact. An argument ending in `n` is a `bigint`.
//
// Everything travels as hex because a wac program is full of spaces, quotes and newlines, and this
// protocol is line-oriented.

import { wacCompile } from "wac/wacCompile.ts";

const dec = new TextDecoder();
const bytes = (h: string) =>
  h.length === 0 ? new Uint8Array(0) : Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));

/** One compiled reference module per distinct source — 232 cases share far fewer programs. */
const built = new Map<string, Record<string, unknown> | string>();

function instantiate(src: string): Record<string, unknown> | string {
  const had = built.get(src);
  if (had !== undefined) return had;
  let out: Record<string, unknown> | string;
  try {
    const r = wacCompile(new Map([["/main.wac", src]]), "/main.wac");
    out = r.ok
      ? new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(r.compiled.wasm)), {})
        .exports as Record<string, unknown>
      : `the reference will not compile it: ${r.diagnostics.map((d) => d.message).join("; ")}`;
  } catch (e) {
    out = `the reference threw: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
  }
  built.set(src, out);
  return out;
}

const input = dec.decode(
  await new Response(Deno.stdin.readable).arrayBuffer().then((b) => new Uint8Array(b)),
);
const lines = input.split("\n").filter((l) => l.length > 0);
const out: string[] = [];

for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  if (op === "runfn") {
    const [srcHex, name, ...args] = rest;
    const mod = instantiate(dec.decode(bytes(srcHex)));
    if (typeof mod === "string") {
      out.push(`runfn ERR ${mod}`);
      continue;
    }
    const f = mod[name];
    if (typeof f !== "function") {
      out.push(`runfn ERR no export named ${name}`);
      continue;
    }
    try {
      // **One spelling of an argument serves both sides.** The wac driver that asks the same
      // question writes `true`, and an `i64` literal has no suffix there — so `true`/`false` are
      // translated here and the `n` the driver strips is what tells this side to use a `bigint`.
      const vals = args.map((a) =>
        a === "true" ? 1 : a === "false" ? 0 : a.endsWith("n") ? BigInt(a.slice(0, -1)) : Number(a)
      );
      out.push(`runfn ${String((f as (...a: unknown[]) => unknown)(...vals))}`);
    } catch (e) {
      // A trap is an answer here, not a harness failure: both compilers must trap on the same input,
      // and a case that traps in one and answers in the other is exactly what this is looking for.
      out.push(`runfn TRAP ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
    }
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
