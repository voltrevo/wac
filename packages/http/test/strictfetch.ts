#!/usr/bin/env -S deno run -A
// `fetch` against a URL, for the diagonal that tests our response *writer*.
//
// **This is the oracle, not the test.** `fetch` rejects a malformed response outright rather than
// coping, which is the whole reason it is here: a writer that emits something almost-right passes
// every parser written to read it and fails this. It stays TypeScript because `fetch` is the thing
// under comparison, and a wac client reading our own writer would be the round trip this file exists
// to avoid.
//
// What crosses the boundary is the status and the body, as text. Whether either is right is the wac
// side's business.
//
//   strictfetch.ts <url>   ->   {"status":200,"body":"…"}  or  {"error":"…"}

try {
  const res = await fetch(Deno.args[0]);
  const body = await res.text();
  console.log(JSON.stringify({ status: res.status, body }));
} catch (e) {
  console.log(JSON.stringify({ error: String(e).split("\n")[0] }));
}
