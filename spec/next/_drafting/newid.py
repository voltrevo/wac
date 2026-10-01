#!/usr/bin/env python3
"""Print N tag ids unused anywhere in spec/ or packages/: python3 spec/next/_drafting/newid.py 10"""
import glob, re, secrets, sys

have = set()
for f in glob.glob("spec/**/*.md", recursive=True) + glob.glob("packages/**/*.wac", recursive=True):
    for t in re.findall(r"§([a-z0-9-]+)", open(f, errors="ignore").read()):
        have.add(t.rsplit("-", 1)[-1])
alphabet = "abcdefghijkmnpqrstuvwxyz23456789"
out = []
while len(out) < int(sys.argv[1] if len(sys.argv) > 1 else 10):
    s = "".join(secrets.choice(alphabet) for _ in range(7))
    if s not in have and s not in out:
        out.append(s)
print(" ".join(out))
