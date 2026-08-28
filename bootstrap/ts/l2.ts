// wac-L2, driven under Deno. The work is in `bootstrap/js/ladder.js`; this only says where the sources come
// from — see `bootstrap/hosts/deno.js`, which is the same seam without a TypeScript wrapper around it.

import { boot } from "../hosts/deno.js";

export async function l1Text(source: string): Promise<string> {
  return await (await boot()).l1Text(source);
}

export async function l2ToL0(program: string): Promise<string> {
  return await (await boot()).l2ToL0(program);
}

export async function l2Run(program: string): Promise<number> {
  return await (await boot()).l2Run(program);
}
