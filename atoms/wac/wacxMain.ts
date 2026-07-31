// The wacx entry point: the only place in the CLI that touches Deno.
//
// `wacx` itself takes every capability as a parameter, so it can be tested without a filesystem or
// a process. This file supplies the real ones and turns the returned code into an exit.

import { wacx, type WacxCap } from "./wacx.ts";

const cap: WacxCap = {
  readFile: (path) => Deno.readTextFile(path),
  writeFile: (path, data) =>
    typeof data === "string" ? Deno.writeTextFile(path, data) : Deno.writeFile(path, data),
  out: (text) => console.log(text),
  err: (text) => console.error(text),
};

const { code } = await wacx(Deno.args, cap);
Deno.exit(code);
