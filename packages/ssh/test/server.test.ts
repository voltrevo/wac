// The `sshd` program, tested by OpenSSH's own client.
//
// Every other test in this package points one way: our code against a real server. This one is
// the reverse, and it is worth having for exactly that reason — it exercises paths nothing else
// touches. The server offers algorithm lists a real client negotiates against, *signs* an
// exchange hash rather than verifying one, is the side that answers a key probe, and picks the
// channel number the client then has to use. None of that is reachable from the client side.
//
// A second implementation of my own misconceptions would agree with itself. OpenSSH does not.

// test-lane: exclusive — a real OpenSSH client against our server, on a real port.

import { haveSshd } from "./server.ts";
import { holdPort, isAddrInUse } from "../../../harness/port.ts";  // one allocator — wac-mono 0069
import { ABANDONED_SSHD } from "./server.ts";
import { reapOrphans } from "../../../harness/reap.ts";

/**
 * Every binary this file builds, removed on the way out.
 *
 * Each build is a fresh ~700 KiB executable and there is no suite teardown to remove it, so `/tmp`
 * accumulated five hundred of them and a parallel run eventually died with "No space left on device"
 * in a package that had nothing to do with it. `unload` fires whether the tests passed, failed or
 * threw, which is the only hook that covers all three.
 */
const built: string[] = [];
globalThis.addEventListener("unload", () => {
  for (const path of built) {
    try {
      Deno.removeSync(path, { recursive: true });
    } catch {
      // Already gone. Nothing to report on the way out.
    }
  }
});

const text = (b: Uint8Array) => new TextDecoder().decode(b);



type Wacsshd = { dir: string; port: number; proc: Deno.ChildProcess; stderr: Promise<string> };

/**
 * The server, built once as a standalone program.
 *
 * Not `deno task app`, which builds and then *spawns* the result: it waits with `outputSync`,
 * so killing the launcher leaves the application running with nothing to reap it. Doing that
 * once per test leaked 57 servers and 13,736 zombie children before anything noticed, and the
 * container ran out of process ids. Running the built binary directly means the handle we hold
 * is the process we kill.
 */
/** The client, built once, for the both-ends-in-wac test. See the note in `cli.test.ts`. */
const sshBinary = await (async () => {
  const out = await Deno.makeTempFile({ prefix: "wac-ssh-" });
  built.push(out);
  const r = await new Deno.Command("deno", {
    args: [
      "run", "-A", "packages/platform/build.ts", "packages/ssh/src/ssh.wac",
      "--allow-read", "--allow-net", "--allow-env", "-o", out,
    ],
  }).output();
  if (!r.success) throw new Error(`building ssh failed: ${new TextDecoder().decode(r.stderr)}`);
  return out;
})();

// Our own server leaks the same way the system one does: a killed run leaves it listening with init as
// its parent. `wacsshd-…` is the temp-file prefix below, so the pattern is this file's own shape — and a
// running instance always has this process as its parent, so nothing live can match. wac-mono 0073.
reapOrphans(/\/tmp\/wacsshd-[A-Za-z0-9]+/, "wacsshd");

const wacsshdBinary = await (async () => {
  const out = await Deno.makeTempFile({ prefix: "wacsshd-" });
  built.push(out);
  const r = await new Deno.Command("deno", {
    args: [
      "run", "-A", "packages/platform/build.ts", "packages/ssh/src/sshd.wac",
      "--allow-read", "--allow-net", "--allow-env", "-o", out,
    ],
  }).output();
  if (!r.success) throw new Error(`building sshd failed: ${new TextDecoder().decode(r.stderr)}`);
  return out;
})();

/**
 * The same server, built with `--allow-write` as well.
 *
 * A server that boots an image has to be able to write one back, and the binary above deliberately
 * cannot: every other test here is about what a *read-only* server does, and widening its grants to suit
 * one test would quietly widen what all of them prove. Two binaries, one line of difference — and the
 * difference is the point, because the first thing the image tests found was this one warning that it
 * could not save and carrying on, which is the right behaviour and an invisible one.
 */
const wacsshdWritableBinary = await (async () => {
  const out = await Deno.makeTempFile({ prefix: "wacsshd-" });
  built.push(out);
  const r = await new Deno.Command("deno", {
    args: [
      "run", "-A", "packages/platform/build.ts", "packages/ssh/src/sshd.wac",
      "--allow-read", "--allow-write", "--allow-net", "--allow-env", "-o", out,
    ],
  }).output();
  if (!r.success) throw new Error(`building a writable sshd failed: ${new TextDecoder().decode(r.stderr)}`);
  return out;
})();

/** Our server, running, with a host key and one authorized client key. */
/**
 * Start one, retrying a port that somebody else took between the probe and the bind.
 *
 * `harness/port.ts` describes that window and provides `withPort` for exactly this; this call site was
 * not using it, and lost a gate run to `Address already in use` from another agent's server on the same
 * machine. A bind failure is the *only* thing retried — anything else is a real failure and is thrown
 * on the first attempt, because retrying those turns one clear error into three slow ones.
 */
async function startWacsshd(extra: string[] = [], binary = wacsshdBinary): Promise<Wacsshd> {
  let last: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await startWacsshdOnce(extra, binary);
    } catch (e) {
      if (!isAddrInUse(e)) throw e;
      last = e;
      console.error(`the port was taken between the probe and the bind; retrying (${attempt}/3)`);
    }
  }
  throw last;
}

