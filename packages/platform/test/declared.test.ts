// A program is bound for what it declared, and not for what its imports mention.
//
// This is a security property before it is a size one. `native/v8/example/hello.wac` logs one line
// and takes `main(Core)`; before `issues/lang/0107` it was described by a manifest of 31 structs and
// 51 callback signatures, including `Socket`, `Child`, `Page`, `Picked` and `Event` — a hello-world
// handed a socket, a child-spawner and a window system because `packages/platform` mentions them.
//
// Nothing failed because of it. The extra surface is not reachable from *inside* the module — the
// wasm imports only the capabilities its own program named — so this is about what the host is asked
// to construct and hand over, which is exactly where ambient authority gets in. A test is the only
// thing that keeps a walk from widening again, because widening it breaks nothing.

import { buildNative } from "../native.ts";

function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

type Manifest = { structs: { name: string }[]; callbacks: unknown[] };

/** Build a program and hand back the manifest that describes its boundary. */
async function manifestOf(entry: string): Promise<Manifest> {
  const dir = await Deno.makeTempDir({ prefix: "wac-declared-" });
  try {
    return await buildNative(entry, `${dir}/out`, {}) as unknown as Manifest;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test("a program that asks for one capability is described by one capability", async () => {
  const m = await manifestOf("native/v8/example/hello.wac");
  const names = m.structs.map((s) => s.name).sort();

  // `main(Core)` — a `Core`, and the ticket shapes its own methods answer with. Asserted as the
  // *whole* list rather than as an absence, because a rule that only forbids today's capabilities
  // says nothing about the one added next week.
  assertEquals(names, ["Core", "Pending<i64>", "Pending<u8[]>", "Pending<u8[]?>"]);

  // The callback signatures are the other half of the same boundary: each is a dispatcher the host
  // may call into. Ten for a program that logs, against 51 when every imported file's exports were
  // roots.
  assertEquals(m.callbacks.length <= 12, true, `${m.callbacks.length} callback signatures`);
});

Deno.test("and one that asks for two is described by two", async () => {
  // The canary. A rule that bound nothing would pass the test above and fail here, and this is also
  // where a `Cli` is *supposed* to arrive: the program said so in its signature.
  const m = await manifestOf("packages/platform/example/wc.wac");
  const names = new Set(m.structs.map((s) => s.name));
  assertEquals(names.has("Core"), true, "wc takes a Core");
  assertEquals(names.has("Cli"), true, "and a Cli, which its main declares");

  // What it does not take. `wc` reads standard input and prints three numbers; it never draws, never
  // picks a file, and never names core's JSX tree.
  for (const absent of ["Page", "Event", "Picked", "Node", "Attr"]) {
    assertEquals(names.has(absent), false, `wc was handed ${absent}`);
  }
});
