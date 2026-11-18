// Node entry for lc-lodestar.mjs: `node lc-lodestar-node.mjs BASE CHECKPOINT NOW [REPEAT] [finalized]`.
import { run } from './lc-lodestar.mjs';
const [base, checkpoint, now, repeat, mode] = process.argv.slice(2);
await run(base, checkpoint, Number(now), Number(repeat || 1), console.log, mode === 'finalized');
