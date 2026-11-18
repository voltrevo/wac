// Node entry: `node mpt-ethereumjs-node.mjs BASE [REPEAT]`.
import { run } from './mpt-ethereumjs.mjs';
const [base, repeat] = process.argv.slice(2);
await run(base, Number(repeat || 200));
