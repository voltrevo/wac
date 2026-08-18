// **The arrival test's last two words: users and system services.**
//
// design/0001 asks for "the same users, files, installed programs, shell behaviour and system services"
// in two substantially different hosts. `arrival.test.ts` covers files, programs and shell behaviour by
// moving an image between them. This is the other half, and it needs a *service*: the users only exist
// once something logs in as them.
//
// So: `packages/ssh`'s `sshd` built twice. The **JavaScript host** writes the world — `/etc/passwd`,
// two homes, two `authorized_keys`, two private files with owners and modes. The **host with no
// JavaScript in it** then serves that same image, and a real OpenSSH client logs in as each user.
//
// design/0001 step 4's own criterion is "two keys land in two homes and neither can read the other's
// private file". That criterion is met here **across hosts**: the world was written by one and is
// enforced by the other, out of the image, with nothing about the machine underneath consulted.
//
// ## What makes this evidence rather than a demonstration
//
// The client is `ssh(1)` — a program neither host wrote, which will not connect at all unless the key
// exchange, the ciphers and the authentication are right. And the permission denial comes from
// `packages/fs` reading a `mode` and an `owner` **stored in the image**, not from the operating system:
// the whole image is one file owned by whoever ran the process, so the host could not enforce it even
// if it wanted to.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
import { withPort } from "../../../harness/port.ts";  // one allocator — wac-mono 0069
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";
// Memoised, and answered by `stat` when the crate has not moved — a bare `cargo build` is 2.6s even
// with nothing to do, and this file asks more than once.
import { nativeBinary } from "../../../harness/nativeHost.ts";

const ENTRY = "packages/ssh/src/sshd.wac";
const CRATE = "native";

/** Whether this machine has the tools: without `ssh` and `ssh-keygen` there is no client. */
const haveSsh = await (async () => {
  for (const tool of ["ssh", "ssh-keygen"]) {
    const r = await new Deno.Command("sh", { args: ["-c", `command -v ${tool}`], stdout: "null", stderr: "null" })
      .output();
    if (!r.success) return false;
  }
  return true;
})();

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-arrival-users-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

async function keygen(name: string): Promise<void> {
  const r = await new Deno.Command("ssh-keygen", {
    args: ["-t", "ed25519", "-f", `${tmp}/${name}`, "-N", "", "-q"],
    stdout: "null",
    stderr: "piped",
  }).output();
  if (!r.success) throw new Error(`ssh-keygen ${name}: ${new TextDecoder().decode(r.stderr)}`);
  await Deno.chmod(`${tmp}/${name}`, 0o600);
}

type Said = { code: number; out: string; err: string };

