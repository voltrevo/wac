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
  throw new Error(`timed out after ${ms}ms waiting for ${what}`);
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
    await buildApp("packages/tor/src/relayd.wac", `${dir}/relayd`, { read: true, write: true, net: true });
    await buildApp("packages/tor/src/gendesc.wac", `${dir}/gendesc`, { read: true, write: true });

    for (const n of [1, 2, 3]) {
      await Deno.writeFile(`${dir}/s${n}`, crypto.getRandomValues(new Uint8Array(32)));
    }

    // Port 0 throughout, so this cannot collide with another agent's suite — the same property that
    // let the wac-only network into the suite in the first place.
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

    // The authority, over the descriptors they just wrote.
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
    const [, orPort, relayFingerprint] = seed;
    const v3ident = (await Deno.readTextFile(`${dir}/cert.fingerprint`)).trim();

    await Deno.mkdir(`${dir}/tordata`);
    await Deno.writeTextFile(
      `${dir}/torrc`,
      [
        `DataDirectory ${dir}/tordata`,
        "SocksPort 0",
        "ControlPort 0",
        "TestingTorNetwork 1",
        `DirAuthority wacauth orport=${orPort} no-v2 v3ident=${v3ident} 127.0.0.1:17999 ${relayFingerprint}`,
        `Log notice file ${dir}/tor.log`,
        "",
      ].join("\n"),
    );

    running.push(start(TOR, ["-f", `${dir}/torrc`], dir));
    const torLog = async () => {
      try {
        return await Deno.readTextFile(`${dir}/tor.log`);
      } catch {
        return "";
      }
    };
    let log = "";
    await until("tor to bootstrap", () => {
      Deno.readTextFile(`${dir}/tor.log`).then((t) => (log = t)).catch(() => {});
      return log.includes("Bootstrapped 100%");
    }, 120000).catch(async (e) => {
      throw new Error(`${e.message}\n--- tor.log ---\n${await torLog()}`);
    });

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
