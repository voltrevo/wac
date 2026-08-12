// A script generator for `packages/sh`, with bash as the oracle.
//
//   deno task shell:fuzz -- --shell /tmp/boxsh [--count 200] [--seed 7] [--verbose]
//
// Every sweep this shell has enumerates one construct at a time — the corpus, `gaps.test.ts`,
// `behaviour.test.ts` — and each was written just after the construct it covers. The bugs that survive
// those live at *intersections*, which is what a generator reaches and a matrix somebody typed does not.
//
// It has earned its place twice. Its first 120 scripts found **wac-mono 0113**: a pipeline whose first
// stage produces no bytes hung, because one condition could not tell an empty held input from no input
// at all. `: | cat` is not a thing a person writes, and every hand-written case in this repo has a first
// stage that produces something. Its next 400 found that `test`'s diagnostics named `test` even when
// they were reached through `[`, which has been true since the builtin was written and shows in the
// spelling every real script uses.
//
// ## The oracle is bash, and the comparison is bytes
//
// Output, standard error and the exit status, all three. Two normalisations, and both are about bash
// naming *itself* rather than about behaviour:
//
//   - `bash: line N:` and `environment: line N:` prefixes come off. A builtin's diagnostic in bash
//     carries the shell's name and a line number; ours carries neither, deliberately — there is no line
//     to give in a `-c` string that has been through a parser.
//   - `sh: ` comes off ours, for the same reason in reverse.
//
// What is *not* normalised is anything about what the command did. A difference that survives those two
// substitutions is a difference worth reading.
//
// ## What the generator must not produce
//
// Two shapes cost an hour between them and are worth stating:
//
//   - **A loop variable reused by a nested loop.** `for i` inside `while [ $i -lt 2 ]` resets the outer
//     counter and the script never ends — in bash as much as here, so it is the generator that is wrong
//     rather than a finding. Every loop gets a name from its depth.
//   - **`case x y in`**, and anything else that is a *syntax* error. Both shells refuse it and their
//     messages differ by design: bash names the offending token and the line, ours says `syntax error`.
//     Generating them buries the real findings under a class that is already understood.
//
// ## Determinism
//
// A seed produces the same scripts on any machine, which is what lets `packages/box/test/fuzz.test.ts`
// run a handful of fixed seeds as an ordinary test. Random-by-default in a suite is a flaky suite; the
// tool is for exploring, the fixed seeds are the ratchet.

const args = Deno.args;
function flag(name: string, fallback: string): string {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : fallback;
}

/** A deterministic 32-bit generator, so a seed means the same thing everywhere. */
export class Rand {
  private state: number;
  constructor(seed: number) {
    this.state = (seed | 0) === 0 ? 0x9e3779b9 : seed | 0;
  }
  next(): number {
    // xorshift32: small, and its only requirement here is that a seed reproduces a run.
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x | 0;
    return (x >>> 0) / 0x100000000;
  }
  int(n: number): number {
    return Math.floor(this.next() * n) % n;
  }
  pick<T>(xs: readonly T[]): T {
    return xs[this.int(xs.length)];
  }
}

const WORDS = ["a", "b", "hi", '"x y"', "$'t\\tb'", '"$v"', "$v", "f", "n"] as const;

const SIMPLE = [
  (r: Rand) => `echo ${r.pick(WORDS)}`,
  (r: Rand) => `echo ${r.pick(WORDS)} ${r.pick(WORDS)}`,
  () => "true",
  () => "false",
  () => ":",
  (r: Rand) => `[ -f ${r.pick(WORDS)} ]`,
  (r: Rand) => `[ ${r.pick(WORDS)} = ${r.pick(WORDS)} ]`,
  (r: Rand) => `test -n ${r.pick(WORDS)}`,
  (r: Rand) => `v=${r.pick(WORDS)}`,
  () => "read q < f; echo [$q]",
  (r: Rand) => `cat <<< ${r.pick(WORDS)}`,
  () => "echo $?",
  (r: Rand) => `printf '%s|' ${r.pick(WORDS)}`,
  () => "local v=in",
  (r: Rand) => `case ${r.pick(WORDS)} in a) echo A;; *) echo other;; esac`,
] as const;

const REDIRS = ["", " > out", " >> out", " 2> err", " 2>&1", " >&2", " 2>/dev/null", " < f"] as const;

