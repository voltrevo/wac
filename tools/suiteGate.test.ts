// The gate's presence notes, and what it is allowed to delete.
//
// `announceHeavy` writes `/tmp/wac-heavy-<pid>` so another agent can be told *who* is using the
// machine rather than only that it is busy, and `heavyOthers` reads them back. Reading them back
// includes a cleanup — a note whose pid is gone is not a presence, so it goes.
//
// **That cleanup is a claim over a whole `/tmp` prefix**, and it cost a file. `tools/runTests.ts`
// stamped the heavy lane's last green run into `/tmp/wac-heavy-last`, which is a name a person would
// write without a second thought and which `heavyOthers` swept on the next gate check: the stamp's
// content is a bare timestamp, `JSON.parse("1755...")` *succeeds* because a number is valid JSON, the
// resulting `note.pid` is `undefined`, and `Deno.kill(undefined)` throws exactly as a dead pid does.
// So the stamp was deleted every time anybody ran a suite, and the lane reported "last run never on
// this machine" forever — a wrong answer with no error anywhere, which is the failure this repository
// keeps finding.
//
// The stamp moved out of the prefix, and the sweep narrowed to notes it can actually recognise. Both,
// because either alone leaves the trap set for the next person who picks a name.

import { announceHeavy, heavyOthers } from "./suiteGate.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

const exists = (path: string): boolean => {
  try {
    Deno.lstatSync(path);
    return true;
  } catch {
    return false;
  }
};

Deno.test("a file sharing the prefix but not the shape is left alone", () => {
  // Three spellings that are all valid JSON and none of them a presence note. The first is the one
  // that actually happened; a number is valid JSON and that is the whole trap.
  const cases: [string, string][] = [
    [`/tmp/wac-heavy-last-${Deno.pid}`, "1755229000000"],
    [`/tmp/wac-heavy-stamp-${Deno.pid}`, `"a string"`],
    [`/tmp/wac-heavy-note-${Deno.pid}`, `{"who":"agent-x","label":"no pid at all"}`],
  ];
  for (const [path, body] of cases) Deno.writeTextFileSync(path, body);
  try {
    heavyOthers();
    for (const [path] of cases) {
      assertEquals(
        exists(path),
        true,
        `${path} was deleted. The sweep may only remove notes it wrote — anything else under the ` +
          `prefix belongs to somebody else, and guessing costs them a file with no error anywhere.`,
      );
    }
  } finally {
    for (const [path] of cases) {
      try { Deno.removeSync(path); } catch { /* the bug under test may have removed it */ }
    }
  }
});

Deno.test("a note whose process is gone is still swept, which is why the sweep exists", () => {
  // The cleanup is worth keeping: a killed suite leaves its note behind, and a stale note makes the
  // machine look busier than it is. Pid 2^22 + 1 is above `/proc/sys/kernel/pid_max`'s default, so it
  // cannot name a live process and cannot name a real one this test might signal.
  const path = `/tmp/wac-heavy-4194305`;
  Deno.writeTextFileSync(
    path,
    JSON.stringify({ who: "agent-gone", label: "a suite that was killed", pid: 4194305, since: 0 }),
  );
  heavyOthers();
  assertEquals(exists(path), false, "a note with a dead pid should have been swept");
});

Deno.test("this process's own note is announced and read back by the others", () => {
  // `heavyOthers` excludes *this* pid by design — the question it answers is "who else", so a runner
  // asking it must not find itself and refuse to start.
  const release = announceHeavy("a test of the gate's own notes");
  try {
    assertEquals(
      heavyOthers().some((n) => n.pid === Deno.pid),
      false,
      "heavyOthers should not report the caller",
    );
    assertEquals(exists(`/tmp/wac-heavy-${Deno.pid}`), true, "the note should be on disk");
  } finally {
    release();
  }
  assertEquals(exists(`/tmp/wac-heavy-${Deno.pid}`), false, "released should mean removed");
});
