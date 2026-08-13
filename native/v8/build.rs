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
    let wasm = format!("{dir}/wacc.wasm");
    println!("cargo:rerun-if-changed={wasm}");
    println!("cargo:rerun-if-env-changed=WAC_SEED_DIR");
    if std::path::Path::new(&wasm).exists() {
        // Absolute: `include_bytes!` resolves against the *source file* that writes it, so a relative
        // path here becomes `src/seed/...` and the build fails with a name nobody typed.
        let abs = std::fs::canonicalize(&wasm)
            .map(|c| c.display().to_string())
            .unwrap_or_else(|_| wasm.clone());
        println!("cargo:rustc-env=WAC_SEED_WASM={abs}");
        println!("cargo:rustc-cfg=wac_seed");
    }
    println!("cargo:rustc-check-cfg=cfg(wac_seed)");
}
