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
//   parsehash <path>                  →  `parsehash <sum>`, or `parsehash ERR <why>`
//   parsedump <path>                  →  `parsedump <dump-hex>`
//   parsehashsrc <src-hex>            →  the same two, for a source that is not a file
//   parsedumpsrc <src-hex>
//   lexhash <path> | lexhashsrc <src-hex>   →  a checksum of the reference's token stream
//   lexdump <path> | lexdumpsrc <src-hex>   →  that stream, for the file that disagreed
//   lexerrs <src-hex> <code> <line> <col>…  →  `lexerrs ok`, or `lexerrs BAD <why>`
//   lexkinds                                →  the token kinds, in the union's order
//   lexcodes                                →  the codes `errorCodes.ts` declares
//   checkpos <src-hex>                      →  `checkpos <hex>`: `line:col\tmessage` per
//                                              non-warning diagnostic the reference reports
//
// `checkpos` is rung 3's oracle, and the whole of what `typecheck_test.wac` asks. **Positions and
// not codes**, because our side reports numeric codes and the reference reports English — and
// positions are the thing rung 3's contract is actually about. Warnings are dropped here rather
// than by the caller: the reference emits them on programs this slice is silent about, and a
// caller filtering them would be a second place to get that rule wrong.
//
// `lexerrs` adjudicates rather than reports: the wac side sends the triples *it* produced and the
// reference decides, because the table that says which number means which English sentence is
// TypeScript and belongs with the implementation it describes.
//
// `parsehash` is the rung-2 differential in one line each way. The dump of the whole corpus is
// megabytes; a checksum of it is nine characters, and the *only* thing that has to travel when the
// two agree — which is every run. `parsedump` is what the caller asks for afterwards, for the one
// file that disagreed, so a failure can still name the line.
//
// `runfn` compiles the source with the reference, instantiates it, and calls one export. **Values are
// decimal text, not numbers on a wire**: an `i64` crosses as a `bigint` and JSON would round it, and
// the whole point of asking is that the answer is exact. An argument ending in `n` is a `bigint`.
//
// Everything travels as hex because a wac program is full of spaces, quotes and newlines, and this
// protocol is line-oriented.

