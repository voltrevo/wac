#!/usr/bin/env python3
# Runs one measurement command and adds what only the parent can see: the child's wall time from exec to exit, and
# its peak RSS (getrusage(RUSAGE_CHILDREN).ru_maxrss, the high-water mark of the one child, which Node cannot
# report for a child process). Prints the child's last JSON line with `procWallMs` and `peakRssMiB` set.
#
#     python3 measure-proc.py wac dist/native.wasm cold . ../../fixtures/state_tests
import json, resource, subprocess, sys, time

t0 = time.monotonic()
p = subprocess.run(sys.argv[1:], capture_output=True, text=True)
wall = (time.monotonic() - t0) * 1000
if p.returncode != 0:
    print(json.dumps({"error": (p.stderr or p.stdout)[-2000:]}))
    sys.exit(0)
out = json.loads(p.stdout.strip().splitlines()[-1])
out["procWallMs"] = wall
out["peakRssMiB"] = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024
print(json.dumps(out))
