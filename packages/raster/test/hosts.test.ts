// The same desktop, drawn on two hosts, compared byte for byte.
//
// `design/system/0004` opens with the constraint that shapes every answer in it: *"it is both, not a
// sequence"* — the kernel-and-wasmtime stack is the ambition **and** running in a tab is paramount.
// `test/live.test.ts` shows the tab. This is the other end, and more usefully it makes the two
// comparable: `Desk` takes no capability, so the same drawing runs anywhere, and the pixels are the
// same pixels or the claim is false.
//
// **This is what step 5 needs before a framebuffer is worth writing.** A framebuffer that disagrees
// with the canvas is not the same desktop, and nothing else in the package would say so — every
// other test here compares my code against my code on one host.
//
// The oracle is not a recorded image. Both sides are produced now, by the same source, and compared
// to each other; a golden file would go stale on every deliberate change and would say nothing about
// which host was wrong.

// Building a binary and spawning it immediately races the loader on a busy machine — `ETXTBSY`.
// `tools/spawnretry.test.ts` requires this import in any file that does both, and it caught this one.
import "../../../harness/spawnRetry.ts";
import { buildApp } from "../../platform/build.ts";
import { buildNative } from "../../platform/native.ts";

/** Local, because this repo has no third-party dependencies. */
function assertEquals<T>(got: T, want: T, msg?: string): void {
  const a = JSON.stringify(got), b = JSON.stringify(want);
  if (a !== b) {
    throw new Error(
      `assertEquals failed${msg === undefined ? "" : ` — ${msg}`}\n  got:  ${a}\n  want: ${b}`,
    );
  }
}

const CRATE = "native";

/** The host with no JavaScript in it, built if cargo is here, or null with the reason said aloud. */
async function nativeHost(): Promise<string | null> {
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
      `SKIPPING the two-host pixel comparison: cargo did not build ${CRATE}.\n` +
        `  ${e instanceof Error ? e.message.split("\n")[0] : e}\n` +
        `  The Deno half below still runs and still asserts.`,
    );
    return null;
  }
  return `${Deno.cwd()}/${CRATE}/target/release/wacland`;
}

Deno.test("the same desktop, on a JavaScript host and on one with no JavaScript in it", async () => {
  const dir = await Deno.makeTempDir({ prefix: "wac-deskshot-" });
  try {
    // The Deno half, which runs whether or not cargo is here.
    const denoBin = `${dir}/deskshot`;
    await buildApp("packages/raster/example/deskshot.wac", denoBin, { write: true });
    const denoOut = `${dir}/deno.ppm`;
    const ran = await new Deno.Command(denoBin, { args: [denoOut], stdout: "piped", stderr: "piped" })
      .output();
    assertEquals(ran.code, 0, `the Deno half failed: ${new TextDecoder().decode(ran.stderr)}`);

    // **Asserted, not merely captured.** Two hosts that both wrote nothing agree perfectly, so the
    // Deno half is checked against what a 320x200 P6 must be before the other one is asked.
    const deno = await Deno.readFile(denoOut);
    const header = new TextDecoder().decode(deno.subarray(0, 15));
    assertEquals(header.startsWith("P6\n320 200\n255\n"), true, `not a 320x200 PPM: ${header}`);
    assertEquals(deno.length, header.indexOf("255\n") + 4 + 320 * 200 * 3, "the pixel data is the wrong size");

    // And that it drew something: an image of one colour would compare equal across hosts and be
    // wrong on both.
    const colours = new Set<number>();
    for (let i = 15; i < deno.length; i += 3) {
      colours.add((deno[i] << 16) | (deno[i + 1] << 8) | deno[i + 2]);
      if (colours.size > 4) break;
    }
    assertEquals(colours.size > 3, true, `the desktop has ${colours.size} colours in it`);

    const host = await nativeHost();
    if (host === null) return;

    const stem = `${dir}/deskshot-native`;
    await buildNative("packages/raster/example/deskshot.wac", stem, { write: true });
    const nativeOut = `${dir}/native.ppm`;
    const nran = await new Deno.Command(host, {
      args: [`${stem}.json`, nativeOut],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(nran.code, 0, `the native half failed: ${new TextDecoder().decode(nran.stderr)}`);

    const native = await Deno.readFile(nativeOut);
    assertEquals(native.length, deno.length, "the two hosts wrote images of different sizes");
    let first = -1;
    for (let i = 0; i < deno.length; i++) {
      if (deno[i] !== native[i]) { first = i; break; }
    }
    assertEquals(
      first,
      -1,
      first < 0 ? "" : `the two hosts disagree at byte ${first}: deno ${deno[first]}, native ${native[first]}`,
    );
    console.log(`  ${deno.length} bytes of desktop, identical on both hosts`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
