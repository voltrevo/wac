# 0363a — `Core.askInterrupt` has no host left that can answer yes

- **Status:** open
- **Reported by:** agent-a
- **Date:** 2026-10-17
- **Kind:** missing feature
- **Symptom:** not implemented

## Reproduction

```
rg -n 'askInterrupt' packages/platform/host native std/platform.wac
```

Expected: a host that owns a keyboard answers `^C` with yes.
Actual: every host answers no. The one that answered yes was std's `Page` on the browser worker host
(its keydown listener ran on the thread serving the bridge), and design/system/0011 step 7 deleted it:
a page is `packages/web`'s `main(Page)` now, whose terminal hands `packages/sh` an interrupt of its own
(`Shell.askInterrupt`, answered by `packages/box/src/lib/session.wac`).

## Notes

- What still asks: `packages/box/src/applets/yes.wac` (`core.interrupted()`), and `packages/ssh`'s and
  `packages/tty`'s `interrupted()` on their own terminals, which are a different reader.
- The decision is whether the capability goes — from std, the op table (`OP.ASK_INTERRUPT`), the
  JavaScript hosts and both native ones, and the capability counts the docs quote — or stays for a
  host that will own a keyboard. CLAUDE.md's rule is "when nothing needs a thing, delete it"; filed
  rather than done because it is a change to every host, and step 7 was not that change.
