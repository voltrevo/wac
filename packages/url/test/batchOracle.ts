#!/usr/bin/env -S deno run
// The oracle for URL parsing, driven in one batch — and why it is not `new URL`.
//
// Deno's `URL` and Node's disagree. Not on anything exotic — `file:///c|/x`, `file:////a` and a
// backslash in a non-special path all come out differently, and each runtime is self-consistent
// about it. So "the host's own URL" is not one oracle, and picking the one that happens to be
// running the test would have quietly made this package match a specific runtime rather than the
// standard.
//
// Worse, neither is right everywhere. Node is right on the file-URL cases; Deno is right that a
// relative reference cannot be resolved against an opaque path unless it starts with `#`, where Node
// happily produces `foo:opaque/a#f`. So neither can be the oracle on its own.
//
// What is sound is where they *agree*: two independent implementations landing on the same answer is
// strong evidence, and there is no case where both are wrong in the same way. Cases where they
// differ are **skipped and counted** rather than hidden — a case dropped silently would read as one
// that passed, and the caller asserts on the count.
//
// **This file is the reference, not the test.** It was packages/url/test/oracle.ts — unbackticked
// because it no longer exists — a module the
// host-side tests imported; now it is a program, so a wac test can be the caller.
// `issues/system/0161`.
//
// Input is lines on stdin:
//
//     u <inputHex> <baseHex|-> <ourAnswerHex>   a parse, compared against whatever both agree on
//     skipped <count> <percent>                 at most this share may be a runtime disagreement
//     hrefonly                                  compare only `href`, not all nine
//     nodeonly                                  compare against Node alone, without requiring Deno
//                                               to agree — for hand-written cases whose runtime
//                                               divergences are listed and excluded by the caller
//     stilldiffer <inputHex> <baseHex|->        assert the two runtimes *still* disagree here
//     nodeok <inputHex> <baseHex|-> <0|1>       assert Node's own verdict, for a gap this package
//                                               has: "the oracle still accepts what we refuse"
//
// `<ourAnswerHex>` is what `test/probe.wac`'s `describe` produces: NUL-separated fields, the first
// `1` or `0` for whether it parsed. Hex because a URL contains every byte there is, newline
// included. Failures go to stdout as `FAIL <reason>`; the last line is `DONE <count>`.

type Parsed = {
  ok: boolean;
  href?: string;
  protocol?: string;
  username?: string;
  password?: string;
  hostname?: string;
  port?: string;
  pathname?: string;
  search?: string;
  hash?: string;
};

type Case = { input: string; base?: string };

const FIELDS = [
  "href",
  "protocol",
  "username",
  "password",
  "hostname",
  "port",
  "pathname",
  "search",
  "hash",
] as const;

const NODE_SCRIPT = `
let raw = "";
process.stdin.on("data", (d) => raw += d);
process.stdin.on("end", () => {
  const cases = JSON.parse(raw);
  const out = cases.map(({ input, base }) => {
    try {
      const u = base === undefined ? new URL(input) : new URL(input, base);
      return {
        ok: true, href: u.href, protocol: u.protocol, username: u.username,
        password: u.password, hostname: u.hostname, port: u.port,
        pathname: u.pathname, search: u.search, hash: u.hash,
      };
    } catch {
      return { ok: false };
    }
  });
  process.stdout.write(JSON.stringify(out));
});
`;

/** Deno's own URL, which is the second opinion rather than the answer. */
function denoOracle(c: Case): Parsed {
  try {
    const u = c.base === undefined ? new URL(c.input) : new URL(c.input, c.base);
    return {
      ok: true,
      href: u.href,
      protocol: u.protocol,
      username: u.username,
      password: u.password,
      hostname: u.hostname,
      port: u.port,
      pathname: u.pathname,
      search: u.search,
      hash: u.hash,
    };
  } catch {
    return { ok: false };
  }
}

function same(a: Parsed, b: Parsed): boolean {
  if (a.ok !== b.ok) return false;
  if (!a.ok) return true;
  return FIELDS.every((f) => a[f] === b[f]);
}

/** `describe`'s NUL-separated form, read back into the same shape the runtimes answer in. */
function fromProbe(text: string): Parsed {
  const p = text.split("\0");
  if (p[0] !== "1") return { ok: false };
  return {
    ok: true,
    href: p[1],
    protocol: p[2] + ":",
    username: p[3],
    password: p[4],
    hostname: p[5],
    port: p[6],
    pathname: p[7],
    search: p[8],
    hash: p[9],
  };
}

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 20);
  for (;;) {
    const n = Deno.stdin.readSync(buf);
    if (n === null || n === 0) break;
    chunks.push(buf.slice(0, n));
  }
  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

const fromHex = (h: string): string => {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return new TextDecoder().decode(bytes);
};

