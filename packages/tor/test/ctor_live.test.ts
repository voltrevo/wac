// test-lane: exclusive — a real C tor bootstrapping from our authority, on real ports
//
// The half of design 0002 step 7 that nothing watched. `INTEROP.md` marks eight components **live**,
// meaning a C tor was on the other side of a socket and the thing worked — and every one of those was
// witnessed by a run somebody did by hand, on a date. Since the suite started standing the wac network
// up on every run, our own side is exercised continuously, which narrows the rot to exactly one
// direction and makes it *less* visible: a row can now only go stale by **tor no longer agreeing with
// us**, and that is the direction nothing was looking.
//
// ## Why this is a test and not a launcher plan
//
// `network.wac` cannot start a C tor, and that is deliberate rather than a gap: `Cli.spawn` takes a
// worker bundle so that what a child may do is the *parent's* choice, and `--allow-run` cannot express
// that at any granularity because the child inherits the operating system's authority instead.
//
// But a C tor never needed to live inside the capability world. It needs to be **a peer on a socket**.
// The suite is TypeScript, its subprocesses already get `--allow-run` and `--allow-net`, and this file
// is the orchestrator that a mixed network needs and the launcher declines to be. So the platform does
// not have to change for this to exist; it only has to change for `network.wac` to own it, which is a
// different and much weaker claim than the one this document made for a week.
//
// ## Ignored unless tor has been built, and loud about it
//
// `ntor_wac.test.ts` records what happens otherwise: it shelled out to a binary in `/tmp`, the
// container was recreated, and this package turned the shared suite red for three agents who had not
// touched it. So the guard skips — and says why on standard error, because a silent skip reads as
// coverage that was never there. Build it with `tools/tor.sh`.

import { buildApp } from "../../platform/build.ts";
import "../../../harness/spawnRetry.ts";

const TOR = `${Deno.env.get("HOME")}/tor-build/torproject-tor-c8d2b17/src/app/tor`;

const haveTor = (() => {
  try {
    return Deno.statSync(TOR).isFile;
  } catch {
    return false;
  }
})();

if (!haveTor) {
  console.error(
    `\n  ctor_live.test.ts is skipped: no tor binary at ${TOR}.\n` +
      `  Build one with tools/tor.sh to check that C tor still agrees with us.\n`,
  );
}

/**
 * The machine's load, for a failure message.
 *
 * Issue 0106's third suggestion, and it belongs here rather than in the wac: a protocol library
 * reaching into `/proc` to describe its own environment would be the wrong layer, and this is the
 * layer that already knows it is a test. The one fact that decides whether a red gate means "re-run"
 * or "investigate", put where somebody reading the failure will see it.
 */
function load(): string {
  // Through a subprocess, which looks absurd for reading a file and is the only way that works.
  // Deno gates `/proc` behind `--allow-all` rather than `--allow-read`, and `Deno.loadavg()` behind
  // `--allow-sys`; `tools/runTests.ts` grants neither, so both paths return "load unknown" under the
  // runner — which is exactly the situation this was added for, and it did, silently, until a real
  // failure message read `(load unknown)`. `--allow-run` is granted, so `cat` it is.
  try {
    const r = new Deno.Command("cat", { args: ["/proc/loadavg"], stdout: "piped", stderr: "null" })
      .outputSync();
    const text = new TextDecoder().decode(r.stdout).trim();
    return text === "" ? "load unknown" : `load ${text.split(" ").slice(0, 3).join(" ")}`;
  } catch {
    return "load unknown";
  }
}

/** A running child, with everything it has said so far. */
type Running = { child: Deno.ChildProcess; said: () => string };

function start(cmd: string, args: string[], cwd: string): Running {
  const child = new Deno.Command(cmd, { args, cwd, stdout: "piped", stderr: "piped" }).spawn();
  let buf = "";
  const dec = new TextDecoder();
  const pump = async (s: ReadableStream<Uint8Array>) => {
    for await (const chunk of s) buf += dec.decode(chunk, { stream: true });
  };
  // Both streams into one buffer: what is wanted here is "did it ever say this", and a program's
  // choice of stream is not part of that question.
  pump(child.stdout).catch(() => {});
  pump(child.stderr).catch(() => {});
  return { child, said: () => buf };
}