async function ssh(port: number, key: string, user: string, script: string): Promise<Said> {
  const r = await new Deno.Command("ssh", {
    args: [
      "-p", String(port),
      "-i", `${tmp}/${key}`,
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=10",
      `${user}@127.0.0.1`,
      script,
    ],
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** A server, started and waited for until it says which port it took. */
async function serve(cmd: string, args: string[], port: number): Promise<Deno.ChildProcess> {
  const child = new Deno.Command(cmd, {
    args,
    stdout: "piped",
    stderr: "piped",
    stdin: "null",
  }).spawn();
  // The startup line, which is the only thing that says binding finished — racing it is how a test
  // like this becomes flaky rather than failing.
  const reader = child.stderr.getReader();
  const d = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    seen += d.decode(value);
    if (seen.includes(`listening on port ${port}`)) {
      reader.releaseLock();
      return child;
    }
  }
  reader.releaseLock();
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  throw new Error(`the server never said it was listening on ${port}: ${seen}`);
}

async function stop(child: Deno.ChildProcess): Promise<void> {
  try {
    child.kill();
  } catch {
    // Already gone.
  }
  await child.status;
}


Deno.test({
  name: "two keys land in two homes on a host that did not write the image",
  ignore: !haveSsh,
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const native = await nativeBinary();
    const deno = `${tmp}/sshd-deno`;
    await buildApp(ENTRY, deno, { read: true, write: true, net: true, env: true });
    await buildNative(ENTRY, `${tmp}/sshd`, { read: true, write: true, net: true, env: true });

    for (const name of ["hostkey", "admin", "ada", "grace"]) await keygen(name);
    await Deno.copyFile(`${tmp}/admin.pub`, `${tmp}/authorized_keys`);
    const pub = async (n: string) => (await Deno.readTextFile(`${tmp}/${n}.pub`)).trim();
    const image = `${tmp}/system.wacimg`;

    // ── The JavaScript host writes the world ────────────────────────────────
    //
    // Through `withPort`, which releases the port immediately before the bind and retries the race —
    // `holdPort` alone *keeps* the socket, so a server handed its port cannot have it.
    let port = 0;
    let server = await withPort(async (p) => {
      port = p;
      return await serve(deno, [
        "-p", String(p), "-h", `${tmp}/hostkey`, "-a", `${tmp}/authorized_keys`, "-i", image,
      ], p);
    });
    const first = { port };
    try {
      const build = [
        "mkdir /etc",
        `printf 'ada:x:1000:1000::/home/ada:/bin/sh\\ngrace:x:1001:1001::/home/grace:/bin/sh\\n' > /etc/passwd`,
        "mkdir /home; mkdir /home/ada; mkdir /home/ada/.ssh; mkdir /home/grace; mkdir /home/grace/.ssh",
        `printf '%s\\n' '${await pub("ada")}' > /home/ada/.ssh/authorized_keys`,
        `printf '%s\\n' '${await pub("grace")}' > /home/grace/.ssh/authorized_keys`,
        "echo the difference engine > /home/ada/secret",
        "echo the first compiler > /home/grace/secret",
        "chmod 600 /home/ada/secret; chown ada /home/ada/secret",
        "chmod 600 /home/grace/secret; chown grace /home/grace/secret",
        "chown ada /home/ada; chown grace /home/grace",
      ].join("; ");
      const made = await ssh(first.port, "admin", "root", build);
      assertEquals(made.code, 0, `building the world: ${made.err}`);
      // **No second connection.** This used to need one: the image was written after the connection
      // was over, so killing the server as soon as `ssh` returned could beat the save and the next
      // host booted an empty world (0108). A session writes before it tells the client the command
      // finished now, so the assertion can be made where it means more — on the file itself, once
      // the server that wrote it is gone.
    } finally {
      await stop(server);
    }

    // The image on disk carries the table, checked with nothing running: an image that never got the
    // users and a second host that cannot read them are different failures, and this rules out the
    // first before the second host is asked anything.
    const onDisk = new TextDecoder().decode(await Deno.readFile(image));
    assertEquals(onDisk.includes("ada:x:1000"), true, "the stopped server left an image with no users");

    if (native === null) return;

    // ── …and the host with no JavaScript in it serves the same file ─────────
    let nativePort = 0;
    server = await withPort(async (p) => {
      nativePort = p;
      return await serve(native, [
        `${tmp}/sshd.json`,
        "-p", String(p), "-h", `${tmp}/hostkey`, "-a", `${tmp}/authorized_keys`, "-i", image,
      ], p);
    });
    const second = { port: nativePort };
    try {
      // Each key lands in its own home, with its own name, without the server being told either.
      const ada = await ssh(second.port, "ada", "ada", "pwd; echo $USER");
      assertEquals(ada.out, "/home/ada\nada\n", `${ada.out} / ${ada.err}`);
      // Grace logs in *after* ada, so this also says the server reads policy as the system rather than
      // as whoever it served last.
      const grace = await ssh(second.port, "grace", "grace", "pwd; echo $USER");
      assertEquals(grace.out, "/home/grace\ngrace\n", `${grace.out} / ${grace.err}`);

      // Each reads their own.
      const own = await ssh(second.port, "ada", "ada", "cat /home/ada/secret");
      assertEquals(own.out, "the difference engine\n", own.err);

      // And neither reads the other's — design/0001 step 4's criterion, on a host that did not write
      // the image. The mode and the owner are **in the image**: the whole thing is one file owned by
      // whoever ran the process, so the operating system could not enforce this even if it tried.
      const theirs = await ssh(second.port, "ada", "ada", "cat /home/grace/secret; echo status=$?");
      assertEquals(theirs.out.includes("status=1"), true, `${theirs.out} / ${theirs.err}`);
      assertEquals(theirs.out.includes("the first compiler"), false, "ada read grace's secret");
      assertEquals(theirs.err.includes("Permission denied"), true, theirs.err);
    } finally {
      await stop(server);
    }
  },
});
