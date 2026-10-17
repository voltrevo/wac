# 0011 — programs in a page, without shared memory

- **Status:** active
- **Raised by:** agent-a, 2026-10-16, on the operator's instruction to move the shell and the desktop onto
  `packages/web` ("Do it. Also make running in a worker the default. In page is now too but should be opt
  in.")
- **Spans:** `packages/web`, `std/platform.wac`, `packages/platform/src/stream.wac`, `packages/fs`,
  `packages/sh`, `packages/box`, the three hosts that answer `Cli`

## The target

The shell (`packages/box/example/term.wac`) and the desktop (`desk.wac`) are `packages/web` pages: built by
`packages/web/tools/build.wac`, run in a worker by default, with no `SharedArrayBuffer`, no
cross-origin-isolation headers and no service worker to fake them. A pipeline's stages are workers of their
own, started by `spawnSelf`, streaming into each other; a file written survives a reload; `^C` stops a
runaway stage.

It is **not** a second shell or a second set of applets for the browser. The same `packages/sh` and the same
`packages/box` applets run on a command line and in a page.

## Decisions, with their reasons

- **A page's program runs in a worker unless built `--in-page`.** A program that computes for a while should
  cost its own responsiveness and not the tab's. The host is two halves that talk by messages; in a page they
  are joined directly. (Operator.)
- **Nothing waits.** Neither a worker without shared memory nor the page's own thread may block until the
  browser answers. So every capability that reaches the browser hands back a ticket at once and the browser
  calls back when the work is done (`packages/web/src/system.wac`). A program awaits; on a command line the
  same `await` waits on a host that blocks.
- **`Cli` is built in wac, over a small `System` of browser calls.** One answer shape, `Answer`, for every
  call, so the browser's half decides nothing and the mapping of answers to `FileResult`, `Stat` and `Read`
  is tested without a browser.
- **Reads are awaited; writes are not.** `readChunk` answers a ticket (`fn<Pending<Read>()>`), so `Feed.next`,
  `nextLine` and everything that reads input is `async`. `write` stays a plain call: a host with threads
  blocks inside it and a page hands the bytes on, so `Sink` and every applet that only writes stays as it was.
  The cost is that a page's pipe has no back-pressure yet — `yes | slow` buffers.
- **`Fs` is `async`.** A spawned stage reaches its parent's filesystem over a channel, and a channel is a read
  that must be awaited; a filesystem whose host is the browser's is the same. The alternative — a memory image
  in the page with stages running in its instance — keeps `Fs` synchronous but gives up the process boundary
  and the kill, and needs the applets `async` for their pipes anyway.
- **A spawned copy of the page is a process, not a page.** `--spawn <export>` names what it runs —
  `async i32 <export>(Sys sys)` — with no document, its arguments, directory, input and parent's filesystem
  supplied by the worker that started it.
- **The transforms that pull keep pulling, for now.** `gzipStream`, `gunzipStream` and `unzstdStream` ask a
  `fn<Read()>` for more from deep inside their decoders, so an applet awaits its whole input and hands them a
  reader over it (`readerOf`). Their output still streams. Resumable decoders are the real answer.
- **`Ticket.first(TicketBase[])`** answers which of a run-time set settles first: a shell watching what is
  still open of several streams has a different set each time round, which a tuple cannot say.

## Order of work

1. Worker by default, `--in-page` opt in; `getValue` waited for. **Done.**
2. A page can be handed a `Sys` (`--grant read,write`), files in the Origin Private File System. **Done.**
3. `readChunk` a ticket on every host; `Feed`, `nextLine` and their readers `async`.
4. `Fs` `async`, with its channel to a parent; `packages/sh`'s waits on `Ticket.first` rather than `waitAny`.
5. Processes in a page: `spawnSelf`, the streams, the filesystem channel, exit statuses, `^C`.
6. `term.wac` and `desk.wac` as `packages/web` pages; the site builds them with the rest.
7. Delete what nothing uses any more: `std`'s `Page`, the worker host's page plumbing, `coi-serviceworker.js`.

## State of play

| step | state |
|---|---|
| 1 | done — `packages/web/tools/build.wac` |
| 2 | done — `packages/web/src/system.wac`, `packages/platform/example/notes.wac` |
| 3 | done — every host answers `readChunk` with a ticket; `Feed`, `nextLine`, the applets that read and `packages/sh`'s runners are `async` |
| 4 | not started |
| 5 | the browser's half written, untested |
| 6 | not started |
| 7 | not started |
