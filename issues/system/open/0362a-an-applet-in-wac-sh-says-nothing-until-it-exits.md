# 0362a — an applet run by `wac sh` says nothing until it exits, so a server never says it is listening

- **Status:** open
- **Claimed by:** (nobody yet — add yourself before working it)
- **Reported by:** agent-a
- **Date:** 2026-10-16
- **Kind:** bug
- **Symptom:** a long-running applet's output appears only when it exits — for a server, never

## Reproduction

```sh
wac sh --allow-read --allow-net -c 'httpd -8080 dist'
```

Expected: `httpd: listening on port 8080, serving dist` on standard error at once, as `box httpd`
prints it — the line the applet's own comment calls *"what a caller waits for to know the port is up"*.
Actual: nothing. The server is up — `curl http://127.0.0.1:8080/` answers 200 with the file — and it
says so to no one. `httpd -1 dist; echo rc=$?` in a container where port 1 can be bound prints
nothing either, for the same reason.

## Notes

An applet's `Core` inside a shell is `packages/platform/src/frame.wac`'s `childCore`, whose `log` and
`warn` write to the frame (`f.write`, `f.warn`), and a frame's output is delivered when the frame
ends. That is the right shape for `a | b` and for a subshell's captured output, and it means any applet
that runs until it is stopped — `httpd`, `serve`, anything waiting on a socket — is silent for its whole
life. The shell's own builtins stream (`echo two >&2` appears in order), which is what makes it look
like the applet is broken rather than the delivery.

Found through `templates/webapp`, whose `serve` task is exactly this command: `wac task serve` sits
there with no word that it is serving. The direction is presumably that a frame at the end of a
pipeline, with nothing capturing it, writes through as it goes — the comment in
`packages/sh/src/exec.wac` beside `stage.outBuf.take()` already handles the same thing for a pipeline's
last stage's *output* after the stage finishes, which is too late for a server.
