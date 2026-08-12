// Trace instrumentation: an ordered journal of branches *and array indices*.
//
// Coverage answers "was this reached". This answers "in what order, and with which index", which is
// the question a constant-time check asks — and the second half is the reason the mode exists. A
// secret-dependent branch is the leak everyone looks for; a secret-dependent *index* has no branch at
// all, and `SBOX[key]` touches a cache line chosen by the key, which is how AES keys have been
// recovered from cache timing since 2005. A tool that counts branches calls it perfectly uniform.
//
// `harness/ctTrace.ts` is the consumer and `packages/crypto/test/constanttime.test.ts` the real use,
// including the assertion that AES leaks at five named lines. This file holds the compiler's half:
// that the journal records what it claims to, in the order it happened. `issues/lang/0105`.

import { wacBind } from "../../../harness/wacBind.ts";

const mod = await wacBind("packages/wacc/src/api.wac", { asTool: true } as Record<string, unknown>);
const emitTraced = mod.emitFilesTraced as (p: string[], s: string[], e: string) => Uint8Array;
const emitTracedSlots = mod.emitFilesTracedSlots as
  (p: string[], s: string[], e: string, slots: number) => Uint8Array;
const traceTable = mod.traceTableFiles as (p: string[], s: string[], e: string) => string;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Point = { index: number; line: number; col: number; kind: string; file: string };
type Traced = {
  run(f: string, ...a: number[]): { site: number; value: number }[];
  points: Point[];
  /** How many events the last run produced, whether or not the journal had room for them. */
  wanted(): number;
  capacity(): number;
};

/** Compile with trace instrumentation and hand back a runner that returns the journal. */
async function traced(source: string, slots = 0): Promise<Traced> {
  const paths = ["/t/m.wac"], sources = [source];
  const wasm = Uint8Array.from(
    (slots === 0
      ? emitTraced(paths, sources, "/t/m.wac")
      : emitTracedSlots(paths, sources, "/t/m.wac", slots)) as unknown as number[],
  );
  if (!WebAssembly.validate(wasm)) throw new Error("the traced module does not validate");
  const { instance } = await WebAssembly.instantiate(wasm as BufferSource, {});
  const ex = instance.exports as Record<string, CallableFunction>;
  const points = traceTable(paths, sources, "/t/m.wac").split("\n").filter((l) => l !== "").map(
    (row) => {
      const [index, line, col, kind, file] = row.split("\t");
      return { index: Number(index), line: Number(line), col: Number(col), kind, file };
    },
  );
  return {
    points,
    capacity: () => ex.__cov_len() as number,
    wanted: () => ex.__cov_get((ex.__cov_len() as number) - 1) as number,
    run(f, ...a) {
      ex.__cov_init();
      ex[f](...a);
      const used = ex.__cov_get(0) as number;
      const out: { site: number; value: number }[] = [];
      for (let k = 0; k * 2 < used; k++) {
        out.push({ site: ex.__cov_get(1 + 2 * k) as number, value: ex.__cov_get(2 + 2 * k) as number });
      }
      return out;
    },
  };
}

/** Where two journals first differ, as `kind@line`, or null when they are identical. */
function divergence(t: Traced, a: { site: number; value: number }[], b: typeof a): string | null {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (x && y && x.site === y.site && x.value === y.value) continue;
    const p = t.points[(x ?? y).site];
    return `${p.kind}@${p.line}`;
  }
  return null;
}

Deno.test("a secret-dependent index diverges, and there is no branch to find", async () => {
  // The shape of AES's S-box lookup, and the whole reason indices are recorded: `f` has exactly one
  // branch point per run either way, so counting branches reports it as uniform.
  const t = await traced(`const u8[] SBOX = u8[](3, 1, 4, 1, 5, 9, 2, 6);
export i32 f(i32 secret) {
  i32 v = SBOX[secret & 7];
  return v;
}
`);
  assertEquals(t.points.some((p) => p.kind === "index"), true, "an index point exists");
  const a = t.run("f", 1), b = t.run("f", 2);
  assertEquals(a.length, b.length, "same number of events — no branch differs");
  assertEquals(divergence(t, a, b), "index@3", "the index at line 3 is where they differ");
});

