// `wac run <file.wac> <name> [args…]` — calling an exported function from the command line.
//
// This behaviour existed only in the reference CLI (`wacx`), which is being retired; the binary
// could run a `main(Core, Cli)` and nothing else. These are the cases `compiler/wacx.test.ts`
// asserted, moved onto the thing people actually type.
//
// **Coerced by the declared parameter type, not guessed from the text.** `1` is an `i32` where one
// is declared and the string `"1"` where a `string` is, which is the whole point of a command line:
// the shell has no types, so the signature is the only thing that can supply them.
//
// **`main` wins where it exists.** A module with a `main` is a program, and its arguments are the
// program's — so this path is for modules without one, which is what a library being poked at is.
// That rule is what stops `wac run p.wac foo` from being ambiguous.

const WAC = "native/v8/target/release/wac";

const SRC = `export i32 gcd(i32 a, i32 b) { return b == 0 ? a : gcd(b, a % b); }
export string greet(string who) { return "hi " + who; }
export void nothing() {}
export bool flip(bool b) { return !b; }
export i64 twice64(i64 n) { return n * 2; }
export i32 total(i32[] xs) { i32 s = 0; for (i32 i = 0; i < xs.len(); i++) { s = s + xs[i]; } return s; }
export i32[] doubled(i32[] xs) {
  i32[] o = i32[xs.len()]();
  for (i32 i = 0; i < xs.len(); i++) { o[i] = xs[i] * 2; }
  return o;
}
export i64 sum64(i64[] xs) { i64 s = 0; for (i32 i = 0; i < xs.len(); i++) { s = s + xs[i]; } return s; }
export f64 sumf(f64[] xs) { f64 s = 0.0; for (i32 i = 0; i < xs.len(); i++) { s = s + xs[i]; } return s; }
export i32 boom() { trap "the ring is full"; }
`;

const WITH_MAIN = `export i32 main() { return 0; }
export i32 gcd(i32 a, i32 b) { return b == 0 ? a : gcd(b, a % b); }
`;

let dir: string | null = null;
async function fixture(): Promise<string> {
  if (dir === null) {
    dir = await Deno.makeTempDir({ prefix: "wac-run-named-" });
    await Deno.writeTextFile(`${dir}/lib.wac`, SRC);
    await Deno.writeTextFile(`${dir}/prog.wac`, WITH_MAIN);
  }
  return dir;
}

async function run(...args: string[]): Promise<{ out: string; code: number }> {
  const r = await new Deno.Command(WAC, { args, stdout: "piped", stderr: "piped" }).output();
  const dec = new TextDecoder();
  return { out: (dec.decode(r.stdout) + dec.decode(r.stderr)).trim(), code: r.code };
}

