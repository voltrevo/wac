// Node entry for lc-helios.mjs: `node lc-helios-node.mjs BASE CHECKPOINT CLOCK-MS`. The clock is pinned by moving
// Date.now (which the wasm reads through js-sys) to CLOCK-MS plus the time elapsed since start.
const [base, checkpoint, clock] = process.argv.slice(2);
const realNow = Date.now.bind(Date);
const start = realNow();
Date.now = () => Number(clock) + (realNow() - start);
const { run } = await import('./lc-helios.mjs');
await run(base, checkpoint);
process.exit(0);
