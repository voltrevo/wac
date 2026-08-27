//! The module graph, flattened — the same thing `js/flatten.js` does, and required to agree with
//! it byte for byte.
//!
//! wac compiles a whole program into **one** wasm module, so an import is a file to include rather
//! than a boundary to cross. No wac-L4 program can read a file, so the host does it.
//!
//! **The patterns are hand-written rather than a regex crate.** `rust/` has no dependencies
//! deliberately, and while this crate already has V8, a second implementation of a *format* is
//! worth keeping readable: somebody comparing this against `js/flatten.js` should be reading two
//! statements of the same rule, not one rule and one regular expression.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A module as gathered: its text, the aliases it imports under, and what it declares.
struct Mod {
    /// The file's stem, which is what a rename is suffixed with.
    name: String,
    text: String,
    /// `y -> x` for every `import { x as y }`.
    aliases: Vec<(String, String)>,
    decls: Vec<Decl>,
}

struct Decl {
    name: String,
    exported: bool,
}

/// **Flattening is two passes, not one.** Which of two colliding names has to be renamed cannot be
/// decided as the modules arrive: lex.wac has a private `emit` and api.wac an exported one, and
/// api.wac is the later of the two — so the answer is to rename the *earlier*, which by then has
/// already been written out.
pub fn flatten(entry: &Path) -> Result<String, String> {
    let mut mods: Vec<Mod> = Vec::new();
    let mut seen: HashSet<PathBuf> = HashSet::new();
    gather(entry, &mut seen, &mut mods)?;

    // Every top-level name, and which modules declare it.
    let mut owners: Vec<(String, Vec<(String, bool)>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for m in &mut mods {
        m.decls = top_level_decls(&m.text);
        for d in &m.decls {
            let at = *index.entry(d.name.clone()).or_insert_with(|| {
                owners.push((d.name.clone(), Vec::new()));
                owners.len() - 1
            });
            owners[at].1.push((m.name.clone(), d.exported));
        }
    }

    // `module -> (from -> to)`
    let mut renames: HashMap<String, Vec<(String, String)>> = HashMap::new();
    let mut rename_in = |m: &str, from: &str, to: String| {
        renames.entry(m.to_string()).or_default().push((from.to_string(), to));
    };

    // A module that aliases an import *and* declares its own thing with the original's name — the
    // whole point of `import { isBuiltinSpec as coreIsBuiltinSpec }` in files.wac is that it can
    // then export a wrapper of the same name. Its own declaration is renamed apart first, while
    // the two are still spelled differently.
    for m in &mods {
        for (_, orig) in &m.aliases {
            if m.decls.iter().any(|d| &d.name == orig) {
                rename_in(&m.name, orig, format!("{orig}_{}", m.name));
            }
        }
    }

    // Then the collisions. The keeper is the one exported, if exactly one is — nothing outside a
    // module can be referring to a private name, so renaming a private one is always safe.
    for (name, list) in &owners {
        if list.len() < 2 {
            continue;
        }
        let exported: Vec<&(String, bool)> = list.iter().filter(|o| o.1).collect();
        if exported.len() > 1 {
            continue;
        }
        let keeper = if exported.len() == 1 { exported[0].0.clone() } else { list[0].0.clone() };
        for (module, _) in list {
            if module == &keeper {
                continue;
            }
            rename_in(module, name, format!("{name}_{module}"));
        }
    }

    let mut out = String::new();
    for m in &mods {
        let mut rewrite: Vec<(String, String)> = renames.get(&m.name).cloned().unwrap_or_default();
        // The aliases go on after the renames, matching the JavaScript's `new Map([...a, ...b])`:
        // a later entry wins, and only the alias-and-own-declaration case has both.
        for (from, to) in &m.aliases {
            rewrite.retain(|(f, _)| f != from);
            rewrite.push((from.clone(), to.clone()));
        }
        if rewrite.is_empty() {
            out.push_str(&m.text);
        } else {
            out.push_str(&unalias(&m.text, &rewrite));
        }
        out.push('\n');
    }
    Ok(out)
}

/// Dependency order, each module once, imports before the module that asks for them.
fn gather(entry: &Path, seen: &mut HashSet<PathBuf>, out: &mut Vec<Mod>) -> Result<(), String> {
    let path = entry
        .canonicalize()
        .map_err(|e| format!("{}: {e}", entry.display()))?;
    if !seen.insert(path.clone()) {
        return Ok(());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let dir = path.parent().unwrap_or(Path::new(".")).to_path_buf();

    let mut aliases: Vec<(String, String)> = Vec::new();
    for (names, spec) in imports(&text) {
        gather(&resolve(&dir, &spec), seen, out)?;
        for item in names.split(',') {
            if let Some((orig, alias)) = as_alias(item) {
                aliases.push((alias, orig));
            }
        }
    }

    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .trim_end_matches(".wac")
        .to_string();
    out.push(Mod { name, text, aliases, decls: Vec::new() });
    Ok(())
}

/// Every `import { ... } from "..."` in a file, as `(names, specifier)`.
///
/// **The list may span lines**, and files.wac's does — so this walks the text rather than the
/// lines. An import starts at the beginning of a line; the names run to the next `}` wherever it
/// is, and the specifier is the quoted string after it. That is what the JavaScript's
/// `\{([^}]*)\}` does, since a negated character class crosses a newline like any other.
fn imports(text: &str) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let b = text.as_bytes();
    let mut i = 0;
    while i < b.len() {
        // Only at the start of a line, after whitespace.
        let at_line_start = i == 0 || b[i - 1] == b'\n';
        if !at_line_start {
            i += 1;
            continue;
        }
        let mut j = i;
        while j < b.len() && (b[j] == b' ' || b[j] == b'\t') {
            j += 1;
        }
        if !text[j..].starts_with("import") {
            i += 1;
            continue;
        }
        let Some(open) = text[j..].find('{') else { break };
        let open = j + open;
        let Some(close) = text[open..].find('}') else { break };
        let close = open + close;
        // **`from` has to be there.** The JavaScript requires `\}\s*from\s*"`, and dropping that
        // made this find the next quote anywhere in the file — which for a line that merely starts
        // with `import` inside a comment matched a string thousands of lines away.
        let rest = &text[close + 1..];
        let after = rest.trim_start();
        let Some(after) = after.strip_prefix("from") else {
            i = close + 1;
            continue;
        };
        let rest = after.trim_start();
        let Some(q1) = rest.find('"') else {
            i = close + 1;
            continue;
        };
        if q1 != 0 {
            i = close + 1;
            continue;
        }
        let Some(q2) = rest[q1 + 1..].find('"') else {
            i = close + 1;
            continue;
        };
        out.push((
            text[open + 1..close].to_string(),
            rest[q1 + 1..q1 + 1 + q2].to_string(),
        ));
        i = close + 1;
    }
    out
}

/// `x as y` in an import list, as `(x, y)`.
fn as_alias(item: &str) -> Option<(String, String)> {
    let mut parts = item.split_whitespace();
    let orig = parts.next()?;
    if parts.next()? != "as" {
        return None;
    }
    let alias = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let ok = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_alphanumeric() || c == '_');
    if ok(orig) && ok(alias) { Some((orig.to_string(), alias.to_string())) } else { None }
}