async function startWacsshdOnce(extra: string[] = [], binary = wacsshdBinary): Promise<Wacsshd> {
  const dir = await Deno.makeTempDir();
  await Deno.mkdir(`${dir}/.ssh`);
  for (const [name, path] of [["host", `${dir}/.ssh/ssh_host_ed25519_key`], ["client", `${dir}/clientkey`]] as const) {
    const r = await new Deno.Command("ssh-keygen", {
      args: ["-t", "ed25519", "-f", path, "-N", "", "-q"],
    }).output();
    if (!r.success) throw new Error(`ssh-keygen failed for ${name}`);
    await Deno.chmod(path, 0o600);
  }
  await Deno.copyFile(`${dir}/clientkey.pub`, `${dir}/.ssh/authorized_keys`);

  const held = holdPort();
  const port = held.port;
  held.release();   // the next statement binds it
  const proc = new Deno.Command(binary, {
    args: ["-p", String(port), ...extra],
    env: { HOME: dir },
    clearEnv: false,
    stdout: "null",
    // Captured rather than discarded so a test can read what the server said about itself. The
    // startup line is the only place `sshd.wac`'s `itoa` is observable at all, and it survived
    // mutation testing as `return ""` — a server announcing "listening on port " with no number.
    stderr: "piped",
  }).spawn();

  // Drained as it arrives, rather than with `new Response(proc.stderr).text()`, which only resolves
  // at end of stream. Two things need it: a server that filled the pipe would block, and startup
  // has to be able to wait for a *particular* line.
  let said = "";
  let announced = () => {};
  const hasAnnounced = new Promise<void>((r) => { announced = r; });
  const stderr = (async () => {
    const dec = new TextDecoder();
    for await (const chunk of proc.stderr) {
      said += dec.decode(chunk, { stream: true });
      if (said.includes("listening on port")) announced();
    }
    announced();          // the process ended without saying it; the waiter must not hang
    return said;
  })();

  // Poll rather than sleep: the first run compiles the wac and the rest do not.
  //
  // **Sixty seconds, not twenty.** The old bound was twenty and it expired once — in the gate, where the
  // whole suite runs at once and a 561 KB wasm module has to be instantiated against a load average of
  // ten. The same test takes under a second on its own. A patient bound costs nothing when the server is
  // quick, because the loop leaves the moment it connects; an impatient one fails a test for the state of
  // the machine, which is a report about the wrong thing entirely.
  //
  // **And it stops the moment the process dies.** It used to poll the full bound and then say "our sshd
  // never accepted a connection", which is true and useless: a server that refused its host key, or
  // could not bind, said exactly why on stderr and exited in milliseconds, and the harness spent a
  // minute not reading it. Waiting for something that has already stopped happening is the wrong
  // failure to report — twice over, because the first thing it hides is the message that explains it.
  let accepted = false;
  let died: number | null = null;
  proc.status.then((st) => { died = st.code; });
  for (let i = 0; i < 600 && !accepted && died === null; i++) {
    try {
      const probe = await Deno.connect({ hostname: "127.0.0.1", port });
      probe.close();
      accepted = true;
    } catch {
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (!accepted) {
    const why = (await Promise.race([stderr, new Promise<string>((r) => setTimeout(() => r(said), 500))]))
      .trim();
    throw new Error(
      died === null
        ? `our sshd never accepted a connection on port ${port}. It said: ${why || "nothing"}`
        : `our sshd exited ${died} before accepting anything. It said: ${why || "nothing"}`,
    );
  }

  // **And wait for the announcement, not just for the socket.** A successful connect only proves
  // the listener is bound; the startup line is written around the same moment and read here a
  // moment later. Returning on the connect alone meant a test could `SIGKILL` the server before
  // that line had been drained, and then assert on an empty string — which is what made this file
  // fail about one full parallel run in ten, always in the one test that reads stderr. Issue 0026.
  await Promise.race([
    hasAnnounced,
    new Promise((r) => setTimeout(r, 20_000)),
  ]);
  return { dir, port, proc, stderr };
}

async function stopWacsshd(s: Wacsshd | undefined): Promise<void> {
  if (s === undefined) return;
  try { s.proc.kill("SIGKILL"); } catch { /* already gone */ }
  await s.proc.status;
  await Deno.remove(s.dir, { recursive: true });
}

/**
 * The real OpenSSH client, against our server.
 *
 * **`-F /dev/null` is why a real bug lived here for as long as it did.** Discarding the system
 * config makes the test reproducible, and it also removes `SendEnv LANG LC_*` — the Debian and
 * Ubuntu default — so the client never sent the `env` requests that broke the server. `extra`
 * exists to put them back: see the test named for it below.
 */
async function realSsh(
  s: Wacsshd, command: string, key = `${s.dir}/clientkey`, extra: string[] = [],
) {
  const r = await new Deno.Command("ssh", {
    args: [
      "-F", "/dev/null", "-i", key, "-p", String(s.port),
      "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
      "-o", "BatchMode=yes", ...extra, "claude@127.0.0.1", command,
    ],
    env: {
      LANG: "C.UTF-8", LC_ALL: "C.UTF-8", HOME: s.dir,
      PATH: Deno.env.get("PATH") ?? "/usr/bin:/bin",
    },
    clearEnv: true,
  }).output();
  // The client writes its host key notice to stderr; it is not the command's output.
  const stderr = text(r.stderr).split("\n")
    .filter(l => !l.startsWith("Warning: Permanently added")).join("\n");
  return { code: r.code, stdout: text(r.stdout), stderr };
}

Deno.test({
  name: "OpenSSH's own client connects to our server, authenticates and runs a command",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    let s: Wacsshd | undefined;
    try {
      s = await startWacsshd();

      const hello = await realSsh(s, "echo hello from the wac server");
      if (hello.code !== 0) throw new Error(`exit ${hello.code}: ${hello.stderr}`);
      if (hello.stdout !== "hello from the wac server\n") {
        throw new Error(`stdout was ${JSON.stringify(hello.stdout)}`);
      }
      // A clean end. Closing the socket without waiting for the client's CHANNEL_CLOSE makes ssh
      // report "Connection closed by remote host", and sending DISCONNECT instead makes it throw
      // the output away and exit 255 — so the absence of both is the assertion.
      if (hello.stderr.trim() !== "") throw new Error(`unexpected stderr: ${hello.stderr}`);

      // The command's exit status reaches the client as its own.
      for (const [command, want] of [["true", 0], ["false", 1], ["frobnicate", 127]] as const) {
        const r = await realSsh(s, command);
        if (r.code !== want) throw new Error(`${command}: exit ${r.code}, expected ${want}`);
      }

      // The two streams stay apart.
      const missing = await realSsh(s, "frobnicate");
      if (missing.stdout !== "") throw new Error("an error message went to stdout");
      if (!missing.stderr.includes("command not found")) {
        throw new Error(`stderr was ${JSON.stringify(missing.stderr)}`);
      }

      // The command is run by `packages/sh`, so what arrives over the channel is a shell script
      // rather than a name the server knows. Each of these needs a different part of it.
      for (const [script, want] of [
        ["seq 1 100 | grep 7 | wc -l", "19\n"],                       // pipeline, three stages
        // `head` rather than `tr`: `packages/sh` has given `tr` up to `packages/box`'s applet, and this
        // server still gets its commands from `packages/sh` (wac-mono 0103 — the `ssh` → `box` edge is
        // blocked on a compiler bug, wac 0076). What is under test is quoting and expansion.
        ['x="a b c"; echo "$x" | head -1', "a b c\n"],
        ['echo "there are $(seq 1 5 | wc -l) lines"', "there are 5 lines\n"],   // substitution
        ["false || echo fallback", "fallback\n"],                     // and-or
        ["echo a; echo b", "a\nb\n"],                                 // a list
      ] as const) {
        const r = await realSsh(s, script);
        if (r.stdout !== want) {
          throw new Error(`${script}\n  got  ${JSON.stringify(r.stdout)}\n  want ${JSON.stringify(want)}`);
        }
      }

      // A file read through the capability world, sorted by the shell's own `sort`.
      const cat = await realSsh(s, `cat ${s.dir}/.ssh/authorized_keys`);
      if (!cat.stdout.startsWith("ssh-ed25519 ")) throw new Error(`cat gave ${cat.stdout.slice(0, 40)}`);

      // The shell's exit status becomes the channel's, which becomes ssh's.
      const nomatch = await realSsh(s, "seq 1 3 | grep 9");
      if (nomatch.code !== 1) throw new Error(`grep with no match exited ${nomatch.code}`);

      // A key that is not in authorized_keys does not get in. This is the check that the
      // signature verification and the key lookup are both doing something.
      const other = `${s.dir}/otherkey`;
      await new Deno.Command("ssh-keygen", {
        args: ["-t", "ed25519", "-f", other, "-N", "", "-q"],
      }).output();
      await Deno.chmod(other, 0o600);
      const refused = await realSsh(s, "echo should not run", other);
      if (refused.code === 0) throw new Error("an unauthorized key was let in");
      if (refused.stdout !== "") throw new Error("an unauthorized key ran a command");
      if (!refused.stderr.includes("Permission denied")) {
        throw new Error(`unexpected refusal: ${refused.stderr}`);
      }
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "with a pty the server does the line editing, and the output comes back for a terminal",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    // `ssh -tt` asks for a pty, which this server refused until design/0001 step 5. The refusal was the
    // honest answer while there was nothing to echo with: a client that gets a pty stops echoing
    // locally, so every keystroke it sends must come back or the user types blind.
    //
    // What is asserted is the two halves of that. The **echo**, including an erase the client never
    // saw — the backspace is one byte on the wire and three back, and the client does nothing with
    // either. And **`\r\n` on the output**, which the shell does not write: a terminal in raw mode does
    // not return the cursor on a bare newline, so without that translation every line would start where
    // the last one ended.
    let s: Wacsshd | undefined;
    try {
      s = await startWacsshd();
      const r = new Deno.Command("ssh", {
        args: [
          "-tt", "-F", "/dev/null", "-i", `${s.dir}/clientkey`, "-p", String(s.port),
          "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
          "-o", "BatchMode=yes", "claude@127.0.0.1",
        ],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = r.stdin.getWriter();
      // `echo hX<DEL>i` — typed wrong and corrected, which only works if this end is editing.
      await w.write(new TextEncoder().encode("echo hX\x7fi\n"));
      await w.write(new Uint8Array([4]));   // ^D on an empty line ends the session
      await w.close();
      const out = await r.output();
      const got = text(out.stdout);

      // The echo, with the erase in it: three bytes back for the one that was typed.
      if (!got.includes("echo hX\b \bi\r\n")) {
        throw new Error(`no echo with an erase in it: ${JSON.stringify(got)}`);
      }
      // …and the corrected command ran, with its output wound back to the left margin.
      if (!got.includes("hi\r\n")) {
        throw new Error(`the corrected command did not run: ${JSON.stringify(got)}`);
      }
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "an interactive session keeps its shell between lines",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    let s: Wacsshd | undefined;
    try {
      s = await startWacsshd();

      // `ssh -T` asks for a shell and no pty, which is the case this server serves. Lines go in
      // over the channel and each one runs as it arrives.
      const r = await new Deno.Command("ssh", {
        args: [
          "-T", "-F", "/dev/null", "-i", `${s.dir}/clientkey`, "-p", String(s.port),
          "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
          "-o", "BatchMode=yes", "claude@127.0.0.1",
        ],
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const w = r.stdin.getWriter();
      await w.write(new TextEncoder().encode(
        "x=hello\n" +
        "echo $x world\n" +
        "seq 1 5 | wc -l\n" +
        "echo state persists: $x\n"));
      await w.close();
      const out = await r.output();
      const stdout = text(out.stdout);

      // The middle assertion is the one that makes it a *session*: a variable set on the first
      // line is still there on the fourth. Without one shell for the whole channel each line
      // would start again and the last would print nothing.
      const want = "hello world\n5\nstate persists: hello\n";
      if (stdout !== want) {
        throw new Error(`interactive session:\n  got  ${JSON.stringify(stdout)}\n  want ${JSON.stringify(want)}`);
      }

      // `exit` ends the session and its status becomes ssh's.
      const bye = new Deno.Command("ssh", {
        args: [
          "-T", "-F", "/dev/null", "-i", `${s.dir}/clientkey`, "-p", String(s.port),
          "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
          "-o", "BatchMode=yes", "claude@127.0.0.1",
        ],
        stdin: "piped",
        stdout: "null",
        stderr: "null",
      }).spawn();
      const bw = bye.stdin.getWriter();
      await bw.write(new TextEncoder().encode("exit 6\n"));
      await bw.close();
      const byeStatus = await bye.status;
      if (byeStatus.code !== 6) throw new Error(`exit 6 gave ${byeStatus.code}`);
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "our own client talks to our own server, both ends in wac",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    let s: Wacsshd | undefined;
    try {
      s = await startWacsshd();

      // A HOME for the client, with the server's host key recorded so it will proceed.
      const home = `${s.dir}/clienthome`;
      await Deno.mkdir(`${home}/.ssh`, { recursive: true });
      await Deno.copyFile(`${s.dir}/clientkey`, `${home}/.ssh/id_ed25519`);
      await Deno.chmod(`${home}/.ssh/id_ed25519`, 0o600);
      const hostBlob = (await Deno.readTextFile(`${s.dir}/.ssh/ssh_host_ed25519_key.pub`)).split(" ")[1];
      await Deno.writeTextFile(`${home}/.ssh/known_hosts`,
        `[127.0.0.1]:${s.port} ssh-ed25519 ${hostBlob}\n`);

      // The built client, not `platform/app.ts`: the launcher spawns the application and forwards
      // no signals, so each call left an orphan behind. Same reason the server binary above is
      // built once — wac-mono issue 0017.
      const r = await new Deno.Command(sshBinary, {
        args: ["-p", String(s.port), "127.0.0.1", "echo", "both", "ends", "in", "wac"],
        env: { HOME: home, USER: "claude" },
        clearEnv: false,
      }).output();
      if (r.code !== 0) throw new Error(`exit ${r.code}: ${text(r.stderr)}`);
      if (text(r.stdout) !== "both ends in wac\n") {
        throw new Error(`stdout was ${JSON.stringify(text(r.stdout))}`);
      }

      // Worth being explicit that this proves less than the test above: two implementations that
      // share an author agree with each other about a misreading as readily as about the spec.
      // It is here because it exercises both halves in one process tree, not as evidence.
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "a client that sends environment requests first still gets its command run",
  ignore: !haveSshd,
  sanitizeResources: false,
  async fn() {
    const s = await startWacsshd();
    try {
      // `SendEnv LANG LC_*` is the default in Debian's and Ubuntu's `ssh_config`, so this is what
      // most clients in the world actually do: two `env` channel requests, both with want_reply
      // *false*, and then `exec`.
      //
      // The server used to treat every request that was not `shell` as an attempt to `exec`,
      // fail to read a command out of it, and answer CHANNEL_FAILURE. Since the `env` requests
      // asked for no reply, those answers landed against the *next* request the client had made —
      // its `exec` — so every command failed with `exec request failed on channel 0` while the
      // server logged that the client had never asked to run anything.
      //
      // It is invisible without this test, because the rest of them pass `-F /dev/null`.
      const r = await realSsh(s, "echo env-first", undefined, ["-o", "SendEnv=LANG LC_*"]);
      if (r.stdout !== "env-first\n") {
        throw new Error(`env-first: got ${JSON.stringify(r.stdout)} code ${r.code}\n${r.stderr}`);
      }
      if (r.code !== 0) throw new Error(`env-first: exit ${r.code}\n${r.stderr}`);

      // And the same again with a command whose status is not zero, so the reply pairing is
      // checked rather than just the happy path.
      const bad = await realSsh(s, "exit 7", undefined, ["-o", "SendEnv=LANG LC_*"]);
      if (bad.code !== 7) throw new Error(`env-first status: exit ${bad.code}\n${bad.stderr}`);
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "a refused subsystem is answered, because that request did want a reply",
  ignore: !haveSshd,
  sanitizeResources: false,
  async fn() {
    const s = await startWacsshd();
    try {
      // The other half of the `want_reply` rule, and the half the `SendEnv` test above cannot
      // reach. That one proves we stay *silent* for requests that asked for nothing; this proves
      // we still *answer* one that asked. Without it, `requestWantsReply` could return a constant
      // `false` and the whole suite stayed green — which is exactly what mutation testing found.
      //
      // It used to ask this with `ssh -tt`, whose `pty-req` we refused. That request is **accepted**
      // now (design/0001 step 5, and the test above drives it), so the refusal it was reading is gone
      // and the property needed a request this server still refuses. `-s` asks for a subsystem —
      // `sftp` — with want_reply set, and there is no subsystem here.
      const r = await new Deno.Command("ssh", {
        args: [
          "-s", "-F", "/dev/null", "-i", `${s.dir}/clientkey`, "-p", String(s.port),
          "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
          "-o", "BatchMode=yes", "claude@127.0.0.1", "sftp",
        ],
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).output();
      const err = text(r.stderr);
      if (!err.includes("subsystem request failed")) {
        throw new Error(`no refusal reached the client. stderr: ${JSON.stringify(err)}`);
      }
    } finally {
      await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "the server announces the port it is actually listening on",
  ignore: !haveSshd,
  sanitizeResources: false,
  async fn() {
    const s = await startWacsshd();
    let said: string;
    try {
      // `itoa` in `sshd.wac` has exactly one observable: this line. It survived mutation testing
      // replaced by `return ""`, which yields `sshd: listening on port ` — a server that has
      // forgotten to say where it is. Harmless-looking, and the first thing anyone reads when a
      // connection will not go through.
      //
      // Asserted against the port the *test* chose, not against whatever the line contains, so a
      // number that is merely present but wrong fails too.
      await stopWacsshd(s);
      said = await s.stderr;
    } catch (e) {
      await stopWacsshd(s);
      throw e;
    }
    const want = `sshd: listening on port ${s.port}`;
    if (!said.includes(want)) {
      throw new Error(`expected ${JSON.stringify(want)}, server said ${JSON.stringify(said.trim())}`);
    }
  },
});

Deno.test("the abandoned-sshd pattern matches what ps actually prints", () => {
  // The trap this exists for: sshd rewrites its own argv, so what `ps` shows is not what was executed. A
  // pattern anchored at the binary matches nothing, the reaper finds nothing, and a machine with thirty
  // leaked daemons looks exactly like a clean one. wac-mono 0073.
  const listener =
    "sshd: /usr/sbin/sshd -D -f /tmp/tmp.VPs8c9aLpd/sshd_config [listener] 0 of 10-100 startups";
  if (!ABANDONED_SSHD.test(listener)) {
    throw new Error(`the pattern does not match a real listener:\n  ${listener}`);
  }
  // And what it must not match: the machine's own sshd, and a client.
  for (const other of [
    "/usr/sbin/sshd -D",
    "sshd: /usr/sbin/sshd -D -f /etc/ssh/sshd_config [listener]",
    "ssh -p 2222 -o StrictHostKeyChecking=no user@127.0.0.1 true",
  ]) {
    if (ABANDONED_SSHD.test(other)) throw new Error(`the pattern matches something it must not:\n  ${other}`);
  }
});

/**
 * design/0001 step 7, the half of it that is this package's: a server that boots an image and serves
 * sessions from it.
 *
 * The first composition of three packages end to end — `packages/ssh` carries the bytes, `packages/sh`
 * runs the commands, `packages/fs` holds the filesystem and writes it down — with OpenSSH's own client
 * driving the whole thing. What makes it worth a test rather than a demo is the *second* connection: a
 * session that finds what the last one left is a system, and one that does not is a toy.
 */
Deno.test({
  name: "a server booted on an image serves every session from it, and saves what they do",
  ignore: !haveSshd,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-image-" });
    const image = `${dir}/home.wacimg`;
    let s: Wacsshd | null = null;
    try {
      s = await startWacsshd(["-i", image], wacsshdWritableBinary);

      // **The commands are `packages/box`'s applets now**, over the image: sixty of them rather than the
      // handful `packages/sh` still carries, and they read what the session reads. The edge waited on a
      // compiler bug (wac 0076) and on applets taking an `Fs` (wac-mono 0109).
      const applets = await realSsh(s, "seq 1 20 > n; sort -nr n | head -3; sha256sum n | cut -c1-16; rm n");
      if (applets.stdout !== "20\n19\n18\nb76ae83c50d61040\n") throw new Error(JSON.stringify(applets));

      // A session with no filesystem grants of its own: `/` is the image, not the server's disk.
      const made = await realSsh(s, "mkdir /data; echo hello > /data/notes; ls /");
      if (made.stdout !== "bin\ndata\ndev\nproc\n") throw new Error(JSON.stringify(made.stdout));

      // A *second connection to the same process* finds it. This is the assertion the whole thing is
      // for: without it the test passes for a server that hands each client a fresh empty filesystem.
      const found = await realSsh(s, "cat /data/notes; ls /data");
      if (found.stdout !== "hello\nnotes\n") throw new Error(JSON.stringify(found.stdout));

      // And the host's own files are not reachable through it, which is what makes this offerable to a
      // stranger — `packages/box/src/bin/sealedsh.wac` names that as the reason it exists.
      const host = await realSsh(s, "cat /etc/passwd; echo status=$?");
      if (!host.stdout.includes("status=1")) throw new Error(JSON.stringify(host.stdout));

      await stopWacsshd(s);
      s = null;

      // A different server process, the same file. The image outlived the program that wrote it, which
      // is the difference between saving state and having it.
      const again = await startWacsshd(["-i", image], wacsshdWritableBinary);
      try {
        const back = await realSsh(again, "cat /data/notes; ls /");
        if (back.stdout !== "hello\nbin\ndata\ndev\nproc\n") throw new Error(JSON.stringify(back.stdout));
      } finally {
        await stopWacsshd(again);
      }
    } finally {
      if (s !== null) await stopWacsshd(s);
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});

/**
 * design/0001 step 3's criterion, over ssh: **`ps` shows the pipeline you are running.**
 *
 * It could not be met for as long as a session on an image did not spawn its stages, and it did not
 * spawn them because a spawned stage would have read the machine rather than the image (wac-mono
 * 0116). Both halves are here in one question: three rows means three instances running at once,
 * and `cat /etc/passwd` failing in the same session means those instances are still sealed.
 *
 * `seq 1 200000` rather than something short because the pipeline has to still be running when `ps`
 * looks. A sequential shell answers this with one row however long the first stage takes.
 */
Deno.test({
  name: "a session on an image shows its own pipeline in `ps` — step 3's criterion",
  ignore: !haveSshd,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-ps-" });
    const image = `${dir}/ps.wacimg`;
    let s: Wacsshd | null = null;
    try {
      s = await startWacsshd(["-i", image], wacsshdWritableBinary);
      const seen = await realSsh(s, "seq 1 200000 | ps");
      const rows = seen.stdout.trimEnd().split("\n");
      if (rows.length !== 4) throw new Error(`expected a header and three rows:\n${seen.stdout}`);
      if (!rows[2].includes("seq 1 200000")) throw new Error(rows.join(" | "));
      if (!rows[3].includes("ps")) throw new Error(rows.join(" | "));

      // The seal, in the same session and through the spawning route, so that a `ps` which showed
      // more by reading the wrong disk would fail here rather than pass quietly.
      //
      // The *output*, not the status: `$?` after a pipeline is its last stage's, so `head` succeeding
      // on nothing reports 0 whatever `cat` did — which is bash's rule and was this test's first bug.
      const machine = await realSsh(s, "cat /etc/passwd | head -1");
      if (machine.stdout !== "") throw new Error(`a stage read the machine: ${machine.stdout}`);

      // And a stage's writes are the session's: the next connection finds what it left.
      const wrote = await realSsh(s, "seq 1 5 | sort -nr > /out");
      if (wrote.stdout !== "") throw new Error(JSON.stringify(wrote.stdout));
      const back = await realSsh(s, "cat /out");
      if (back.stdout !== "5\n4\n3\n2\n1\n") throw new Error(JSON.stringify(back.stdout));
    } finally {
      if (s !== null) await stopWacsshd(s);
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "an image the server cannot read stops it before it binds, and is not written over",
  ignore: !haveSshd,
  fn: async () => {
    // Starting empty would be worse than stopping: the server would then *save over* the image it could
    // not read. And it used to announce "listening on port …" first and refuse after, which is a moment
    // in which it looks like it is working.
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-badimage-" });
    const image = `${dir}/bad.wacimg`;
    try {
      await Deno.mkdir(`${dir}/.ssh`);
      const key = await new Deno.Command("ssh-keygen", {
        args: ["-t", "ed25519", "-f", `${dir}/.ssh/ssh_host_ed25519_key`, "-N", "", "-q"],
      }).output();
      if (!key.success) throw new Error("ssh-keygen failed");
      await Deno.writeTextFile(`${dir}/.ssh/authorized_keys`, "");
      await Deno.writeTextFile(image, "not an image");
      const held = holdPort();
      const port = held.port;
      held.release();
      const r = await new Deno.Command(wacsshdWritableBinary, {
        args: ["-p", String(port), "-i", image],
        env: { HOME: dir },
        clearEnv: false,
        stdout: "null",
        stderr: "piped",
      }).output();
      const said = text(r.stderr);
      if (r.code === 0) throw new Error(`the server started anyway: ${said}`);
      if (!said.includes("too short to be an image")) throw new Error(said);
      if (said.includes("listening on port")) throw new Error(`it bound first: ${said}`);
      if (await Deno.readTextFile(image) !== "not an image") {
        throw new Error("the unreadable image was written over");
      }
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});

Deno.test({
  name: "a server that cannot write its image says so rather than losing the session",
  ignore: !haveSshd,
  fn: async () => {
    // The first thing the image tests found, and they found it by failing for the wrong reason: the
    // binary every other test here uses is built without `--allow-write`, so it served the session, did
    // the work, and could not save it. Warning and carrying on is right — the client's commands ran and
    // their output was real — but a server that lost the session in silence would be indistinguishable.
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-nowrite-" });
    const image = `${dir}/home.wacimg`;
    const s = await startWacsshd(["-i", image]);        // the read-only binary, deliberately
    try {
      const made = await realSsh(s, "mkdir /data; ls /");
      if (made.stdout !== "bin\ndata\ndev\nproc\n") throw new Error(JSON.stringify(made.stdout));
      await stopWacsshd(s);
      const said = await s.stderr;
      if (!said.includes("could not be saved")) throw new Error(`it said nothing: ${said}`);
      if (await Deno.stat(image).then(() => true, () => false)) {
        throw new Error("an image appeared, so the server could write after all");
      }
    } finally {
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});

/**
 * design/0001 step 4: two keys land in two homes, and neither can read the other's private file.
 *
 * The whole of the step in one test, and it is a composition of three packages rather than a feature of
 * any of them. `packages/fs` enforces `mode` and `owner` — which it recorded and ignored until now, and
 * said so in its own comment. `packages/fs/src/passwd.wac` reads the user table **out of the image**,
 * per design/0001 D5: a host's idea of who is logged in cannot survive a file that is one blob owned by
 * whoever ran the process. `packages/ssh` matches the client's key against each user's own
 * `~/.ssh/authorized_keys` and hands the session that name.
 *
 * The image is built by the first server through an ordinary session — there is no other way to write
 * one, and that is the point: the system builds its own world with the tools it ships.
 */
Deno.test({
  name: "a session knows what terminal the client said it has",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    // design/0001 step 5 asks for "a `TERM` worth setting". The `pty-req` carries the terminal type
    // and its size, and every field of it used to be dropped — so a session ran with no `$TERM` and a
    // program asking what it was talking to got nothing.
    //
    // Through a **real pty request**, which means `ssh -tt`: the value has to survive the client's
    // encoding of it rather than a string this test made up.
    let s: Wacsshd | null = null;
    try {
      s = await startWacsshd();
      const r = await new Deno.Command("ssh", {
        args: [
          "-tt", "-p", String(s.port), "-i", `${s.dir}/clientkey`,
          "-o", "StrictHostKeyChecking=no", "-o", "UserKnownHostsFile=/dev/null",
          "-o", "LogLevel=ERROR", "-o", "ConnectTimeout=10",
          "x@127.0.0.1", "echo T=[$TERM]; exit",
        ],
        env: { ...Deno.env.toObject(), TERM: "vt100" },
        stdout: "piped",
        stderr: "piped",
      }).output();
      const out = new TextDecoder().decode(r.stdout);
      if (!out.includes("T=[vt100]")) {
        throw new Error(`the session did not learn the client's terminal: ${JSON.stringify(out)}`);
      }
      // And a session with no pty has **no** `$TERM` rather than a guessed one, which is what lets a
      // program tell "no terminal" from "a terminal I have never heard of".
      //
      // Asked of a server booted on an *image*, because this one has no image and is therefore a
      // host-mounted shell — where an unset variable does fall back to the machine's environment, on
      // purpose, exactly as `wacsh` does. That is the same rule from the other side, and asking the
      // wrong server was how this test first failed.
      const dir = await Deno.makeTempDir({ prefix: "wac-sshd-term-" });
      let sealed: Wacsshd | null = null;
      try {
        sealed = await startWacsshd(["-i", `${dir}/term.wacimg`], wacsshdWritableBinary);
        const plain = await realSsh(sealed, "echo T=[$TERM]");
        if (plain.stdout !== "T=[]\n") {
          throw new Error(`a session with no pty had a TERM: ${JSON.stringify(plain.stdout)}`);
        }
      } finally {
        if (sealed !== null) await stopWacsshd(sealed);
        await Deno.remove(dir, { recursive: true });
      }
    } finally {
      if (s !== null) await stopWacsshd(s);
    }
  },
});

Deno.test({
  name: "a session on an image has its own environment, not the server's",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    // **design/0001's opening promise, and it was untrue.** A session sealed in an image reported
    // `HOME=/home/claude` and a `$PATH` from the machine the server was running on, because an unset
    // variable fell back to `cli.env` — the *server process's* environment. D4 says a session's `Cli`
    // has `env` that is the session's.
    //
    // The fallback is right for `wacsh`, whose filesystem is the same machine's, and wrong here. So
    // `Shell.onFs` turns it off: a shell whose world is a filesystem does not borrow the host's
    // environment, which is the same rule as not spawning its stages.
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-env-" });
    let s: Wacsshd | null = null;
    try {
      s = await startWacsshd(["-i", `${dir}/env.wacimg`], wacsshdWritableBinary);
      const said = await realSsh(s, "echo HOME=[$HOME] PATHLEN=${#PATH} TERM=[$TERM]");
      if (said.code !== 0) throw new Error(`exit ${said.code}: ${said.stderr}`);
      if (said.stdout !== "HOME=[] PATHLEN=0 TERM=[]\n") {
        throw new Error(`a sealed session read the server's environment: ${JSON.stringify(said.stdout)}`);
      }
      // The canary: the server *does* have those variables, so an empty answer means they were
      // withheld rather than that this machine happens to have none.
      if ((Deno.env.get("HOME") ?? "").length === 0) {
        throw new Error("this machine has no HOME, so the test above proves nothing");
      }
    } finally {
      if (s !== null) await stopWacsshd(s);
      await Deno.remove(dir, { recursive: true });
    }
  },
});

Deno.test({
  name: "two keys land in two homes, and neither can read the other's private file",
  ignore: !haveSshd,
  sanitizeResources: false,
  fn: async () => {
    const dir = await Deno.makeTempDir({ prefix: "wac-sshd-users-" });
    const image = `${dir}/system.wacimg`;
    let s: Wacsshd | null = null;
    try {
      // Two client keys, made the way the harness makes its own.
      for (const name of ["ada", "grace"]) {
        const r = await new Deno.Command("ssh-keygen", {
          args: ["-t", "ed25519", "-f", `${dir}/${name}`, "-N", "", "-q"],
        }).output();
        if (!r.success) throw new Error(`ssh-keygen failed for ${name}`);
        await Deno.chmod(`${dir}/${name}`, 0o600);
      }
      const pub = async (name: string) => (await Deno.readTextFile(`${dir}/${name}.pub`)).trim();

      // ── The first server writes the world ───────────────────────────────────
      s = await startWacsshd(["-i", image], wacsshdWritableBinary);
      const build = [
        "mkdir /etc",
        `printf 'ada:x:1000:1000::/home/ada:/bin/sh\ngrace:x:1001:1001::/home/grace:/bin/sh\n' > /etc/passwd`,
        "mkdir /home; mkdir /home/ada; mkdir /home/ada/.ssh; mkdir /home/grace; mkdir /home/grace/.ssh",
        `printf '%s\n' '${await pub("ada")}' > /home/ada/.ssh/authorized_keys`,
        `printf '%s\n' '${await pub("grace")}' > /home/grace/.ssh/authorized_keys`,
        "echo the difference engine > /home/ada/secret",
        "echo the first compiler > /home/grace/secret",
        "chmod 600 /home/ada/secret; chown ada /home/ada/secret",
        "chmod 600 /home/grace/secret; chown grace /home/grace/secret",
        "chown ada /home/ada; chown grace /home/grace",
        // **A private `.ssh`, which is what everyone is told to keep.** It is also the case that catches
        // a server reading policy files as whoever logged in last: `authenticate` runs before it knows
        // who this is, so it has to read as the system rather than as the previous session.
        "chmod 700 /home/grace/.ssh; chown grace /home/grace/.ssh",
        "chmod 600 /home/grace/.ssh/authorized_keys; chown grace /home/grace/.ssh/authorized_keys",
      ].join("; ");
      const built = await realSsh(s, build);
      if (built.code !== 0) throw new Error(`building the image failed: ${built.stderr}`);
      // Said out loud on the same server that wrote it: an image that did not get the table is a
      // different failure from a key that did not match, and the second is unreadable without the first.
      //
      // **It is also load-bearing, which is a bug rather than a feature of this test.** Without this
      // second connection the image had not been written by the time `stopWacsshd` killed the server,
      // and the next server booted a world with no users in it. wac-mono 0108.
      const check = await realSsh(s, "cat /etc/passwd; ls /home/ada/.ssh; ls /home/grace/.ssh");
      if (!check.stdout.includes("ada:x:1000") || !check.stdout.includes("authorized_keys")) {
        throw new Error(`the image did not get the users: ${JSON.stringify(check)}`);
      }
      await stopWacsshd(s);
      s = null;

      // ── …and a second server serves it, to two people ───────────────────────
      const live = await startWacsshd(["-i", image], wacsshdWritableBinary);
      try {
        // Each key lands in its own home, with its own name, without the server being told either.
        const adaHome = await realSsh(live, "pwd; echo $USER", `${dir}/ada`);
        if (adaHome.stdout !== "/home/ada\nada\n") throw new Error(JSON.stringify(adaHome));
        // Grace logs in *after* ada, and her key file is one only she may read — so this fails unless
        // the server reads it as the system rather than as the user it last served.
        const graceHome = await realSsh(live, "pwd; echo $USER", `${dir}/grace`);
        if (graceHome.stdout !== "/home/grace\ngrace\n") throw new Error(JSON.stringify(graceHome.stdout));

        // Each can read their own.
        const own = await realSsh(live, "cat /home/ada/secret", `${dir}/ada`);
        if (own.stdout !== "the difference engine\n") throw new Error(JSON.stringify(own.stdout));

        // **And not the other's**, which is the criterion the design states.
        const other = await realSsh(live, "cat /home/grace/secret; echo status=$?", `${dir}/ada`);
        if (other.stdout !== "status=1\n") throw new Error(JSON.stringify(other.stdout));
        if (!other.stderr.includes("Permission denied")) {
          throw new Error(`expected a permission error, got ${JSON.stringify(other.stderr)}`);
        }

        // Nor by widening it first, which is the obvious way round a check.
        const widen = await realSsh(live, "chmod 644 /home/grace/secret; cat /home/grace/secret; echo status=$?", `${dir}/ada`);
        if (!widen.stdout.includes("status=1")) throw new Error(JSON.stringify(widen.stdout));
      } finally {
        await stopWacsshd(live);
      }
    } finally {
      if (s !== null) await stopWacsshd(s);
      await Deno.remove(dir, { recursive: true }).catch(() => {});
    }
  },
});
