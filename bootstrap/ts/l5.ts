// wac-L5, driven under Deno. See `ts/l2.ts`.
//
// `flatten` is here rather than in the portable core's shape because the core takes a filesystem
// as two methods and this supplies Deno's — the whole point of the split.

import { boot, files } from "../hosts/deno.js";
import { flatten as flattenWith } from "../js/flatten.js";

export async function l5Compiler(): Promise<WebAssembly.Module> {
  return await (await boot()).l5Compiler();
}

export async function flatten(entry: string): Promise<string> {
  return await flattenWith(entry, files);
}

export async function l5ToL0(program: string): Promise<string> {
  return await (await boot()).l5ToL0(program);
}

export async function l5Run(program: string, entry = "main"): Promise<number> {
  return await (await boot()).l5Run(program, entry);
}

export async function l5RunFile(entry: string, fn = "main"): Promise<number> {
  return await l5Run(await flatten(entry), fn);
}
