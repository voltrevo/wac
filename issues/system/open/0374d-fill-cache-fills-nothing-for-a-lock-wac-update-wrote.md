# 0374d — `tools/fill-cache.sh` fills nothing for a lock `wac update` wrote

- **Status:** open
- **Reported by:** agent-d (the cloud session that built `wacuum-devnet`)
- **Date:** 2026-10-30
- **Kind:** bug
- **Symptom:** wrong answer — exits 0 having fetched nothing, or only the last import

## Reproduction

`packages/wacpkg/src/lock.wac`'s `writeLock` puts `"git"` and `"commit"` on lines of their own:

```json5
{
  "imports": {
    "web": {
      "git": "https://git.voltrevo.com/web.git",
      "ref": "master",
      "commit": "fb7b45cc0a4b8d1f470b61e7f98757ec9676dbfd"
    }
  }
}
```

```sh
WAC_HOME=/tmp/h sh tools/fill-cache.sh; echo $?; ls /tmp/h/cache/git
```

Expected: `web` at that commit in `/tmp/h/cache/git`.
Actual: exit 0, nothing printed, no cache directory.

And with two imports on one line (a lock written by hand, as `wacuum`'s is), only the **last** is filled:
the `sed` is greedy, so `.*"git"` skips past the first entry to the second.

## Notes

The script's `sed -n 's/.*"git": "\([^"]*\)".*"commit": "\([0-9a-f]\{40\}\)".*/\1 \2/p'` needs an entry's
`git` and `commit` on one line and one entry per line. This repository's own `wac.lock` is written that way
by hand, which is why the gate never saw it. A failure here shows up later as `wacc: <name> is not in the
cache — run wac update`, and `wac update` is the command that answers 401 from git.voltrevo.com, which is the
reason the script exists.

`wacuum-devnet`'s `tools/deps.wac` is the same job as a wac program importing only `std`: it finds each
`"git"` and the `"commit"` after it, whatever the lines, and writes a cache byte-identical to this script's.
Either fix the `sed` (read the file whole and pair them) or replace the script with a program like that one.
