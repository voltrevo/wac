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

Deno.test("a build with no programs has no /bin at all", async () => {
  // `packages/ssh`'s server wires no applets, and an **empty** `/bin` would claim more than an absent
  // one: `ls /` would show a directory of programs with no programs in it. So `mountBin` of nothing
  // mounts nothing, and this is the assertion that says so from the other side — every listing in the
  // suite that gained a `bin` did so because that build has programs.
  //
  // Checked through `packages/fs` directly rather than by building a second shell: the rule is the
  // filesystem's, and a shell with no applets is not a thing this package builds.
  const mod = await import("../../../harness/wacBind.ts");
  const fs = await mod.wacBind("packages/fs/src/fs.wac") as unknown as {
    Fs: { inMemory(now: bigint): { mountBin(names: unknown, random: unknown): void; readDir(p: string): string[] | null } };
    "Vec$string": { create(): { push(s: string): void } };
  };
  const empty = fs.Fs.inMemory(0n);
  empty.mountBin(fs["Vec$string"].create(), null);
  assertEquals(empty.readDir("/"), [], "an empty /bin was mounted anyway");

  const one = fs.Fs.inMemory(0n);
  const names = fs["Vec$string"].create();
  names.push("wc");
  one.mountBin(names, null);
  assertEquals(one.readDir("/"), ["bin"], "a build with a program has a /bin");
  assertEquals(one.readDir("/bin"), ["wc"]);
});

Deno.test("every session that has programs has a /bin listing them", async () => {
  // **The bug this is here for.** `packages/ssh`'s server wires `boxNames` into its session shell —
  // four lines below the import that provides it — and was handed an empty program list, with a
  // comment saying it had no applets of its own. So an ssh session had sixty-three programs, `help`
  // listed all of them, and `ls /bin` said "No such file or directory": the one place a person looks
  // to find out what a system can run.
  //
  // Checked by *source*, because the alternative is standing up a server and a client to ask a
  // question about a wiring decision. What must hold is that a session shell wired with `boxNames` is
  // given `boxNames` — anywhere in the repo.
  const wires: string[] = [];
  for await (const entry of Deno.readDir("packages")) {
    if (!entry.isDirectory) continue;
    for (const sub of ["src", "src/bin", "example"]) {
      let files: Deno.DirEntry[] = [];
      try {
        files = [...Deno.readDirSync(`packages/${entry.name}/${sub}`)];
      } catch {
        continue;
      }
      for (const f of files) {
        if (!f.isFile || !f.name.endsWith(".wac")) continue;
        const path = `packages/${entry.name}/${sub}/${f.name}`;
        const src = Deno.readTextFileSync(path);
        if (!src.includes("externalNames = boxNames")) continue;
        const world = /(?:mountSystem|boot)\([^)]*\)/s.exec(src)?.[0] ?? "";
        // **Only where a system world is built at all.** `packages/box/src/bin/sh.wac` — `wacsh` — is
        // the deliberate exception and calls neither: it is an ordinary shell over the *real*
        // filesystem (design/0001 D3a), where `/bin`, `/dev` and `/proc` are the machine's own and
        // mounting ours over them would hide them. The rule is not "every shell has a `/bin`"; it is
        // that a shell which builds a world builds it consistently with the programs it wired.
        if (world === "") continue;
        wires.push(path);
        assertEquals(
          world.includes("boxNames"),
          true,
          `${path} wires boxNames into its shell but gives its world ${JSON.stringify(world)}`,
        );
      }
    }
  }
  // The canary: a search that found nothing would report every session correct.
  assertEquals(wires.length >= 2, true, `only found ${wires.length} session builders: ${wires}`);
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
