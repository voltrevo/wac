// Whether the machine can afford a full suite right now, and whether you have just had one.
//
// Three agents share five cores and 11.9 GB. A suite peaks over 3 GB and takes five to eleven
// minutes, so two at once is tight and three is not survivable: the kernel's `oom_kill` counter moved
// from 20 to 22 in a single evening, and three of those kills were suite runs that had reached about
// 70% and reported no failure at all — `EXIT=137`, no summary, nothing to debug.
//
// **Concurrency is the thing that hurts, not any single reading.** The lock below is the real
// protection; the memory and load thresholds are a second line, and one of them has already been
// wrong once — see the note on swap.
//
// This refuses the run before it starts, and says what to do instead. It is deliberately in
// `tools/runTests.ts`'s path rather than in `push.sh`, because `deno task test` is what an agent
// reaches for by reflex and the gate is worth nothing if the common door bypasses it. A *targeted*
// run — `deno test -A packages/git/test/` — does not come through here at all, which is the whole
// point: the encouraged thing stays instant.
//
// ## The three refusals, in order of how certain the harm is
//
//   1. **another suite is running** — the one that actually causes the OOM. A lock in `/tmp`, which
//      every agent shares, holding who and since when. A dead pid releases it.
//   2. **the machine cannot take it** — measured, not guessed: every kill this session happened with
//      free swap near zero.
//   3. **you ran one recently** — the "too often" half, per agent.
//
// ## Why it can be overridden
//
// Because a gate with no way past it is one somebody deletes the first time it is wrong, and the
// thresholds here are derived from a single day of failures. `WAC_SUITE_ANYWAY=1` goes through, says
// so loudly, and records itself in the lock — an override that leaves no trace is indistinguishable
// from the gate not working.
//
// `WAC_SUITE_RETRY=1` is the narrow one, and it skips **only the cooldown**. `tools/push.sh` sets
// it for attempts 2 and 3: a suite that passed and then lost the push race has to run again, six
// minutes later by construction, and the twenty-minute rule was refusing exactly that — a lost
// race became `tests failed after 1s (exit 3): not pushing`, so the agent that lost it could not
// push at all. It still waits for the lock and still respects memory and load, because
// concurrency is the part that causes the kills and a retry is no less concurrent than anything
// else.
//
// **It refuses rather than queueing, and `tools/push.sh` is refused like anything else.** A script
// that waits quietly for a free machine decides for you; being told is what lets the caller pick —
// keep working locally, run the targeted tests, come back later, or override with a reason.

/** Shared by every agent, because the resource being protected is shared. */
const LOCK = "/tmp/wac-suite.lock";
/** Per agent, so "you ran one recently" is about you. */
const lastRunFile = (who: string) => `/tmp/wac-suite-last-${who}`;
/** One per live heavy runner, keyed by pid so two of them never collide. */
const heavyFile = (pid: number) => `/tmp/wac-heavy-${pid}`;

/** Minutes before the same agent should run a full suite again. */
const COOLDOWN_MIN = 20;
/** Megabytes of available memory below which a suite is likely to be killed rather than finish. */
const MIN_AVAILABLE_MB = 3000;
/**
 * Swap is **not** a threshold here, and the reason is worth keeping.
 *
 * The first version refused when free swap fell under 200 MB, reasoning that every suite killed this
 * session was killed with swap near zero. That is true and useless: swap has been near zero on this
 * machine for hours, and five suites *completed* during the same window. The measure was taken from
 * the failures without looking at the successes, so it separates nothing — it would have refused
 * every run, for ever, and been read as the gate being broken rather than wrong.
 *
 * `MemAvailable` is the direct question, and concurrency is the real protection: the kills happened
 * when suites overlapped, which is what the lock prevents.
 */
/** One-minute load average above which five cores are already spoken for. */
const MAX_LOAD = 8;

