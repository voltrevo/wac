// The wasmtime version, baked in so a compiled-module cache cannot survive an upgrade.
//
// `Module::deserialize_file` checks its own header and refuses an artifact from a different
// wasmtime, so this is belt as well as braces — but a cache *name* that changes with the engine
// means a stale entry is never read at all, rather than read and rejected on every run.
fn main() {
    // **The seed: a compiler inside the binary.** With `seed/wacc.wasm` present, this runtime can
    // run a wac program with no manifest handed to it — which is what makes a single `wac` command
    // possible rather than `wacland something.wasm`. Absent, the binary is exactly what it was and
    // says so when asked to act as one. Produced by `./bootstrap.sh --host wasmtime`.
    //
    // **It wanted a `seed/wacc.json` as well until 2026-08-28**, from when a program was a module
    // and a manifest beside it. Nothing has written that file since the manifest moved into a
    // `wac.manifest` section, so the condition below could never hold and this binary could never
    // be built as a `wac` command — while `src/main.rs` carried the whole `run_seed` path for it.
    let dir = std::env::var("WAC_SEED_DIR").unwrap_or_else(|_| "seed".into());
    let wasm = format!("{dir}/wacc.wasm");
    println!("cargo:rerun-if-changed={wasm}");
    println!("cargo:rerun-if-env-changed=WAC_SEED_DIR");
    if std::path::Path::new(&wasm).exists() {
        // Absolute: `include_bytes!` resolves against the *source file* that writes it, so a
        // relative path here becomes `src/seed/...` and the build fails with a name nobody typed.
        let abs = |p: &str| {
            std::fs::canonicalize(p).map(|c| c.display().to_string()).unwrap_or_else(|_| p.into())
        };
        println!("cargo:rustc-env=WAC_SEED_WASM={}", abs(&wasm));
        println!("cargo:rustc-cfg=wac_seed");
    }
    println!("cargo:rustc-check-cfg=cfg(wac_seed)");

    let version = std::env::var("DEP_WASMTIME_VERSION")
        .or_else(|_| std::env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=WASMTIME_BUILD={version}");
    println!("cargo:rerun-if-changed=Cargo.toml");
}
