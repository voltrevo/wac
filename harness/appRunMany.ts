// Run one built program many times in **one** Deno process, on lines from standard input.
//
// ## What this is for
//
// The two-host tests run a script through three implementations and compare the answers, and the
// JavaScript one costs a process start each time: **133ms for a built bundle against 17ms for
// `wacland` and 2ms for bash**, measured 2026-08-19. `packages/platform/test/wac/native_hostfs_test.wac`
// makes about a hundred of those runs and is 17s; its two siblings are 9.3s and 11s. That is the
// largest single item in the `wac test` lane, and all of it is Deno starting.
//
// `harness/appRun.ts` already solves this *from TypeScript*: `appRunner` builds the program's worker
// half once and runs it in a worker, ~1ms a run, which is what took `native_hostfs.test.ts` from 29s
// to 9.4s while it was still TypeScript. A wac test cannot call it — it is a Deno module, and a wac
// test's only way out is `Cli.exec`. So this is that harness behind one `exec`: the wac side sends a
// batch of runs and reads a batch of answers, which is exactly the shape `wactest/src/oracle.wac`
// already speaks.
//
// ## The protocol
//
//     deno run -A harness/appRunMany.ts <entry.wac> [--allow-…]
//
// One request per line of standard input, and one answer per line of standard output, in the same
// order — **hex, not JSON**, because the caller is a wac test and both sides already have hex:
// `wactest/src/oracle.wac`'s `hex` writes it and `codec/src/hex.wac`'s `decoded` reads it. JSON would
// mean an encoder on the wac side that does not exist and escaping rules on both.
//
//     run <argv> <cwd> <stdin> <env>   argv and env are joined by NUL, every field hex
//     ran <code> <stdout> <stderr>     code in decimal, the two streams hex
//
// `env` is `K=V` pairs joined by NUL. Given, the program sees exactly those and nothing else — which
// is what a differential wants: `LC_ALL=C`, a known `PATH`, and no inheritance from whatever started
// the suite. Empty means the grant decides, as `appRun.ts` documents.
//
// A field that is empty is the empty string, which hex writes as nothing — so `run 2d63...  ` is a
// run with no cwd and no input. The last line is `DONE <n>`, because a reader has to be able to tell
// "answered everything" from "died half way", and it is the line `wactest`'s oracles already look for.
//
// ## What it is not
//
// It is not a sandbox and it is not a second implementation of anything. Each run is
// `appRunner(...).run(...)`: the same built program, the same capability implementations, the same
// grants. What changes is that the process starts once.
//
// ## What it costs, measured
//
//     50 runs as 50 processes                9 736ms      195ms each
//     50 runs through here (cold build)      2 582ms
//     200 runs through here (warm)             776ms
//     0 runs through here (the fixed cost)     526ms      so ~1.25ms a run
//
// The fixed half is Deno starting and the worker half of the program being read from the build cache.
// Past a handful of runs it is not close: a hundred runs is 20 seconds of process starts against
// about two-thirds of a second here.

import { appRunner } from "./appRun.ts";
import { type Grants } from "../packages/platform/build.ts";

const args = [...Deno.args];
const entry = args.shift();
if (entry === undefined) {
  console.error("usage: appRunMany.ts <entry.wac> [--allow-read] [--allow-write] [--allow-net] [--allow-env] [--allow-run]");
  Deno.exit(2);
}

const grants: Grants = {};
for (const a of args) {
  if (a === "--allow-read") grants.read = true;
  else if (a === "--allow-write") grants.write = true;
  else if (a === "--allow-net") grants.net = true;
  else if (a === "--allow-env") grants.env = true;
  else if (a === "--allow-run") grants.run = true;
  else {
    console.error(`appRunMany: unknown flag ${a}`);
    Deno.exit(2);
  }
}

const runner = await appRunner(entry, grants);

const dec = new TextDecoder();
const enc = new TextEncoder();

/** The bytes a hex field stands for. An empty field is no bytes. */
function unhex(field: string): Uint8Array {
  const out = new Uint8Array(field.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(field.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

const text = dec.decode(await new Response(Deno.stdin.readable).arrayBuffer());
const lines = text.split("\n").filter((l) => l.trim().length > 0);

const out: string[] = [];
let answered = 0;
for (const line of lines) {
  const [word, argvHex = "", cwdHex = "", stdinHex = "", envHex = ""] = line.split(" ");
  if (word !== "run") {
    // An unknown request is this harness's fault or the caller's, and either way the run it stands
    // for did not happen — so it is an answer saying so rather than a gap in the sequence.
    out.push(`ran -1  ${hex(enc.encode(`appRunMany: not a request: ${line}`))}`);
    answered++;
    continue;
  }
  const joined = dec.decode(unhex(argvHex));
  const argv = joined.length === 0 ? [] : joined.split("\u0000");
  const cwd = dec.decode(unhex(cwdHex));
  const pairs = dec.decode(unhex(envHex));
  const env: Record<string, string> = {};
  for (const kv of pairs.length === 0 ? [] : pairs.split("\u0000")) {
    const at = kv.indexOf("=");
    if (at > 0) env[kv.slice(0, at)] = kv.slice(at + 1);
  }
  const r = await runner.run(argv, {
    cwd: cwd.length === 0 ? undefined : cwd,
    stdin: unhex(stdinHex),
    env: pairs.length === 0 ? undefined : env,
  });
  out.push(`ran ${r.code} ${hex(enc.encode(r.out))} ${hex(enc.encode(r.err))}`);
  answered++;
}

console.log(out.join("\n"));
console.log(`DONE ${answered}`);

// **Exit rather than return.** `appRunner` keeps a worker, and a live worker keeps Deno's event loop
// alive — without this the process prints every answer and then hangs, which reads to a caller as a
// program that never finished rather than one that finished and would not leave.
Deno.exit(0);
