//! The `.wax` assembler, in Rust. See `spec/wax.md`.
//!
//! A deliberate line-for-line translation of `ts/assemble.ts`: the same three passes, the same
//! names, the same emission order. Two implementations that agree because they were written from
//! the same structure prove less than two written independently — but they prove the *format* is
//! unambiguous, which is what is being tested, and a divergence here is a real defect in one of
//! them rather than a difference of interpretation.

use std::collections::HashMap;

/// A value type is a number type, an abstract reference, or a reference to a declared type. The last
/// is two bytes — a nullability byte and the type's index — which is why this is a shape rather than
/// a byte, and why every place that emits one asks for a list.
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum ValType {
    Plain(u8, &'static str),
    Ref { nullable: bool, to: String },
}

impl ValType {
    fn name(&self) -> String {
        match self {
            ValType::Plain(_, n) => (*n).to_string(),
            ValType::Ref { nullable, to } => {
                format!("{} {}", if *nullable { "refnull" } else { "ref" }, to)
            }
        }
    }
}

/// The number types and the abstract heap types, spelled as value types.
fn plain(tok: &str) -> Option<ValType> {
    Some(match tok {
        "i32" => ValType::Plain(0x7f, "i32"),
        "i64" => ValType::Plain(0x7e, "i64"),
        "anyref" => ValType::Plain(0x6e, "anyref"),
        "eqref" => ValType::Plain(0x6d, "eqref"),
        "i31ref" => ValType::Plain(0x6c, "i31ref"),
        "structref" => ValType::Plain(0x6b, "structref"),
        "arrayref" => ValType::Plain(0x6a, "arrayref"),
        "nullref" => ValType::Plain(0x71, "nullref"),
        _ => return None,
    })
}

#[derive(Debug)]
pub struct WaxError(pub String);

impl std::fmt::Display for WaxError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.0)
    }
}

fn err<T>(line: usize, message: impl Into<String>) -> Result<T, WaxError> {
    Err(WaxError(format!("line {}: {}", line, message.into())))
}

// ---------------------------------------------------------------- LEB128

pub fn uleb(mut n: u32) -> Vec<u8> {
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

pub fn sleb(mut v: i64) -> Vec<u8> {
    let mut out = Vec::new();
    loop {
        let mut b = (v & 0x7f) as u8;
        v >>= 7;
        // The sign bit of the byte must match the sign of what is left, or another byte is needed.
        let sign_bit_set = (b & 0x40) != 0;
        let done = (v == 0 && !sign_bit_set) || (v == -1 && sign_bit_set);
        if !done {
            b |= 0x80;
        }
        out.push(b);
        if done {
            return out;
        }
    }
}

fn name_bytes(s: &str) -> Vec<u8> {
    let mut out = uleb(s.len() as u32);
    out.extend_from_slice(s.as_bytes());
    out
}

fn section(id: u8, payload: Vec<u8>) -> Vec<u8> {
    if payload.is_empty() {
        return Vec::new();
    }
    let mut out = vec![id];
    out.extend(uleb(payload.len() as u32));
    out.extend(payload);
    out
}

fn vector(items: Vec<Vec<u8>>) -> Vec<u8> {
    let mut out = uleb(items.len() as u32);
    for it in items {
        out.extend(it);
    }
    out
}

// ---------------------------------------------------------------- pass 1: read

struct FuncType {
    params: Vec<ValType>,
    results: Vec<ValType>,
}

enum DeclType {
    Func(FuncType),
    Struct(Vec<ValType>),
    Array(ValType),
}

struct Decl {
    name: String,
    body: DeclType,
}

struct Import {
    module: String,
    field: String,
    name: String,
    params: Vec<ValType>,
    results: Vec<ValType>,
}

struct Global {
    name: String,
    ty: ValType,
    mutable: bool,
    value: i64,
}

struct DataSeg {
    offset: i64,
    bytes: Vec<u8>,
}

enum ExportKind {
    Func(String),
    Memory,
}

struct Export {
    name: String,
    kind: ExportKind,
}

struct Local {
    name: String,
    ty: ValType,
}

struct Line {
    n: usize,
    tokens: Vec<String>,
}

struct Func {
    name: String,
    params: Vec<Local>,
    locals: Vec<Local>,
    results: Vec<ValType>,
    body: Vec<Line>,
}

struct Module {
    types: Vec<Decl>,
    imports: Vec<Import>,
    memory_pages: Option<u32>,
    globals: Vec<Global>,
    data: Vec<DataSeg>,
    exports: Vec<Export>,
    funcs: Vec<Func>,
}

/// Split a line into tokens, keeping a double-quoted string as one token.
fn tokenize(src: &str) -> Vec<String> {
    let b: Vec<char> = src.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == ' ' || c == '\t' || c == '\r' {
            i += 1;
            continue;
        }
        if c == ';' {
            break;
        }
        if c == '"' {
            let mut j = i + 1;
            while j < b.len() && b[j] != '"' {
                if b[j] == '\\' {
                    j += 1;
                }
                j += 1;
            }
            let end = (j + 1).min(b.len());
            out.push(b[i..end].iter().collect::<String>());
            i = j + 1;
            continue;
        }
        let mut j = i;
        while j < b.len() && !matches!(b[j], ' ' | '\t' | '\r' | ';') {
            j += 1;
        }
        out.push(b[i..j].iter().collect::<String>());
        i = j;
    }
    out
}

