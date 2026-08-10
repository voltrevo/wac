// The wasmtime version, baked in so a compiled-module cache cannot survive an upgrade.
//
// `Module::deserialize_file` checks its own header and refuses an artifact from a different
// wasmtime, so this is belt as well as braces — but a cache *name* that changes with the engine
// means a stale entry is never read at all, rather than read and rejected on every run.
fn main() {
    let version = std::env::var("DEP_WASMTIME_VERSION")
        .or_else(|_| std::env::var("CARGO_PKG_VERSION"))
        .unwrap_or_else(|_| "unknown".into());
    println!("cargo:rustc-env=WASMTIME_BUILD={version}");
    println!("cargo:rerun-if-changed=Cargo.toml");
}
