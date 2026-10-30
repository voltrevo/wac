// The bridge's slot protocol, walked rather than sampled.
//
// The third layer, after the queue and the child's lifecycle. A slot is shared memory written by two
// agents that never take turns: the worker claims a free one, fills it and publishes a request, and later
// drains an answer out of one; the host takes requests, works, and puts each answer in whichever slot is
// free. Which of them acts next is the hardware's business, and the code's comments record what that has
// already cost —
//
//   - a plain store where a compare-and-exchange belongs let one side overwrite the other's state, and
//     the slot was owned by nobody for the life of the program;
//   - one state for "claimed" and "pending" together let a sweep dispatch a slot whose opcode had not
//     been written yet, which surfaced as `no handler for capability 0` — invisible at four slots,
//     reproducible within three runs at sixteen;
//   - a call held the slot it came in from submission to collection, so a `recv` on a quiet connection
//     held one for good and the 129th call parked the worker for ever (`issues/system/0373d`).
//
// The first two were found by a fuzzer, eventually, and the third by a server in the field. This walks
// the state space instead: every state reachable by any interleaving of the two agents' steps over one
// slot and a few calls, against the rules that must hold in all of them.
//
// **The protocol since 0373d.** A call is a number, not a slot. A request holds its slot until the host
// reads it, which frees it; the call is then a row in the host's memory however long the work takes; the
// answer goes in any free slot, tagged with the call, and the worker drains it the next time it waits for
// anything, which frees that slot. So no slot waits on the work or on the program — the property the last
// test below is about.
//
// **What this covers and what it cannot.** It is a model of the *protocol* — who may move a slot from
// which state to which, and what each side may conclude. It says nothing about memory ordering: a plain
// load where an `Atomics` one belongs, or a torn read of the payload, is invisible here and is only ever
// caught by the real thing under stress. The bugs above are protocol bugs; that is the class this catches.

import { ST_ANSWERING, ST_CLAIMED, ST_FREE, ST_PENDING, ST_READY, ST_RUNNING } from "../host/layout.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

/** Calls the worker makes in a walk. Three through one slot: enough for one to wait while two contend. */
const CALLS = 3;

/** One slot, and what each side knows about the calls going through it. */
type World = {
  status: number;
  /** What the slot carries: a request, an answer, or nothing worth reading. */
  kind: "request" | "answer" | null;
  /** Which call it carries. */
  id: number | null;
  /** How many calls the worker has published. */
  made: number;
  /** The worker's view: submitted and not yet answered or given up on. */
  outstanding: number[];
  /** Answered and waiting to be collected. */
  answered: number[];
  /** Given up on while the host had them. */
  dropped: number[];
  /** Collected, and what each was — a call's answer is its own number, so a crossed one shows. */
  collected: [number, number][];
  /** The host's view: read and being worked on. */
  working: number[];
  /** Finished, waiting for a free slot. */
  outbox: number[];
};

const fresh = (): World => ({
  status: ST_FREE,
  kind: null,
  id: null,
  made: 0,
  outstanding: [],
  answered: [],
  dropped: [],
  collected: [],
  working: [],
  outbox: [],
});

const without = (xs: number[], x: number): number[] => xs.filter((y) => y !== x);

/** A step either side may take. `go` answers the new world, or null when the step is not possible. */
type Move = { readonly show: string; readonly by: "worker" | "host"; readonly go: (w: World) => World | null };

