// A puzzle whose solution is a wac program: write `solve`, and the robot walks what you returned.
//
// The level is a maze as text — `#` wall, `.` floor, `S` start, `G` goal — and the player writes a
// function that takes it and returns a route as a string of `U`, `D`, `L`, `R`. The page compiles it
// with the compiler already bundled here, runs it in a worker with a timeout, then *validates the
// route against the maze* and animates the robot following it.
//
// ## Why the whole route rather than one step at a time
//
// A sensing robot — call the function once per step, hand it what it can see — is the more obvious
// design and it is worse here. It needs one worker round trip per step, so a hundred-step maze is a
// hundred compiles-or-calls and the animation becomes a progress bar. Returning the route means one
// call, and it makes the puzzle a real algorithmic one: you cannot hardcode a path you have not been
// shown, because the maze arrives as an argument.
//
// ## What checks the answer
//
// Not "did it return something" — the walk is replayed against the maze here, in TypeScript, and a
// route that steps into a wall or leaves the grid fails with the step that did it. That matters
// because the interesting wrong answers are the ones that look plausible: an off-by-one in a bounds
// check produces a route that is *almost* right, and a validator that only checked the final square
// would pass a robot that walked through a wall to get there.

import { useState } from "react";
import { runFunction } from "./wac-compile";
import WacEditor from "./WacEditor";

/**
 * `#` wall, `.` floor, `S` start, `G` goal.
 *
 * **Three of them, and only the first is on screen.** One visible maze makes the puzzle
 * `return "DDDDRRRRRRD";` — the player can read the answer off the picture. Running the same `solve`
 * against mazes it has not seen is what makes it an algorithm rather than a transcription, and it is
 * the whole reason the maze is a parameter instead of a constant.
 *
 * Each was checked solvable before being used here: 11, 20 and 30 steps. The second one I wrote by
 * hand had no route at all, which a player would have experienced as their correct program failing.
 */
const LEVELS = [
  ["#########", "#S..#...#", "#.#.#.#.#", "#.#...#.#", "#.#####.#", "#.......#", "#####.#G#", "#.....#.#", "#########"],
  ["#########", "#S#.....#", "#.#.###.#", "#.#.#...#", "#.#.#.#.#", "#...#.#.#", "#.###.#.#", "#.....#G#", "#########"],
  ["#########", "#S....#G#", "#####.#.#", "#...#.#.#", "#.#.#.#.#", "#.#...#.#", "#.#####.#", "#.......#", "#########"],
].map((rows) => rows.join("\n"));
const LEVEL = LEVELS[0];

const START = `// Write \`solve\`. It is handed a maze and returns the route as a
// string of U, D, L and R — one letter per step.
//
// The maze is rows separated by newlines: '#' wall, '.' floor,
// 'S' where you start, 'G' where you must end up.
//
// It is run against THREE mazes and only one is on screen, so
// returning the route you can see gets you one out of three.
// A breadth-first search over the grid gets all three; \`Vec\` from
// packages/std is the queue.
//
// This one walks straight into a wall. Fix it.

export string solve(string maze) {
  return "RRRR";
}
`;

type Result =
  | { kind: "idle" }
  | { kind: "running" }
  | { kind: "failed"; why: string }
  | { kind: "walked"; path: [number, number][]; ok: boolean; why: string; steps: number; passed: number };

function parse(level: string): { grid: string[][]; sx: number; sy: number; gx: number; gy: number } {
  const grid = level.split("\n").map((r) => [...r]);
  let sx = 0, sy = 0, gx = 0, gy = 0;
  grid.forEach((row, y) =>
    row.forEach((c, x) => {
      if (c === "S") { sx = x; sy = y; }
      if (c === "G") { gx = x; gy = y; }
    })
  );
  return { grid, sx, sy, gx, gy };
}

/** Replay the route against the maze. The failure message names the step, not just the outcome. */
function walk(route: string, level: string): { path: [number, number][]; ok: boolean; why: string } {
  const { grid, sx, sy, gx, gy } = parse(level);
  let x = sx, y = sy;
  const path: [number, number][] = [[x, y]];
  const moves: Record<string, [number, number]> = { U: [0, -1], D: [0, 1], L: [-1, 0], R: [1, 0] };
  for (let i = 0; i < route.length; i++) {
    const step = moves[route[i]];
    if (step === undefined) {
      return { path, ok: false, why: `step ${i + 1}: ${JSON.stringify(route[i])} is not one of U, D, L, R` };
    }
    x += step[0];
    y += step[1];
    if (y < 0 || y >= grid.length || x < 0 || x >= grid[y].length) {
      return { path, ok: false, why: `step ${i + 1} walked off the grid` };
    }
    if (grid[y][x] === "#") {
      return { path, ok: false, why: `step ${i + 1} walked into a wall at ${x},${y}` };
    }
    path.push([x, y]);
  }
  if (x !== gx || y !== gy) {
    return { path, ok: false, why: `the route ends at ${x},${y} and the goal is at ${gx},${gy}` };
  }
  return { path, ok: true, why: "" };
}

