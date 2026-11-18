// Node entry: `node stmt-js-node.mjs BASE viem|ethers [REPEAT]`.
import { run } from './stmt-js.mjs';
const [base, lib, repeat] = process.argv.slice(2);
const { recover } = await import(`./stmt-${lib}.mjs`);
await run(base, recover, Number(repeat || 10));
