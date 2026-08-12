// The wasmtime version, baked in so a compiled-module cache cannot survive an upgrade.
//
// `Module::deserialize_file` checks its own header and refuses an artifact from a different
// wasmtime, so this is belt as well as braces — but a cache *name* that changes with the engine
// means a stale entry is never read at all, rather than read and rejected on every run.
fn main() {
    // **The seed: a compiler inside the binary.** With `seed/wacc.json` and `seed/wacc.wasm` present,
    // this runtime can run a wac program with no manifest handed to it — which is what makes a single
    // `wac` command possible rather than `wacland something.json`. Absent, the binary is exactly what
    // it was and says so when asked to act as one. Produced by:
    //
    //     deno task app:native packages/wacc/example/wacc.wac --allow-read --allow-write -o native/seed/wacc
    //
    // Whether that artifact is committed is design/lang/0003's open question; the build works either
    // way, which is the point of not deciding it here.
    let dir = std::env::var("WAC_SEED_DIR").unwrap_or_else(|_| "seed".into());
    let json = format!("{dir}/wacc.json");
    let wasm = format!("{dir}/wacc.wasm");
    println!("cargo:rerun-if-changed={json}");
    println!("cargo:rerun-if-changed={wasm}");
    println!("cargo:rerun-if-env-changed=WAC_SEED_DIR");
    if std::path::Path::new(&json).exists() && std::path::Path::new(&wasm).exists() {
        // Absolute: `include_str!` resolves against the *source file* that writes it, so a relative
        // path here becomes `src/seed/...` and the build fails with a name nobody typed.
        let abs = |p: &str| {
            std::fs::canonicalize(p).map(|c| c.display().to_string()).unwrap_or_else(|_| p.into())
        };
        println!("cargo:rustc-env=WAC_SEED_JSON={}", abs(&json));
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
