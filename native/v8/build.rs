// **The seed: a compiler inside the binary.**
//
// With `seed/wacc.wasm` present, this host is a `wac` command — one file that compiles wac, with no
// Deno, no wasm beside it and no JavaScript anywhere in the path. Absent, it is the runtime it has
// always been, `wacv8 program.wasm`, and says so when asked to act as one. Produced by:
//
//     deno task app:native packages/wacc/example/wacc.wac --allow-read --allow-write -o native/v8/seed/wacc
//     (cd native/v8 && cargo build --release)
//
// **One file, not two.** `native/build.rs` embeds a manifest *and* a module, because the wasmtime
// host was written when a program was a pair. A module built by `packages/platform/native.ts` now
// carries its own manifest in a `wac.manifest` custom section — `manifest_in` in `src/main.rs` — so
// there is nothing else to embed, and the payload the binary carries is the same artefact that runs
// when it is handed to `wacv8` directly. A seed that could drift from its own manifest would be a
// third way to build the compiler, and the point of this direction is that there is one.

fn main() {
    let dir = std::env::var("WAC_SEED_DIR").unwrap_or_else(|_| "seed".into());
    println!("cargo:rerun-if-env-changed=WAC_SEED_DIR");
    // **One payload, as of `issues/system/0257c`.** There were three — the compiler answering
    // `check`/`compile`/`build`, a shell answering `sh`, a fetcher answering `update` — and the
    // second and third are now *inside* the first, because `wac` is one program that contains the
    // compiler plus more rather than a compiler with two modules bolted beside it. The binary that
    // carried them lost 1.85 MB and the other hosts gained two commands they never had.
    //
    // Still optional: a build with no payload is the runtime this host started as.
    embed(&dir, "wacc", "WAC_SEED_WASM", "wac_seed");
    println!("cargo:rustc-check-cfg=cfg(wac_seed)");
}

/// Embed `<dir>/<stem>.wasm`, if it is there, as `env` and set `cfg`.
fn embed(dir: &str, stem: &str, env: &str, cfg: &str) {
    let wasm = format!("{dir}/{stem}.wasm");
    println!("cargo:rerun-if-changed={wasm}");
    if std::path::Path::new(&wasm).exists() {
        // Absolute: `include_bytes!` resolves against the *source file* that writes it, so a relative
        // path here becomes `src/seed/...` and the build fails with a name nobody typed.
        let abs = std::fs::canonicalize(&wasm)
            .map(|c| c.display().to_string())
            .unwrap_or_else(|_| wasm.clone());
        println!("cargo:rustc-env={env}={abs}");
        println!("cargo:rustc-cfg={cfg}");
    }
}