fn unquote(tok: &str, line: usize) -> Result<Vec<u8>, WaxError> {
    if tok.len() < 2 || !tok.starts_with('"') || !tok.ends_with('"') {
        return err(line, format!("expected a double-quoted string, got {}", tok));
    }
    let s: Vec<char> = tok[1..tok.len() - 1].chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < s.len() {
        if s[i] != '\\' {
            let mut buf = [0u8; 4];
            out.extend_from_slice(s[i].encode_utf8(&mut buf).as_bytes());
            i += 1;
            continue;
        }
        i += 1;
        match s.get(i) {
            Some('n') => out.push(10),
            Some('t') => out.push(9),
            Some('\\') => out.push(92),
            Some('"') => out.push(34),
            Some('x') => {
                let hex: String = s.get(i + 1..i + 3).map(|c| c.iter().collect()).unwrap_or_default();
                match u8::from_str_radix(&hex, 16) {
                    Ok(v) if hex.len() == 2 => out.push(v),
                    _ => return err(line, format!("bad \\x escape: \\x{}", hex)),
                }
                i += 2;
            }
            Some(c) => return err(line, format!("unknown escape \\{}", c)),
            None => return err(line, "a trailing backslash"),
        }
        i += 1;
    }
    Ok(out)
}

/// A run of value types. `ref` and `refnull` take the following token, which is why this consumes a
/// list rather than mapping over one — a reference is two tokens and a number is one.
fn valtypes(toks: &[String], line: usize) -> Result<Vec<ValType>, WaxError> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let t = toks[i].as_str();
        if t == "ref" || t == "refnull" {
            match toks.get(i + 1) {
                Some(to) => out.push(ValType::Ref { nullable: t == "refnull", to: to.clone() }),
                None => return err(line, format!("{} with no type after it", t)),
            }
            i += 2;
            continue;
        }
        match plain(t) {
            Some(v) => out.push(v),
            None => return err(line, format!("not a value type: {}", t)),
        }
        i += 1;
    }
    Ok(out)
}

fn one_valtype(toks: &[String], line: usize, what: &str) -> Result<ValType, WaxError> {
    let v = valtypes(toks, line)?;
    if v.len() != 1 {
        return err(line, format!("{} needs exactly one type", what));
    }
    Ok(v.into_iter().next().unwrap())
}

/// Everything after `->` on a directive line.
fn results_after_arrow(tokens: &[String], from: usize, line: usize) -> Result<Vec<ValType>, WaxError> {
    match tokens.iter().skip(from).position(|t| t == "->") {
        Some(rel) => valtypes(&tokens[from + rel + 1..], line),
        None => err(line, "expected `->`"),
    }
}

