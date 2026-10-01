#!/usr/bin/env python3
"""Tag check for spec/next: placed tags unique; every source tag either reused or listed in appendix D."""
import os, re, sys
from collections import defaultdict
TAG = re.compile(r"\[§([a-z0-9-]+)\]")
REF = re.compile(r"§([a-z0-9]+(?:-[a-z0-9]+)+)")
placed = defaultdict(list)
mentioned = set()
for root, _, files in os.walk("spec/next"):
    if "_drafting" in root: continue
    for f in files:
        if not f.endswith(".md"): continue
        p = os.path.join(root, f)
        s = open(p).read()
        if f == "README.md" and root == "spec/next": continue
        if f.startswith("D-"):
            mentioned |= set(REF.findall(s)); continue
        for t in TAG.findall(s): placed[t].append(p)
        mentioned |= set(REF.findall(s))
dups = {t: ps for t, ps in placed.items() if len(ps) > 1}
cov = open("spec/next/_drafting/COVERAGE.md").read()
src = []
for line in cov.splitlines():
    if line.startswith("## "): ch = line[3:]
    for t in re.findall(r"`([a-z0-9-]+-[a-z0-9]{7})`", line): src.append((t, ch, line.split("|")[1].strip(), line.split("|")[2].strip()))
seen=set(); missing=[]
for t, ch, s, h in src:
    if t in seen: continue
    seen.add(t)
    if t not in placed and t not in mentioned: missing.append((t, ch, s, h))
ids = re.compile(r"-([a-z0-9]{7})$")
byid = defaultdict(set)
for t in placed: byid[ids.search(t).group(1) if ids.search(t) else t].add(t)
idclash = {k: v for k, v in byid.items() if len(v) > 1}
print(f"placed {len(placed)}, dup placements {len(dups)}, id clashes {len(idclash)}, source tags {len(seen)}, unaccounted {len(missing)}")
for t, ps in dups.items(): print("DUP", t, ps)
for k, v in idclash.items(): print("IDCLASH", v)
if "-v" in sys.argv:
    for m in missing: print("\t".join(m))
d = open("spec/next/appendices/D-tag-migration.md").read()
sec = d.split("## Retired")[0]
for line in sec.splitlines():
    cells = line.split("|")
    if len(cells) > 3:
        for t in REF.findall(cells[2]):
            if t not in placed: print("D TARGET NOT PLACED", t)
        for t in REF.findall(cells[1]):
            if t in placed: print("D OLD TAG STILL PLACED", t)