Deno.test("a secret-dependent branch diverges at the branch", async () => {
  const t = await traced(`export i32 f(i32 secret) {
  if (secret > 10) { return 1; }
  return 0;
}
`);
  // `else@2`, not `then@2`: the divergence is named for the point the *first* run stood at, and
  // with `secret = 1` that run took the untaken side. Which of the two it names does not matter to a
  // caller — `firstDivergence` reports the line — and pinning the real answer is worth more than
  // pinning the one I assumed.
  assertEquals(divergence(t, t.run("f", 1), t.run("f", 100)), "else@2");
});

Deno.test("a routine that does not look at its secret produces one journal", async () => {
  // The canary for the two tests above: a comparison that *finds* a divergence everywhere is not a
  // check, it is a broken clock, and both of the leaks here are one line away from this program.
  const t = await traced(`export i32 f(i32 secret) {
  i32 acc = 0;
  for (i32 i = 0; i < 8; i++) { acc = acc + (secret & 1); }
  return acc;
}
`);
  const a = t.run("f", 0x00), b = t.run("f", 0xFF);
  assertEquals(a.length > 0, true, "something was recorded");
  assertEquals(divergence(t, a, b), null, "identical journals");
});

Deno.test("the right-hand side of a short circuit is a point", async () => {
  // It had none, so a secret deciding whether `b` runs at all was invisible — and a coverage report
  // called `a && b` covered when only `a` had ever been true. The reference records it as `and-rhs`;
  // this is the same point under the same name.
  const t = await traced(`i32 side(i32 v) { return v; }
export i32 f(i32 secret) {
  bool ok = secret > 4 && side(secret) > 0;
  return ok ? 1 : 0;
}
`);
  assertEquals(t.points.some((p) => p.kind === "and-rhs"), true, "an and-rhs point exists");
  // **`and-rhs`, which is the whole point of the point.** With `secret = 1` the left operand is false
  // and the right never runs; with `secret = 9` it does. Before this point existed the two runs
  // recorded the same events and the check said the secret had not been observed.
  assertEquals(divergence(t, t.run("f", 1), t.run("f", 9)), "and-rhs@3");
});

Deno.test("the journal is a journal: order is what it records", async () => {
  // Two runs that touch the same indices in a different *order* have identical counts, and coverage
  // cannot tell them apart. This is what a trace is for.
  const t = await traced(`const u8[] T = u8[](0, 1, 2, 3);
export i32 f(i32 secret) {
  i32 a = T[secret & 1];
  i32 b = T[(secret + 1) & 1];
  return a + b;
}
`);
  const a = t.run("f", 0), b = t.run("f", 1);
  assertEquals(a.map((e) => e.value).join(","), "0,0,1", "0 then 1");
  assertEquals(b.map((e) => e.value).join(","), "0,1,0", "1 then 0 — the same two, swapped");
  assertEquals(divergence(t, a, b) !== null, true, "and the journals differ");
});

Deno.test("a journal too small says how large it needed to be", async () => {
  // `issues/lang/0059`: the buffer was a fixed 2^22 events, so a routine that produces more could not
  // be checked for secret dependence *at all* — and the routines that overflow are the ones selected
  // for being expensive on purpose. A KDF's cost is the function rather than a parameter of it.
  //
  // Two halves. The caller can size the journal, and a run that overflows says what it needed rather
  // than leaving the caller to double and try again.
  const SRC = `export i32 f(i32 n) {
  i32 acc = 0;
  for (i32 i = 0; i < n; i++) { acc = acc + i; }
  return acc;
}
`;
  // 3 slots is one event's worth of room and no more, so 40 iterations overflow it many times over.
  const tiny = await traced(SRC, 8);
  const events = tiny.run("f", 40);
  assertEquals(tiny.capacity(), 8, "the size is the caller's");
  assertEquals(events.length < tiny.wanted(), true, "fewer recorded than happened");
  assertEquals(tiny.wanted() > 40, true, `one point per iteration at least, got ${tiny.wanted()}`);

  // The same program with room: nothing is lost, and the count agrees with what was recorded.
  const roomy = await traced(SRC, 1 << 12);
  const all = roomy.run("f", 40);
  assertEquals(all.length, roomy.wanted(), "every event recorded is every event that happened");
  // And the number the small run reported is the number the large one produced — which is what makes
  // it a size to use rather than a lower bound to double.
  assertEquals(tiny.wanted(), roomy.wanted(), "the overflowing run counted the same events");
});
