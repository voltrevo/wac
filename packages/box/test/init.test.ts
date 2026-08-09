// `init`: what the system says to start, started and reaped — design/0001 step 7's other half.
//
// Step 7 is "something owns the image, starts the daemons, and reaps". `sshd -i image` is the first
// half; this is the second, and the thing that makes it step 7 rather than a launcher is that **the
// services are data in the image**. You can `cat /etc/init`, edit it, and the next boot is different.
//
// Every case here runs through `imaged`, because that is what makes the point: the file the services
// come from is in the same image the session writes to.
//
// ## What is asserted, and what is deliberately not
//
// Asserted: services start, their output arrives, each status is reported, the worst becomes `init`'s
// own, an absent file starts nothing without failing, and comments and blank lines are skipped.
//
// Not asserted, because it is not implemented and says so: restart policy, dependency order, health,
// readiness, and stopping a service. `init.wac`'s header names all five. A test that checked "the
// service is still running" would be checking nothing, since nothing here can end one.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const tmp = await Deno.makeTempDir({ prefix: "wac-init-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

const imaged = `${tmp}/imaged`;
await buildApp("packages/box/src/bin/imaged.wac", imaged, { read: true, write: true });

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Run = { code: number; out: string; err: string };

function session(image: string, script: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", imaged, image, "-c", script],
    cwd: tmp,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/**
 * An image with `/etc/init` in it, written by one session so the next can boot it.
 *
 * The lines are passed with **real newlines** inside the single-quoted argument, not as `\n` escapes:
 * `printf '%s'` does not interpret escapes in its *argument*, only in its format, so the first version
 * of this wrote one service called `echo hello from a service\nseq 1 3` and the test read exactly
 * that back. The shell is right and the harness was wrong.
 */
function withServices(name: string, ...lines: string[]): string {
  const image = `${tmp}/${name}.wacimg`;
  const body = lines.join("\n") + "\n";
  const wrote = session(image, `mkdir /etc; printf '%s' '${body}' > /etc/init; cat /etc/init | wc -l`);
  if (wrote.code !== 0) throw new Error(`writing ${name}: ${wrote.err}`);
  return image;
}

Deno.test("the services are data in the image, and init starts and reaps them", () => {
  const image = withServices("basic", "echo hello from a service", "seq 1 3");
  const boot = session(image, "init");
  assertEquals(boot.code, 0, boot.err);

  const lines = boot.out.split("\n").filter((l) => l.length > 0);
  // Both start before either is waited for: `spawnSelf` gives a real child, so the starting is
  // concurrent even though the reporting below is in order.
  assertEquals(lines.slice(0, 2), ["init: started echo", "init: started seq"]);
  // Each service's own output, then its status — a status line before the output it belongs to would
  // be the wrong way round and is the shape this loop is written to avoid.
  assertEquals(lines.slice(2), [
    "hello from a service",
    "init: echo exited 0",
    "1",
    "2",
    "3",
    "init: seq exited 0",
  ]);
});

Deno.test("a service that fails is reported, and becomes init's own status", () => {
  const image = withServices("failing", "echo first", "false", "echo after");
  const boot = session(image, "init; echo status=$?");
  // The failure does not stop the others — there is no dependency order to break — and it is not
  // swallowed either. A launcher that reported 0 here would have hidden the only thing worth knowing.
  assertEquals(boot.out.includes("init: false exited 1"), true, boot.out);
  assertEquals(boot.out.includes("after"), true, "a later service did not run");
  assertEquals(boot.out.includes("status=1"), true, boot.out);
});

Deno.test("comments and blank lines are skipped, and an absent file starts nothing", () => {
  const image = withServices("comments", "# a comment", "", "echo only-me   # trailing");
  const boot = session(image, "init");
  const lines = boot.out.split("\n").filter((l) => l.length > 0);
  assertEquals(lines, ["init: started echo", "only-me", "init: echo exited 0"]);

  // No `/etc/init` at all: nothing to start, said out loud, and not a failure. A boot that started
  // nothing in silence is indistinguishable from one that started everything and lost the output.
  const empty = `${tmp}/empty.wacimg`;
  const none = session(empty, "init; echo status=$?");
  assertEquals(none.out.includes("status=0"), true, `${none.out} / ${none.err}`);
  assertEquals(none.err.includes("nothing to start"), true, none.err);
});

Deno.test("a service is a child with its own grants, not a call inside init", () => {
  // The claim `spawnSelf` is for, and the reason a service is a *process*: `init` hands each one
  // `GRANT_NONE`, so a service cannot read even though `imaged` itself can — it must, to open the
  // image. A service that could read would mean `init` was calling rather than spawning.
  const image = withServices("grants", "cat /etc/init");
  const boot = session(image, "init");
  // `cat` reads through the *session's* filesystem, which is the image — that is not the host read
  // being tested. What is tested is next: a service asking the host for a real file.
  assertEquals(boot.out.includes("init: cat exited"), true, boot.out);

  const host = withServices("hostread", "get /etc/hostname");
  const tried = session(host, "init");
  // Whatever `get` makes of it, the service must not have come back with this machine's hostname.
  const mine = (() => {
    try {
      return Deno.readTextFileSync("/etc/hostname").trim();
    } catch {
      return "";
    }
  })();
  if (mine.length > 0) {
    assertEquals(tried.out.includes(mine), false, `a service read the host's hostname: ${tried.out}`);
  }
});

Deno.test("a service can see the system it was started by", () => {
  // **The half of step 7 that was missing and said it was done.** A service was started with
  // `GRANT_NONE` and no filesystem channel, so it had no filesystem at all: an `/etc/init` saying
  // `cat /etc/motd` started `cat`, which could not see the image that line was read out of, and
  // exited 1. Every service that touched a file failed, on a system whose whole point is that what
  // boots is data in the image.
  //
  // It asks `init` now, over the channel wac-mono 0116 built — and `init` is itself a spawned applet
  // whose filesystem is the session's, so the question travels the chain to whoever holds the image.
  // Grants stay `GRANT_NONE`: a service needs no capability of its own precisely because it asks.
  const image = `${tmp}/reading.wacimg`;
  const wrote = session(image, "mkdir /etc; echo hello from the image > /etc/motd; " +
    "printf '%s' 'cat /etc/motd\nwc -l /etc/motd\n' > /etc/init");
  if (wrote.code !== 0) throw new Error(`writing the image: ${wrote.err}`);

  const boot = session(image, "init");
  assertEquals(boot.code, 0, boot.out + boot.err);
  const lines = boot.out.split("\n").filter((l) => l.length > 0);
  assertEquals(lines, [
    "init: started cat",
    "init: started wc",
    "hello from the image",
    "init: cat exited 0",
    "1 /etc/motd",
    "init: wc exited 0",
  ]);
});

Deno.test("a service that fails says why, which is the part an init system is for", () => {
  // `init` read each service's standard output and **never its error stream**, so when every service
  // was failing for want of a filesystem all a boot said was "exited 1". A service that dies is
  // expected; a service that dies without saying why is a system nobody can fix.
  const image = `${tmp}/complaining.wacimg`;
  const wrote = session(image, "mkdir /etc; printf '%s' 'cat /etc/nosuch\n' > /etc/init");
  if (wrote.code !== 0) throw new Error(`writing the image: ${wrote.err}`);

  const boot = session(image, "init");
  assertEquals(boot.code, 1, boot.out + boot.err);
  // The service's own words, on the stream a diagnostic belongs on...
  assertEquals(
    boot.err.includes("cat: /etc/nosuch: No such file or directory"),
    true,
    `the service's complaint went nowhere: ${JSON.stringify(boot.err)}`,
  );
  // ...and before the line that says it ended, which is the same ordering the output half keeps.
  assertEquals(boot.out.trimEnd().split("\n").pop(), "init: cat exited 1", boot.out);
});