/**
 * Which agent this is, from the workspace path — `~/agent-c/workspaces/wac` is `agent-c`.
 *
 * Not `hostname` (the container id), not `$USER` (always `claude`), and not asked for: the path is
 * the one thing that differs per agent and it is already the convention the filesystem is arranged
 * around. An unrecognised layout answers `unknown`, which still works — it just shares a cooldown.
 */
export function agentName(): string {
  const m = /\/(agent-[a-z0-9]+)\//.exec(Deno.cwd());
  return m === null ? "unknown" : m[1];
}

/** `/proc/meminfo` and `/proc/loadavg`, via `cat` because Deno gates `/proc` behind `--allow-all`. */
function machine(): { availableMb: number; load: number } | null {
  try {
    const read = (path: string) => {
      const r = new Deno.Command("cat", { args: [path], stdout: "piped", stderr: "null" }).outputSync();
      return new TextDecoder().decode(r.stdout);
    };
    const mem = read("/proc/meminfo");
    const kb = (key: string) => {
      const m = new RegExp(`^${key}:\\s+(\\d+) kB`, "m").exec(mem);
      return m === null ? null : Number(m[1]) / 1024;
    };
    const available = kb("MemAvailable");
    const load = Number(read("/proc/loadavg").split(" ")[0]);
    if (available === null || Number.isNaN(load)) return null;
    return { availableMb: Math.round(available), load };
  } catch {
    // Unreadable is not a reason to block: this gate exists to save time, and refusing a run because
    // it could not read `/proc` would be the gate costing what it is meant to protect.
    return null;
  }
}

type Held = { who: string; pid: number; since: number; forced: boolean };

function readLock(): Held | null {
  try {
    const held = JSON.parse(Deno.readTextFileSync(LOCK)) as Held;
    // A lock whose process is gone is not a lock. `kill -0` is the question "is this pid alive".
    try {
      Deno.kill(held.pid, "SIGCONT");
    } catch {
      return null;
    }
    return held;
  } catch {
    return null;
  }
}

const minutesSince = (ms: number) => Math.round((Date.now() - ms) / 60000);

function advice(): string {
  return [
    "",
    "   Keep working locally. Run what you touched:",
    "     deno test -A packages/<name>/test/       the package",
    "     deno test -A path/to/one.test.ts         one file",
    "     deno task docs                           the doc checks, strictly",
    "",
    "   The suite is 5-11 minutes and three agents share five cores and 11.9 GB.",
    "   Two at once is tight; three get killed at about 70% with no failure reported.",
    "   `WAC_SUITE_ANYWAY=1 deno task test` goes through anyway, and says that it did.",
  ].join("\n");
}

/**
 * Refuse, unless the machine is quiet and you have not just had one.
 *
 * Returns a release function when the run may proceed. Call it when the suite finishes, so the next
 * agent is not waiting on a lock nobody holds.
 */
/**
 * A heavy non-suite runner announcing itself, so the gate can *see* it.
 *
 * `takeSuiteSlot` has exactly one caller, `tools/runTests.ts`, while roughly thirty-seven other
 * `deno task` entries build programs and run them — every `mutate*`, `corpus:*`, `coverage:*`,
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

/** Every heavy runner that is not this process and whose pid is still alive. */
export function heavyOthers(): { who: string; label: string; pid: number; since: number }[] {
  const out: { who: string; label: string; pid: number; since: number }[] = [];
  let entries: Deno.DirEntry[];
  try {
    entries = [...Deno.readDirSync("/tmp")];
  } catch {
    return out;
  }
  for (const e of entries) {
    if (!e.name.startsWith("wac-heavy-")) continue;
    try {
      const note = JSON.parse(Deno.readTextFileSync(`/tmp/${e.name}`));
      if (note.pid === Deno.pid) continue;
      // A note whose process is gone is not a presence — the same `kill -0` question the lock asks.
      try {
        Deno.kill(note.pid, "SIGCONT");
      } catch {
        try { Deno.removeSync(`/tmp/${e.name}`); } catch { /* someone else swept it */ }
        continue;
      }
      out.push(note);
    } catch { /* an unreadable note is not evidence of anything */ }
  }
  return out;
}