function simple(r: Rand): string {
  return r.pick(SIMPLE)(r);
}

/**
 * One statement, at most `maxDepth` deep.
 *
 * The depth cap has to exclude *every* recursive branch, not shrink the menu: the first version picked
 * from a smaller range that still contained only recursive cases, and blew the stack instead of
 * producing a script.
 */
function stmt(r: Rand, depth: number, maxDepth: number): string {
  if (depth >= maxDepth) return simple(r) + r.pick(REDIRS);
  switch (r.int(16)) {
    case 0:
      return `if ${simple(r)}; then ${stmt(r, depth + 1, maxDepth)}; else ${stmt(r, depth + 1, maxDepth)}; fi`;
    case 1:
      return `for v${depth} in 1 2; do ${stmt(r, depth + 1, maxDepth)}; done`;
    case 2:
      return `c${depth}=0; while [ $c${depth} -lt 2 ]; do c${depth}=$((c${depth}+1)); ` +
        `${stmt(r, depth + 1, maxDepth)}; done`;
    case 3:
      return `g${depth}() { ${stmt(r, depth + 1, maxDepth)}; }; g${depth}`;
    case 4:
      return `h${depth}() { local v=in; ${stmt(r, depth + 1, maxDepth)}; }; h${depth}; echo [$v]`;
    case 5:
      return `${simple(r)} | cat`;
    case 6:
      return `! ${simple(r)}; echo $?`;
    case 7:
      return `for v${depth} in 1 2 3; do ${simple(r)}; break; done`;
    case 8:
      return `until [ -f nosuchfile ]; do ${simple(r)}; break; done`;
    // **Three forms the generator could not reach**, added 2026-08-12 after the two it *could*
    // reach found two defects. A subshell is where `local` and `return` broke — through a pipeline
    // stage, because `( … )` was not in this list at all, so the shape that actually carries the
    // fault was reachable only sideways. `&&`/`||` decide whether the next command runs from a
    // status, which nothing else here generates, and `case` is a whole statement form with its own
    // parser. All three are supported and compared against bash like everything else.
    case 9:
      return `( ${stmt(r, depth + 1, maxDepth)} )`;
    case 10:
      return `${simple(r)} && ${simple(r)} || ${simple(r)}`;
    case 11:
      return `case ${r.pick(["x", "$v", "f", "\"x y\""])} in x) ${simple(r)};; ` +
        `*) ${simple(r)};; esac`;
    // **A compound as a pipeline stage**, which is where the third defect lived: `runCompound`
    // collects when it is not the last command, and a stage is never last. Case 5 pipes a *simple*
    // command, so the collecting path was only ever reached through a statement that happened to
    // sit in the middle of a list. Three stages for the same reason one level along — `runStages`
    // with more than two was reachable only from the hand-written corpus.
    case 12:
      return `${simple(r)} | cat | cat`;
    case 13:
      return `{ ${stmt(r, depth + 1, maxDepth)}; } | cat`;
    // **A redirection on a compound**, which `REDIRS` only ever reaches a *simple* command with.
    // That is the path `runCompound` places its collected streams through — and of 733 corpus
    // scripts, two put a redirection on a compound and both feed input with a heredoc, so the
    // output direction had no case anywhere. `{ … } > out`, `if … fi 2>/dev/null` and
    // `{ … } 2>&1 | cat` were each checked against bash before this was added: they agree, so what
    // this generates is coverage rather than a known difference repeated.
    case 14:
      return `{ ${stmt(r, depth + 1, maxDepth)}; }${r.pick(REDIRS)}`;
    default:
      return simple(r) + r.pick(REDIRS);
  }
}

export function script(r: Rand, maxDepth = 2): string {
  const n = 1 + r.int(2);
  const parts: string[] = [];
  for (let i = 0; i < n; i++) parts.push(stmt(r, 0, maxDepth));
  return "v=set; " + parts.join("; ");
}

