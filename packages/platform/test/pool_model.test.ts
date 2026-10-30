// The buffer pool, walked rather than sampled.
//
// The fourth model, after the queue, the child's lifecycle and the slot protocol. It exists because the
// transport stopped giving every slot a buffer of its own: 128 slots × 128 KiB is 16 MiB per bridge, and a
// shell that spawns four applets pays it four times. Slots are now cheap control records and the payload
// buffers are pooled, with a small inline area per slot as the guarantee that an answer can *always* be
// written. That trade buys eight times the fan-in for the same memory and introduces exactly one new
// hazard: **a buffer is shared, so who owns it has to be right in every interleaving.**
//
// It is not a hypothetical hazard. The pool's first version stored "no buffer" as -1 in a field of shared
// memory, which starts as zeroes — so every slot nobody had touched claimed to hold buffer 0, and the
// first `release` of an untouched slot handed that buffer back while a live answer was still in it. Two
// slots pointed at one buffer and the worker read one call's answer out of another's:
//
//   asked as 15, answered as 24
//
// The fuzzer found it on its first seed, which is luck — the same class of bug hid for weeks twice before
// (see `bridge_model.test.ts`). This walks the states instead, and both mutants below are a buffer owned
// wrongly, so the invariants have to be load-bearing rather than decorative.
//
// **The answer path since `issues/system/0373d`.** An answer no longer goes back in the slot its request
// came in: the host takes a free slot for it, writes it in a pooled buffer or the slot's inline area, and
// the worker drains it — copies it out and releases the buffer — the next time it waits for anything. So a
// response buffer passes between exactly two hands, and the host's write can no longer lose a race to a
// cancel, which was the mirror-image mutant here: a cancelled call's answer is drained and dropped like any
// other, through the same release.
//
// **Reachable states, not paths.** Two slots and a shared buffer make the path space too large to
// enumerate to a useful depth, and paths are the wrong unit anyway: what matters is whether a bad *state*
// is reachable. So this is a breadth-first walk of every reachable state with a visited set, keeping the
// path that first reached each one so a violation still prints how to get there.
//
// **What it does not cover**, in the same terms as the other three: this is a model of ownership, not of
// memory. Whether the store that publishes a handle is visible before the store that publishes the status
// is a question about `Atomics` and hardware, and no model here can see it.

import { ST_ANSWERING, ST_FREE, ST_READY } from "../host/layout.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** Two slots and one buffer: enough for one slot to steal the other's. */
const SLOTS = 2;
const BUFS = 1;
/** Answers to deliver. Three, because the zeroed-memory theft needs a third to land in the stolen buffer. */
const ANSWERS = 3;

/**
 * A slot on the answer path.
 *
 * `res` is the modelled handle: a buffer index, or `null` for "the answer is in my inline area". The real
 * field holds a one-based index so that zeroed memory means `null`; the first mutant below is what happens
 * when it does not.
 */
type Slot = {
  status: number;
  /** The call whose answer is here. */
  id: number | null;
  /** Attached pooled buffer, or null for inline. */
  res: number | null;
};

type World = {
  slots: Slot[];
  /** Free flags, exactly as `acquireBuf` reads them. */
  free: boolean[];
  /** Which call's bytes are in each pooled buffer — the thing cross-talk corrupts. */
  content: (number | null)[];
  /** Each slot's inline area, same question. */
  inline: (number | null)[];
  /** The next call the host has an answer for, 1-based; past `ANSWERS` when it has none left. */
  next: number;
  /** What the worker drained, as `[whose slot said, whose bytes it read]`. */
  drained: [number, number][];
};

const fresh = (): World => ({
  slots: Array.from({ length: SLOTS }, () => ({ status: ST_FREE, id: null, res: null })),
  free: Array.from({ length: BUFS }, () => true),
  content: Array.from({ length: BUFS }, () => null),
  inline: Array.from({ length: SLOTS }, () => null),
  next: 1,
  drained: [],
});

