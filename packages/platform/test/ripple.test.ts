// The ripple tank's solver stays bounded, and actually propagates.
//
//     deno test -A packages/platform/test/ripple.test.ts
//
// `example/ripple.wac` is a toy and says so, but its arithmetic is not arbitrary: the wave equation
// discretised with c² = 1/2 sits *at* the stability limit for a five-point Laplacian, and a scheme
// past that limit looks right for a second and then explodes into checkerboard. That failure is
// invisible in a screenshot and obvious in a number, which is what this checks.
//
// Two properties, because either alone can be satisfied by something wrong:
//
//   - **it decays.** A peak that grows is an unstable scheme. Damping is what makes it look like
//     water rather than noise, and it is the term most likely to be "tidied" by someone later.
//   - **it spreads.** A grid that decays to nothing without ever touching more cells is not a wave,
//     it is a dot fading out — which is exactly what a wrong Laplacian sign produces, and it passes
//     the decay check on its own.

import { wacBind } from "../../../harness/wacBind.ts";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

const m = await wacBind("packages/platform/test/wac/rippleprobe.wac") as {
  maxAfter: (steps: number) => number;
  spreadAfter: (steps: number) => number;
};

Deno.test("the wave decays rather than growing — the scheme is stable", () => {
  const peaks = [1, 10, 50, 200].map((n) => m.maxAfter(n));
  for (let i = 1; i < peaks.length; i++) {
    assert(
      peaks[i] < peaks[i - 1],
      `the peak grew between samples, so the scheme is unstable: ${peaks.join(" → ")}`,
    );
  }
  assert(peaks[0] > 0, "the splash left no height at all, so nothing was simulated");
});

Deno.test("the wave propagates — it is not a dot fading out", () => {
  const near = m.spreadAfter(10);
  const far = m.spreadAfter(200);
  assert(near > 25, `after ten steps only ${near} cells are moving, which is barely the splash itself`);
  assert(
    far > near * 10,
    `the disturbance reached ${far} cells after 200 steps against ${near} after ten — ` +
      `it is decaying in place rather than spreading`,
  );
});