/// How many block-likes are open inside a partially-read body — so `end` can close the function.
fn depth_of(body: &[Line]) -> i32 {
    let mut d = 0;
    for l in body {
        match l.tokens[0].as_str() {
            "block" | "loop" | "if" => d += 1,
            "end" => d -= 1,
            _ => {}
        }
    }
    d
}

fn read(source: &str) -> Result<Module, WaxError> {
    let mut m = Module {
        types: Vec::new(),
        imports: Vec::new(),
        memory_pages: None,
        globals: Vec::new(),
        data: Vec::new(),
        exports: Vec::new(),
        funcs: Vec::new(),
    };
    let lines: Vec<&str> = source.split('\n').collect();
    let mut cur: Option<Func> = None;

    for (i, raw) in lines.iter().enumerate() {
        let n = i + 1;
        let t = tokenize(raw);
        if t.is_empty() {
            continue;
        }

        if let Some(f) = cur.as_mut() {
            if t[0] == "end" && t.len() == 1 && depth_of(&f.body) == 0 {
                m.funcs.push(cur.take().unwrap());
                continue;
            }
            // **The name is last, and the type is everything before it.** A reference type is two
            // tokens, so a fixed position for the name works for `i32` and not for `refnull $Node`.
            if t[0] == "param" || t[0] == "local" {
                if t[0] == "param" && (!f.locals.is_empty() || !f.body.is_empty()) {
                    return err(n, "`param` must come before locals and instructions");
                }
                if t[0] == "local" && !f.body.is_empty() {
                    return err(n, "`local` must come before instructions");
                }
                let ty = one_valtype(&t[1..t.len() - 1], n, &t[0])?;
                let slot = Local { name: t[t.len() - 1].clone(), ty };
                if t[0] == "param" { f.params.push(slot); } else { f.locals.push(slot); }
                continue;
            }
            f.body.push(Line { n, tokens: t });
            continue;
        }

        match t[0].as_str() {
            "type" => {
                if t[2] == "struct" {
                    m.types.push(Decl {
                        name: t[1].clone(),
                        body: DeclType::Struct(valtypes(&t[3..], n)?),
                    });
                } else if t[2] == "array" {
                    let el = one_valtype(&t[3..], n, "an array")?;
                    m.types.push(Decl { name: t[1].clone(), body: DeclType::Array(el) });
                } else {
                    let arrow = match t.iter().position(|x| x == "->") {
                        Some(a) => a,
                        None => return err(n, "expected `type $n func … -> …`"),
                    };
                    if t[2] != "func" {
                        return err(n, "expected `type $n func … -> …`, `… struct …` or `… array …`");
                    }
                    m.types.push(Decl {
                        name: t[1].clone(),
                        body: DeclType::Func(FuncType {
                            params: valtypes(&t[3..arrow], n)?,
                            results: valtypes(&t[arrow + 1..], n)?,
                        }),
                    });
                }
            }
            "import" => {
                let arrow = match t.iter().position(|x| x == "->") {
                    Some(a) => a,
                    None => return err(n, "expected `import … $n func … -> …`"),
                };
                if t[4] != "func" {
                    return err(n, "expected `import … $n func … -> …`");
                }
                m.imports.push(Import {
                    module: String::from_utf8(unquote(&t[1], n)?).unwrap(),
                    field: String::from_utf8(unquote(&t[2], n)?).unwrap(),
                    name: t[3].clone(),
                    params: valtypes(&t[5..arrow], n)?,
                    results: valtypes(&t[arrow + 1..], n)?,
                });
            }
            "memory" => {
                if m.memory_pages.is_some() {
                    return err(n, "a second `memory`");
                }
                m.memory_pages = Some(t[1].parse().map_err(|_| WaxError(format!("line {}: pages", n)))?);
            }
            "global" => {
                let eq = match t.iter().position(|x| x == "=") {
                    Some(a) if a >= 4 => a,
                    _ => return err(n, "expected `global $n <type> <mut|const> = <lit>`"),
                };
                let ty = one_valtype(&t[2..eq - 1], n, "a global")?;
                // A reference global starts null and has no literal to read.
                let value = match ty {
                    ValType::Ref { .. } => 0,
                    _ => t[eq + 1].parse().map_err(|_| WaxError(format!("line {}: literal", n)))?,
                };
                m.globals.push(Global {
                    name: t[1].clone(),
                    ty,
                    mutable: t[eq - 1] == "mut",
                    value,
                });
            }
            "data" => m.data.push(DataSeg {
                offset: t[1].parse().map_err(|_| WaxError(format!("line {}: offset", n)))?,
                bytes: unquote(&t[2], n)?,
            }),
            "export" => {
                let label = String::from_utf8(unquote(&t[1], n)?).unwrap();
                match t[2].as_str() {
                    "memory" => m.exports.push(Export { name: label, kind: ExportKind::Memory }),
                    "func" => m.exports.push(Export {
                        name: label,
                        kind: ExportKind::Func(t[3].clone()),
                    }),
                    other => return err(n, format!("export of {} is not a thing", other)),
                }
            }
            "func" => {
                cur = Some(Func {
                    name: t[1].clone(),
                    params: Vec::new(),
                    locals: Vec::new(),
                    results: results_after_arrow(&t, 2, n)?,
                    body: Vec::new(),
                });
            }
            other => return err(n, format!("unknown directive {}", other)),
        }
    }
    if let Some(f) = cur {
        return err(lines.len(), format!("function {} has no `end`", f.name));
    }
    Ok(m)
}

