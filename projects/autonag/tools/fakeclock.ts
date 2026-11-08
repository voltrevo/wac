// Preloaded into autonag's CLI and admin tool by tools/oracle_cli.ts: the clock fixed at FAKE_NOW, and, for
// the admin tool, crypto.randomUUID counting on from FAKE_UUID_START in the oracle's pattern, the count it
// reached written to FAKE_UUID_FILE on exit so the oracle's server carries on from it.
import { writeFileSync } from "fs";

const NOW = Number(process.env.FAKE_NOW);
const Real = Date;
class FakeDate extends Real {
  constructor(...a: any[]) {
    if (a.length === 0) super(NOW);
    else super(...(a as [any]));
  }
  static now() { return NOW; }
}
globalThis.Date = FakeDate as any;

const file = process.env.FAKE_UUID_FILE;
if (file) {
  let n = Number(process.env.FAKE_UUID_START);
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    value: () => `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, "0")}`, configurable: true,
  });
  process.on("exit", () => writeFileSync(file, String(n)));
}
