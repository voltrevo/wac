#!/usr/bin/env python3
"""Replace each `@ID@` in the given files with the next unused id from idpool.txt, in order.

    python3 spec/next/_drafting/ids.py spec/next/2-types/08-primitives.md
"""
import sys

POOL = "spec/next/_drafting/idpool.txt"
pool = [l.strip() for l in open(POOL) if l.strip()]
used = 0
for path in sys.argv[1:]:
    text = open(path).read()
    while "@ID@" in text:
        text = text.replace("@ID@", pool[used], 1)
        used += 1
    open(path, "w").write(text)
open(POOL, "w").write("\n".join(pool[used:]) + "\n")
print(f"{used} ids assigned, {len(pool) - used} left")