import { wacCompile } from "wac/wacCompile.ts";
import { referenceDump } from "./referencePrint.ts";
import { wacLex } from "wac/wacLex.ts";
import { wacParse, type Program } from "wac/wacParse.ts";
import { wacResolve } from "wac/wacResolve.ts";
import { wacTypeCheck } from "wac/wacTypeCheck.ts";
import { CODE_DIVERGENCES, disagreement, LEX_CODES, staleDivergence, tableFaults } from "./errorCodes.ts";

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
  } else if (op === "parsehash" || op === "parsedump" || op === "parsehashsrc" ||
             op === "parsedumpsrc") {
    const path = rest[0];
    let dump: string;
    try {
      // By path for the corpus, which is megabytes and already on disk; by source for the cases a
      // working corpus does not contain, which exist only in the test that states them.
      const fromSrc = op === "parsehashsrc" || op === "parsedumpsrc";
      const text = fromSrc ? dec.decode(bytes(path)) : await Deno.readTextFile(path);
      dump = referenceDump(text);
    } catch (e) {
      out.push(`${op} ERR ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      continue;
    }
    if (op === "parsedump" || op === "parsedumpsrc") {
      out.push(`${op} ${[...new TextEncoder().encode(dump)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
      continue;
    }
    // **The same checksum the wac side computes**, or the two cannot be compared at all: seeded at
    // 7, `h * 31 + byte`, masked to 31 bits so both stay inside a signed `i32`.
    let h = 7;
    for (const b of new TextEncoder().encode(dump)) h = (Math.imul(h, 31) + b) & 2147483647;
    out.push(`${op} ${h}`);
  } else if (op === "lexhash" || op === "lexhashsrc" || op === "lexdump" || op === "lexdumpsrc") {
    const fromSrc = op.endsWith("src");
    let text: string;
    try {
      text = fromSrc ? dec.decode(bytes(rest[0])) : await Deno.readTextFile(rest[0]);
    } catch (e) {
      out.push(`${op} ERR ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      continue;
    }
    // **The canonical form both sides build**: kind name, line, column and the text the reference
    // stores — decoded for a string and a character literal, the span for everything else. The wac
    // side decodes the same way, or the two are comparing different things.
    const canon = wacLex(text).tokens
      .map((t) => `${t.kind}|${t.line}|${t.col}|${t.text}`).join("\n");
    if (op === "lexdump" || op === "lexdumpsrc") {
      out.push(`${op} ${[...new TextEncoder().encode(canon)].map((b) => b.toString(16).padStart(2, "0")).join("")}`);
      continue;
    }
    let h = 7;
    for (const b of new TextEncoder().encode(canon)) h = (Math.imul(h, 31) + b) & 2147483647;
    out.push(`${op} ${h}`);
  } else if (op === "lexerrs") {
    const src = dec.decode(bytes(rest[0]));
    const mine: number[] = rest.slice(1).map(Number);
    const ref = wacLex(src).errors;
    const n = mine.length / 3;
    if (n !== ref.length) {
      out.push(`lexerrs BAD ${JSON.stringify(src)}: ${n} errors, reference says ${ref.length}`);
      continue;
    }
    let said = "";
    for (let i = 0; i < n && said === ""; i++) {
      if (mine[i * 3 + 1] !== ref[i].line || mine[i * 3 + 2] !== ref[i].col) {
        said = `error ${i} at ${mine[i * 3 + 1]}:${mine[i * 3 + 2]}, reference says ${ref[i].line}:${ref[i].col}`;
        break;
      }
      if (CODE_DIVERGENCES.has(src)) {
        // Recorded as a disagreement about *category*. Checked the other way instead: if the two have
        // started agreeing, the entry is stale and hiding a real comparison.
        if (staleDivergence(src, mine[i * 3], ref[i].message)) {
          said = `is recorded as a divergence but the two now agree — delete the entry in errorCodes.ts`;
        }
        continue;
      }
      const wrong = disagreement(LEX_CODES, mine[i * 3], ref[i].message);
      if (wrong !== null) said = `error ${i}: ${wrong}`;
    }
    out.push(said === "" ? `lexerrs ok ${n}` : `lexerrs BAD ${JSON.stringify(src)}: ${said}`);
  } else if (op === "lexkinds") {
    // **Read out of the union at run time, not hardcoded**, so reordering it breaks the comparison
    // loudly instead of silently pairing our index with the wrong name.
    const text = await Deno.readTextFile(new URL(import.meta.resolve("wac/wacLex.ts")));
    const m = text.match(/export type TokenKind =([\s\S]*?)\| "eof";/);
    if (m === null) {
      out.push("lexkinds BAD could not find the TokenKind union in wacLex.ts");
    } else {
      const found = [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1]);
      const seen: string[] = [];
      for (const k of [...found, "eof"]) if (!seen.includes(k)) seen.push(k);
      out.push(`lexkinds ${seen.join(" ")}`);
    }
  } else if (op === "checkpos") {
    let text: string;
    try {
      text = dec.decode(bytes(rest[0]));
    } catch (e) {
      out.push(`checkpos ERR ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      continue;
    }
    let lines: string[] = [];
    try {
      const { tokens } = wacLex(text);
      const { program } = wacParse(tokens, "/main.wac");
      const programs = new Map<string, Program>([["/main.wac", program]]);
      lines = wacTypeCheck(wacResolve("/main.wac", programs), programs)
        .filter((e) => e.severity !== "warning")
        .map((e) => `${e.line}:${e.col}\t${e.message}`);
    } catch (e) {
      out.push(`checkpos ERR ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
      continue;
    }
    out.push(`checkpos ${[...new TextEncoder().encode(lines.join("\n"))]
      .map((b) => b.toString(16).padStart(2, "0")).join("")}`);
  } else if (op === "lexcodes") {
    const faults = tableFaults(LEX_CODES);
    out.push(faults.length > 0 ? `lexcodes BAD ${faults.join("; ")}`
                               : `lexcodes ${LEX_CODES.map((c) => c.code).join(" ")}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
