#!/usr/bin/env -S deno run -A
// Deno's `fetch`, behind a command line.
//
// **One half of a differential, not a harness.** The claim `packages/server` makes is that its
// answers survive contact with software that was not written to agree with them, and `fetch` is the
// strictest client available here — it rejects a malformed response outright rather than doing its
// best with it. So it stays TypeScript: it is the thing doing the judging.
//
//   fetchclient.ts <base> get <path>...        one line per path: <status> <tab> <body>
//   fetchclient.ts <base> post <path> <body>   the same, for one POST
//   fetchclient.ts <base> time                 GET /time, and print how far out its clock is
//
// `time` is here rather than in the caller because the claim is that the reported time is *a time,
// parsed back by the platform rather than by us* — so the parse has to happen where a platform is,
// and what crosses back is the skew in milliseconds. A reply the platform cannot parse exits 1.
//
// A request that throws prints `ERR <tab> <message>` on that path's line, because a client refusing
// a response *is* the answer the caller wants to see.

const [base, mode, ...rest] = Deno.args;

const line = (status: string, body: string) =>
  `${status}\t${body.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll("\t", "\\t")}\n`;

const out: string[] = [];
if (mode === "get") {
  for (const path of rest) {
    try {
      const res = await fetch(base + path);
      out.push(line(String(res.status), await res.text()));
    } catch (e) {
      out.push(line("ERR", e instanceof Error ? e.message : String(e)));
    }
  }
} else if (mode === "post") {
  const [path, body] = rest;
  try {
    const res = await fetch(base + path, { method: "POST", body });
    out.push(line(String(res.status), await res.text()));
  } catch (e) {
    out.push(line("ERR", e instanceof Error ? e.message : String(e)));
  }
} else if (mode === "time") {
  const res = await fetch(base + "/time");
  const body = await res.text();
  let now: unknown;
  try {
    now = (JSON.parse(body) as { now: string }).now;
  } catch {
    console.error(`/time did not answer JSON: ${body}`);
    Deno.exit(1);
  }
  const parsed = Date.parse(String(now));
  if (Number.isNaN(parsed)) {
    console.error(`/time returned ${String(now)}, which is not a time`);
    Deno.exit(1);
  }
  out.push(`${Math.abs(parsed - Date.now())}\n`);
} else {
  console.error("usage: fetchclient.ts <base> get <path>...");
  console.error("       fetchclient.ts <base> post <path> <body>");
  console.error("       fetchclient.ts <base> time");
  Deno.exit(2);
}
await Deno.stdout.write(new TextEncoder().encode(out.join("")));
