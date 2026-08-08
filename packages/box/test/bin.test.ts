// `/bin`: a directory of the programs this build actually has.
//
// design/0001 asks for a machine with "`/bin` full of programs". The applets are compiled into the
// binary, so there is no file on disk to point at — and the honest answer to that is not to invent
// one. Each entry is a real directory entry with a real mode and a real size, and reading it gives a
// sentence saying the program is built in. `ls /bin` is the truth about this binary; `cp /bin/wc
// elsewhere` gets a text file that explains itself.
//
// ## What makes it a directory of *programs* rather than a listing
//
// `/bin/wc -l` runs `wc`. A `/bin` you can only `ls` is a list of names: a path to a program has to
// work, because that is what a path to a program means everywhere else. The shell rewrites the path to
// the bare name **before** anything reads the file, since the spawn route would otherwise read the
// sentence and refuse it as "not a wac worker bundle" — true of the sentence, false of the program.
//
// ## The list is `boxNames()`, not a list somebody typed
//
// `box.test.ts` already ties `boxNames()` to the dispatcher and to the README's count, so a program
// that exists and is unlisted fails there. This ties `/bin` to the same function, which means the
// three can only agree.

import { buildApp } from "../../platform/build.ts";
// Imported for its side effect: retries a spawn that fails with "Text file busy". wac-mono 0074.
import "../../../harness/spawnRetry.ts";

const built = await Deno.makeTempFile({ prefix: "wac-bin-" });
await buildApp("packages/box/src/bin/sealedsh.wac", built, {});
globalThis.addEventListener("unload", () => {
  try {
    Deno.removeSync(built);
  } catch {
    // Already gone.
  }
});

type Run = { code: number; out: string; err: string };

async function sh(script: string): Promise<Run> {
  const r = await new Deno.Command(built, {
    args: ["-c", script],
    stdin: "null",
    stdout: "piped",
    stderr: "piped",
  }).output();
  const d = new TextDecoder();
  return { code: r.code, out: d.decode(r.stdout), err: d.decode(r.stderr) };
}

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** The names the dispatcher has, read from the source that `box.test.ts` also ties to it. */
const names = await (async () => {
  const src = await Deno.readTextFile("packages/box/src/box.wac");
  const listed = src.match(/string\[\] appletNames\(\) \{[\s\S]*?\n\}/)?.[0] ?? "";
  return (listed.match(/"[a-z0-9-]+"/g) ?? []).map((q) => q.slice(1, -1)).sort();
})();

Deno.test("/bin lists exactly the programs this build has", async () => {
  const listing = await sh("ls /bin");
  assertEquals(listing.code, 0, listing.err);
  assertEquals(listing.out.split("\n").filter((l) => l.length > 0), names);
  // The canary: a `/bin` of nothing would also be "exactly the programs" if the source list were
  // empty, and this file would pass while the machine had no programs at all.
  assertEquals(names.length > 50, true, `only ${names.length} names — is the list being read?`);
});

Deno.test("a program in /bin is a file with a mode and a size, and says what it is", async () => {
  const one = await sh("stat /bin/wc");
  assertEquals(one.code, 0, one.err);
  // `<path> file <size> <when>` — a file, not a directory, with a real length.
  assertEquals(one.out.startsWith("/bin/wc file "), true, one.out);
  const size = Number(one.out.split(" ")[2]);
  assertEquals(size > 0, true, one.out);

  const said = await sh("cat /bin/wc");
  assertEquals(said.out, "wc is built into this program; there is no file here to copy elsewhere.\n");
  assertEquals(said.out.length, size, "stat and cat disagree about the length");

  // And a name that is not a program is absent rather than empty — the two are different answers.
  const missing = await sh("cat /bin/nosuch");
  assertEquals(missing.code, 1);
  assertEquals(missing.err.includes("No such file"), true, missing.err);
});

Deno.test("a path into /bin runs the program, however it is spelled", async () => {
  // The plain path.
  assertEquals((await sh("echo a b c | /bin/wc -w")).out, "3\n");
  // Relative, from inside `/bin` — the same program by another spelling, which a shell that matched
  // on the text of the word rather than the resolved path would get wrong.
  assertEquals((await sh("cd /bin; echo x y | ./wc -w")).out, "2\n");
  // And through a link that is not there: `/bin/nosuch` is not a program, so it is not found rather
  // than refused for some other reason.
  const nope = await sh("/bin/nosuch; echo status=$?");
  assertEquals(nope.out, "status=127\n", nope.err);
  assertEquals(nope.err.includes("command not found"), true, nope.err);

  // A directory that merely looks like it: `/binary/wc` must not be treated as `/bin`'s.
  const near = await sh("mkdir /binary; /binary/wc; echo status=$?");
  assertEquals(near.out.includes("status=127"), true, `${near.out} / ${near.err}`);
});

Deno.test("/bin is read-only, like every other synthesised mount", async () => {
  for (const script of ["echo x > /bin/wc", "rm /bin/wc", "mkdir /bin/d"]) {
    const r = await sh(script);
    assertEquals(r.code !== 0, true, `${script} was allowed`);
  }
  // A program cannot be added by writing one either, which is the same statement from the other side:
  // what is in `/bin` is what this build has.
  const added = await sh("echo x > /bin/newthing; ls /bin | wc -l");
  assertEquals(added.out.trim(), String(names.length), added.err);
});
