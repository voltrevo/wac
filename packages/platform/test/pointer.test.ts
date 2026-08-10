// What a pointer event says, and how many of them a program has to read.
//
// Both of these are what a window manager needs before it can drag anything, and both were wrong in
// a way nothing noticed while the only pointer users were "click somewhere on a canvas".
//
//   - **Coordinates are relative to the element the capability names.** platform.wac has said
//     "where in the element it happened, in its own pixels" since the field existed. The host sent
//     `ev.offsetX`, which is relative to `ev.target` — the deepest element under the pointer — and
//     those are the same element only when nothing is in between. A title bar holds a `<span>` and a
//     `<button>`.
//   - **A `pointermove` is a position, not an occurrence.** The queue is unbounded and a program
//     reads one event per bridge round trip, so a drag would leave it behind the pointer for as long
//     as the drag lasted, and it would keep moving the window after the pointer stopped.
//
// Driven through `pageDom` with a document made of plain objects, which is where both rules live —
// `browser_live` then checks that a real Chromium agrees, but a race is a poor place to learn what
// the rule *is*.

import { pageDom } from "../host/entryBrowser.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

type Listener = (ev: unknown) => void;

/**
 * A document of plain objects: a `.bar` at (100, 50) with a `<span>` inside it at (140, 58).
 *
 * The span is the point of the fixture. A pointer over the title text has the span as its target and
 * the bar as its `closest(".bar")`, which is exactly the arrangement the old coordinates got wrong.
 */
function fixture() {
  const listeners = new Map<string, Listener[]>();
  const bar = {
    id: "bar1",
    innerHTML: "",
    textContent: "",
    closest: (sel: string) => (sel === ".bar" ? bar : null),
    getBoundingClientRect: () => ({ left: 100, top: 50, width: 300, height: 20 }),
    addEventListener: () => {},
  };
  const span = {
    id: "",
    innerHTML: "",
    textContent: "",
    // The span's own box, which is *not* what the capability reports.
    getBoundingClientRect: () => ({ left: 140, top: 58, width: 60, height: 12 }),
    closest: (sel: string) => (sel === ".bar" ? bar : null),
    addEventListener: () => {},
  };
  const doc = {
    title: "",
    getElementById: (id: string) => (id === "bar1" ? bar : null),
    addEventListener: (kind: string, fn: Listener) => {
      const have = listeners.get(kind) ?? [];
      have.push(fn);
      listeners.set(kind, have);
    },
  };
  // deno-lint-ignore no-explicit-any
  const dom = pageDom(bar as any, doc as any, () => {});
  const fire = (kind: string, ev: Record<string, unknown>) => {
    for (const fn of listeners.get(kind) ?? []) fn({ preventDefault: () => {}, ...ev });
  };
  return { dom, fire, span };
}

Deno.test("a pointer's coordinates are the named element's, not the one under the pointer", async () => {
  const { dom, fire, span } = fixture();
  dom.on(".bar", "pointerdown");

  // The pointer is over the span, at page (150, 60). The bar's top-left is (100, 50), so what the
  // capability promises is (50, 10). `offsetX` would have said (10, 2) — relative to the span.
  fire("pointerdown", { target: span, clientX: 150, clientY: 60, offsetX: 10, offsetY: 2 });

  const e = await dom.next();
  assertEquals(e.id, "bar1", "the id is the element that matched the selector");
  assertEquals(`${e.x},${e.y}`, "50,10", "coordinates are relative to the element the id names");
});

Deno.test("a pointermove replaces a queued pointermove rather than joining the queue", async () => {
  const { dom, fire, span } = fixture();
  dom.on(".bar", "pointermove");
  dom.on(".bar", "pointerdown");

  // Three moves with nobody reading — a drag, in miniature.
  fire("pointermove", { target: span, clientX: 110, clientY: 55 });
  fire("pointermove", { target: span, clientX: 160, clientY: 65 });
  fire("pointermove", { target: span, clientX: 210, clientY: 75 });

  // **The newest position, and only it.** A queue that kept all three would answer 10,5 here and
  // spend two more reads catching up — which is the lag this exists to prevent.
  const first = await dom.next();
  assertEquals(`${first.x},${first.y}`, "110,25", "the newest move is what a reader gets");

  // And the queue is empty rather than holding the two it replaced: the next event to arrive is the
  // next thing a reader sees.
  fire("pointerdown", { target: span, clientX: 150, clientY: 60 });
  const then = await dom.next();
  assertEquals(then.kind, "pointerdown", "the older moves were replaced, not stored");
});

Deno.test("...but only for the same element, and only for moves", async () => {
  const { dom, fire, span } = fixture();
  dom.on(".bar", "pointermove");
  dom.on(".bar", "click");

  // A click between two moves is an occurrence: it has to survive, or a window manager loses the
  // press that started the drag.
  fire("pointermove", { target: span, clientX: 110, clientY: 55 });
  fire("click", { target: span, clientX: 120, clientY: 56 });
  fire("pointermove", { target: span, clientX: 210, clientY: 75 });

  assertEquals((await dom.next()).kind, "pointermove");
  assertEquals((await dom.next()).kind, "click");
  const last = await dom.next();
  assertEquals(`${last.kind} ${last.x},${last.y}`, "pointermove 110,25");
});