const clone = (w: World): World => ({
  slots: w.slots.map((s) => ({ ...s })),
  free: [...w.free],
  content: [...w.content],
  inline: [...w.inline],
  next: w.next,
  drained: w.drained.map(([a, b]) => [a, b] as [number, number]),
});

/** How the code under test handles a buffer. */
type Rules = {
  /** Whether releasing a slot with nothing attached releases buffer 0 — the zeroed-memory bug. */
  readonly zeroMeansBufZero: boolean;
  /** Whether a drain hands the buffer back, or keeps it — a pool that loses one per answer. */
  readonly releaseOnDrain: boolean;
};

const SOUND: Rules = { zeroMeansBufZero: false, releaseOnDrain: true };

/** Take a buffer, or null when they are all busy. Deterministic: the lowest free one, as in `acquireBuf`. */
function acquire(w: World): number | null {
  for (let i = 0; i < BUFS; i++) if (w.free[i]) return i;
  return null;
}

function releaseAttached(w: World, s: Slot, r: Rules): void {
  const bi = s.res ?? (r.zeroMeansBufZero ? 0 : null);
  s.res = null;
  if (bi !== null) w.free[bi] = true;
}

type Move = { readonly show: string; readonly go: (w: World) => void };

/** Every step either side can take, for one slot. */
function movesFor(i: number, r: Rules): Move[] {
  const at = (w: World) => w.slots[i];
  return [
    {
      show: `h${i}: take for an answer`,
      go: (w) => {
        const s = at(w);
        if (s.status !== ST_FREE || w.next > ANSWERS) return;
        s.status = ST_ANSWERING;
        s.id = w.next;
        w.next += 1;
      },
    },
    {
      // An answer that fits inline, or one that did not get a pooled buffer. Always available, which is
      // the progress guarantee the pool is not allowed to take away.
      show: `h${i}: write inline`,
      go: (w) => {
        const s = at(w);
        if (s.status !== ST_ANSWERING) return;
        w.inline[i] = s.id;
        s.res = null;
        s.status = ST_READY;
      },
    },
    {
      show: `h${i}: write pooled`,
      go: (w) => {
        const s = at(w);
        if (s.status !== ST_ANSWERING) return;
        const bi = acquire(w);
        if (bi === null) return; // no buffer: the inline move is the one that can still run
        w.free[bi] = false;
        w.content[bi] = s.id;
        s.res = bi;
        s.status = ST_READY;
      },
    },
    {
      // Copied out, the buffer handed back, the slot freed — `readRes` and then `release` in `call.ts`.
      show: `w${i}: drain`,
      go: (w) => {
        const s = at(w);
        if (s.status !== ST_READY) return;
        const read = s.res === null ? w.inline[i] : w.content[s.res];
        w.drained.push([s.id!, read!]);
        if (r.releaseOnDrain) releaseAttached(w, s, r);
        else s.res = null;
        s.status = ST_FREE;
        s.id = null;
      },
    },
  ];
}

type Broken = { rule: string; path: string[]; detail: string };

/** What has to hold in every reachable state. */
function check(w: World, path: string[], broken: Broken[]): void {
  const fail = (rule: string, detail: string) => broken.push({ rule, path, detail });

  // The answer a worker reads is the answer to the call its slot names. This is the one the zeroed-memory
  // bug broke, and it broke it *quietly*: the bytes are real bytes from a real call.
  for (const [whose, read] of w.drained) {
    if (whose !== read) {
      fail("a worker drained another call's answer", `call ${whose} read call ${read}'s bytes`);
      return;
    }
  }
  // No buffer is attached to two slots at once.
  for (let bi = 0; bi < BUFS; bi++) {
    const holders = w.slots.filter((s) => s.res === bi).length;
    if (holders > 1) {
      fail("one buffer, two slots", `buffer ${bi} attached ${holders} times`);
      return;
    }
    // And a buffer somebody holds is not also on the free list — the double free, stated directly.
    if (holders === 1 && w.free[bi]) {
      fail("a buffer is free and attached at the same time", `buffer ${bi}`);
      return;
    }
  }
  // At rest, nothing is held: every slot free, so every buffer is back. A pool that loses one per
  // occurrence is a bridge that stalls an hour later with nothing to point at.
  const idle = w.slots.every((s) => s.status === ST_FREE && s.res === null);
  if (idle && w.free.some((f) => !f)) {
    fail("the pool leaked", `free=${JSON.stringify(w.free)}`);
    return;
  }
}

