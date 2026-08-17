//! The manifest `packages/platform/native.ts` writes beside the `.wasm`.
//!
//! Read as data rather than compiled in: the field order of `Core` and `Cli` is `platform.wac`'s, and a
//! runtime holding its own copy of that order keeps working — wrongly — the day a capability is
//! inserted in the middle. The JavaScript hosts do hold such a copy, in a `Core.of(...)` call bindgen
//! generated for them; this reads it.

use serde::Deserialize;

/// Bumped when a field changes meaning. Refused rather than guessed at.
pub const SUPPORTED_VERSION: u32 = 1;

#[derive(Debug, Deserialize)]
pub struct Manifest {
    pub version: u32,
    pub entry: String,
    pub wasm: String,
    pub grants: Grants,
    pub callbacks: Vec<Callback>,
    pub structs: Vec<Struct>,
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
    /// The wac type as written, which is how a struct field names the signature it wants.
    #[serde(rename = "type")]
    pub ty: String,
    pub params: Vec<String>,
    pub ret: String,
    /// How many distinct functions of this signature can be live at once. The module's table is fixed
    /// at compile time, so this is a real ceiling rather than a hint.
    pub slots: u32,
}

#[derive(Debug, Deserialize)]
pub struct Struct {
    pub name: String,
    pub bind: String,
    pub fields: Vec<Field>,
    pub methods: Vec<Method>,
    /// An enum's variants, with the export that builds each. Empty for a struct.
    ///
    /// Added 2026-08-12: this file's whole argument is that a host reads the mangling rather than
    /// holding a copy, and enums were the one kind of type the manifest did not describe — so the
    /// three `$bind$e_Read_*_new` names below were spelled in `main.rs` instead. issues/system/0141.
    #[serde(default)]
    pub variants: Vec<Variant>,
}

#[derive(Debug, Deserialize)]
pub struct Variant {
    pub name: String,
    /// The export that builds it.
    pub make: String,
}

#[derive(Debug, Deserialize)]
pub struct Field {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: String,
}

#[derive(Debug, Deserialize)]
pub struct Method {
    pub name: String,
    #[serde(rename = "isStatic")]
    pub is_static: bool,
    pub params: Vec<String>,
    pub ret: String,
    /// The `$bind$` export that calls it, resolved by the emitter so the mangling has one copy.
    #[serde(rename = "export")]
    pub export_name: String,
}

#[derive(Debug, Deserialize)]
pub struct Export {
    pub name: String,
    pub params: Vec<String>,
    pub ret: String,
}

impl Manifest {
    pub fn find_struct(&self, name: &str) -> Option<&Struct> {
        self.structs.iter().find(|s| s.name == name)
    }

    /// The export that builds `<enum>.<variant>`, or `None` when the manifest predates the field.
    pub fn variant_ctor(&self, enum_name: &str, variant: &str) -> Option<&str> {
        self.find_struct(enum_name)?
            .variants
            .iter()
            .find(|v| v.name == variant)
            .map(|v| v.make.as_str())
    }

    /// The index of the callback signature spelled `ty`, which is how a field names the dispatcher
    /// that will serve it.
    pub fn callback_index(&self, ty: &str) -> Option<usize> {
        self.callbacks.iter().position(|c| c.ty == ty)
    }
}

impl Struct {
    pub fn constructor(&self) -> Option<&Method> {
        self.methods.iter().find(|m| m.is_static && m.name == "of")
    }
}