async function main(): Promise<number> {
  const lines = new TextDecoder().decode(readAll()).split("\n").filter((l) => l.length > 0);
  const out: string[] = [];
  const say = (s: string) => {
    if (out.length < 40) out.push(`FAIL ${s}`);
  };

  const cases: Case[] = [];
  const ours: Parsed[] = [];
  const labels: string[] = [];
  let hrefOnly = false;
  // Node alone, for the hand-written groups: they exclude the five known runtime divergences by
  // name, so requiring agreement would discard cases the caller has already accounted for. The
  // generated sweeps do the opposite and take only agreement, because they cannot name anything.
  let nodeOnly = false;
  const directives: string[][] = [];
  const stillDiffer: Case[] = [];
  const nodeVerdict: Array<{ c: Case; want: boolean }> = [];

  for (const line of lines) {
    const f = line.split(" ");
    if (f[0] === "u") {
      const input = fromHex(f[1]);
      const base = f[2] === "-" ? undefined : fromHex(f[2]);
      cases.push({ input, base });
      ours.push(fromProbe(fromHex(f[3])));
      labels.push(
        base === undefined
          ? JSON.stringify(input)
          : `${JSON.stringify(input)} against ${JSON.stringify(base)}`,
      );
    } else if (f[0] === "hrefonly") {
      hrefOnly = true;
    } else if (f[0] === "nodeonly") {
      nodeOnly = true;
    } else if (f[0] === "nodeok") {
      nodeVerdict.push({
        c: { input: fromHex(f[1]), base: f[2] === "-" ? undefined : fromHex(f[2]) },
        want: f[3] === "1",
      });
    } else if (f[0] === "stilldiffer") {
      stillDiffer.push({
        input: fromHex(f[1]),
        base: f[2] === "-" ? undefined : fromHex(f[2]),
      });
    } else if (f[0] === "skipped") {
      directives.push(f);
    } else {
      say(`unknown check ${JSON.stringify(f[0])}`);
    }
  }

  const node = await nodeOracleAsync(cases);
  let skipped = 0;
  const firstSkipped: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    const want = node[i];
    if (!nodeOnly && !same(denoOracle(cases[i]), want)) {
      skipped++;
      if (firstSkipped.length < 5) firstSkipped.push(labels[i]);
      continue;   // the runtimes disagree; not evidence about anything
    }
    const got = ours[i];
    if (got.ok !== want.ok) {
      say(`${labels[i]}: wac ${got.ok ? "accepted" : "rejected"}, both runtimes ${
        want.ok ? "accepted" : "rejected"
      }`);
      continue;
    }
    if (!want.ok) continue;
    for (const field of hrefOnly ? (["href"] as const) : FIELDS) {
      if (got[field] !== want[field]) {
        say(`${labels[i]}: ${field} was ${JSON.stringify(got[field])}, both runtimes say ${
          JSON.stringify(want[field])
        }`);
        break;
      }
    }
  }

  // A gap this package has, pinned from the other side: the assertion is that the *oracle* still
  // accepts what we refuse. Without it, the day something else starts rejecting these — a change to
  // Node, a change to the input — the "we reject it" half would keep passing and the divergence
  // would have quietly become an agreement about nothing.
  if (nodeVerdict.length > 0) {
    const said = await nodeOracleAsync(nodeVerdict.map((v) => v.c));
    for (let i = 0; i < nodeVerdict.length; i++) {
      if (said[i].ok !== nodeVerdict[i].want) {
        say(
          `${JSON.stringify(nodeVerdict[i].c.input)}: Node ${said[i].ok ? "accepts" : "rejects"} it, ` +
            `and this expected the opposite — the divergence has moved`,
        );
      }
    }
  }

  // The other half of a recorded divergence: if a runtime is fixed and the two now agree, the entry
  // has served its purpose and should be deleted rather than left as a comment that rots.
  if (stillDiffer.length > 0) {
    const nodeSaid = await nodeOracleAsync(stillDiffer);
    for (let i = 0; i < stillDiffer.length; i++) {
      const deno = denoOracle(stillDiffer[i]);
      if (deno.href === nodeSaid[i].href && deno.ok === nodeSaid[i].ok) {
        say(
          `${JSON.stringify(stillDiffer[i].input)}: both runtimes now say ${
            JSON.stringify(nodeSaid[i].href)
          } — drop this entry`,
        );
      }
    }
  }

  for (const d of directives) {
    const count = Number(d[1]);
    const percent = Number(d[2]);
    if (skipped * 100 > count * percent) {
      say(
        `the runtimes disagreed on ${skipped}/${count} cases, above the ${percent}% this allows — ` +
          `the oracle has become too thin to mean much. First few: ${firstSkipped.join(" | ")}`,
      );
    }
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

/** Parse every case with Node's URL. One subprocess for the whole batch. */
async function nodeOracleAsync(cases: Case[]): Promise<Parsed[]> {
  if (cases.length === 0) return [];
  const child = new Deno.Command("node", {
    args: ["-e", NODE_SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  // Started before the write, not after: node answers only at end of input, but a batch big enough
  // to fill its stdout pipe would park it there while this side was still writing. Draining
  // concurrently is what makes the batch safe at any size — the same rule `Cli.exec` had to learn.
  const outcome = child.output();
  const w = child.stdin.getWriter();
  await w.write(new TextEncoder().encode(JSON.stringify(cases)));
  await w.close();
  const r = await outcome;
  if (r.code !== 0) throw new Error(`node oracle failed: ${new TextDecoder().decode(r.stderr)}`);
  return JSON.parse(new TextDecoder().decode(r.stdout)) as Parsed[];
}

Deno.exit(await main());