// ---------------------------------------------------------------- pass 2: index

struct Index {
    types: Vec<Decl>,
    type_of: HashMap<String, u32>,
    func_of: HashMap<String, u32>,
    global_of: HashMap<String, u32>,
    func_type_index: Vec<u32>,
}

fn shape_key(params: &[ValType], results: &[ValType]) -> String {
    let p: Vec<String> = params.iter().map(|v| v.name()).collect();
    let r: Vec<String> = results.iter().map(|v| v.name()).collect();
    format!("{}->{}", p.join(","), r.join(","))
}

fn index(m: &Module) -> Index {
    let mut types: Vec<Decl> = Vec::new();
    let mut by_shape: HashMap<String, u32> = HashMap::new();
    for d in &m.types {
        if let DeclType::Func(ft) = &d.body {
            let k = shape_key(&ft.params, &ft.results);
            by_shape.entry(k).or_insert(types.len() as u32);
        }
        types.push(Decl {
            name: d.name.clone(),
            body: match &d.body {
                DeclType::Func(ft) => DeclType::Func(FuncType {
                    params: ft.params.clone(),
                    results: ft.results.clone(),
                }),
                DeclType::Struct(f) => DeclType::Struct(f.clone()),
                DeclType::Array(e) => DeclType::Array(e.clone()),
            },
        });
    }

    // A shape may already be declared, in which case a function reuses it; an undeclared shape is
    // appended. Declared types are never merged with each other — see the spec.
    fn need(
        types: &mut Vec<Decl>,
        by_shape: &mut HashMap<String, u32>,
        params: &[ValType],
        results: &[ValType],
    ) -> u32 {
        let k = shape_key(params, results);
        if let Some(at) = by_shape.get(&k) {
            return *at;
        }
        let nm = format!("$auto{}", types.len());
        types.push(Decl {
            name: nm,
            body: DeclType::Func(FuncType { params: params.to_vec(), results: results.to_vec() }),
        });
        let at = types.len() as u32 - 1;
        by_shape.insert(k, at);
        at
    }

    let mut func_of = HashMap::new();
    for (i, im) in m.imports.iter().enumerate() {
        need(&mut types, &mut by_shape, &im.params, &im.results);
        func_of.insert(im.name.clone(), i as u32);
    }
    let mut func_type_index = Vec::new();
    for (i, f) in m.funcs.iter().enumerate() {
        func_of.insert(f.name.clone(), (m.imports.len() + i) as u32);
        let params: Vec<ValType> = f.params.iter().map(|p| p.ty.clone()).collect();
        func_type_index.push(need(&mut types, &mut by_shape, &params, &f.results));
    }

    let mut global_of = HashMap::new();
    for (i, g) in m.globals.iter().enumerate() {
        global_of.insert(g.name.clone(), i as u32);
    }

    // Built after `need` has appended: an auto type is still a name something could refer to.
    let mut type_of = HashMap::new();
    for (i, d) in types.iter().enumerate() {
        type_of.entry(d.name.clone()).or_insert(i as u32);
    }

    Index { types, type_of, func_of, global_of, func_type_index }
}