async function until(what: string, ok: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (ok()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out after ${ms}ms waiting for ${what} (${load()})`);
}

/**
 * Three relays and an authority, and the two facts a tor needs to be told about them.
 *
 * Port 0 throughout, so this cannot collide with another agent's suite — the same property that let
 * the wac-only network into the suite in the first place.
 */
async function standUpNetwork(dir: string, running: Running[]) {
  await buildApp("packages/tor/src/relayd.wac", `${dir}/relayd`, { read: true, write: true, net: true });
  await buildApp("packages/tor/src/gendesc.wac", `${dir}/gendesc`, { read: true, write: true });

  for (const n of [1, 2, 3]) {
    await Deno.writeFile(`${dir}/s${n}`, crypto.getRandomValues(new Uint8Array(32)));
  }

  const docs = "-C v.consensus -K cert.cert -D r1.desc -D r2.desc -D r3.desc" +
    " -M v.consensus.micro -m v.consensus.mds";
  for (const n of [1, 2, 3]) {
    const args = [`s${n}`, "-p", "0", "-n", `wacc${n}`, "--descriptor", `r${n}.desc`];
    if (n === 1) args.push("--seedline", "seed.txt");
    running.push(start(`${dir}/relayd`, [...args, ...docs.split(" ")], dir));
  }
  await until(
    "three relays to bind and write descriptors",
    () => running.every((r) => r.said().includes("-byte descriptor for port")),
    120000,
  );

  const vote = await new Deno.Command(`${dir}/gendesc`, {
    args: ["keys.json", "cert", "vote", "v", "-", "r1.desc", "r2.desc", "r3.desc"],
    cwd: dir,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (vote.code !== 0) {
    throw new Error(`gendesc failed:\n${new TextDecoder().decode(vote.stderr)}`);
  }
  await until(
    "the relays to find the documents and start serving them",
    () => running.every((r) => r.said().includes("serving the consensus")),
    30000,
  );

  // What tor has to be told, and both halves come out of the network rather than out of this file.
  // `v3ident` is whose signature to trust on the consensus; the trailing fingerprint is whose TLS
  // identity to expect on the wire. They are different keys answering different questions, which is
  // the whole shape of the DirAuthority line — and tor dials the **ORPort** named here rather than
  // the DirPort, because it prefers a tunnelled directory connection even for a direct fetch. A
  // `dird` serving only a DirPort is unreachable to it; a relay answering BEGIN_DIR is not.
  const seed = (await Deno.readTextFile(`${dir}/seed.txt`)).trim().split(/\s+/);
  const v3ident = (await Deno.readTextFile(`${dir}/cert.fingerprint`)).trim();
  return { orPort: seed[1], relayFingerprint: seed[2], v3ident };
}

/**
 * Start a tor against a network `standUpNetwork` has already brought up, and wait for a line in its
 * log.
 *
 * `net` is passed in rather than stood up here. It used to stand one up itself, which was fine while
 * one test used it and wrong the moment a second wanted a network *and* a tor: that test called
 * `standUpNetwork` for the service's sake and then this, and got two sets of three relays writing to
 * the same descriptor paths in one directory.
 */
async function startTor(dir: string, running: Running[], net: { orPort: string; relayFingerprint: string; v3ident: string }, extra: string[], awaitLine: string) {
  await Deno.mkdir(`${dir}/tordata`);
  await Deno.writeTextFile(
    `${dir}/torrc`,
    [
      `DataDirectory ${dir}/tordata`,
      "ControlPort 0",
      "TestingTorNetwork 1",
      `DirAuthority wacauth orport=${net.orPort} no-v2 v3ident=${net.v3ident} 127.0.0.1:17999 ${net.relayFingerprint}`,
      `Log notice file ${dir}/tor.log`,
      ...extra,
      "",
    ].join("\n"),
  );
  running.push(start(TOR, ["-f", `${dir}/torrc`], dir));

  let log = "";
  const readLog = () => {
    Deno.readTextFile(`${dir}/tor.log`).then((t) => (log = t)).catch(() => {});
    return log.includes(awaitLine);
  };
  await until(`tor to reach ${JSON.stringify(awaitLine)}`, readLog, 120000).catch(async (e) => {
    let final = "";
    try { final = await Deno.readTextFile(`${dir}/tor.log`); } catch { /* never wrote one */ }
    throw new Error(`${e.message}\n--- tor.log ---\n${final}`);
  });
  return { log: () => log, refresh: readLog };
}

Deno.test({
  name: "a C tor bootstraps from our authority and through our relays",
  ignore: !haveTor,
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-ctor-" });
  const running: Running[] = [];
  try {
    const net = await standUpNetwork(dir, running);
    const tor = await startTor(dir, running, net, ["SocksPort 0"], "Bootstrapped 100%");
    const log = tor.log();

    // Bootstrapping is not one event, and which stages it passed is the interesting part. A tor that
    // reached 100% from a *cached* consensus would prove nothing, which is why the DataDirectory is
    // fresh per run — every one of these had to come off our wire.
    for (const stage of [
      "Bootstrapped 30% (loading_status): Loading networkstatus consensus",
      "Bootstrapped 40% (loading_keys): Loading authority key certs",
      "Bootstrapped 50% (loading_descriptors): Loading relay descriptors",
      "Bootstrapped 75% (enough_dirinfo)",
      "Bootstrapped 100% (done)",
    ]) {
      if (!log.includes(stage)) throw new Error(`tor never logged ${JSON.stringify(stage)}:\n${log}`);
    }

    // And the thing this test was written to catch: tor complaining about us. The first run of it
    // found the responder's NETINFO carrying a timestamp of zero, so tor read the epoch and warned
    // that one of us was twenty thousand days out — then bootstrapped anyway, because the
    // recommendation for that check is `warn`. A wrong value that still works is exactly what a suite
    // with no C tor in it cannot see, and it is what this assertion is for.
    if (log.includes("skewed time")) {
      throw new Error(`tor thinks our clock is wrong — check the NETINFO timestamp:\n${log}`);
    }

    // The second finding, and the same shape. Our link certificate was Ed25519 where every real
    // relay's is RSA, so tor asked it for an RSA key, got none, and left `expecting an rsa key` on
    // OpenSSL's error queue three times per handshake. The message was noise; what it pointed at was
    // a relay identifiable as ours from the first flight, by a field anyone on the path can read.
    if (log.includes("expecting an rsa key")) {
      throw new Error(`tor cannot read our link certificate's key as RSA:\n${log}`);
    }
    if (log.includes("Unhandled OpenSSL errors")) {
      throw new Error(`we left OpenSSL errors on tor's queue:\n${log}`);
    }
  } finally {
    for (const r of running) {
      try {
        r.child.kill("SIGKILL");
        await r.child.status;
      } catch { /* already gone */ }
    }
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "a C tor carries a stream through our relays, both directions",
  ignore: !haveTor,
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  // `INTEROP.md` marks streams **live** in both directions on a run somebody did by hand. This is
  // that run, in the suite — and it exercises more than the stream: a SOCKS request makes tor build
  // a real three-hop circuit through our relays, CREATE2 at the guard and EXTEND2 twice, then
  // RELAY_BEGIN at the exit, which is one of ours opening a TCP connection and carrying bytes back.
  //
  // ## The assertion that has to come first, and why
  //
  // The first attempt at this test asserted the body and passed while measuring nothing. `NO_PROXY`
  // is set to `localhost,127.0.0.1` in this container, curl honours it, and it therefore **ignored
  // `--socks5-hostname` entirely** and connected straight to the test's own HTTP server. Byte-identical
  // body, exit code zero, and not one Tor cell involved — which is exactly the failure
  // `src/network.wac`'s header describes: a confident number measured against a proxy setting.
  //
  // So the load-bearing assertion is that **a relay of ours says it opened the stream**. The body
  // being right is necessary and proves nothing on its own; that line is what distinguishes "our exit
  // carried it" from "the bytes arrived some other way". `--noproxy ""` and a cleared environment are
  // what make the request actually go where it says.
  const dir = await Deno.makeTempDir({ prefix: "wac-ctor-stream-" });
  const running: Running[] = [];
  let target: Deno.HttpServer | null = null;
  try {
    // Long enough to span several relay cells, so the exit has to carry a sequence rather than get
    // lucky with a body that fits in one.
    const BODY = "wac relay carried this\n".repeat(300);
    const targetPort = 18800 + Math.floor(Math.random() * 400);
    target = Deno.serve({ hostname: "127.0.0.1", port: targetPort, onListen: () => {} }, () =>
      new Response(BODY, { headers: { "content-type": "text/plain" } }));
    const socksPort = targetPort + 1000;

    // `TestingTorNetwork` sets `ClientRejectInternalAddresses 0`, which is what makes a loopback
    // target reachable through a circuit at all — on a real network a client refuses one, correctly.
    const net = await standUpNetwork(dir, running);
    const tor = await startTor(dir, running, net, [`SocksPort ${socksPort}`], "Bootstrapped 100%");

    const got = await new Deno.Command("curl", {
      args: ["--silent", "--show-error", "--max-time", "60", "--noproxy", "",
             "--socks5-hostname", `127.0.0.1:${socksPort}`,
             `http://127.0.0.1:${targetPort}/`],
      env: { no_proxy: "", NO_PROXY: "", http_proxy: "", HTTP_PROXY: "" },
      stdout: "piped", stderr: "piped",
    }).output();
    const body = new TextDecoder().decode(got.stdout);
    const err = new TextDecoder().decode(got.stderr);

    tor.refresh();
    if (got.code !== 0) {
      throw new Error(`curl through tor failed (${load()}): ${err}\n--- tor.log ---\n${tor.log()}`);
    }

    // First: did it go through us at all? The relays are the first three entries in `running`; the
    // fourth is tor itself, and asking tor whether the bytes went through our relays is asking the
    // wrong process.
    const relays = running.slice(0, 3);
    await until(
      `a relay of ours to report opening the stream to 127.0.0.1:${targetPort}`,
      () => relays.some((r) => r.said().includes(`open to 127.0.0.1:${targetPort}`)),
      15000,
    ).catch(() => {
      throw new Error(
        "no relay of ours opened the stream, so whatever curl fetched did not come through them:\n" +
          relays.map((r, i) => `relay${i + 1}:\n${r.said().slice(-1500)}`).join("\n"),
      );
    });

    // Then: byte-identical, not merely non-empty. A stream that dropped or reordered a cell in the
    // middle would still pass a length check.
    if (body !== BODY) {
      throw new Error(
        `the body came back wrong: ${body.length} bytes, wanted ${BODY.length}\n` +
          `--- tor.log ---\n${tor.log()}`,
      );
    }
  } finally {
    if (target !== null) await target.shutdown();
    for (const r of running) {
      try {
        r.child.kill("SIGKILL");
        await r.child.status;
      } catch { /* already gone */ }
    }
    await Deno.remove(dir, { recursive: true });
  }
});