/**
 * The `bash: line 1: ` a diagnostic carries, so that a message can be compared with ours.
 *
 * **The name was allowed to be preceded by any run of non-space characters.** With `^` under `m`
 * that matched *standard output* sitting on
 * the same line, because `out + err` are joined below and a `printf '%s|'` leaves no newline between
 * them. So `set|set|set|set|bash: line 1: local: …` normalised to `local: …`, bash's four printed
 * words vanished, and the fuzzer reported a disagreement in which both shells had in fact printed
 * `set|set|set|set|` and exited 0. It was the only disagreement three seeds could find, and it was
 * this regex reading bash's own output as part of its name (issue 0130).
 *
 * Two changes, either of which would have been enough, and both are worth having: only a *path* may
 * precede the name, and the two streams are joined with a newline so nothing can share a line with a
 * prefix that is not its own.
 *
 * **And the anchor is gone**, which is the other half. A diagnostic does not always start a line:
 * `printf '%s|' a >&2` leaves `a|bash: line 1: local: …` with the prefix in the middle, and `^`
 * cannot see it — so the same script disagreed for the same non-reason in the other direction. The
 * patterns are matched anywhere now, which costs the ability to tell a *message* from a script that
 * printed the same characters. That is safe here and only here: every script comes from `script()`
 * below, whose vocabulary is `a`, `b`, `c`, `x y`, digits and the fixture names, and none of them
 * can produce `sh: ` or `bash: line 1: `. Widen that vocabulary and this has to be revisited.
 */
const PREFIX = /(?:\S*\/)?(?:bash|environment|ba-c): line \d+: /g;
const normalise = (t: string) => t.replace(PREFIX, "").replace(/sh: /g, "");
/** Standard output and standard error, joined so that neither can be read as part of the other. */
const combined = (r: { out: string; err: string }) => r.out + "\n" + r.err;

export type Disagreement = {
  script: string;
  bash: string;
  ours: string;
  codes: [number, number];
  /** Set when a bound fired rather than a shell answering — see `run`. */
  hung?: string;
};