// ---------------------------------------------------------------- pass 3: emit

fn nullary(op: &str) -> Option<u8> {
    Some(match op {
        "return" => 0x0f,
        "drop" => 0x1a,
        "select" => 0x1b,
        "unreachable" => 0x00,
        "nop" => 0x01,
        "i32.eqz" => 0x45,
        "i32.eq" => 0x46,
        "i32.ne" => 0x47,
        "i32.lt_s" => 0x48,
        "i32.lt_u" => 0x49,
        "i32.gt_s" => 0x4a,
        "i32.gt_u" => 0x4b,
        "i32.le_s" => 0x4c,
        "i32.le_u" => 0x4d,
        "i32.ge_s" => 0x4e,
        "i32.ge_u" => 0x4f,
        "i32.add" => 0x6a,
        "i32.sub" => 0x6b,
        "i32.mul" => 0x6c,
        "i32.div_s" => 0x6d,
        "i32.div_u" => 0x6e,
        "i32.rem_s" => 0x6f,
        "i32.rem_u" => 0x70,
        "i32.and" => 0x71,
        "i32.or" => 0x72,
        "i32.xor" => 0x73,
        "i32.shl" => 0x74,
        "i32.shr_s" => 0x75,
        "i32.shr_u" => 0x76,
        _ => return None,
    })
}

fn memop(op: &str) -> Option<u8> {
    Some(match op {
        "i32.load" => 0x28,
        "i32.load8_s" => 0x2c,
        "i32.load8_u" => 0x2d,
        "i32.store" => 0x36,
        "i32.store8" => 0x3a,
        _ => return None,
    })
}

/// A value type's bytes. A reference is a nullability byte and the type's index as a **signed** LEB —
/// the same slot holds the negative abbreviations for the abstract types, which is why it cannot be
/// the unsigned encoding used everywhere else for an index.
fn vt_bytes(v: &ValType, ix: &Index, line: usize) -> Result<Vec<u8>, WaxError> {
    match v {
        ValType::Plain(b, _) => Ok(vec![*b]),
        ValType::Ref { nullable, to } => match ix.type_of.get(to) {
            Some(at) => {
                let mut out = vec![if *nullable { 0x63 } else { 0x64 }];
                out.extend(sleb(*at as i64));
                Ok(out)
            }
            None => err(line, format!("no type {}", to)),
        },
    }
}

/// A heap type, for `ref.null`, `ref.test` and `ref.cast`.
fn heap_type(tok: &str, ix: &Index, line: usize) -> Result<Vec<u8>, WaxError> {
    if let Some(ValType::Plain(b, _)) = plain(tok) {
        return Ok(vec![b]);
    }
    match tok {
        "none" => return Ok(vec![0x71]),
        "any" => return Ok(vec![0x6e]),
        "eq" => return Ok(vec![0x6d]),
        _ => {}
    }
    match ix.type_of.get(tok) {
        Some(at) => Ok(sleb(*at as i64)),
        None => err(line, format!("no type {}", tok)),
    }
}

/// The block type of a block-like: empty, or a single value type.
fn block_type(results: &[ValType], ix: &Index, line: usize) -> Result<Vec<u8>, WaxError> {
    match results.len() {
        0 => Ok(vec![0x40]),
        1 => vt_bytes(&results[0], ix, line),
        _ => err(line, "a block with more than one result needs a type index, unsupported"),
    }
}

