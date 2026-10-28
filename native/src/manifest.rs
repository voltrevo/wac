//! The manifest `packages/platform/native.ts` writes beside the `.wasm`.
//!
//! Read as data rather than compiled in: the callback signatures a module takes, the grants it was
//! built with, and the types of its exports — `__wacHost`'s four calls among them — are the module's to
//! say. What else the manifest carries is not read here.

use serde::Deserialize;

/// Bumped when a field changes meaning. Refused rather than guessed at.
pub const SUPPORTED_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub entry: String,
    pub grants: Grants,
    pub callbacks: Vec<Callback>,
    pub exports: Vec<Export>,
}

#[derive(Debug, Default, Clone, Deserialize)]
pub struct Grants {
    #[serde(default)]
    pub read: bool,
    #[serde(default)]
    pub write: bool,
    #[serde(default)]
    pub env: bool,
    #[serde(default)]
    pub net: bool,
    /// Running a host program — `Cli.exec`. Its own grant, not `write`'s: a world that may start a
    /// confined wasm module must be able to refuse a host binary without refusing both.
    /// `issues/system/0165`.
    #[serde(default)]
    pub run: bool,
}

/// One funcref signature the module takes, and how to hand it a function.
#[derive(Debug, Deserialize)]
pub struct Callback {
    /// Import field under module `wac`: `cb0`, `cb1`.
    pub field: String,
    /// Export turning a slot number into the funcref to pass in.
    pub helper: String,
    /// The wac type as written, which is how an export's parameter names the signature it wants.
    #[serde(rename = "type")]
    pub ty: String,
    /// How many distinct functions of this signature can be live at once. The module's table is fixed
    /// at compile time, so this is a real ceiling rather than a hint.
    pub slots: u32,
}

#[derive(Debug, Deserialize, Clone)]
pub struct Export {
    pub name: String,
    pub params: Vec<String>,
    pub ret: String,
}

impl Manifest {
    /// The index of the callback signature spelled `ty`, which is how a parameter names the dispatcher
    /// that will serve it.
    pub fn callback_index(&self, ty: &str) -> Option<usize> {
        self.callbacks.iter().position(|c| c.ty == ty)
    }
}
