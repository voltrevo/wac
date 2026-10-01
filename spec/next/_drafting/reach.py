#!/usr/bin/env python3
"""Flag examples whose code is not reachable from the entry's exports, and needless `main`.

Run from spec/next:  python3 _drafting/reach.py [-v] [files…]
An approximation of 05: a declaration is reached if an identifier naming it appears in reached code.
"""
import os, re, sys

KW = {"struct", "enum", "symbol", "static", "type", "namespace", "const", "virtual", "override", "async", "gen"}
IDENT = re.compile(r'@"[^"]*"|[A-Za-z_]\w*')

def strip_fn(s):
    # remove balanced fn<...> and gen<...> and generic <...> after a type, crudely
    out, depth = [], 0
    i = 0
    while i < len(s):
        if s.startswith("fn<", i) or s.startswith("gen<", i):
            j = s.index("<", i); depth = 1; j += 1
            while j < len(s) and depth:
                depth += {"<": 1, ">": -1}.get(s[j], 0); j += 1
            out.append(" T "); i = j; continue
        out.append(s[i]); i += 1
    return "".join(out)

def decl_name(line):
    l = line.strip()
    l = re.sub(r"^export\s+", "", l)
    m = re.match(r"(?:const\s+)?(struct|enum|symbol|namespace|type)\s+(@\"[^\"]*\"|\w+)", l)
    if m: return m.group(2)
    m = re.match(r"static\s+.*?(\w+)\s*=", l)
    if m: return m.group(1)
    l2 = strip_fn(l)
    l2 = re.sub(r"<[^<>()]*>", " ", l2)
    l2 = re.sub(r"<[^<>()]*>", " ", l2)
    m = re.search(r'(@"[^"]*"|\w+)\s*\(', l2)
    if m: return m.group(1)
    return None

def split_files(lines):
    files, cur, name = [], [], "main.wac"
    for ln, l in lines:
        m = re.match(r"// ---- (.+) ----", l)
        if m:
            if cur: files.append((name, cur))
            name, cur = m.group(1), []
            continue
        cur.append((ln, l))
    files.append((name, cur))
    return files

def decls(lines):
    """[(name, exported, start, [lines], commented)] top-level declarations."""
    out = []
    for ln, l in lines:
        code = l
        commented = False
        if l.startswith("// ") and not l.startswith("// ERROR") and not l.startswith("// expect") and not l.startswith("// fragment"):
            cand = l[3:]
            if cand and not cand.startswith(" ") and decl_name(cand) and re.match(r"(export |struct|enum|const|static|type|symbol|namespace|async|gen|[A-Za-z_][\w<>\[\]?, ()]* [@\w\"]+\s*[(<])", cand):
                # a commented-out top-level declaration: it belongs to an ERROR above it
                out.append([decl_name(cand), cand.startswith("export"), ln, [(ln, cand)], True]); continue
        if l and not l[0].isspace() and not l.startswith("//") and not l.startswith("}") and not l.startswith("import") and not l.startswith(")"):
            n = decl_name(l)
            if n:
                out.append([n, l.startswith("export"), ln, [(ln, l)], False]); continue
        if out and not out[-1][4]: out[-1][3].append((ln, l))
        elif out and out[-1][4] and l.startswith("// ") and not l.startswith("// ERROR"):
            out[-1][3].append((ln, l[3:]))
    return out

def body_idents(dl):
    s = []
    for ln, l in dl[3]:
        if l.lstrip().startswith("// ERROR"): continue
        code = l.split("//")[0] if not dl[4] else l
        interp = " ".join(re.findall(r"\\\{([^}]*)\}", code))
        code = re.sub(r'"(?:[^"\\]|\\.)*"', '""', code) + " " + interp
        s.append(code)
    toks = set(IDENT.findall(" ".join(s)))
    return toks - {dl[0]}

