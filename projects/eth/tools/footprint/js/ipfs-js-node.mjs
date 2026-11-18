// Node entry: `node ipfs-js-node.mjs BASE [REPEAT] [platform|noble]`.
import { run } from './ipfs-js.mjs';
const [base, repeat, hash] = process.argv.slice(2);
await run(base, Number(repeat || 5), console.log, hash || 'platform');