/// The GC instructions that take one type index, by their second opcode byte.
fn gc1(op: &str) -> Option<u8> {
    Some(match op {
        "struct.new" => 0x00,
        "struct.new_default" => 0x01,
        "array.new" => 0x06,
        "array.new_default" => 0x07,
        "array.get" => 0x0b,
        "array.get_s" => 0x0c,
        "array.get_u" => 0x0d,
        "array.set" => 0x0e,
        _ => return None,
    })
}

/// ...and those that take a type index and a field index.
fn gc2(op: &str) -> Option<u8> {
    Some(match op {
        "struct.get" => 0x02,
        "struct.get_s" => 0x03,
        "struct.get_u" => 0x04,
        "struct.set" => 0x05,
        _ => return None,
    })
}

fn emit_body(f: &Func, ix: &Index) -> Result<Vec<u8>, WaxError> {
    let mut slot: HashMap<&str, u32> = HashMap::new();
    for (i, p) in f.params.iter().enumerate() {
        slot.insert(&p.name, i as u32);
    }
    for (i, l) in f.locals.iter().enumerate() {
        slot.insert(&l.name, (f.params.len() + i) as u32);
    }

    // Open labels, innermost last. `br $l` is the distance from the top of this stack.
    let mut labels: Vec<&str> = Vec::new();
    let mut out: Vec<u8> = Vec::new();

    for line in &f.body {
        let n = line.n;
        let t = &line.tokens;
        let op = t[0].as_str();

        if let Some(b) = nullary(op) {
            out.push(b);
            continue;
        }
        if let Some(code) = gc1(op) {
            match ix.type_of.get(&t[1]) {
                Some(at) => {
                    out.push(0xfb);
                    out.extend(uleb(code as u32));
                    out.extend(uleb(*at));
                }
                None => return err(n, format!("no type {}", t[1])),
            }
            continue;
        }
        if let Some(code) = gc2(op) {
            match ix.type_of.get(&t[1]) {
                Some(at) => {
                    out.push(0xfb);
                    out.extend(uleb(code as u32));
                    out.extend(uleb(*at));
                    out.extend(uleb(t[2].parse().unwrap_or(0)));
                }
                None => return err(n, format!("no type {}", t[1])),
            }
            continue;
        }
        if let Some(b) = memop(op) {
            if t.len() != 3 {
                return err(n, format!("{} needs <align> <offset>", op));
            }
            let align: u32 = t[1].parse().unwrap_or(0);
            if !matches!(align, 1 | 2 | 4 | 8) {
                return err(n, format!("align must be a power of two in bytes, got {}", t[1]));
            }
            out.push(b);
            out.extend(uleb(align.trailing_zeros()));
            out.extend(uleb(t[2].parse().unwrap_or(0)));
            continue;
        }

        let local_of = |name: &str| -> Result<u32, WaxError> {
            match slot.get(name) {
                Some(v) => Ok(*v),
                None => err(n, format!("no local or parameter {}", name)),
            }
        };

        match op {
            "i32.const" => {
                out.push(0x41);
                out.extend(sleb(t[1].parse().map_err(|_| WaxError(format!("line {}: literal", n)))?));
            }
            "i64.const" => {
                out.push(0x42);
                out.extend(sleb(t[1].parse().map_err(|_| WaxError(format!("line {}: literal", n)))?));
            }
            "local.get" => {
                out.push(0x20);
                out.extend(uleb(local_of(&t[1])?));
            }
            "local.set" => {
                out.push(0x21);
                out.extend(uleb(local_of(&t[1])?));
            }
            "local.tee" => {
                out.push(0x22);
                out.extend(uleb(local_of(&t[1])?));
            }
            "global.get" | "global.set" => match ix.global_of.get(&t[1]) {
                Some(at) => {
                    out.push(if op == "global.get" { 0x23 } else { 0x24 });
                    out.extend(uleb(*at));
                }
                None => return err(n, format!("no global {}", t[1])),
            },
            "memory.size" => out.extend_from_slice(&[0x3f, 0x00]),
            "memory.grow" => out.extend_from_slice(&[0x40, 0x00]),
            "call" => match ix.func_of.get(&t[1]) {
                Some(at) => {
                    out.push(0x10);
                    out.extend(uleb(*at));
                }
                None => return err(n, format!("no function {}", t[1])),
            },
            "array.len" => out.extend_from_slice(&[0xfb, 0x0f]),
            "ref.is_null" => out.push(0xd1),
            "ref.eq" => out.push(0xd3),
            "ref.as_non_null" => out.push(0xd4),
            "ref.null" => {
                out.push(0xd0);
                out.extend(heap_type(&t[1], ix, n)?);
            }
            // `ref.test` and `ref.cast` are written with the nullability they test for, the same two
            // spellings a value type uses, because the opcode differs by exactly that.
            "ref.test" | "ref.cast" => {
                if t[1] != "ref" && t[1] != "refnull" {
                    return err(n, format!("{} needs `ref` or `refnull` and a type", op));
                }
                let base: u8 = if op == "ref.test" { 0x14 } else { 0x16 };
                out.push(0xfb);
                out.extend(uleb((base + if t[1] == "refnull" { 1 } else { 0 }) as u32));
                out.extend(heap_type(&t[2], ix, n)?);
            }
            "block" | "loop" | "if" => {
                out.push(match op {
                    "block" => 0x02,
                    "loop" => 0x03,
                    _ => 0x04,
                });
                out.extend(block_type(&results_after_arrow(t, 2, n)?, ix, n)?);
                labels.push(&t[1]);
            }
            "else" => out.push(0x05),
            "end" => {
                if labels.is_empty() {
                    return err(n, "an `end` with nothing open");
                }
                labels.pop();
                out.push(0x0b);
            }
            "br" | "br_if" => {
                let d = match labels.iter().rposition(|l| *l == t[1]) {
                    Some(at) => (labels.len() - 1 - at) as u32,
                    None => return err(n, format!("no label {} is open here", t[1])),
                };
                out.push(if op == "br" { 0x0c } else { 0x0d });
                out.extend(uleb(d));
            }
            other => return err(n, format!("unknown instruction {}", other)),
        }
    }
    if !labels.is_empty() {
        return Err(WaxError(format!("{}: {} block(s) left open", f.name, labels.len())));
    }
    out.push(0x0b); // the function's own end
    Ok(out)
}

