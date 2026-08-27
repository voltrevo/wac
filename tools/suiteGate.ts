// A heavy runner announcing itself, so the suite's gate can *see* it.
//
// **This was the gate until 2026-08-21, and now it is one half of it.** `tools/runTests.wac` took over
// the lock, the memory and load thresholds, the per-agent cooldown and the refusal — see
// `tools/wac/suitegate.wac`, which owns the protocol now. What is left here is the *writer* of
// `/tmp/wac-heavy-<pid>`, because the eight tools that announce themselves are still TypeScript:
// every `corpus:*`, `coverage:all` and `mutate`.
//
// Why that split is the right one rather than a leftover: a suite has to *refuse*, and refusing needs
// the lock, the readings and the cooldown together — one program, and it is the runner. Announcing is
// one file written and removed, and belongs to whichever program is doing the heavy work. So the
// duplication that remains between the two languages is a filename and four keys, pinned on the wac
// side by `tools/wac/suitegate_test.wac` and on this side by `tools/suiteGate.test.ts`.
//
// When those eight tools move, this file goes with them.

/** One per live heavy runner, keyed by pid so two of them never collide. */
const heavyFile = (pid: number) => `/tmp/wac-heavy-${pid}`;

/**
 * Which agent this is, from the workspace path — `~/agent-c/workspaces/wac` is `agent-c`.
 *
 * Not `hostname` (the container id), not `$USER` (always `claude`), and not asked for: the path is
 * the one thing that differs per agent and it is already the convention the filesystem is arranged
 * around. An unrecognised layout answers `unknown`, which still works.
 */
export function agentName(): string {
  const m = /\/(agent-[a-z0-9]+)\//.exec(Deno.cwd());
  return m === null ? "unknown" : m[1];
}

/**
 * A heavy non-suite runner announcing itself, so the gate can *see* it.
 *
 * The gate had exactly one caller, the suite runner, while roughly thirty-seven other
 * `wac task` entries build programs and run them — every `mutate*`, `corpus:*`, `coverage:*`,
 * `bench*`, `size` and `shell:fuzz`. None of them is visible here in either direction: they do not
 * wait for a suite and a suite does not wait for them. That is the first candidate in
 * issues/system 0142 and it is the shape every kill on 2026-08-12 had — all three refusals passed,
 * the run started, and something else arrived during the ten minutes that followed.
 *
 * **This records rather than excludes, and that is deliberate.** A mutual-exclusion token across
 * every heavy runner would serialise the machine and could deadlock against `coverage:all`, which
 * runs inside `tools/push.sh` after the suite it follows. What a ten-minute suite actually needs is
 * not "is there room this instant" — the memory and load checks already answer that, and answer it
 * about a moment — but "is something going to keep running while I do". A presence file answers
 * the second question, and the gate can weigh it without anybody waiting on anybody.
 *
 *     const done = announceHeavy("corpus:backings");
 *     try { … } finally { done(); }
 *
 * Same liveness rule as the lock: a file whose pid is gone is not a presence.
 */
export function announceHeavy(label: string): () => void {
  const path = heavyFile(Deno.pid);
  try {
    Deno.writeTextFileSync(
      path,
      JSON.stringify({ who: agentName(), label, pid: Deno.pid, since: Date.now() }),
    );
  } catch { /* an unwritable note should never stop the work it describes */ }
  return () => {
    try {
      Deno.removeSync(path);
    } catch { /* already gone */ }
  };
}
