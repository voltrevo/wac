// Opcodes, shared by both sides of the bridge.
//
// Numbers rather than names because they cross as an i32 in the control block, and a
// number nobody has to parse is one fewer thing to get wrong. Append only: a value that
// has shipped never changes meaning.

export const OP = {
  NOW_MILLIS: 1,
  MONOTONIC_NANOS: 2,
  RANDOM_BYTES: 3,
  // 4 and 5 were `LOG` and `WARN`, lines a host printed for the program. Retired rather than reused: a line is
  // bytes on standard output or error, `WRITE_STDOUT` and `WRITE_STDERR` (design/system/0013 step 6).
  ARG_COUNT: 6,
  ARG: 7,
  ENV: 8,
  READ_FILE: 9,
  WRITE_FILE: 10,
  READ_STDIN: 11,
  WRITE_STDOUT: 12,
  STAT: 13,
  READ_DIR: 14,
  MKDIR: 15,
  REMOVE: 16,
  RENAME: 17,
  // 18 and 20 were `OPEN_INPUT` and `OPEN_OUTPUT`, which redirected standard input and output to a
  // file. Retired with `Cli` rather than reused (design/system/0013 step 6): a program streams a file
  // through `OPEN_FILE`.
  READ_CHUNK: 19,
  CONNECT: 21,
  LISTEN: 22,
  ACCEPT: 23,
  RECV: 24,
  SEND: 25,
  CLOSE_SOCKET: 26,
  SPAWN: 27,
  EXIT_CODE: 28,
  CLOSE_FEED: 29,
  SLEEP_MILLIS: 30,
  // 31–40 were std's `Page` — render, text, values, events, title, pixels, files, downloads — and
  // 51 and 56 its style and partial blit. Retired rather than reused: a page is `packages/web`'s
  // `main(Page)` now, which talks to the document by messages and needs no bridge
  // (design/system/0011 step 7).
  CWD: 41,
  // 42 and 43 were `PUSH_CHILD` and `POP_CHILD`, an applet run in process as a frame. Retired with
  // `Cli` rather than reused (design/system/0013 step 6): nothing called them but `Cli`'s own fields.
  // 44 was `EXEC`, the same capability without an environment or a choice about the child's streams.
  // Retired rather than reused — see `EXEC_WITH` at the end.
  // 45 was `OUTPUT_ERROR`, why a write to an `OPEN_OUTPUT` file failed; it went with that.
  LINK_STAT: 47,
  WRITE_STDERR: 48,
  SPAWN_SELF: 49,
  /**
   * "Has the user asked to interrupt?" — `Host.interrupted` in `std/platform.wac`.
   *
   * Answered from what the host already knows, so it starts nothing; it still parks the worker like
   * every opcode, and that is the point rather than the cost — see the note in `provider.ts`.
   */
  ASK_INTERRUPT: 50,
  /**
   * "Make this file executable, or stop it being" — `Files.setExecutable` in `std/platform.wac`.
   *
   * One bit rather than a mode, because git's regular-file modes differ only in that bit and because a
   * browser's OPFS has no mode bits at all, so a general `chmod` would be unanswerable on one of the four
   * hosts rather than merely unsupported on it.
   */
  SET_EXECUTABLE: 52,

  // **Datagrams**, which are not `connect`/`recv`/`send` with a flag. A QUIC server answers many
  // peers from one socket and a connection is identified by its connection ID rather than by an
  // address, so a peer may move mid-connection; a connected socket represents neither. See
  // design/system 0007. `CLOSE_SOCKET` closes one of these too — a handle is a handle.
  BIND_DATAGRAM: 53,
  RECEIVE_FROM: 54,
  SEND_TO: 55,
  /**
   * End a socket's outbound direction and keep reading — `issues/system/0215`.
   *
   * Its own opcode rather than a flag on `CLOSE_SOCKET`, because a host that did not know about the
   * flag would close both directions and the program would hang on a reply that can never come. An
   * unserved opcode fails and names itself.
   */
  CLOSE_SEND: 57,
  /**
   * `Procs.exec` — a host program, run to completion, in a directory. `issues/system/0165`, `0290b`.
   *
   * **44 and 58 were earlier spellings of it, and are not reused**: a binary or a worker bundle built
   * before still sends them and should fail rather than be misread — a host that had not been rebuilt
   * would read the environment or the directory as the head of standard input, silently, where an
   * opcode it does not serve fails and names itself. They are not listed here because
   * `conformance_test.wac` reads this table as *the surface*.
   */
  EXEC: 59,
  /**
   * "Set this file's permission bits" — `Files.chmod` in `std/platform.wac`.
   *
   * `SET_EXECUTABLE` above is the narrow form and stays: it promises one bit and changes one bit,
   * which is what a git checkout wants. This promises the mode. `issues/system/0296c`.
   */
  CHMOD: 60,
  OPEN_FILE: 61,
  CLOSE_FILE: 62,
  CLOSE_OUTPUT: 63,
  // **Answered in the worker's own realm and never sent to the launcher**: a loaded module lives in
  // the caller's realm, its requests served over the caller's own bridge, so nothing about it crosses.
  // Numbered because std asks for them like any other request. `issues/system/0240c`.
  LOAD: 64,
  CALL: 65,
  UNLOAD: 66,
  VALIDATE: 67,
} as const;

/**
 * Grant flags for `OP.SPAWN`, matching the `GRANT_*` constants in `platform.wac`.
 *
 * Here rather than in a world because both sides of the bridge read them, and because a
 * fourth copy of these numbers — wac, worker, each host — is three too many already. The
 * host intersects a request with its own authority; see `deno.ts`.
 */
export const GRANT_READ = 1;
export const GRANT_WRITE = 2;
export const GRANT_NET = 4;
export const GRANT_ENV = 8;
/**
 * `Procs.exec` — running a host *program*, which is not what `spawn` does.
 *
 * Its own bit because it is its own authority: a world that may start a confined wasm module must
 * be able to refuse a host binary without refusing both, and a page always refuses this one.
 */
export const GRANT_RUN = 16;