export function takeSuiteSlot(): () => void {
  const who = agentName();
  const forced = Deno.env.get("WAC_SUITE_ANYWAY") === "1";
  // **A gate retry is not a second suite in the cooldown's sense.** `tools/push.sh` runs the suite,
  // pushes, and on a lost race merges and runs it again — six minutes later by construction, which
  // the twenty-minute cooldown refuses. Measured on 2026-08-12, an hour after this file landed: a
  // lost push race became `tests failed after 1s (exit 3): not pushing`, so the agent that lost the
  // race could not push at all.
  //
  // Narrower than `WAC_SUITE_ANYWAY` on purpose. That one goes past *everything*, including the
  // lock — and the lock is the protection that matters, since concurrency is what causes the kills.
  // A retry still waits for the machine and still refuses if another agent is running one; what it
  // skips is only the "you have just had one" rule, which is about an agent reaching for the suite
  // by reflex rather than about a script finishing a job it started.
  const retry = Deno.env.get("WAC_SUITE_RETRY") === "1";
  const refuse = (why: string): never => {
    console.error(`\n== not running the suite: ${why} ==\n${advice()}\n`);
    Deno.exit(3);
  };

  if (!forced) {
    const held = readLock();
    if (held !== null) {
      refuse(
        `${held.who} started one ${minutesSince(held.since)}m ago (pid ${held.pid})` +
          (held.forced ? ", with WAC_SUITE_ANYWAY" : ""),
      );
    }

    // **Said before the thresholds, because it explains them.** The memory and load readings
    // describe this instant; a heavy runner next door describes the next ten minutes, which is what
    // a suite actually has to survive. This does not refuse on its own — see `announceHeavy` for
    // why exclusion would be worse — but a run that goes on to be killed should not leave the
    // person reading the log guessing what else was on the machine. issues/system 0142.
    const others = heavyOthers();
    if (others.length > 0) {
      const said = others
        .map((o) => `${o.label} (${o.who}, ${minutesSince(o.since)}m)`)
        .join(", ");
      console.error(`\n== heavy work is running next door: ${said} ==`);
      console.error("   Not a refusal. If this run is killed without reporting a failure, that is");
      console.error("   the likeliest reason — issues/system 0142.\n");
    }

    const m = machine();
    if (m !== null) {
      if (m.availableMb < MIN_AVAILABLE_MB) {
        refuse(`only ${m.availableMb} MB of memory available, and a suite peaks above ${MIN_AVAILABLE_MB}`);
      }
      if (m.load > MAX_LOAD) {
        refuse(`the load average is ${m.load.toFixed(1)} on five cores`);
      }
    }

    if (!retry) {
      try {
        const last = Number(Deno.readTextFileSync(lastRunFile(who)));
        const ago = minutesSince(last);
        if (ago < COOLDOWN_MIN) {
          refuse(`${who} ran one ${ago}m ago — the cooldown is ${COOLDOWN_MIN}m`);
        }
      } catch { /* no record: this is the first run */ }
    }
  } else {
    console.warn(
      "\n== WAC_SUITE_ANYWAY=1: running the suite despite the gate ==\n" +
        "   Recorded in the lock, so another agent can see why it is held.\n",
    );
  }

  const held: Held = { who, pid: Deno.pid, since: Date.now(), forced };
  try {
    Deno.writeTextFileSync(LOCK, JSON.stringify(held));
    Deno.writeTextFileSync(lastRunFile(who), String(Date.now()));
  } catch { /* an unwritable lock should not stop a run that has been allowed */ }

  return () => {
    try {
      // Only if it is still ours: a forced run by somebody else may have taken it in the meantime,
      // and releasing theirs would be worse than leaving ours.
      const now = readLock();
      if (now !== null && now.pid === Deno.pid) Deno.removeSync(LOCK);
    } catch { /* nothing held */ }
  };
}

