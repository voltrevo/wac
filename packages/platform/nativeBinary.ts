// Build a wac application into one **native executable**: the program inside a Rust host on V8.
//
//   deno task app:wacbin packages/wacc/example/wacc.wac --allow-read --allow-write -o wac
//   ./wac compile main.wac main.wasm          # no Deno on the machine, no wasm beside it
//
// Three ways to make one file, and they differ in what comes along:
//
// | | size | needs |
// | --- | --- | --- |
// | `app:build` | 710 KB | a Deno to run it |
// | `app:binary` | 105 MB | nothing — `deno compile`, so a Deno is *inside* it |
// | this | 67 MB | nothing — `native/v8`, so a V8 and a Rust host are inside it |
//
// The last two run the same engine at the same speed (about 1.2s to compile wacc's own sources,
// either way); this one is 38 MB smaller because it carries V8 without the rest of a runtime, and it
// is the **primary platform** — design/lang/0003. `app:binary` stays because it needs no Rust
// toolchain, which is the only reason to prefer it.
//
// Two steps and no cleverness: `buildNative` for the module and its manifest, then `cargo build`
// with `WAC_SEED_DIR` pointing at them — `native/v8/build.rs` embeds what it finds there.
//
// The grants are baked in exactly as `app:build` and `app:binary` bake them, and for the same
// reason: whoever packages the thing chooses what it may do, and the person running it cannot
// quietly widen that.

import { buildNative } from "./native.ts";
import type { Grants } from "./build.ts";

const CRATE = "native/v8";

/** Build `entry` into a standalone native executable at `dest`. */
export async function buildNativeBinary(
  entry: string,
  dest: string,
  grants: Grants,
): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: "wac-nativebin-" });
  try {
    // `build.rs` looks for `wacc.wasm` in the directory it is given, so the payload is written under
    // that name whatever program it is. The name is the seed's, not this program's.
    await buildNative(entry, `${dir}/wacc`, grants);

    const built = await new Deno.Command("cargo", {
      args: ["build", "--release", "--quiet"],
      cwd: CRATE,
      env: { WAC_SEED_DIR: dir },
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (built.code !== 0) {
      throw new Error(
        `cargo did not build ${CRATE} — is a Rust toolchain installed?\n` +
          new TextDecoder().decode(built.stderr),
      );
    }
    // **Copied out, not left in `target/`.** The next build of this crate — with another program, or
    // with none — overwrites that path, and a binary that changes underneath the person who built it
    // is the kind of surprise this repository removes.
    await Deno.copyFile(`${CRATE}/target/release/wacv8`, dest);
    await Deno.chmod(dest, 0o755);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

if (import.meta.main) {
  const args = Deno.args;
  const entry = args[0];
  const at = args.indexOf("-o");
  const dest = at >= 0 && at + 1 < args.length ? args[at + 1] : null;
  if (entry === undefined || entry.startsWith("-") || dest === null) {
    console.error(
      "usage: deno task app:wacbin <entry.wac> -o <dest> [--allow-read] [--allow-write] [--allow-net] [--allow-env]",
    );
    console.error("  writes one native executable with the program and the host inside it");
    Deno.exit(2);
  }
  const t0 = Date.now();
  await buildNativeBinary(entry, dest, {
    read: args.includes("--allow-read"),
    write: args.includes("--allow-write"),
    env: args.includes("--allow-env"),
    net: args.includes("--allow-net"),
  });
  const size = (await Deno.stat(dest)).size;
  console.log(
    `${dest}  ${(size / (1024 * 1024)).toFixed(0)} MB  built in ${
      ((Date.now() - t0) / 1000).toFixed(1)
    }s`,
  );
}
