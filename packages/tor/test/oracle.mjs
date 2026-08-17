// The parts of the Tor tests only something outside this repository can answer.
//
// Batched: read every line, answer, then `DONE <n>`. A run that stopped halfway is otherwise
// indistinguishable from one that agreed with everything.
//
//   descdigest                     →  `descdigest <hex>`
//
// `descdigest` is the SHA-1 an `r` line carries: over the span the descriptor's RSA signature
// covers, which ends after `router-signature\n` rather than at the end of the document. The span is
// found here rather than passed in, because the span is the thing being checked — asking wac where
// its own signature ended would make the comparison agree with itself.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const here = new URL(".", import.meta.url).pathname;

const json = (name) => JSON.parse(readFileSync(`${here}data/${name}`, "utf8"));

function descriptorDigest() {
  const text = json("routerdesc_generated.json").descriptor;
  const end = "router-signature\n";
  const span = text.indexOf(end) + end.length;
  return new Uint8Array(createHash("sha1").update(Buffer.from(text.slice(0, span), "utf8")).digest());
}

const input = Buffer.concat(await new Promise((resolve) => {
  const chunks = [];
  process.stdin.on("data", (c) => chunks.push(c));
  process.stdin.on("end", () => resolve(chunks));
})).toString();

const lines = input.split("\n").filter((l) => l.length > 0);
const out = [];
for (const line of lines) {
  const [op] = line.split(" ");
  if (op === "descdigest") {
    out.push(`descdigest ${hex(descriptorDigest())}`);
  } else {
    out.push(`FAIL unknown op ${op}`);
  }
}
out.push(`DONE ${lines.length}`);
console.log(out.join("\n"));