/// Consecutive locals of one type are one entry, which is what wasm's format asks for.
fn local_decls(f: &Func, ix: &Index) -> Vec<u8> {
    let mut runs: Vec<(ValType, u32)> = Vec::new();
    for l in &f.locals {
        match runs.last_mut() {
            Some((ty, count)) if ty.name() == l.ty.name() => *count += 1,
            _ => runs.push((l.ty.clone(), 1)),
        }
    }
    vector(
        runs.into_iter()
            .map(|(ty, count)| {
                let mut e = uleb(count);
                e.extend(vt_bytes(&ty, ix, 0).unwrap_or_default());
                e
            })
            .collect(),
    )
}

pub fn assemble(source: &str) -> Result<Vec<u8>, WaxError> {
    let m = read(source)?;
    let ix = index(&m);
    let mut out: Vec<u8> = vec![0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

    // **One recursive group, or none at all.** A struct whose field refers to another struct — an AST
    // node holding an array of nodes — needs the two in the same group, because outside one a type may
    // only name types already defined. Putting every type in a single group is the rule with no cases
    // in it, and it costs two bytes. A module with no GC types keeps the plain encoding, so nothing
    // that assembled before assembles differently now.
    let has_gc = ix.types.iter().any(|d| !matches!(d.body, DeclType::Func(_)));
    let mut type_entries: Vec<Vec<u8>> = Vec::new();
    for d in &ix.types {
        let mut e = Vec::new();
        match &d.body {
            DeclType::Func(ft) => {
                e.push(0x60);
                let mut ps = Vec::new();
                for p in &ft.params {
                    ps.push(vt_bytes(p, &ix, 0)?);
                }
                e.extend(vector(ps));
                let mut rs = Vec::new();
                for r in &ft.results {
                    rs.push(vt_bytes(r, &ix, 0)?);
                }
                e.extend(vector(rs));
            }
            // Every field is mutable. wac has no immutable field and neither does anything above this.
            DeclType::Struct(fields) => {
                e.push(0x5f);
                let mut fs = Vec::new();
                for f in fields {
                    let mut b = vt_bytes(f, &ix, 0)?;
                    b.push(0x01);
                    fs.push(b);
                }
                e.extend(vector(fs));
            }
            DeclType::Array(el) => {
                e.push(0x5e);
                e.extend(vt_bytes(el, &ix, 0)?);
                e.push(0x01);
            }
        }
        type_entries.push(e);
    }
    let type_payload = if has_gc {
        let mut p = uleb(1);
        p.push(0x4e);
        p.extend(vector(type_entries));
        p
    } else {
        vector(type_entries)
    };
    out.extend(section(1, type_payload));

    out.extend(section(
        2,
        vector(
            m.imports
                .iter()
                .map(|im| {
                    let want = shape_key(&im.params, &im.results);
                    let at = ix
                        .types
                        .iter()
                        .position(|d| match &d.body {
                            DeclType::Func(ft) => shape_key(&ft.params, &ft.results) == want,
                            _ => false,
                        })
                        .unwrap() as u32;
                    let mut e = name_bytes(&im.module);
                    e.extend(name_bytes(&im.field));
                    e.push(0x00);
                    e.extend(uleb(at));
                    e
                })
                .collect(),
        ),
    ));

    out.extend(section(3, vector(ix.func_type_index.iter().map(|t| uleb(*t)).collect())));

    if let Some(pages) = m.memory_pages {
        let mut e = vec![0x00];
        e.extend(uleb(pages));
        out.extend(section(5, vector(vec![e])));
    }

    let mut global_entries: Vec<Vec<u8>> = Vec::new();
    for g in &m.globals {
        let mut e = vt_bytes(&g.ty, &ix, 0)?;
        e.push(if g.mutable { 0x01 } else { 0x00 });
        match &g.ty {
            // A reference global starts null.
            ValType::Ref { to, .. } => {
                e.push(0xd0);
                e.extend(heap_type(to, &ix, 0)?);
            }
            ValType::Plain(b, _) => {
                e.push(if *b == 0x7f { 0x41 } else { 0x42 });
                e.extend(sleb(g.value));
            }
        }
        e.push(0x0b);
        global_entries.push(e);
    }
    out.extend(section(6, vector(global_entries)));

    let mut exports = Vec::new();
    for e in &m.exports {
        let mut b = name_bytes(&e.name);
        match &e.kind {
            ExportKind::Memory => {
                b.push(0x02);
                b.push(0x00);
            }
            ExportKind::Func(target) => match ix.func_of.get(target) {
                Some(at) => {
                    b.push(0x00);
                    b.extend(uleb(*at));
                }
                None => return Err(WaxError(format!("export names no function {}", target))),
            },
        }
        exports.push(b);
    }
    out.extend(section(7, vector(exports)));

    // Sections are written in ascending id, which wasm requires: code (10) before data (11).
    let mut codes = Vec::new();
    for f in &m.funcs {
        let mut body = local_decls(f, &ix);
        body.extend(emit_body(f, &ix)?);
        let mut e = uleb(body.len() as u32);
        e.extend(body);
        codes.push(e);
    }
    out.extend(section(10, vector(codes)));

    out.extend(section(
        11,
        vector(
            m.data
                .iter()
                .map(|d| {
                    let mut e = vec![0x00, 0x41];
                    e.extend(sleb(d.offset));
                    e.push(0x0b);
                    e.extend(uleb(d.bytes.len() as u32));
                    e.extend_from_slice(&d.bytes);
                    e
                })
                .collect(),
        ),
    ));

    Ok(out)
}