Deno.test("[§wac-cli-run-7jnq2mv] run calls a named export and prints what it answered", async () => {
  const d = await fixture();
  const wrong: string[] = [];
  const cases: [string[], string][] = [
    [["gcd", "48", "18"], "6"],
    // A `string` parameter takes the argument exactly as written.
    [["greet", "world"], "hi world"],
    [["greet", "two words"], "hi two words"],
    // `void` prints nothing at all, rather than `undefined` or a blank line of its own.
    [["nothing"], ""],
    // A bool answers in the vocabulary it accepts, not as 0 and 1.
    [["flip", "true"], "false"],
    [["flip", "0"], "true"],
    // i64 is a BigInt across the boundary, so precision past 2^53 survives.
    [["twice64", "4611686018427387903"], "9223372036854775806"],
  ];
  for (const [args, want] of cases) {
    const got = await run("run", `${d}/lib.wac`, ...args);
    if (got.code !== 0) wrong.push(`${args.join(" ")}: exit ${got.code} — ${got.out}`);
    else if (got.out !== want) wrong.push(`${args.join(" ")}: ${JSON.stringify(got.out)}, want ${JSON.stringify(want)}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("[§wac-cli-run-7jnq2mv] a list argument, however it is written", async () => {
  const d = await fixture();
  const wrong: string[] = [];
  const cases: [string[], string][] = [
    [["total", "1,2,3"], "6"],
    // Brackets are accepted because people type them.
    [["total", "[1, 2, 3]"], "6"],
    [["total", ""], "0"],
    [["total", "[]"], "0"],
    // An array return prints as its space-separated elements.
    [["doubled", "1,2,3"], "2 4 6"],
    // Elements keep their declared width: this sum is exact only in i64.
    [["sum64", "9007199254740993,1"], "9007199254740994"],
    [["sumf", "0.5,0.25"], "0.75"],
  ];
  for (const [args, want] of cases) {
    const got = await run("run", `${d}/lib.wac`, ...args);
    if (got.code !== 0) wrong.push(`${args.join(" ")}: exit ${got.code} — ${got.out}`);
    else if (got.out !== want) wrong.push(`${args.join(" ")}: ${JSON.stringify(got.out)}, want ${JSON.stringify(want)}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("[§wac-cli-run-7jnq2mv] what it refuses, and what it says", async () => {
  const d = await fixture();
  const wrong: string[] = [];
  // Every one of these is a usage mistake rather than a program failure, so all of them are exit 2
  // and all of them name the thing that is wrong rather than the call.
  const cases: [string[], string][] = [
    [["nosuch"], "exports no `nosuch`"],
    [["gcd", "48"], "takes 2 argument(s), given 1"],
    [["gcd", "48", "18", "6"], "takes 2 argument(s), given 3"],
    [["gcd", "x", "18"], "`x` is not an i32"],
    [["flip", "maybe"], "`maybe` is not a bool"],
    // The element, not the list — a message about `1,x,3` sends you looking at the wrong thing.
    [["total", "1,x,3"], "`x` is not an i32"],
    [[], "exports no main, so name the function to run"],
  ];
  for (const [args, want] of cases) {
    const got = await run("run", `${d}/lib.wac`, ...args);
    if (got.code !== 2) wrong.push(`${args.join(" ")}: exit ${got.code}, want 2 — ${got.out}`);
    else if (!got.out.includes(want)) wrong.push(`${args.join(" ")}: ${JSON.stringify(got.out.slice(0, 90))} does not say ${JSON.stringify(want)}`);
  }
  // A wrong name lists what the module does export, with signatures, because the next thing anybody
  // does is ask what it *is* called.
  const named = await run("run", `${d}/lib.wac`, "nosuch");
  for (const expected of ["gcd(i32, i32)", "greet(string)", "flip(bool)"]) {
    if (!named.out.includes(expected)) wrong.push(`the listing omits ${expected}`);
  }
  if (wrong.length > 0) throw new Error(wrong.join("\n  "));
});

Deno.test("[§wac-cli-run-7jnq2mv] a trap is exit 2 and says what it said", async () => {
  const d = await fixture();
  // Distinct from a compile failure, which is 1: the program ran and stopped, which is a different
  // outcome from one that never started.
  const got = await run("run", `${d}/lib.wac`, "boom");
  if (got.code !== 2) throw new Error(`exit ${got.code}, want 2 — ${got.out}`);
  if (!got.out.includes("the ring is full")) throw new Error(`it did not repeat the message: ${got.out}`);

  const broken = `${d}/broken.wac`;
  await Deno.writeTextFile(broken, `export i32 nope() { return "x"; }\n`);
  const bad = await run("run", broken, "nope");
  if (bad.code !== 1) throw new Error(`a file that does not compile exited ${bad.code}, want 1`);
});

Deno.test("[§wac-cli-run-7jnq2mv] a module with a `main` runs it, arguments and all", async () => {
  const d = await fixture();
  // The disambiguation. `prog.wac` exports both `main` and `gcd`; `gcd` here is the program's first
  // argument, not a function to call, and the program is what runs.
  const got = await run("run", `${d}/prog.wac`, "gcd", "48", "18");
  if (got.code !== 0) throw new Error(`exit ${got.code} — ${got.out}`);
  if (got.out.includes("6")) throw new Error(`it called gcd instead of main: ${got.out}`);
});
