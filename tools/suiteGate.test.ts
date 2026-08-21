// A heavy runner's presence note is written and removed.
//
// **This file tested the reader until 2026-08-21, and the reader has moved.** `announceHeavy` writes
// `/tmp/wac-heavy-<pid>` so another agent can be told *who* is using the machine rather than only that
// it is busy; the suite's gate reads them back, and the suite's gate is now `tools/runTests.wac`. So
// the cases about *reading* — a file sharing the prefix but not the shape is left alone, a note whose
// pid is gone is swept — live in `tools/wac/suitegate_test.wac`, next to the code they check.
//
// What they were about is worth repeating here, because this file is the writer and the two have to
// agree: the sweep is a claim over a whole `/tmp` prefix, and it once deleted the heavy lane's own
// stamp. `/tmp/wac-heavy-last` was a bare timestamp, `JSON.parse` accepts a number, so the note had
// no `pid`, the liveness check threw exactly as a dead pid does, and the file went on every gate
// check — a wrong answer with no error anywhere. Anything written under this prefix must be an object
// with a numeric `pid`, which is what the shape below is.

import { announceHeavy } from "./suiteGate.ts";

function assertEquals<T>(got: T, want: T, msg: string): void {
  if (got !== want) throw new Error(`${msg}\n  got:  ${got}\n  want: ${want}`);
}

const exists = (path: string): boolean => {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

Deno.test("a note is written for this process and removed when it is released", () => {
  const path = `/tmp/wac-heavy-${Deno.pid}`;
  const release = announceHeavy("a test of the gate's own notes");
  try {
    assertEquals(exists(path), true, "the note should be on disk");
    // The shape, because the reader is a different program in a different language now: an object
    // with a numeric `pid`, or the reader is required to leave it alone.
    const note = JSON.parse(Deno.readTextFileSync(path));
    assertEquals(typeof note, "object", "a note is an object");
    assertEquals(typeof note.pid, "number", "with a numeric pid — the whole recognition rule");
    assertEquals(note.pid, Deno.pid, "which is this process");
    assertEquals(typeof note.who, "string", "and a `who`, so the reader can name it");
    assertEquals(typeof note.label, "string", "and a label, which is what makes it useful");
    assertEquals(typeof note.since, "number", "and a millisecond stamp");
  } finally {
    release();
  }
  assertEquals(exists(path), false, "released should mean removed");
});