def analyse(path):
    lines = list(enumerate(open(path, encoding="utf-8").read().split("\n"), 1))
    i, out = 0, []
    while i < len(lines):
        ln, l = lines[i]
        if l.strip() == "```wac":
            j = i + 1; block = []
            while lines[j][1].strip() != "```": block.append(lines[j]); j += 1
            out += check(path, ln, block)
            i = j
        i += 1
    return out

def check(path, start, block):
    if not block or block[0][1].startswith("// fragment"): return []
    exp = " ".join(l for _, l in block if l.startswith("// expect"))
    probs = []
    files = split_files(block)
    alld = []
    entry = None
    for name, fl in files:
        if not name.endswith(".wac"): continue
        ds = decls(fl)
        for d in ds: d.append(name)
        alld += ds
        if name == "main.wac" or len(files) == 1: entry = name
    m = re.search(r"\(wac \w+ ([\w./-]+\.wac)\)", exp)
    if m: entry = m.group(1)
    if entry is None:
        wf = [n for n, _ in files if n.endswith(".wac")]
        entry = wf[-1] if wf else None
    names = {}
    for d in alld:
        if not d[4]: names.setdefault(d[0], []).append(d)
    for name, fl in files:
        for _, l in fl:
            for a, b in re.findall(r"(\w+)\s+as\s+(\w+)", l if l.startswith("import") else ""):
                if a in names: names.setdefault(b, []).extend(names[a])
    reroots = []
    for name, fl in files:
        for _, l in fl:
            m2 = re.match(r"export\s*\{([^}]*)\}\s*;", l)
            if m2 and name == entry:
                for item in m2.group(1).split(","):
                    head = re.match(r"\s*(\w+)", item)
                    if head: reroots += names.get(head.group(1), [])
                continue
            m = re.match(r"export\s*\{([^}]*)\}\s*from", l)
            if not m: continue
            for item in m.group(1).split(","):
                parts = item.split()
                if not parts: continue
                a = parts[0].split(".")[-1]; b2 = parts[-1]
                if a in names and b2 != a: names.setdefault(b2, []).extend(names[a])
                if name == entry: reroots += names.get(a, [])
    reached = set()
    work = [d for d in alld if d[1] and d[5] == entry and not d[4]] + reroots
    for d in work: reached.add(id(d))
    while work:
        d = work.pop()
        for t in body_idents(d):
            for e in names.get(t, []):
                if id(e) not in reached: reached.add(id(e)); work.append(e)
    def meant(d):  # its own line says it is dropped on purpose
        return "dropped" in d[3][0][1].split("//", 1)[-1] if "//" in d[3][0][1] else False
    for d in alld:
        if d[4]:
            # commented ERROR declaration: uncommented, it must be reached — exported in the entry, or named by reached code
            if not (d[1] and d[5] == entry):
                used = any(d[0] in body_idents(e) for e in alld if id(e) in reached)
                if not used: probs.append((start, d[2], "ERROR-DECL-DROPPED", d[0]))
            continue
        if id(d) not in reached and not meant(d):
            probs.append((start, d[2], "UNREACHED", d[0]))
        if id(d) not in reached and not meant(d):
            for ln, l in d[3]:
                if "// ERROR" in l: probs.append((start, ln, "ERROR-IN-DROPPED", d[0]))
    has_main = any(d[0] == "main" and d[1] for d in alld)
    program = ("exits" in exp or "prints" in exp)
    if has_main and not program: probs.append((start, start, "MAIN", exp.replace("// expect", "").strip()[:40]))
    return [(path,) + p for p in probs]

paths = [a for a in sys.argv[1:] if not a.startswith("-")]
if not paths:
    for root, _, fs in os.walk("."):
        if "_drafting" in root: continue
        paths += [os.path.join(root, f) for f in fs if f.endswith(".md")]
allp = []
for p in sorted(paths): allp += analyse(p)
from collections import Counter
print(Counter(k for _, _, _, k, _ in allp))
fences = {(p, s) for p, s, *_ in allp}
print("fences with a problem:", len(fences))
if "-v" in sys.argv:
    for p, s, ln, k, n in allp: print(f"{p}:{ln}: {k} {n}")
