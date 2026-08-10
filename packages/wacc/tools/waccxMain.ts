// The `waccx` entry point: the only place in this CLI that touches Deno.
//
// The same shape as `wacxMain.ts`, for the same reason — `waccx` takes every capability as a
// parameter, so `waccx.test.ts` runs it over an in-memory filesystem with no process involved.

import { waccx } from "./waccx.ts";
import type { WacxCap } from "wac/wacx.ts";

const cap: WacxCap = {
  readFile: (path) => Deno.readTextFile(path),
  writeFile: (path, data) =>
    typeof data === "string" ? Deno.writeTextFile(path, data) : Deno.writeFile(path, data),
  chmod: (path, mode) => Deno.chmod(path, mode),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

const { code } = await waccx(Deno.args, cap);
Deno.exit(code);