async function run(cmd: string, s: string, dir: string, held: boolean, seconds = 10) {
  const child = new Deno.Command("timeout", {
    args: [String(seconds), cmd, "-c", s],
    cwd: dir,
    // Held open and never written to is a terminal's shape, and is what 0113 needed to appear.
    stdin: held ? "piped" : "null",
    stdout: "piped",
    stderr: "piped",
    env: { LC_ALL: "C", PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin", HOME: dir },
    clearEnv: true,
  }).spawn();
  const r = await child.output();
  const d = new TextDecoder();
  // `timeout` answers 124 when it had to kill, which is a status no shell here returns for itself.
  // Kept as its own field rather than compared as an exit code: a bound that fired is not an answer,
  // and reporting it as one sent somebody hunting a regression that did not exist — a gate said
  // `bash "" (0) / ours "" (124)` for a script that finishes instantly on an idle machine.
  return { out: d.decode(r.stdout), err: d.decode(r.stderr), code: r.code, hung: r.code === 124 };
}

/**
 * Compare `count` generated scripts through `shell` against bash.
 *
 * Both stdin shapes for every script: closed, and open-but-silent. The second is the one no other
 * harness in this repo gives a shell, and the only one under which 0113 appears.
 */
export async function sweep(shell: string, seed: number, count: number, dir: string): Promise<Disagreement[]> {
  const r = new Rand(seed);
  const out: Disagreement[] = [];
  for (let i = 0; i < count; i++) {
    const s = script(r);
    for (const held of [false, true]) {
      // **The whole directory back to its starting state, not just `out` and `err`.** A script can
      // truncate a fixture — `> f` is one `REDIRS` pick away — and the next script would then be
      // measured against a world the previous one changed, which makes a difference that reproduces
      // for a reason that has nothing to do with the shell.
      await reset(dir);
      for (const f of ["out", "err"]) {
        try {
          await Deno.remove(`${dir}/${f}`);
        } catch {
          // Not there, which is the usual case.
        }
      }
      const want = await run("bash", s, dir, held);
      await reset(dir);
      for (const f of ["out", "err"]) {
        try {
          await Deno.remove(`${dir}/${f}`);
        } catch {
          // As above.
        }
      }
      const got = await run(shell, s, dir, held);
      const a = normalise(combined(want));
      const b = normalise(combined(got));
      // A bound that fired on either side is reported as itself. Comparing on through it turns a
      // loaded machine into a disagreement, which is the one thing a differential must not invent.
      if (want.hung || got.hung) {
        // **Asked again at three times the bound before it is called anything.** Ten seconds is
        // generous for a generated script and not generous at all on a machine three agents share:
        // this fired on `h0() { local v=in; … }` during a suite and a 1,500-script sweep, and the
        // same script finishes instantly by hand. A fixed wall-clock bound cannot tell a hang from
        // starvation, so it asks — the shape `harness/bounded.ts` uses for the two-host
        // differentials, and `issues/system/0128` is the argument. Once, not until green.
        const wantAgain = want.hung ? await run("bash", s, dir, held, 30) : want;
        const gotAgain = got.hung ? await run(shell, s, dir, held, 30) : got;
        const a2 = normalise(combined(wantAgain));
        const b2 = normalise(combined(gotAgain));
        if (!wantAgain.hung && !gotAgain.hung) {
          console.error(
            `fuzz: ${JSON.stringify(s)} hit the 10s bound and finished within 30s — ` +
              `the machine, not the shell`,
          );
          if (a2 !== b2 || wantAgain.code !== gotAgain.code) {
            out.push({ script: s, bash: a2, ours: b2, codes: [wantAgain.code, gotAgain.code] });
            break;
          }
          continue;
        }
        const who = wantAgain.hung && gotAgain.hung
          ? "both shells"
          : wantAgain.hung
          ? "bash"
          : "ours";
        out.push({
          script: s,
          bash: a2,
          ours: b2,
          codes: [wantAgain.code, gotAgain.code],
          hung: `${who} did not finish in 10s, and did not finish in 30s asked again — a bound ` +
            `fired twice, so there is no answer here to compare`,
        });
      } else if (a !== b || want.code !== got.code) {
        out.push({ script: s, bash: a, ours: b, codes: [want.code, got.code] });
        break;
      }
    }
  }
  return out;
}

/** The fixtures a generated script may name, in a directory of its own. */
export async function fixtures(dir: string): Promise<void> {
  await reset(dir);
}

/** Every fixture back to its starting contents, and everything a script may have made removed. */
async function reset(dir: string): Promise<void> {
  await Deno.writeTextFile(`${dir}/f`, "a\nb\nc\n");
  await Deno.writeTextFile(`${dir}/n`, "3\n1\n2\n");
  for await (const e of Deno.readDir(dir)) {
    if (e.name !== "f" && e.name !== "n") {
      await Deno.remove(`${dir}/${e.name}`, { recursive: true }).catch(() => {});
    }
  }
}

if (import.meta.main) {
  const shell = flag("shell", "");
  if (shell === "") {
    console.error("usage: deno task shell:fuzz -- --shell <binary> [--count N] [--seed S] [--verbose]");
    console.error("  build one: deno task app:build packages/box/src/bin/sh.wac -o /tmp/boxsh \\");
    console.error("             --allow-read --allow-write --allow-env");
    Deno.exit(2);
  }
  const count = Number(flag("count", "200"));
  const seed = Number(flag("seed", "1"));
  const verbose = args.includes("--verbose");

  const dir = await Deno.makeTempDir({ prefix: "shell-fuzz-" });
  await fixtures(dir);
  // **The canary.** Every result below is "these two agree", which a harness that ran neither would
  // also report. Two scripts that must differ prove the comparison is live.
  const one = await run(shell, "echo one", dir, false);
  const two = await run(shell, "echo two", dir, false);
  if (one.out === two.out || one.out === "") {
    console.error(`${shell} did not answer \`echo one\`: it said ${JSON.stringify(one.out)}`);
    Deno.exit(2);
  }

  const bad = await sweep(shell, seed, count, dir);
  await Deno.remove(dir, { recursive: true });
  console.log(`${count - bad.length} of ${count} scripts agree with bash (seed ${seed})`);
  for (const d of bad.slice(0, verbose ? bad.length : 8)) {
    console.log(`\nSCRIPT ${d.script}\n  bash ${JSON.stringify(d.bash)} (${d.codes[0]})`);
    console.log(`  ours ${JSON.stringify(d.ours)} (${d.codes[1]})`);
    // **The reason, when there is one.** `sweep` recorded "a bound fired, so there is no answer
    // here to compare" and this printed the two answers without it, so a reader saw a difference
    // and went hunting — the exact thing the field was added to prevent.
    if (d.hung !== undefined) console.log(`  ${d.hung}`);
  }
  Deno.exit(bad.length === 0 ? 0 : 1);
}
