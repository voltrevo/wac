// wac-L3, driven under Deno. See `ts/l2.ts`.

import { boot } from "../hosts/deno.js";

export async function l3Compiler(): Promise<WebAssembly.Module> {
  return await (await boot()).l3Compiler();
}

export async function l3ToL0(program: string): Promise<string> {
  return await (await boot()).l3ToL0(program);
}

export async function l3Run(program: string, entry = "main"): Promise<number> {
  return await (await boot()).l3Run(program, entry);
}