/** The steps. Ids are 1..CALLS, so a move per call is written out rather than chosen at random. */
function moves(): Move[] {
  const out: Move[] = [
    {
      show: "worker: claim",
      by: "worker",
      // Claimed, *not* pending: between taking a slot and writing the opcode there is nothing to take, and
      // sharing one state is what let a sweep dispatch a slot whose opcode was still the previous call's.
      go: (w) => w.status === ST_FREE && w.made < CALLS ? { ...w, status: ST_CLAIMED, kind: null, id: null } : null,
    },
    {
      show: "worker: publish",
      by: "worker",
      go: (w) => {
        if (w.status !== ST_CLAIMED) return null;
        const id = w.made + 1;
        return { ...w, status: ST_PENDING, kind: "request", id, made: id, outstanding: [...w.outstanding, id] };
      },
    },
    {
      show: "host: take",
      by: "host",
      // The request is read and its slot handed straight back; the call is the host's row now.
      go: (w) =>
        w.status === ST_PENDING && w.kind === "request"
          ? { ...w, status: ST_FREE, kind: null, id: null, working: [...w.working, w.id!] }
          : null,
    },
    {
      show: "host: take a free slot for an answer",
      by: "host",
      // A compare-and-exchange from free, because the worker claims from free too.
      go: (w) => w.outbox.length > 0 && w.status === ST_FREE ? { ...w, status: ST_ANSWERING, kind: null, id: null } : null,
    },
    {
      show: "host: write the answer",
      by: "host",
      go: (w) =>
        w.status === ST_ANSWERING
          ? { ...w, status: ST_READY, kind: "answer", id: w.outbox[0], outbox: w.outbox.slice(1) }
          : null,
    },
    {
      show: "worker: drain",
      by: "worker",
      // Copied out and the slot freed, whatever the program is doing; a dropped call's answer goes nowhere.
      go: (w) => {
        if (w.status !== ST_READY || w.kind !== "answer") return null;
        const id = w.id!;
        const was = w.dropped.includes(id);
        return {
          ...w,
          status: ST_FREE,
          kind: null,
          id: null,
          dropped: was ? without(w.dropped, id) : w.dropped,
          answered: was ? w.answered : [...w.answered, id],
        };
      },
    },
  ];
  for (let id = 1; id <= CALLS; id++) {
    out.push(
      {
        show: `host: finish ${id}`,
        by: "host",
        go: (w) => w.working.includes(id) ? { ...w, working: without(w.working, id), outbox: [...w.outbox, id] } : null,
      },
      {
        show: `worker: collect ${id}`,
        by: "worker",
        go: (w) =>
          w.answered.includes(id) && w.outstanding.includes(id)
            ? {
              ...w,
              answered: without(w.answered, id),
              outstanding: without(w.outstanding, id),
              collected: [...w.collected, [id, id] as [number, number]],
            }
            : null,
      },
      {
        show: `worker: cancel ${id}`,
        by: "worker",
        // Local: nothing of the bridge's is held by an outstanding call, so the host is not told.
        go: (w) => {
          if (!w.outstanding.includes(id)) return null;
          const had = w.answered.includes(id);
          return {
            ...w,
            outstanding: without(w.outstanding, id),
            answered: without(w.answered, id),
            dropped: had ? w.dropped : [...w.dropped, id],
          };
        },
      },
    );
  }
  return out;
}

type Broken = { rule: string; path: string[]; detail: string };

/** What has to hold in every reachable state. */
function check(w: World): string | null {
  // A collected answer is its own call's — never another's, which is what would look entirely plausible.
  for (const [id, said] of w.collected) if (id !== said) return `call ${id} collected call ${said}'s answer`;
  // A call given up on is never delivered: its answer is dropped as it is drained.
  for (const id of w.answered) if (!w.outstanding.includes(id)) return `the answer to cancelled call ${id} was delivered`;
  // A published request carries its call.
  if (w.status === ST_PENDING && (w.kind !== "request" || w.id === null)) return "a slot was published with no request in it";
  // No request is lost: every call made is somewhere — on its way to the host, being worked on, answered
  // and on its way back, delivered, collected, or given up on.
  for (let id = 1; id <= w.made; id++) {
    const inSlot = w.id === id && (w.status === ST_PENDING || w.status === ST_READY);
    const somewhere = inSlot || w.working.includes(id) || w.outbox.includes(id) || w.answered.includes(id) ||
      w.collected.some(([c]) => c === id) || w.dropped.includes(id) || !w.outstanding.includes(id);
    if (!somewhere) return `call ${id} was lost`;
  }
  return null;
}

/** Every reachable state, breadth first, with the first path to each. */
function reachable(ms: readonly Move[]): { states: { w: World; path: string[] }[]; broken: Broken | null } {
  const key = (w: World) => JSON.stringify(w);
  const start = fresh();
  const seen = new Set<string>([key(start)]);
  const states = [{ w: start, path: [] as string[] }];
  for (let i = 0; i < states.length; i++) {
    const { w, path } = states[i];
    for (const m of ms) {
      const after = m.go(w);
      if (after === null) continue;
      const k = key(after);
      if (seen.has(k)) continue;
      seen.add(k);
      const here = [...path, m.show];
      const bad = check(after);
      if (bad !== null) return { states, broken: { rule: bad.replace(/\d+/g, "N"), path: here, detail: bad } };
      states.push({ w: after, path: here });
    }
  }
  return { states, broken: null };
}

/**
 * Whether the slot comes back from `w` with the host never finishing anything and the program never
 * collecting or cancelling — a peer that never speaks, and a program busy elsewhere. That is 0373d's
 * property: no slot waits on the work, and none waits on the program.
 */
function comesBack(w: World, ms: readonly Move[]): boolean {
  const allowed = ms.filter((m) => !/finish|collect|cancel/.test(m.show));
  const seen = new Set<string>();
  const queue = [w];
  while (queue.length > 0) {
    const s = queue.shift()!;
    if (s.status === ST_FREE) return true;
    const k = JSON.stringify(s);
    if (seen.has(k)) continue;
    seen.add(k);
    for (const m of allowed) {
      const after = m.go(s);
      if (after !== null) queue.push(after);
    }
  }
  return false;
}

