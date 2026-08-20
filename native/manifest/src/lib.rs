//! Reading the `wac.manifest` custom section out of a module.
//!
//! **A module that describes itself is one artefact rather than two**, which is what lets `spawn`
//! take wasm: a program handed bytes can run them without being handed a second file it has no way
//! to find. A custom section is the format's own extension point — id 0, a name, and bytes nobody
//! else reads — so a module carrying this runs anywhere a module without it runs.
//!
//! **Shared rather than copied.** This lived in `native/v8` alone, and `native/` took a `.json`
//! written beside the module instead — not for a reason, just because the wasmtime host predates the
//! section. Forty-four lines of byte-scanning duplicated into a second host is a second copy that
//! drifts, so it is a crate that both depend on by path. Nothing here touches an engine; it is the
//! same code whichever one is underneath.

/// The manifest text carried by `wasm`, or `None` when it carries none.
pub fn manifest_in(wasm: &[u8]) -> Option<String> {
    if wasm.len() < 8 || &wasm[0..4] != b"\0asm" {
        return None;
    }
    let mut at = 8;
    while at < wasm.len() {
        let id = wasm[at];
        at += 1;
        let (size, used) = uleb(wasm, at)?;
        at += used;
        let end = at.checked_add(size)?;
        if end > wasm.len() {
            return None;
        }
        if id == 0 {
            let (n, used) = uleb(wasm, at)?;
            let name_at = at + used;
            let name_end = name_at.checked_add(n)?;
            if name_end <= end && &wasm[name_at..name_end] == b"wac.manifest" {
                return String::from_utf8(wasm[name_end..end].to_vec()).ok();
            }
        }
        at = end;
    }
    None
}

/// LEB128 unsigned: the value, and how many bytes it took.
pub fn uleb(bytes: &[u8], at: usize) -> Option<(usize, usize)> {
    let mut value: usize = 0;
    let mut shift = 0;
    let mut used = 0;
    loop {
        let b = *bytes.get(at + used)?;
        value |= ((b & 0x7f) as usize) << shift;
        used += 1;
        if b & 0x80 == 0 {
            return Some((value, used));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}
