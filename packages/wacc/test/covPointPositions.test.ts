// **A coverage point at a position no construct has is a decision nobody measures.**
//
// `harness/wacCoverage.ts` merges points on `(file, line, col, kind)`, and `covTableRow` derives the
// *file* from the point's line in the linked blob. So a point given a floored or zeroed position lands
// at the entry module's first line, every point like it lands there too, and covering any one of them
// covers all — a collapse that always reads in the flattering direction. `issues/lang/0148`.
//
// Two of each construct, because one is indistinguishable from correct: with a single arm or a single
// loop the collapse has nothing to collapse into, which is why both of these survived. In an
// *imported* file, because the entry here contains neither construct — a point attributed to it is
// then visibly wrong rather than merely misplaced.
//
//   - `else:` had no token to take a position from. The parser left `variantTok` at -1 (its "this is
//     the else arm" sentinel), the emitter asked for that token's line and column, and both accessors
//     floor a negative index to 1. `Arm` keeps the `else` keyword's token now.
//   - `for (;;)` has no condition to take a position from, and the emitter asked for `0:0`. `emitLoop`
//     takes the statement's own position for that case.
//   - `do { … } while (c)` had no point at all, which the reference emits — found while checking the
//     first two, and the reason the last test here counts kinds against the reference rather than
//     asserting a number of its own.

import { instrument } from "../../../harness/wacCoverage.ts";

type Point = { file: string; line: number; col: number; kind: string; index: number };

async function withFixture<T>(
  lib: string,
  entry: string,
  f: (points: Point[], dir: string) => Promise<T> | T,
): Promise<T> {
  const dir = await Deno.makeTempDir({ dir: ".", prefix: "wac-covpos-" });
  try {
    await Deno.writeTextFile(`${dir}/lib.wac`, lib);
    await Deno.writeTextFile(`${dir}/entry.wac`, entry);
    const r = await instrument(`${dir}/entry.wac`);
    return await f(r.points as Point[], dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

/** Every point, as the string a failure should show. */
const shown = (ps: Point[]) =>
  ps.map((p) => `${p.file}:${p.line}:${p.col} ${p.kind}`).join("\n  ") || "(none)";

function assertDistinct(points: Point[]): void {
  const keys = new Set(points.map((p) => `${p.file}:${p.line}:${p.col}:${p.kind}`));
  if (keys.size !== points.length) {
    throw new Error(
      `${points.length} points share ${keys.size} keys, so ${points.length - keys.size} ` +
        `decision(s) cannot be told apart:\n  ${shown(points)}`,
    );
  }
}

const ELSE_LIB = `export enum E { A, B }

export i32 pick(E e) {
  match (e) {
    case A: { return 1; }
    else: { return 2; }
  }
}

export i32 other(E e) {
  match (e) {
    case A: { return 10; }
    else: { return 20; }
  }
}
`;

const ELSE_ENTRY = `import { E, other, pick } from "./lib.wac";

export i32 go(bool useA) {
  E e = E.B;
  if (useA) { e = E.A; }
  return pick(e) + other(e);
}
`;

Deno.test("coverage: each else arm is its own point, in its own file, at its own line", async () => {
  await withFixture(ELSE_LIB, ELSE_ENTRY, (points) => {
    const atOrigin = points.filter((p) => p.line <= 1 && p.col <= 1);
    if (atOrigin.length !== 0) {
      throw new Error(`point(s) at a position no construct has:\n  ${shown(atOrigin)}`);
    }
    // The two `else:` keywords are lines 6 and 13 of `lib.wac`.
    const lines = points.filter((p) => p.file.endsWith("lib.wac")).map((p) => p.line);
    if (!lines.includes(6) || !lines.includes(13)) {
      throw new Error(`the else arms are lines 6 and 13 of lib.wac; points are:\n  ${shown(points)}`);
    }
    assertDistinct(points);
  });
});

const LOOP_LIB = `export i32 spin(i32 n) {
  i32 k = 0;
  for (;;) {
    k = k + 1;
    if (k >= n) { break; }
  }
  return k;
}

export i32 other(i32 n) {
  i32 k = 0;
  for (;;) {
    k = k + 2;
    if (k >= n) { break; }
  }
  return k;
}
`;

const LOOP_ENTRY = `import { other, spin } from "./lib.wac";

export i32 go(i32 n) {
  return spin(n) + other(n);
}
`;

Deno.test("coverage: a loop with no condition is placed at the loop, not at 0:0", async () => {
  await withFixture(LOOP_LIB, LOOP_ENTRY, (points) => {
    const loops = points.filter((p) => p.kind === "loop");
    if (loops.length !== 2) {
      throw new Error(`two conditionless loops, ${loops.length} loop point(s):\n  ${shown(points)}`);
    }
    for (const p of loops) {
      if (p.line === 0 || p.col === 0 || !p.file.endsWith("lib.wac")) {
        throw new Error(`a loop point outside the file that holds the loop:\n  ${shown(loops)}`);
      }
    }
    assertDistinct(points);
  });
});

const KINDS_LIB = `export i32 spinDo(i32 n) {
  i32 k = 0;
  do { k = k + 1; } while (k < n);
  return k;
}

export i32 spinWhile(i32 n) {
  i32 k = 0;
  while (k < n) { k = k + 1; }
  return k;
}

export i32 spinFor(i32 n) {
  i32 k = 0;
  for (;;) {
    k = k + 1;
    if (k >= n) { break; }
  }
  return k;
}
`;

const KINDS_ENTRY = `import { spinDo, spinFor, spinWhile } from "./lib.wac";

export i32 go(i32 n) {
  return spinDo(n) + spinWhile(n) + spinFor(n);
}
`;

Deno.test("coverage: wacc counts as many loops as the reference does", async () => {
  // **A kind-set comparison cannot see this and a count can.** `issues/lang/0112` asked for a test
  // asserting the two compilers emit the same *kinds*; wacc emitted no point for a `do` body, and any
  // `while` in the same file supplies the `loop` kind — so the set matched while a construct went
  // unmeasured. `else` and `entry` counts differ on purpose (0112 records why), so this compares the
  // kinds where a difference is a defect.
  const dir = await Deno.makeTempDir({ dir: ".", prefix: "wac-covkinds-" });
  const before = Deno.env.get("WAC_COV_FROM");
  try {
    await Deno.writeTextFile(`${dir}/lib.wac`, KINDS_LIB);
    await Deno.writeTextFile(`${dir}/entry.wac`, KINDS_ENTRY);
    const count = (ps: Point[], kind: string) => ps.filter((p) => p.kind === kind).length;

    Deno.env.delete("WAC_COV_FROM");
    const mine = (await instrument(`${dir}/entry.wac`)).points as Point[];
    Deno.env.set("WAC_COV_FROM", "reference");
    const theirs = (await instrument(`${dir}/entry.wac`)).points as Point[];

    for (const kind of ["loop", "case"]) {
      if (count(mine, kind) !== count(theirs, kind)) {
        throw new Error(
          `wacc emits ${count(mine, kind)} ${kind} point(s) and the reference ${count(theirs, kind)} ` +
            `— a construct one of them measures and the other does not.\n  wacc:\n  ${shown(mine)}` +
            `\n  reference:\n  ${shown(theirs)}`,
        );
      }
    }
  } finally {
    if (before === undefined) Deno.env.delete("WAC_COV_FROM");
    else Deno.env.set("WAC_COV_FROM", before);
    await Deno.remove(dir, { recursive: true });
  }
});
