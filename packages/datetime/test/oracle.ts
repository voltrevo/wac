#!/usr/bin/env -S deno run
// Differential-testing oracle: JavaScript's `Date`, driven in one batch.
//
// `Date` is an exact oracle for the civil calendar and for RFC 3339 in UTC, and there is no second
// implementation with its range: python's `datetime` stops at year 1 and year 9999, and this checks
// out to ±275 760. So the oracle stays where it is and the *caller* moved —
// `test/wac/datetime_test.wac` computes the answers and hands them here for checking, one process
// for the whole sweep rather than one host call per day.
//
// **This file is the reference, not the test.** It is the same role `packages/gzip/test/fuzz/oracle.py`
// plays for gzip: the thing being compared against, invoked the way `gunzip` is invoked. It is not
// part of the TypeScript that `issues/system/0161` is moving.
//
// Input is lines on stdin, the first token naming what is being checked. Failures are reported on
// stdout as `FAIL <reason>`; the last line is `DONE <count>`. Any other output shape is a harness
// problem and the caller treats it as such.
//
//     civil <dayNum> <y> <m> <d> <dow>    a day number and the civil date and weekday it names
//     days  <y> <m> <d> <dayNum>          a civil date and the day number it maps to
//     leap  <y> <0|1>                     whether the year is a leap year
//     mlen  <y> <m> <len>                 the length of a month
//     yday  <y> <m> <d> <n>               the day of the year, 1-based
//     fmt   <ms> <iso>                    an epoch millisecond and its RFC 3339 text
//     parse <ms> <iso>                    the same, checked with Date.parse rather than toISOString
//     nan   <iso>                         text the oracle must also reject, for a known divergence

const DAY_MS = 86400000;

/** `Date.UTC` maps years 0-99 to 1900-1999, so say what we mean. */
function utc(y: number, m: number, d: number): number {
  const t = new Date(0);
  t.setUTCFullYear(y, m - 1, d);
  t.setUTCHours(0, 0, 0, 0);
  return t.getTime();
}

function main(): number {
  const text = new TextDecoder().decode(readAll());
  const lines = text.split("\n").filter((l) => l.length > 0);
  const out: string[] = [];

  for (const line of lines) {
    const f = line.split(" ");
    const kind = f[0];
    const n = (i: number) => Number(f[i]);

    if (kind === "civil") {
      const at = new Date(n(1) * DAY_MS);
      const want = [at.getUTCFullYear(), at.getUTCMonth() + 1, at.getUTCDate(), at.getUTCDay()];
      const got = [n(2), n(3), n(4), n(5)];
      if (want.join(",") !== got.join(",")) {
        out.push(`FAIL day ${f[1]}: got ${got.join("-")}, Date says ${want.join("-")}`);
      }
    } else if (kind === "days") {
      const want = Math.floor(utc(n(1), n(2), n(3)) / DAY_MS);
      if (!Number.isFinite(want)) {
        out.push(`FAIL ${f[1]}-${f[2]}-${f[3]}: outside the range Date supports, so not a test case`);
      } else if (want !== n(4)) {
        out.push(`FAIL ${f[1]}-${f[2]}-${f[3]}: got day ${f[4]}, Date says ${want}`);
      }
    } else if (kind === "leap") {
      const feb = new Date(0);
      feb.setUTCFullYear(n(1), 1, 29);
      feb.setUTCHours(0, 0, 0, 0);
      const want = feb.getUTCMonth() === 1 ? 1 : 0;
      if (want !== n(2)) out.push(`FAIL ${f[1]}: leap ${f[2]}, Date says ${want}`);
    } else if (kind === "mlen") {
      const y = n(1), m = n(2);
      const want = Math.round((utc(m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1, 1) - utc(y, m, 1)) / DAY_MS);
      if (want !== n(3)) out.push(`FAIL ${y}-${m}: length ${f[3]}, Date says ${want}`);
    } else if (kind === "yday") {
      const want = Math.round((utc(n(1), n(2), n(3)) - utc(n(1), 1, 1)) / DAY_MS) + 1;
      if (want !== n(4)) out.push(`FAIL ${f[1]}-${f[2]}-${f[3]}: day of year ${f[4]}, Date says ${want}`);
    } else if (kind === "fmt") {
      const want = new Date(Number(f[1])).toISOString();
      if (want !== f[2]) out.push(`FAIL ${f[1]}: got ${f[2]}, Date says ${want}`);
    } else if (kind === "parse") {
      const want = Date.parse(f[2]);
      if (Number.isNaN(want)) {
        out.push(`FAIL the oracle rejected ${f[2]}, so it is a bad test case`);
      } else if (want !== Number(f[1])) {
        out.push(`FAIL ${f[2]}: got ${f[1]}, Date.parse says ${want}`);
      }
    } else if (kind === "nan") {
      if (!Number.isNaN(Date.parse(f[1]))) {
        out.push(`FAIL Date.parse now accepts ${f[1]}, so it could be the oracle after all`);
      }
    } else {
      out.push(`FAIL unknown check ${JSON.stringify(kind)}`);
    }
  }

  for (const line of out) console.log(line);
  console.log(`DONE ${lines.length}`);
  return 0;
}

function readAll(): Uint8Array {
  const chunks: Uint8Array[] = [];
  const buf = new Uint8Array(1 << 16);
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

Deno.exit(main());