export default function Maze() {
  const [code, setCode] = useState(START);
  const [result, setResult] = useState<Result>({ kind: "idle" });
  const [at, setAt] = useState(0);

  async function run() {
    setResult({ kind: "running" });
    setAt(0);
    const files = { "maze.wac": code };
    // Every level, same `solve`. The first is the one on screen; the others are why a hardcoded
    // route does not count as an answer.
    let passed = 0;
    let firstFailure = "";
    let shown: { path: [number, number][]; ok: boolean; why: string } | null = null;
    for (let i = 0; i < LEVELS.length; i++) {
      const r = await runFunction(files, "maze.wac", "solve", [LEVELS[i]]);
      if (!r.success) {
        setResult({ kind: "failed", why: r.output });
        return;
      }
      // The runner hands back the value as text; a returned string arrives quoted.
      const route = r.output.trim().replace(/^"|"$/g, "");
      const outcome = walk(route, LEVELS[i]);
      if (i === 0) { shown = { ...outcome }; }
      if (outcome.ok) { passed++; }
      else if (firstFailure === "") { firstFailure = `maze ${i + 1}: ${outcome.why}`; }
    }
    const first = shown!;
    const path = first.path;
    setResult({
      kind: "walked",
      path,
      ok: passed === LEVELS.length,
      why: firstFailure,
      steps: path.length - 1,
      passed,
    });
    // Animate by advancing an index — one `setTimeout` chain rather than a frame loop, because the
    // interesting thing is the sequence of squares and not smooth motion between them.
    for (let i = 0; i <= path.length; i++) {
      setTimeout(() => setAt(i), i * 90);
    }
  }

  const { grid } = parse(LEVEL);
  const walked = result.kind === "walked" ? result.path.slice(0, at) : [];
  const here = walked.length > 0 ? walked[walked.length - 1] : null;
  const seen = new Set(walked.map(([x, y]) => `${x},${y}`));

  return (
    <div style={{ margin: "1.2rem 0 0" }}>
      <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", alignItems: "flex-start" }}>
        <div style={{ flex: "1 1 22rem", minWidth: "18rem" }}>
          <WacEditor value={code} onChange={setCode} files={{ "maze.wac": code }} fileName="maze.wac" />
        </div>
        <div>
          <pre
            style={{
              font: "16px/1.15 ui-monospace, monospace",
              padding: ".7rem",
              borderRadius: 6,
              margin: 0,
            }}
          >
            {grid.map((row, y) => (
              <div key={y}>
                {row.map((c, x) => {
                  const isHere = here !== null && here[0] === x && here[1] === y;
                  const been = seen.has(`${x},${y}`);
                  const ch = isHere ? "@" : c === "S" || c === "." ? (been ? "·" : " ") : c;
                  return (
                    <span key={x} style={{ opacity: c === "#" ? 0.55 : 1, fontWeight: isHere ? 700 : 400 }}>
                      {ch === "." ? " " : ch}
                    </span>
                  );
                })}
              </div>
            ))}
          </pre>
        </div>
      </div>

      <div style={{ marginTop: ".8rem", display: "flex", gap: ".7rem", alignItems: "center" }}>
        <button
          onClick={run}
          disabled={result.kind === "running"}
          style={{ font: "inherit", fontSize: ".9rem", padding: ".35rem .9rem", borderRadius: 5 }}
        >
          {result.kind === "running" ? "compiling…" : "compile and walk"}
        </button>
        {result.kind === "walked" && (
          <span style={{ fontSize: ".9rem" }}>
            {result.ok
              ? `all ${LEVELS.length} mazes solved`
              : `${result.passed} of ${LEVELS.length} — ${result.why}`}
          </span>
        )}
      </div>

      {result.kind === "failed" && (
        <pre style={{ marginTop: ".6rem", padding: ".7rem", borderRadius: 6, fontSize: 12.5, overflowX: "auto" }}>
          {result.why}
        </pre>
      )}
    </div>
  );
}
