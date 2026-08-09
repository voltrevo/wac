// **The arrival test.** One image, two substantially different hosts.
//
// design/0001, in its own words: "load the same image in two substantially different hosts and
// demonstrate the same users, files, installed programs, shell behaviour and system services in both,
// with no implicit access to either host" — where substantially different means **one JavaScript host
// and one that is not** (D9), because two JavaScript hosts share the transport, the worker model and
// the event loop and prove nothing.
//
// The program is `packages/box/src/bin/imaged.wac`, built twice: once for Deno and once for
// `native/`, the wasmtime runtime. The *image* is one file on disk that both of them open.
//
// ## What this covers, and what it does not
//
// Covered: **files, installed programs and shell behaviour.** A session on one host writes; a session
// on the other reads what it wrote, runs the same sixty applets over it, and writes back.
//
// Not covered, and named rather than implied: **users and system services.** `Fs.user` is set by
// `packages/ssh`'s server, which needs the network, and the native host has no sockets yet — see
// issue 0087. So `/etc/passwd` crosses as a *file* here, which is what design/0001 D5 says it is, but
// nothing has yet logged in as one of the users in it on both hosts.
//
// Also worth knowing, because it is easy to read this file as covering more than it does: **the host
// capability surface exercised here is `readFile` and `writeFile` and nothing else.** Everything the
// session does to files goes through `packages/fs`'s VFS *inside* the image, which is the whole point
// of the design — so a host `readDir` that answered in the wrong order changes nothing here, and I
// checked, because a canary that does not fire is worth more than one that does. The host's directory
// and metadata capabilities are exercised by `packages/fs/test/host.test.ts` on the Deno side and by
// nothing at all on the native side yet.
//
// ## The strongest assertion here is the last one
//
// Two hosts agreeing about a file they both wrote is worth something. Two hosts producing **byte
// identical images** after a session that changed nothing is worth more: it says the format carries no
// trace of the machine that wrote it — no ordering that came from a directory listing, no timestamp
// from a clock, no padding from an allocator. That is what "an image moves between hosts carrying its
// state" has to mean to be true.

import { buildApp } from "../build.ts";
import { buildNative } from "../native.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const ENTRY = "packages/box/src/bin/imaged.wac";
const CRATE = "native";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const tmp = await Deno.makeTempDir({ prefix: "wac-arrival-" });
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(tmp, { recursive: true });
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