const report = (b: Broken | null) => b === null ? "" : `${b.detail}\n  path: ${b.path.join(" → ")}`;

Deno.test("every reachable state keeps answers matched, cancelled ones undelivered, and no call lost", () => {
  const { states, broken } = reachable(moves());
  assertEquals(broken, null, report(broken));
  console.log(`  ${states.length} reachable states`);
});

Deno.test("a slot always comes back, with the host never finishing and the program never collecting", () => {
  const ms = moves();
  const { states } = reachable(ms);
  const stuck = states.filter(({ w }) => !comesBack(w, ms));
  assertEquals(stuck.length, 0, stuck.length === 0 ? "" : `stuck after: ${stuck[0].path.join(" → ")}`);
});

Deno.test("the liveness check catches the shape 0373d was: a call holding its slot while the host works", () => {
  // The old protocol in one move: the host takes the request and keeps the slot, answering into it when
  // the work is done. A call the host never finishes then holds the slot for good, and with every slot
  // held like that the worker has nowhere to put the call that would let it recover.
  const held: Move[] = moves().map((m) =>
    m.show === "host: take"
      ? {
        ...m,
        go: (w: World) =>
          w.status === ST_PENDING && w.kind === "request" ? { ...w, status: ST_RUNNING, working: [...w.working, w.id!] } : null,
      }
      : m.show.startsWith("host: finish")
      ? {
        ...m,
        go: (w: World) => {
          const id = Number(m.show.slice("host: finish ".length));
          if (!w.working.includes(id) || w.status !== ST_RUNNING || w.id !== id) return null;
          return { ...w, status: ST_READY, kind: "answer" as const, working: without(w.working, id) };
        },
      }
      : m
  );
  const { states } = reachable(held);
  const stuck = states.filter(({ w }) => !comesBack(w, held));
  assertEquals(stuck.length > 0, true, "a slot held for as long as the host works went unnoticed");
  // The state that says it, rather than the first doomed one — a claim is doomed once taking holds slots.
  const holding = stuck.find(({ w }) => w.status === ST_RUNNING) ?? stuck[0];
  console.log(`  stuck after: ${holding.path.join(" → ")}`);
});

Deno.test("and a host taking a slot for its answer with a plain store, over a request the worker had claimed", () => {
  // Both sides take free slots. Taking one without the exchange lands an answer on top of a slot the worker
  // has claimed or published, and the request in it is gone — a call that will never be answered.
  const plain: Move[] = moves().map((m) =>
    m.show === "host: take a free slot for an answer"
      ? { ...m, go: (w: World) => w.outbox.length > 0 && w.status !== ST_ANSWERING && w.status !== ST_READY ? { ...w, status: ST_ANSWERING, kind: null, id: null } : null }
      : m
  );
  const { broken } = reachable(plain);
  assertEquals(broken !== null, true, "an answer written over a request went unnoticed");
  assertEquals(broken!.rule, "call N was lost", `caught the wrong thing: ${report(broken)}`);
});

Deno.test("and a publish that skips `claimed`, which is the other historical one", () => {
  // One state for "taken" and "has a request in it" together: the sweep dispatches a slot whose opcode
  // has not been written, and the host runs whatever the previous call left there — zero on a slot's
  // first use, hence `no handler for capability 0`.
  const eager: Move[] = moves().map((m) =>
    m.show === "worker: claim"
      ? { ...m, go: (w: World) => w.status === ST_FREE && w.made < CALLS ? { ...w, status: ST_PENDING, kind: null, id: null } : null }
      : m
  );
  const { broken } = reachable(eager);
  assertEquals(broken !== null, true, "a slot published with no request went unnoticed");
  assertEquals(broken!.rule, "a slot was published with no request in it", `caught the wrong thing: ${report(broken)}`);
});

Deno.test("and a drain that delivers what it should drop, a cancelled call's answer", () => {
  const leaky: Move[] = moves().map((m) =>
    m.show === "worker: drain"
      ? {
        ...m,
        go: (w: World) =>
          w.status === ST_READY && w.kind === "answer"
            ? { ...w, status: ST_FREE, kind: null, id: null, answered: [...w.answered, w.id!] }
            : null,
      }
      : m
  );
  const { broken } = reachable(leaky);
  assertEquals(broken !== null, true, "a cancelled call's answer delivered went unnoticed");
  assertEquals(broken!.rule, "the answer to cancelled call N was delivered", `caught the wrong thing: ${report(broken)}`);
});
