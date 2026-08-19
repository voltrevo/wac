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
// One request per line of standard input, as JSON:
//
//     {"argv":["-c","echo hi"],"cwd":"/tmp/x","stdin":"","env":{"LC_ALL":"C"}}
//
// One answer per line of standard output, in the same order:
//
//     {"code":0,"out":"hi\n","err":""}
//
// and `DONE <n>` at the end, because a reader has to be able to tell "answered everything" from
// "died half way" — the same last line `wactest`'s oracles use.
//
// **Output is text.** A program whose output is not UTF-8 is not what these tests compare; the byte
// form stays inside `appRun.ts` for callers that need it.
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

type Request = {
  argv?: string[];
  cwd?: string;
  stdin?: string;
  env?: Record<string, string>;
};

const runner = await appRunner(entry, grants);

const text = new TextDecoder().decode(await new Response(Deno.stdin.readable).arrayBuffer());
const lines = text.split("\n").filter((l) => l.trim().length > 0);

let answered = 0;
const out: string[] = [];
for (const line of lines) {
  let request: Request;
  try {
    request = JSON.parse(line) as Request;
  } catch (e) {
    // A malformed request is this harness's fault or the caller's, and either way the run it stands
    // for did not happen — so it is an answer that says so rather than a silent gap in the sequence.
    out.push(JSON.stringify({ code: -1, out: "", err: `appRunMany: ${e instanceof Error ? e.message : e}` }));
    answered++;
    continue;
  }
  const r = await runner.run(request.argv ?? [], {
    cwd: request.cwd,
    stdin: request.stdin,
    env: request.env,
  });
  out.push(JSON.stringify({ code: r.code, out: r.out, err: r.err }));
  answered++;
}

console.log(out.join("\n"));
console.log(`DONE ${answered}`);

// **Exit rather than return.** `appRunner` keeps a worker, and a live worker keeps Deno's event loop
// alive — without this the process prints every answer and then hangs, which reads to a caller as a
// program that never finished rather than one that finished and would not leave.
Deno.exit(0);
