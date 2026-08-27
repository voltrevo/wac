// wac-L4, driven under Deno. See `ts/l2.ts`.

import { boot } from "../hosts/deno.js";

export async function l4Compiler(): Promise<WebAssembly.Module> {
  return await (await boot()).l4Compiler();
}

export async function l4ToL0(program: string): Promise<string> {
  return await (await boot()).l4ToL0(program);
}

export async function l4Run(program: string, entry = "main"): Promise<number> {
  return await (await boot()).l4Run(program, entry);
}