/// `"./m.wac"` is relative to the importing file, and a bare `"core/option.wac"` is a path from a
/// package root — found by walking up until it resolves, because nothing here knows where the root
/// is. A bare specifier that is not a `.wac` file names something wacc carries inside itself.
fn resolve(dir: &Path, spec: &str) -> PathBuf {
    if spec.starts_with("./") || spec.starts_with("../") {
        return dir.join(spec);
    }
    if !spec.ends_with(".wac") {
        return dir.join(spec);
    }
    let mut at = dir.to_path_buf();
    for _ in 0..12 {
        let tryit = at.join(spec);
        if tryit.is_file() {
            return tryit;
        }
        match at.parent() {
            Some(up) if up != at => at = up.to_path_buf(),
            _ => break,
        }
    }
    dir.join(spec)
}

/// The names a module declares at the top level, and whether each is exported.
///
/// A declaration is what starts at brace depth zero and reaches a `(`, a `{` or an `=`. Comments
/// and strings are stepped over, because a brace inside either would leave the depth wrong for the
/// rest of the file.
fn top_level_decls(text: &str) -> Vec<Decl> {
    let mut out = Vec::new();
    let mut depth: i32 = 0;
    let mut in_block = false;
    for raw in text.split('\n') {
        let b: Vec<char> = raw.chars().collect();
        let mut line = String::new();
        let mut i = 0;
        while i < b.len() {
            if in_block {
                if b[i] == '*' && i + 1 < b.len() && b[i + 1] == '/' {
                    in_block = false;
                    i += 1;
                }
                i += 1;
                continue;
            }
            if b[i] == '/' && i + 1 < b.len() && b[i + 1] == '*' {
                in_block = true;
                i += 2;
                continue;
            }
            if b[i] == '/' && i + 1 < b.len() && b[i + 1] == '/' {
                break;
            }
            if b[i] == '"' || b[i] == '\'' {
                let q = b[i];
                i += 1;
                while i < b.len() && b[i] != q {
                    i += if b[i] == '\\' { 2 } else { 1 };
                }
                i += 1;
                line.push_str("\"\"");
                continue;
            }
            line.push(b[i]);
            i += 1;
        }
        if depth == 0 {
            if let Some(d) = declared(&line) {
                out.push(d);
            }
        }
        for c in line.chars() {
            if c == '{' {
                depth += 1;
            }
            if c == '}' {
                depth -= 1;
            }
        }
    }
    out
}

