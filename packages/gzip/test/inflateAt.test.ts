// `inflateAt`, which reports where a DEFLATE stream ended.
//
//     deno test -A packages/gzip/test/inflateAt.test.ts
//
// Every other caller here hands `inflate` a whole buffer, so where the stream stopped never mattered.
// `packages/git` is the case where it does: a packfile is concatenated zlib streams with nothing
// recording their lengths, so reading the second means knowing where the first ended.
//
// The oracle is **concatenation**: compress two payloads, join them, and inflate the second one starting
// where the first said it finished. If the reported end were wrong by even a byte the second inflate
// would fail or produce rubbish, so the round trip is the check.

import { wacBind } from "../../../harness/wacBind.ts";

// deno-lint-ignore no-explicit-any
const z = await wacBind("packages/gzip/src/inflate.wac") as any;
// deno-lint-ignore no-explicit-any
const d = await wacBind("packages/gzip/src/deflate.wac") as any;

const enc = new TextEncoder();
const dec = new TextDecoder();

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

Deno.test("the end it reports is where the next stream begins", () => {
  const cases = [
    ["hello\n", "world\n"],
    ["", "after an empty one\n"],
    ["a".repeat(5000), "b".repeat(3000)],
    ["\u00ff\u00fe high bytes", "and more"],
  ];
  for (const [one, two] of cases) {
    const a = Uint8Array.from(d.deflateDynamic(enc.encode(one)));
    const b = Uint8Array.from(d.deflateDynamic(enc.encode(two)));
    const both = new Uint8Array(a.length + b.length);
    both.set(a, 0);
    both.set(b, a.length);

    const first = z.inflateAt(both, 0);
    assert(dec.decode(Uint8Array.from(first.bytes)) === one, `the first stream came back wrong for ${JSON.stringify(one.slice(0, 12))}`);
    // **The end must be exact.** Off by one and the second inflate reads a shifted bit stream; the bit
    // reader holds bits from bytes it has already pulled, so `pos` alone would overshoot.
    assert(first.end === a.length, `end reported ${first.end}, the first stream is ${a.length} bytes`);

    const second = z.inflateAt(both, first.end);
    assert(dec.decode(Uint8Array.from(second.bytes)) === two, "the second stream did not inflate from the reported end");
    assert(second.end === both.length, `the second stream ended at ${second.end}, not ${both.length}`);
  }
});

Deno.test("it agrees with `inflate` about the bytes", () => {
  for (const text of ["", "x", "hello, world\n", "z".repeat(20000)]) {
    const stream = Uint8Array.from(d.deflateDynamic(enc.encode(text)));
    const viaInflate = dec.decode(Uint8Array.from(z.inflate(stream)));
    const viaAt = dec.decode(Uint8Array.from(z.inflateAt(stream, 0).bytes));
    assert(viaInflate === viaAt, `the two disagree on ${JSON.stringify(text.slice(0, 12))}`);
  }
});
