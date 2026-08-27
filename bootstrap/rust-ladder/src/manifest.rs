//! The `wac.manifest` custom section — what turns a compiled module into the artefact a host can
//! run.
//!
//! A host handed a module cannot work out which export is the memory, what a function's wac
//! signature was, or the field order of a struct it is passed. That is what the manifest is for,
//! and `packages/platform/native.ts` writes one after compiling. Reaching the unified binary with
//! no Deno means writing the same one here.
//!
//! **Everything in it is answered by wacc, or read off the module.** `exportSigsFiles` gives the
//! signatures and `bindTypesFiles` the struct shapes — both tab-separated lines, which is why
//! this is parsing rather than a second compiler. The `bind` table is read from the module's own
//! export list, exactly as `native.ts` reads it from the compile result.
//!
//! **The format is wac's, and this is a copy of it**, which is a thing that can drift. The check
//! for that is a differential: `ts/manifest_test.ts` compares what this writes against what
//! `native.ts` writes for the same program, so a change to the format fails here rather than
//! somewhere downstream of a bootstrap.

/// What a program is allowed to do, as the five flags `native.ts` writes.
#[derive(Default, Clone, Copy)]
pub struct Grants {
    pub read: bool,
    pub write: bool,
    pub env: bool,
    pub net: bool,
    pub run: bool,
}

impl Grants {
    /// `--allow-read` and friends, as `seed.sh` passes them.
    pub fn from_args(args: &[String]) -> Grants {
        let mut g = Grants::default();
        for a in args {
            match a.as_str() {
                "--allow-read" => g.read = true,
                "--allow-write" => g.write = true,
                "--allow-env" => g.env = true,
                "--allow-net" => g.net = true,
                "--allow-run" => g.run = true,
                _ => {}
            }
        }
        g
    }
}

/// One exported function, as `exportSigsFiles` describes it.
pub struct Sig {
    pub name: String,
    pub ret: String,
    pub params: Vec<String>,
}

/// `name\tret\tparam,param` per line.
///
/// The parameter list is split on commas **at the top level**, because a type may carry a comma
/// inside brackets — `Map<u8[], i32>` is one parameter and splitting naively makes it two.
pub fn parse_sigs(wire: &str) -> Vec<Sig> {
    let mut out = Vec::new();
    for line in wire.split('\n') {
        if line.is_empty() {
            continue;
        }
        let mut cols = line.split('\t');
        let name = cols.next().unwrap_or("").to_string();
        let ret = cols.next().unwrap_or("").to_string();
        let params = cols.next().unwrap_or("");
        out.push(Sig { name, ret, params: split_top(params) });
    }
    out
}

/// Split on commas outside `<>`, `[]` and `()`.
fn split_top(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for c in text.chars() {
        match c {
            '<' | '[' | '(' => depth += 1,
            '>' | ']' | ')' => depth -= 1,
            ',' if depth == 0 => {
                if !cur.trim().is_empty() {
                    out.push(cur.trim().to_string());
                }
                cur = String::new();
                continue;
            }
            _ => {}
        }
        cur.push(c);
    }
    if !cur.trim().is_empty() {
        out.push(cur.trim().to_string());
    }
    out
}

/// JSON string escaping, for the handful of characters a path or a type name can hold.
fn json_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// The manifest text, formatted the way `JSON.stringify(m, null, 2)` formats it.
///
/// Two spaces, a newline at the end, and the key order of the `Manifest` type — a differential
/// against the Deno path compares the bytes, so the shape is part of the answer rather than a
/// presentation choice.
pub fn manifest_json(
    entry: &str,
    wasm_name: &str,
    grants: Grants,
    bind: &[(String, String)],
    sigs: &[Sig],
) -> String {
    let mut s = String::new();
    s.push_str("{\n  \"version\": 1,\n");
    s.push_str(&format!("  \"entry\": {},\n", json_str(entry)));
    s.push_str(&format!("  \"wasm\": {},\n", json_str(wasm_name)));
    s.push_str("  \"grants\": {\n");
    for (i, (k, v)) in [
        ("read", grants.read),
        ("write", grants.write),
        ("env", grants.env),
        ("net", grants.net),
        ("run", grants.run),
    ]
    .iter()
    .enumerate()
    {
        s.push_str(&format!("    \"{k}\": {v}{}\n", if i == 4 { "" } else { "," }));
    }
    s.push_str("  },\n");
    // Callbacks and structs are empty for a program that hands the host no function reference and
    // no struct. Filling them needs `bindTypesFiles`' `S`/`E`/`M` lines — see PLAN.md.
    s.push_str("  \"callbacks\": [],\n");
    if bind.is_empty() {
        s.push_str("  \"bind\": {},\n");
    } else {
        s.push_str("  \"bind\": {\n");
        for (i, (k, v)) in bind.iter().enumerate() {
            s.push_str(&format!(
                "    {}: {}{}\n",
                json_str(k),
                json_str(v),
                if i + 1 == bind.len() { "" } else { "," }
            ));
        }
        s.push_str("  },\n");
    }
    s.push_str("  \"structs\": [],\n");
    if sigs.is_empty() {
        s.push_str("  \"exports\": []\n");
    } else {
        s.push_str("  \"exports\": [\n");
        for (i, e) in sigs.iter().enumerate() {
            s.push_str("    {\n");
            s.push_str(&format!("      \"name\": {},\n", json_str(&e.name)));
            if e.params.is_empty() {
                s.push_str("      \"params\": [],\n");
            } else {
                s.push_str("      \"params\": [\n");
                for (k, p) in e.params.iter().enumerate() {
                    s.push_str(&format!(
                        "        {}{}\n",
                        json_str(p),
                        if k + 1 == e.params.len() { "" } else { "," }
                    ));
                }
                s.push_str("      ],\n");
            }
            let ret = if e.ret.is_empty() { "void" } else { &e.ret };
            s.push_str(&format!("      \"ret\": {}\n", json_str(ret)));
            s.push_str(&format!("    }}{}\n", if i + 1 == sigs.len() { "" } else { "," }));
        }
        s.push_str("  ]\n");
    }
    s.push_str("}\n");
    s
}

fn uleb(mut n: u32) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut b = (n & 0x7f) as u8;
        n >>= 7;
        if n != 0 {
            b |= 0x80;
        }
        out.push(b);
        if n == 0 {
            return out;
        }
    }
}

/// The module with the manifest inside it, as a custom section named `wac.manifest`.
///
/// A custom section is the format's own extension point: id 0, a name, and bytes nobody else
/// reads. It goes at the end, where a section of unknown id is allowed to be.
pub fn with_manifest_section(wasm: &[u8], manifest: &str) -> Vec<u8> {
    let name = b"wac.manifest";
    let mut payload = uleb(name.len() as u32);
    payload.extend_from_slice(name);
    payload.extend_from_slice(manifest.as_bytes());

    let mut out = wasm.to_vec();
    out.push(0); // a custom section
    out.extend(uleb(payload.len() as u32));
    out.extend(payload);
    out
}
