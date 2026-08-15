// The reserved handles, which five hosts and the wac side all have to agree about.
//
// A handle is a number and nothing else — that is the point of it, and what lets `waitAny` watch a
// socket, a child's output and standard input in one call. Two of those numbers are *reserved*
// rather than allocated: 0 is standard input, and 1 is a child's end of its filesystem channel
// (`PARENT_FS`, wac-mono 0116). Nothing hands them out, and every host's counter has to start past
// them.
//
// ## Why this is a test and not a constant
//
// It was very nearly not caught. The JavaScript hosts counted allocated handles from 1 and reserved
// only 0, which was correct while there was one reserved number; the native host counted from **0**,
// because its table is a `Vec` and the first `push` is index zero. So on that host the first child a
// program spawned *was* handle 0 — the number that means standard input everywhere else. Nothing had
// noticed, because `Cap::Recv` consults the handle table before it considers standard input: a
// program that spawned before it read got its child, and one that read first got a refusal. Both are
// wrong and neither says so.
//
// Adding a second reserved number is exactly the change that would have made that permanent, so the
// numbers are read out of the files that declare them and compared. A constant in one file is a
// constant the others copy.
//
// ## And then it happened again, in the host this did not read
//
// This test was written against four hosts. `native/v8` is a fifth — the same runtime on V8 rather
// than wasmtime — and it declared none of these constants, so the loop below walked straight past
// it. Its allocator started at 1, and the first handle it ever handed out was `PARENT_FS`: before a
// spawn, a child asking its parent for a filesystem got a throw, so every `box` applet trapped;
// after one it would have been handed the child's *output queue* under the number that means "ask
// my parent". `issues/system/0148`, and the second time this exact class of bug has been found.
//
// A guard for a class of rot is only as wide as the files it opens. This one now names every host
// that allocates a handle, and a sixth has to be added here as well as written.

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

/** One `name = number` declaration, whatever the language's spelling of it is. */
async function declared(path: string, pattern: RegExp): Promise<Record<string, number>> {
  const src = await Deno.readTextFile(path);
  const out: Record<string, number> = {};
  for (const m of src.matchAll(pattern)) out[m[1]] = Number(m[2]);
  return out;
}

Deno.test("the reserved handles are the same numbers on the wac side and in every host", async () => {
  // The wac side: `export const i32 NAME = N;`
  const wac = await declared(
    "packages/platform/src/platform.wac",
    /^export const i32 (STDIN|PARENT_FS) = (\d+);$/gm,
  );
  // The shared host module, which both reserved numbers and the counter's floor live in.
  const js = await declared(
    "packages/platform/host/children.ts",
    /^export const (PARENT_FS_HANDLE|FIRST_FREE_HANDLE) = (\d+);$/gm,
  );
  // The two hosts with no JavaScript in them, which each declare all three because neither has an
  // import to share. Their `FIRST_FREE_HANDLE` differs in type — a `usize` indexes wasmtime's `Vec`
  // of slots, an `i32` is the V8 host's counter — so the number is read separately from the name.
  const rs = await declared(
    "native/src/main.rs",
    /^const (STDIN_HANDLE|PARENT_FS_HANDLE): i32 = (\d+);$/gm,
  );
  const rsV8 = await declared(
    "native/v8/src/main.rs",
    /^const (STDIN_HANDLE|PARENT_FS_HANDLE|FIRST_FREE_HANDLE): i32 = (\d+);$/gm,
  );
  const rsAll = await Deno.readTextFile("native/src/main.rs");
  const firstFree = rsAll.match(/^const FIRST_FREE_HANDLE: usize = (\d+);$/m);

  assertEquals(wac.STDIN, 0, "standard input's handle is 0 in platform.wac");
  assertEquals(wac.PARENT_FS, 1, "the filesystem channel's handle is 1 in platform.wac");
  assertEquals(js.PARENT_FS_HANDLE, wac.PARENT_FS, "children.ts and platform.wac disagree");
  assertEquals(rs.STDIN_HANDLE, wac.STDIN, "main.rs and platform.wac disagree about standard input");
  assertEquals(rs.PARENT_FS_HANDLE, wac.PARENT_FS, "main.rs and platform.wac disagree about PARENT_FS");
  assertEquals(rsV8.STDIN_HANDLE, wac.STDIN, "native/v8 and platform.wac disagree about standard input");
  assertEquals(rsV8.PARENT_FS_HANDLE, wac.PARENT_FS, "native/v8 and platform.wac disagree about PARENT_FS");

  // **The floor is above every reserved number**, which is the property the two constants exist for.
  const reserved = [wac.STDIN, wac.PARENT_FS];
  assertEquals(
    js.FIRST_FREE_HANDLE > Math.max(...reserved),
    true,
    `FIRST_FREE_HANDLE is ${js.FIRST_FREE_HANDLE}, which is not past ${reserved.join(" and ")}`,
  );
  assertEquals(
    Number(firstFree?.[1]),
    js.FIRST_FREE_HANDLE,
    "the native host's first free handle is not the JavaScript hosts'",
  );
  assertEquals(
    rsV8.FIRST_FREE_HANDLE,
    js.FIRST_FREE_HANDLE,
    "native/v8's first free handle is not the JavaScript hosts' — 0148 was exactly this",
  );
});

Deno.test("every host's allocation counter starts at the floor rather than at a number", async () => {
  // The three JavaScript hosts allocate from a counter. Read rather than trusted, because the way
  // this went wrong before was a literal that was right when it was written: `let nextHandle = 1`
  // is correct for one reserved number and silently wrong for two.
  for (const host of ["deno.ts", "node.ts", "browser.ts"]) {
    const src = await Deno.readTextFile(`packages/platform/host/${host}`);
    const starts = [...src.matchAll(/let nextHandle = (.+);$/gm)].map((m) => m[1]);
    assertEquals(starts, ["FIRST_FREE_HANDLE"], `${host} starts its handle counter at a literal`);
  }

  // The native host has no counter — its table is a `Vec` and a handle is an index — so what it
  // reserves is *slots*, and the check is that it makes as many of them as there are reserved
  // numbers rather than that it counts from somewhere.
  const rs = await Deno.readTextFile("native/src/main.rs");
  assertEquals(
    /slots: vec!\[None; FIRST_FREE_HANDLE\]/.test(rs),
    true,
    "the native handle table does not reserve FIRST_FREE_HANDLE slots, so an allocated handle can be one",
  );

  // The V8 host *does* have a counter, so it is read the same way the JavaScript ones are. It began
  // at the literal 1 — correct for one reserved number, and 0148 for two.
  // Stated as the property rather than as a list of matches: `next_handle: i32,` is the struct's
  // field declaration and `next_handle: FIRST_FREE_HANDLE,` is the initialiser, and a check that
  // collected both spellings was reading the type as if it were a value.
  const v8 = await Deno.readTextFile("native/v8/src/main.rs");
  assertEquals(
    /next_handle: \d/.test(v8),
    false,
    "native/v8 initialises its handle counter from a number — 0148 was the literal 1",
  );
  assertEquals(
    /next_handle: FIRST_FREE_HANDLE,/.test(v8),
    true,
    "native/v8 does not initialise its handle counter from the shared floor",
  );
});
