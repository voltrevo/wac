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

/// A struct or enum a host can hold, as `bindTypesFiles` describes it.
pub struct BindType {
    pub name: String,
    pub bind: String,
    pub fields: Vec<(String, String)>,
    /// `(name, hasThis, ret, params)`
    pub methods: Vec<(String, bool, String, Vec<String>)>,
    /// `(name, payload)`
    pub variants: Vec<(String, Vec<(String, String)>)>,
}

/// A callback signature the module imports a dispatcher for.
pub struct Callback {
    pub index: i64,
    pub ret: String,
    pub params: Vec<String>,
    pub wac: String,
}

/// Split on `sep`, ignoring any that sits inside brackets.
///
/// A type can hold the separator: `Map<u8[],i32>` is one field type with a comma in it, and a
/// naive split turns `index:Map<u8[],i32>` into a field of type `Map<u8[]` and a second one called
/// `i32>` — a wire that says the right thing, read wrongly.
fn split_on(text: &str, sep: char) -> Vec<String> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut cur = String::new();
    for c in text.chars() {
        match c {
            '<' | '[' | '(' => depth += 1,
            '>' | ']' | ')' => depth -= 1,
            _ => {}
        }
        if c == sep && depth == 0 {
            out.push(cur.clone());
            cur.clear();
            continue;
        }
        cur.push(c);
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// The `S`, `E` and `M` lines: a struct, an enum, and a method belonging to one.
pub fn parse_bind_types(wire: &str) -> Vec<BindType> {
    let mut out: Vec<BindType> = Vec::new();
    for line in wire.split('\n') {
        if line.is_empty() {
            continue;
        }
        let cells: Vec<&str> = line.split('\t').collect();
        match cells.first().copied() {
            Some("S") | Some("E") => {
                let is_struct = cells[0] == "S";
                let mut t = BindType {
                    name: cells.get(1).unwrap_or(&"").to_string(),
                    bind: cells.get(2).unwrap_or(&"").to_string(),
                    fields: Vec::new(),
                    methods: Vec::new(),
                    variants: Vec::new(),
                };
                let body = cells.get(3).copied().unwrap_or("");
                if is_struct && !body.is_empty() {
                    for f in split_on(body, ',') {
                        if let Some(at) = f.find(':') {
                            t.fields.push((f[..at].to_string(), f[at + 1..].to_string()));
                        }
                    }
                }
                if !is_struct && !body.is_empty() {
                    for v in split_on(body, ';') {
                        let mut bits = v.splitn(2, ':');
                        let name = bits.next().unwrap_or("").to_string();
                        let rest = bits.next().unwrap_or("");
                        let mut payload = Vec::new();
                        if !rest.is_empty() {
                            for f in split_on(rest, '|') {
                                if let Some(at) = f.find(':') {
                                    payload.push((f[..at].to_string(), f[at + 1..].to_string()));
                                }
                            }
                        }
                        t.variants.push((name, payload));
                    }
                }
                out.push(t);
            }
            Some("M") => {
                let owner = cells.get(1).copied().unwrap_or("");
                let Some(t) = out.iter_mut().find(|t| t.bind == owner) else { continue };
                let params = cells.get(5).copied().unwrap_or("");
                t.methods.push((
                    cells.get(2).unwrap_or(&"").to_string(),
                    cells.get(3).copied() == Some("this"),
                    cells.get(4).unwrap_or(&"").to_string(),
                    if params.is_empty() { Vec::new() } else { split_on(params, ',') },
                ));
            }
            _ => {}
        }
    }
    out
}

/// The `C` lines, in the order `wac.cb<j>` is numbered.
pub fn parse_callbacks(wire: &str) -> Vec<Callback> {
    let mut out = Vec::new();
    for line in wire.split('\n') {
        if !line.starts_with("C\t") {
            continue;
        }
        let cells: Vec<&str> = line.split('\t').collect();
        let params = cells.get(3).copied().unwrap_or("");
        out.push(Callback {
            index: cells.get(1).and_then(|s| s.parse().ok()).unwrap_or(0),
            ret: cells.get(2).unwrap_or(&"").to_string(),
            params: if params.is_empty() { Vec::new() } else { split_on(params, ',') },
            wac: cells.get(4).unwrap_or(&"").to_string(),
        });
    }
    out
}

/// The `A` lines: a name that is another type under a different spelling.
pub fn parse_aliases(wire: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for line in wire.split('\n') {
        if !line.starts_with("A\t") {
            continue;
        }
        let cells: Vec<&str> = line.split('\t').collect();
        out.push((cells.get(1).unwrap_or(&"").to_string(), cells.get(2).unwrap_or(&"").to_string()));
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

/// Just enough JSON to write a manifest, and to write it the way `JSON.stringify(m, null, 2)`
/// writes it — two spaces per level, no space before a colon, and no trailing commas. The
/// formatting is part of the answer here rather than a presentation choice, because the check is a
/// byte comparison against what `native.ts` produced.
#[derive(Clone)]
pub enum Json {
    Str(String),
    Bool(bool),
    Num(i64),
    Arr(Vec<Json>),
    Obj(Vec<(String, Json)>),
}

impl Json {
    fn write(&self, out: &mut String, indent: usize) {
        let pad = "  ".repeat(indent);
        let inner = "  ".repeat(indent + 1);
        match self {
            Json::Str(v) => out.push_str(&json_str(v)),
            Json::Bool(v) => out.push_str(if *v { "true" } else { "false" }),
            Json::Num(v) => out.push_str(&v.to_string()),
            // An empty array or object is `[]` and `{}` on one line, which is what
            // `JSON.stringify` does and is easy to get wrong by always expanding.
            Json::Arr(items) if items.is_empty() => out.push_str("[]"),
            Json::Obj(pairs) if pairs.is_empty() => out.push_str("{}"),
            Json::Arr(items) => {
                out.push_str("[\n");
                for (i, it) in items.iter().enumerate() {
                    out.push_str(&inner);
                    it.write(out, indent + 1);
                    out.push_str(if i + 1 == items.len() { "\n" } else { ",\n" });
                }
                out.push_str(&pad);
                out.push(']');
            }
            Json::Obj(pairs) => {
                out.push_str("{\n");
                for (i, (k, v)) in pairs.iter().enumerate() {
                    out.push_str(&inner);
                    out.push_str(&json_str(k));
                    out.push_str(": ");
                    v.write(out, indent + 1);
                    out.push_str(if i + 1 == pairs.len() { "\n" } else { ",\n" });
                }
                out.push_str(&pad);
                out.push('}');
            }
        }
    }

    pub fn text(&self) -> String {
        let mut out = String::new();
        self.write(&mut out, 0);
        out.push('\n');
        out
    }
}

fn s(v: &str) -> Json {
    Json::Str(v.to_string())
}

fn strings(v: &[String]) -> Json {
    Json::Arr(v.iter().map(|x| Json::Str(x.clone())).collect())
}

/// Name-and-type pairs, the shape a field takes in the manifest.
fn named(pairs: &[(String, String)]) -> Json {
    Json::Arr(
        pairs
            .iter()
            .map(|(n, t)| Json::Obj(vec![("name".into(), s(n)), ("type".into(), s(t))]))
            .collect(),
    )
}

/// The manifest, as `native.ts` builds it.
///
/// **The mangling is resolved here, once**, against the module this describes — which is why a
/// method's export name is computed at this point rather than in each runtime that reads the file.
#[allow(clippy::too_many_arguments)]
pub fn manifest_json(
    entry: &str,
    wasm_name: &str,
    grants: Grants,
    bind: &[(String, String)],
    sigs: &[Sig],
    callbacks: &[Callback],
    types: &[BindType],
    aliases: &[(String, String)],
) -> String {
    let mut structs: Vec<(String, Json)> = types
        .iter()
        .map(|t| {
            let methods = Json::Arr(
                t.methods
                    .iter()
                    .map(|(name, has_this, ret, params)| {
                        Json::Obj(vec![
                            ("name".into(), s(name)),
                            ("isStatic".into(), Json::Bool(!has_this)),
                            ("params".into(), strings(params)),
                            ("ret".into(), s(if ret.is_empty() { "void" } else { ret })),
                            (
                                "export".into(),
                                s(&format!(
                                    "$bind${}_{}_{}",
                                    if *has_this { "m" } else { "sm" },
                                    t.bind,
                                    name
                                )),
                            ),
                        ])
                    })
                    .collect(),
            );
            let variants = Json::Arr(
                t.variants
                    .iter()
                    .map(|(name, payload)| {
                        Json::Obj(vec![
                            ("name".into(), s(name)),
                            ("fields".into(), named(payload)),
                            ("make".into(), s(&format!("$bind$e_{}_{}_new", t.bind, name))),
                        ])
                    })
                    .collect(),
            );
            (
                t.name.clone(),
                Json::Obj(vec![
                    ("name".into(), s(&t.name)),
                    ("bind".into(), s(&t.bind)),
                    ("fields".into(), named(&t.fields)),
                    ("methods".into(), methods),
                    ("variants".into(), variants),
                ]),
            )
        })
        .collect();

    // An alias is a second spelling of a type already described: copy the description and change
    // the name. Skipped when something already answers to that name.
    for (of, name) in aliases {
        if structs.iter().any(|(n, _)| n == name) {
            continue;
        }
        let Some((_, Json::Obj(fields))) = structs.iter().find(|(n, _)| n == of) else { continue };
        let mut copy = fields.clone();
        if let Some(slot) = copy.iter_mut().find(|(k, _)| k == "name") {
            slot.1 = s(name);
        }
        structs.push((name.clone(), Json::Obj(copy)));
    }

    let m = Json::Obj(vec![
        ("version".into(), Json::Num(1)),
        ("entry".into(), s(entry)),
        ("wasm".into(), s(wasm_name)),
        (
            "grants".into(),
            Json::Obj(vec![
                ("read".into(), Json::Bool(grants.read)),
                ("write".into(), Json::Bool(grants.write)),
                ("env".into(), Json::Bool(grants.env)),
                ("net".into(), Json::Bool(grants.net)),
                ("run".into(), Json::Bool(grants.run)),
            ]),
        ),
        (
            "callbacks".into(),
            Json::Arr(
                callbacks
                    .iter()
                    .map(|c| {
                        Json::Obj(vec![
                            ("field".into(), s(&format!("cb{}", c.index))),
                            ("helper".into(), s(&format!("$bind$fnref_{}", c.index))),
                            ("type".into(), s(&c.wac)),
                            ("params".into(), strings(&c.params)),
                            ("ret".into(), s(if c.ret.is_empty() { "void" } else { &c.ret })),
                            // Both compilers emit this many trampolines per signature.
                            ("slots".into(), Json::Num(16)),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "bind".into(),
            Json::Obj(bind.iter().map(|(k, v)| (k.clone(), s(v))).collect()),
        ),
        ("structs".into(), Json::Arr(structs.into_iter().map(|(_, j)| j).collect())),
        (
            "exports".into(),
            Json::Arr(
                sigs.iter()
                    .filter(|e| !e.name.starts_with("$bind$"))
                    .map(|e| {
                        Json::Obj(vec![
                            ("name".into(), s(&e.name)),
                            ("params".into(), strings(&e.params)),
                            ("ret".into(), s(if e.ret.is_empty() { "void" } else { &e.ret })),
                        ])
                    })
                    .collect(),
            ),
        ),
    ]);
    m.text()
}

/// Every name a module exports, read out of its export section.
///
/// **Read rather than instantiated.** The obvious way is to instantiate the module and ask
/// JavaScript for the keys — which works until the module *imports* something, and then wants an
/// import object nobody has. A module's exports are in the file; taking them from there needs no
/// engine and no imports.
pub fn export_names(wasm: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut p = 8; // past the magic and the version
    let read = |p: &mut usize| -> u32 {
        let mut n = 0u32;
        let mut shift = 0;
        loop {
            if *p >= wasm.len() {
                return n;
            }
            let b = wasm[*p];
            *p += 1;
            n |= ((b & 0x7f) as u32) << shift;
            shift += 7;
            if b & 0x80 == 0 {
                return n;
            }
        }
    };
    while p < wasm.len() {
        let id = wasm[p];
        p += 1;
        let len = read(&mut p) as usize;
        let end = p + len;
        if id == 7 {
            let count = read(&mut p);
            for _ in 0..count {
                let n = read(&mut p) as usize;
                if p + n > wasm.len() {
                    return out;
                }
                out.push(String::from_utf8_lossy(&wasm[p..p + n]).into_owned());
                p += n;
                p += 1; // the kind
                read(&mut p); // the index
            }
            return out;
        }
        p = end;
    }
    out
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