/// One line's declaration, if it is one.
///
/// The JavaScript is a regular expression; this is the same rule written out. Up to four words
/// before a `(`, a `{` or an `=`: an optional `export`, an optional `const`, an optional `struct`
/// or `enum`, an optional type, and then the name. `import` is not a declaration.
fn declared(line: &str) -> Option<Decl> {
    let t = line.trim_start();
    let mut rest = t;
    let mut exported = false;
    for keyword in ["export ", "const ", "struct ", "enum "] {
        if let Some(after) = rest.strip_prefix(keyword) {
            if keyword == "export " {
                exported = true;
            }
            rest = after.trim_start();
        }
    }
    let (first, after_first) = word(rest)?;
    let plain = |w: &str| w.chars().all(|c| c.is_alphanumeric() || c == '_');
    let (name, after) = match word(after_first.trim_start()) {
        Some((second, after_second)) if !after_first.starts_with(|c: char| "({=".contains(c)) => {
            (second, after_second)
        }
        _ => (first, after_first),
    };
    if !plain(name) || name.is_empty() || name == "import" {
        return None;
    }
    if !name.starts_with(|c: char| c.is_alphabetic() || c == '_') {
        return None;
    }
    match after.trim_start().chars().next() {
        Some('(') | Some('{') | Some('=') => Some(Decl { name: name.to_string(), exported }),
        _ => None,
    }
}

/// One word and what follows it. A word here may carry `<>`, `[]`, `?` or `,`, because a *type*
/// can — the name that follows may not, which is what tells the two apart when only one is present.
///
/// A free function rather than a closure inside `declared`, because a closure returning a borrow of
/// its argument cannot express that the borrow outlives the call.
fn word(s: &str) -> Option<(&str, &str)> {
    let mut end = 0;
    for (k, c) in s.char_indices() {
        if c.is_alphanumeric() || c == '_' || c == '<' || c == '>' || c == '[' || c == ']'
            || c == '?' || c == ','
        {
            end = k + c.len_utf8();
        } else {
            break;
        }
    }
    if end == 0 { None } else { Some((&s[..end], &s[end..])) }
}

/// Identifiers only: a rename must not reach inside a string, a character literal or a comment.
fn unalias(text: &str, aliases: &[(String, String)]) -> String {
    let map: HashMap<&str, &str> =
        aliases.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    let b: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c == '/' && i + 1 < b.len() && b[i + 1] == '/' {
            while i < b.len() && b[i] != '\n' {
                out.push(b[i]);
                i += 1;
            }
            continue;
        }
        if c == '/' && i + 1 < b.len() && b[i + 1] == '*' {
            out.push('/');
            out.push('*');
            i += 2;
            while i < b.len() && !(b[i] == '*' && i + 1 < b.len() && b[i + 1] == '/') {
                out.push(b[i]);
                i += 1;
            }
            if i < b.len() {
                out.push('*');
                out.push('/');
                i += 2;
            }
            continue;
        }
        if c == '"' || c == '\'' {
            out.push(c);
            i += 1;
            while i < b.len() && b[i] != c {
                if b[i] == '\\' && i + 1 < b.len() {
                    out.push(b[i]);
                    i += 1;
                }
                if i < b.len() {
                    out.push(b[i]);
                    i += 1;
                }
            }
            if i < b.len() {
                out.push(b[i]);
                i += 1;
            }
            continue;
        }
        if c.is_alphabetic() || c == '_' {
            let start = i;
            while i < b.len() && (b[i].is_alphanumeric() || b[i] == '_') {
                i += 1;
            }
            let w: String = b[start..i].iter().collect();
            out.push_str(map.get(w.as_str()).copied().unwrap_or(w.as_str()));
            continue;
        }
        out.push(c);
        i += 1;
    }
    out
}