function session(cmd: string, extra: string[], image: string, script: string): Run {
  const r = new Deno.Command("timeout", {
    args: ["20", cmd, ...extra, image, "-c", script],
    cwd: tmp,
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

/** The native binary, built if cargo is here, or null with the reason said out loud. */
async function nativeBinary(): Promise<string | null> {
  try {
    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) throw new Error(new TextDecoder().decode(built.stderr));
  } catch (e) {
    console.warn(
      `SKIPPING the arrival test's second host: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The one-host half below still runs. See issues/closed/0087.`,
    );
    return null;
  }
  // Absolute: every session sets `cwd` to the scratch directory.
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

const deno = `${tmp}/imaged-deno`;
await buildApp(ENTRY, deno, { read: true, write: true });
await buildNative(ENTRY, `${tmp}/imaged`, { read: true, write: true });
const manifest = `${tmp}/imaged.json`;

Deno.test("an image written on one host is the same system on the other", async () => {
  const native = await nativeBinary();
  const img = "home.wacimg";

  // **One.** The JavaScript host makes a system: a home directory, a file, and a file of numbers.
  const made = session(deno, [], img, [
    "mkdir -p /home/ada /etc",
    "echo hello from deno > /home/ada/note",
    "seq 1 5 > /home/ada/n",
    "printf 'root:x:0:0::/root:/bin/sh\\nada:x:1000:1000::/home/ada:/bin/sh\\n' > /etc/passwd",
    "ls /home/ada",
  ].join("; "));
  assertEquals(made.out, "n\nnote\n", made.err);
  // The canary for the whole file: an image nobody wrote to would make every read below pass by
  // agreeing about nothing.
  const size = (await Deno.stat(`${tmp}/${img}`)).size;
  assertEquals(size > 100, true, `the image is ${size} bytes — nothing was written`);

  if (native === null) return;

  // **Two.** The host with no JavaScript in it opens the same file: the same names, the same bytes,
  // and `sort` and `head` — two of `packages/box`'s applets — over the numbers the other host wrote.
  const read = session(native, [manifest], img, "ls /home/ada; cat /home/ada/note; sort -nr /home/ada/n | head -1; wc -l < /etc/passwd");
  assertEquals(read.out, "n\nnote\nhello from deno\n5\n2\n", read.err);

  // **Two and a half: the system's *services*, from the same file.** design/0001 step 7 — what runs at
  // boot is `/etc/init` in the image, so `init` on the other host starts what this one wrote down.
  // Everything about it crosses: the parsing, the spawning, the relayed output and the statuses.
  const wroteInit = session(deno, [], img, "printf 'echo from the init file\nfalse\n' > /etc/init; wc -l < /etc/init");
  assertEquals(wroteInit.out, "2\n", wroteInit.err);
  const booted = session(native, [manifest], img, "init; echo status=$?");
  assertEquals(booted.out.split("\n").filter((l) => l.length > 0), [
    "init: started echo",
    "init: started false",
    "from the init file",
    "init: echo exited 0",
    "init: false exited 1",
    "status=1",
  ], booted.err);

  // **Three.** And back the other way, which is the half that would be missing if only one host could
  // write: the format is not "what Deno emits and wasmtime tolerates".
  const wrote = session(native, [manifest], img, "echo written by wasmtime > /home/ada/back; ls /home/ada");
  assertEquals(wrote.out, "back\nn\nnote\n", wrote.err);
  const back = session(deno, [], img, "cat /home/ada/back; ls /home/ada");
  assertEquals(back.out, "written by wasmtime\nback\nn\nnote\n", back.err);
});

Deno.test("a session that changes nothing writes the same bytes on either host", async () => {
  const native = await nativeBinary();
  if (native === null) return;

  const start = "twice.wacimg";
  const made = session(deno, [], start, "mkdir -p /a/b; echo x > /a/b/c; seq 1 20 > /a/n; ls /a");
  assertEquals(made.out, "b\nn\n", made.err);

  await Deno.copyFile(`${tmp}/${start}`, `${tmp}/js.wacimg`);
  await Deno.copyFile(`${tmp}/${start}`, `${tmp}/rs.wacimg`);
  const a = session(deno, [], "js.wacimg", "true");
  const b = session(native, [manifest], "rs.wacimg", "true");
  assertEquals(a.code, 0, a.err);
  assertEquals(b.code, 0, b.err);

  const js = await Deno.readFile(`${tmp}/js.wacimg`);
  const rs = await Deno.readFile(`${tmp}/rs.wacimg`);
  // Byte for byte. Anything that differed here would be the machine leaking into the image: a
  // directory order, a clock, an allocator's padding.
  assertEquals(Array.from(rs), Array.from(js), "the two hosts wrote different images");
  // The canary again, and it is not the same one: an image of zero bytes is also byte-identical.
  assertEquals(js.length > 100, true, `the image is ${js.length} bytes`);
});

Deno.test("neither host reaches the disk except through the grants the image needs", async () => {
  const native = await nativeBinary();
  if (native === null) return;

  // `imaged` is granted read and write **because it has an image to open**, and that is all it uses
  // them for: the session's own filesystem is the image. So a path that exists on this machine
  // resolves inside the image instead, on both hosts.
  //
  // Asserted by *shadowing* rather than by absence. "The file is not there" would also be the answer
  // if the shell were broken, and an assertion that a broken shell passes is not an assertion. So the
  // image gets an `/etc/hostname` of its own, with contents this machine's cannot have, and both
  // hosts have to read that one.
  const img = "sealed.wacimg";
  const theirs = (await Deno.readTextFile("/etc/hostname").catch(() => "")).trim();
  session(deno, [], img, "mkdir -p /etc; echo inside-the-image > /etc/hostname");
  for (const [name, cmd, extra] of [["deno", deno, []], ["native", native, [manifest]]] as const) {
    const r = session(cmd, [...extra], img, "cat /etc/hostname");
    assertEquals(r.out, "inside-the-image\n", `${name}: ${JSON.stringify(r.out + r.err)}`);
    if (theirs.length > 0) {
      assertEquals(r.out.includes(theirs), false, `${name} read the machine's hostname`);
    }
  }
});
