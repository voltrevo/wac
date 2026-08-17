// **Where a grant flag goes, and what happens when it is in the other place.** `issues/system/0177`.
//
// `wac build` read its entry as the argument at a fixed position and `wac run` read its grants only
// before the entry, so the two commands disagreed about where `--allow-read` belongs — and only one
// of them said so. `run` handed the flag to the program as its first argument, so the program ran
// **without the grant it asked for** and complained about the bogus argument instead. Nothing in the
// output pointed at the command line.
//
// Both commands take grants on either side now, and `run` refuses a program argument that is a grant
// it knows rather than passing it on, because passing it on is the silent case. `--` is the way to
// mean it: everything after it is the program's, whatever it looks like.
//
// The probe program returns 7 when its first argument is the string `--allow-read`, which is what
// tells a passed-through flag apart from a granted one.

// Imported for its side effect: retries a spawn that fails with "Text file busy", which a test that
// builds a binary and immediately runs it can hit.
import "../harness/spawnRetry.ts";

const WAC = "native/v8/target/release/wac";

const PROBE = `import { Core, Cli } from "../packages/platform/src/platform.wac";

export i32 main(Core core, Cli cli) {
  i32 n = cli.argCount().wait();
  string first = n > 0 ? string.fromBytes(cli.arg(0).wait()) : "";
  core.log("argc=" + itoa(n) + " first=" + first);
  return first == "--allow-read" ? 7 : 0;
}

string itoa(i32 v) {
  if (v == 0) { return "0"; }
  string out = "";
  i32 x = v;
  while (x > 0) { out = "0123456789".slice(x % 10, x % 10 + 1) + out; x = x / 10; }
  return out;
}
`;

function assertEquals<T>(got: T, want: T, msg?: string): void {
  if (got !== want) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n` +
        `  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`,
    );
  }
}

// **Inside the repository**, because an import specifier is relative: a program in `/tmp` cannot
// reach `packages/platform` at all, and a test written there passes on a compile failure instead of
// on the behaviour it is about.
async function withProbe<T>(f: (path: string, dir: string) => Promise<T> | T): Promise<T> {
  const dir = await Deno.makeTempDir({ dir: ".", prefix: "wac-grantplace-" });
  try {
    const path = `${dir}/p.wac`;
    await Deno.writeTextFile(path, PROBE);
    return await f(path, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

function run(args: string[]): { out: string; code: number } {
  const r = new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).outputSync();
  const dec = new TextDecoder();
  return { out: dec.decode(r.stdout) + dec.decode(r.stderr), code: r.code };
}

Deno.test("[§wac-cli-grants-3qm7wv2] wac build: a grant before the entry is a grant, not the entry", async () => {
  await withProbe((path, dir) => {
    const r = run(["build", "--allow-read", path, "-o", `${dir}/p`]);
    assertEquals(r.code, 0, r.out);
    // The old failure was about the flag as a *file*: "wacc: cannot read --allow-read".
    assertEquals(r.out.includes("cannot read --allow-read"), false, r.out);
  });
});

Deno.test("[§wac-cli-grants-3qm7wv2] wac build: the grant is honoured wherever it was written", async () => {
  await withProbe(async (path, dir) => {
    const r = run(["build", "--allow-read", path, "-o", `${dir}/p`]);
    assertEquals(r.code, 0, r.out);
    const manifest = JSON.parse(await Deno.readTextFile(`${dir}/p.json`));
    assertEquals(manifest.grants.read, true, JSON.stringify(manifest.grants));
  });
});

Deno.test("[§wac-cli-grants-3qm7wv2] wac run: a grant after the entry is refused, not handed to the program", async () => {
  await withProbe((path) => {
    const r = run(["run", path, "--allow-read", "X"]);
    // The silent case: the program ran, without the grant, and returned 7 because its first
    // argument was the flag.
    assertEquals(r.code, 2, r.out);
    assertEquals(r.out.includes("argc="), false, `the program ran anyway — ${r.out}`);
    // Says which flag and where it goes, since the caller's mistake is a position.
    assertEquals(r.out.includes("--allow-read"), true, r.out);
    assertEquals(r.out.includes("--"), true, r.out);
  });
});

Deno.test("[§wac-cli-grants-3qm7wv2] wac run: after `--`, a grant-looking argument is the program's", async () => {
  await withProbe((path) => {
    const r = run(["run", path, "--", "--allow-read"]);
    // 7 is the probe saying its first argument is the string `--allow-read` — so the separator was
    // consumed and the flag was passed through rather than granted.
    assertEquals(r.code, 7, r.out);
    assertEquals(r.out.includes("first=--allow-read"), true, r.out);
  });
});
