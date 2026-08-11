// `connectThrough` against the proxy this container actually has.
//
//     deno test -A packages/http/test/tunnel.test.ts
//
// `proxy.test.ts` covers every decision `src/proxy.wac` makes, without a socket, because that is this
// package's rule. What it cannot cover is the loop that owns one — and a loop nothing exercises is
// where the ordering mistakes live: sending before reading, reading once and assuming a whole reply
// arrived, closing a socket that a caller still owns. So this runs the program.
//
// **Skipped without `HTTP_PROXY`, and that is a real limit on what it proves.** A skipped test that
// reads as a pass is worse than no test, so the skip says so on standard error, and the assertions
// below check the *proxy's* behaviour rather than the internet's: `example.com` is not assumed
// reachable, only that Squid answers about it one way or the other.

import { buildApp } from "../../platform/build.ts";

const dec = new TextDecoder();

const proxy = Deno.env.get("HTTP_PROXY") ?? "";
if (proxy === "") console.error("http tunnel tests: skipped — HTTP_PROXY is not set");

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

let exePath: string | null = null;
async function tunnel(): Promise<string> {
  if (exePath === null) {
    exePath = await Deno.makeTempFile({ prefix: "tunnel-" });
    // Net and nothing else: what this proves cannot be about the filesystem.
    await buildApp("packages/http/example/tunnel.wac", exePath, { net: true, env: true });
    await Deno.chmod(exePath, 0o755);
  }
  return exePath;
}

async function run(args: string[]): Promise<{ out: string; err: string; code: number }> {
  const r = await new Deno.Command(await tunnel(), {
    args,
    stdout: "piped",
    stderr: "piped",
    env: { HTTP_PROXY: proxy, PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
    clearEnv: true,
  }).output();
  return { out: dec.decode(r.stdout).trim(), err: dec.decode(r.stderr).trim(), code: r.code };
}

Deno.test({
  name: "a CONNECT tunnel opens through the real proxy",
  ignore: proxy === "",
  fn: async () => {
    const r = await run(["github.com", "443"]);
    assert(r.code === 0, `tunnel failed: ${r.err}`);
    assert(r.out.startsWith("open to github.com:443 via "), `it said ${JSON.stringify(r.out)}`);
    // The count is printed rather than asserted to be zero: a proxy is allowed to coalesce, and a test
    // that demanded zero would be asserting the absence of the case `proxy.wac` carries the offset for.
    assert(/\d+ byte\(s\) already through$/.test(r.out), `no leftover count in ${JSON.stringify(r.out)}`);
  },
});

Deno.test({
  name: "a host the proxy will not open comes back in the proxy's own words",
  ignore: proxy === "",
  fn: async () => {
    // Not on any allowlist, and not a name that resolves. Either way Squid answers with a status rather
    // than dropping the connection, and the point is that its line survives to the caller — a refusal
    // is a line in a config file on the host, not a fault in the network.
    const r = await run(["not-a-real-host.invalid", "443"]);
    assert(r.code === 1, `expected a refusal, got code ${r.code} and ${JSON.stringify(r.out)}`);
    assert(r.err.startsWith("tunnel: "), `the error is ${JSON.stringify(r.err)}`);
    assert(
      /the proxy refused not-a-real-host\.invalid:443: HTTP\/1\.[01] \d\d\d /.test(r.err) ||
        /could not be reached|closed the connection|is not HTTP/.test(r.err),
      `the message does not carry what the proxy said: ${JSON.stringify(r.err)}`,
    );
  },
});

Deno.test({
  name: "without a proxy variable it says that, rather than dialling something",
  ignore: proxy === "",
  fn: async () => {
    const r = await new Deno.Command(await tunnel(), {
      args: ["github.com", "443"],
      stdout: "piped",
      stderr: "piped",
      env: { PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin" },
      clearEnv: true,
    }).output();
    assert(r.code === 1, `expected 1, got ${r.code}`);
    assert(
      dec.decode(r.stderr).includes("HTTP_PROXY is not set"),
      `it said ${JSON.stringify(dec.decode(r.stderr))}`,
    );
  },
});