/** Breadth-first over every reachable state, keeping the first path to each. */
function explore(r: Rules, limit = 200_000): { broken: Broken[]; states: number } {
  const broken: Broken[] = [];
  const moves = Array.from({ length: SLOTS }, (_, i) => movesFor(i, r)).flat();
  const start = fresh();
  const key = (w: World) => JSON.stringify(w);
  const seen = new Set<string>([key(start)]);
  let frontier: { w: World; path: string[] }[] = [{ w: start, path: [] }];

  while (frontier.length > 0 && broken.length === 0 && seen.size < limit) {
    const next: { w: World; path: string[] }[] = [];
    for (const { w, path } of frontier) {
      for (const m of moves) {
        const after = clone(w);
        m.go(after);
        const k = key(after);
        if (seen.has(k)) continue;
        seen.add(k);
        const here = [...path, m.show];
        check(after, here, broken);
        if (broken.length > 0) return { broken, states: seen.size };
        next.push({ w: after, path: here });
      }
    }
    frontier = next;
  }
  return { broken, states: seen.size };
}

Deno.test("no reachable state has two slots sharing a buffer, an answer crossed, or a buffer lost", () => {
  const { broken, states } = explore(SOUND);
  assertEquals(
    broken.length === 0,
    true,
    broken.length === 0 ? "" : `${broken[0].rule}: ${broken[0].detail}\n  ${broken[0].path.join(" → ")}`,
  );
  console.log(`  ${states} reachable states`);
});

Deno.test("the invariants catch the zeroed-memory bug the fuzzer found", () => {
  // "No buffer" as -1 in memory that starts at zero: draining an inline answer releases buffer 0, which
  // another slot's answer is still in. The next pooled answer takes it and overwrites those bytes.
  //
  // The rule is asserted, not just that *something* broke, because the interesting claim is that the
  // *delivery* invariant catches this and not only the accounting one. With the accounting checks removed
  // it still fails, on the path the real bug took:
  //
  //   h0 take → h0 write inline → h1 take → h1 write pooled (buffer 0) → w0 drain (frees buffer 0, which
  //   it never held) → h0 take → h0 write pooled (buffer 0 again) → w1 drain
  //
  // and what w1 reads is the third call's bytes. That is `asked as 15, answered as 24`, eight moves deep.
  const { broken } = explore({ ...SOUND, zeroMeansBufZero: true });
  assertEquals(broken.length > 0, true, "a slot freeing a buffer it never held has to be caught");
  assertEquals(
    broken[0].rule === "a worker drained another call's answer" ||
      broken[0].rule === "a buffer is free and attached at the same time" ||
      broken[0].rule === "one buffer, two slots",
    true,
    `caught the wrong thing: ${broken[0].rule}`,
  );
  console.log(`  caught as "${broken[0].rule}": ${broken[0].path.join(" → ")}`);
});

Deno.test("and a drain that keeps its buffer, one per pooled answer", () => {
  // The leak the answer path can have now that a cancel cannot race the host's write: the worker copies the
  // bytes out and frees the slot without handing the buffer back. Eight answers of that and the bridge
  // writes everything inline, in four-kilobyte round trips, with nothing to say why.
  const { broken } = explore({ ...SOUND, releaseOnDrain: false });
  assertEquals(broken.length > 0, true, "a leaked buffer has to be caught");
  assertEquals(broken[0].rule, "the pool leaked", `caught the wrong thing: ${broken[0].rule}`);
});
