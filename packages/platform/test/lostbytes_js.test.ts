// An abandoned read on the JavaScript host, which had no case of its own.
//
// `packages/platform/test/wac/lostbytes_test.wac` runs this shape against both Rust binaries and is
// what caught a fix landing on one host and not the other. The JavaScript host — Deno here, and the
// same bridge under Node and in the browser — was not covered at all, and `design/system/0001` D9 is
// that a wac program must not depend on its host.
//
// TypeScript rather than wac because the subject *is* the JavaScript host, which is the exception
// `issues/system/0161` records for `packages/platform`'s `.test.ts` files.
//
// ## What this does not assert, and why that matters
//
// There are two orderings. A caller can give up **before** the bytes arrive, or **after** the answer
// has already landed in its slot. Measured through this harness:
//
//     abandoned before the bytes arrive   0 of 5 lost
//     abandoned after the answer landed   5 of 5 lost   <- issues/system/0311b
//
// Only the first is asserted below. The second is a filed, measured defect — `cancel` releases a
// slot whose answer has already arrived, and for a `recv` that answer is bytes taken off a socket
// once — and asserting it would put a red test in the shared suite for a bug that is written down.
// **So this file passing does not mean the JavaScript host keeps an abandoned read's bytes.** It
// means the ordering that works still works. When `0311b` is fixed, the second case belongs here and
// this comment goes.
import "../../../harness/spawnRetry.ts";
import { appRunner } from "../../../harness/appRun.ts";

const GRANTS = { read: true, write: true, net: true, run: true, env: true };
const ENTRY = ".cache/lostbytes/jsprobe.wac";

/** The parent gives up on a read, then asks again; the child answers late either way. */
const PROGRAM = `import { Core, Cli, Child, Pending, GRANT_ALL } from "std/platform.wac";
import { Read } from "core";

export i32 main(Core core, Cli cli) {
  i32 n = cli.argCount().wait();
  string mode = n > 0 ? string.fromBytes(cli.arg(0).wait()) : "";
  if (mode == "child") {
    core.delay(400).wait();
    cli.write("PAYLOAD".toBytes());
    return 0;
  }
  Child kid = cli.spawnSelf(u8[][]("child".toBytes()), GRANT_ALL(), ".", false, false).wait();
  if (kid.handle < 0) { core.log("no child: " + kid.error); return 1; }
  if (mode != "control") {
    Pending<Read> first = cli.recv(kid.handle);
    core.waitAny(i32[](first.id), 50);
    first.cancel();
    core.cancel(first.id);
  }
  string got = "";
  bool reading = true;
  while (reading) {
    match (cli.recv(kid.handle).wait()) {
      case Data(b): { got = got + string.fromBytes(b); }
      case End: { reading = false; }
      case Failed(e): { reading = false; }
    }
  }
  core.log(got == "PAYLOAD" ? "VERDICT kept" : "VERDICT lost");
  return 0;
}
`;

await Deno.mkdir(".cache/lostbytes", { recursive: true });
await Deno.writeTextFile(ENTRY, PROGRAM);
const app = await appRunner(ENTRY, GRANTS);
const said = async (args: string[]) => {
  const r = await app.run(args);
  return r.out + r.err;
};

/** Five, because one run of a race is a coin — see `issues/system/0307b`, which cost three fixes. */
const TRIES = 5;

Deno.test("the control keeps the payload, so the case below can fail", async () => {
  const got = await said(["control"]);
  if (!got.includes("VERDICT kept")) {
    throw new Error(`the control lost it, so nothing here means anything — ${got}`);
  }
});

Deno.test("a read abandoned before its bytes arrive does not take them with it", async () => {
  for (let i = 0; i < TRIES; i++) {
    const got = await said([]);
    if (!got.includes("VERDICT kept")) {
      throw new Error(`run ${i + 1} of ${TRIES}: the abandoned read took the bytes — ${got}`);
    }
  }
});
