#!/usr/bin/env -S deno run --allow-read
// The reference's diagnostic renderer, as an oracle for `src/render.wac`.
//
// **This file is the reference, not the test.** `wacDiag` is what `waccx` printed and what a person
// reading a refusal has always seen; `src/render.wac` is that layout in wac. The claim is that the
// two agree character for character, so the comparison has to hold the reference's own output rather
// than a description of it — which means importing `wacDiag` rather than reimplementing it.
//
// Deno rather than node, because both halves are `.ts`: `parseDiagnostics` reads the wire
// and `wacDiag` lays it out. Neither touches the filesystem, so `--allow-read` is only what Deno
// wants to load the modules.
//
// The usual direction: the test renders and this reports what it disagrees with.
//
//   renderdiag <what-hex> <path-hex> <src-hex> <wire-hex> <ours-hex>   (judges)
//   refrender  <path-hex> <src-hex>                                    →  `refrender <hex>`
//
// `refrender` **produces**: it is the *reference compiler's own* diagnostics, rendered by the same
// `wacDiag`. `renderdiag` renders a wire the caller supplies; this one compiles the source itself,
// which is a different question — what the other compiler says, rather than how ours is laid out.
//
// `wire` is `diagnoseFiles`' output — the same wire the wac side rendered from, passed across rather
// than recomputed here, so that a disagreement is about the *rendering* and never about two
// compilers having refused different things.
//
// `FAIL …` per disagreement, `DONE <n>` last. See `packages/wactest/src/oracle.wac`.

import { parseDiagnostics } from "../tools/wireDiagnostics.ts";
import { wacDiag } from "wac/wacDiag.ts";
import { wacCompile } from "wac/wacCompile.ts";

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 20);
  for (;;) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

function textOf(h: string): string {
  const bytes = new Uint8Array((h ?? "").length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
}

const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
const out: string[] = [];
// Answers for the ops that **produce**, printed ahead of the `FAIL` lines so a disagreement
// elsewhere in the batch cannot shift the positions the caller reads them by.
const emit: string[] = [];
const say = (s: string) => {
  if (out.length < 20) out.push(`FAIL ${s}`);
};

for (const line of lines) {
  const [op, ...rest] = line.split(" ");
  try {
    if (op === "renderdiag") {
      const [whatHex, pathHex, srcHex, wireHex, oursHex] = rest;
      const what = textOf(whatHex);
      const path = textOf(pathHex);
      const src = textOf(srcHex);
      const ours = textOf(oursHex);
      const theirs = wacDiag(parseDiagnostics(textOf(wireHex)), new Map([[path, src]]));

      // **Asserted, not merely compared.** Two empty strings are equal, and a program that refused
      // nothing would agree with a renderer that rendered nothing.
      if (theirs === "") {
        say(`${what}: nothing was refused, so nothing was compared`);
        continue;
      }
      if (!theirs.includes("^")) {
        say(`${what}: no caret in the reference rendering`);
        continue;
      }
      if (ours === theirs) continue;

      const a = ours.split("\n"), b = theirs.split("\n");
      let named = false;
      for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        say(
          `${what} — line ${i + 1} differs: render.wac ${JSON.stringify(a[i])}, ` +
            `wacDiag ${JSON.stringify(b[i])}`,
        );
        named = true;
        break;
      }
      if (!named) say(`${what}: same lines, different length`);
    } else if (op === "refrender") {
      const [pathHex, srcHex] = rest;
      const path = textOf(pathHex);
      const files = new Map([[path, textOf(srcHex)]]);
      const r = wacCompile(files, path, {});
      const text = wacDiag(r.diagnostics, files);
      emit.push(`refrender ${[...new TextEncoder().encode(text)]
        .map((b) => b.toString(16).padStart(2, "0")).join("")}`);
    } else {
      say(`unknown op ${JSON.stringify(op)}`);
    }
  } catch (e) {
    say(`${op}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

for (const l of emit) console.log(l);
for (const l of out) console.log(l);
console.log(`DONE ${lines.length}`);
