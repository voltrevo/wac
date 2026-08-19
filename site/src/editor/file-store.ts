const STORAGE_KEY = "wac-files";

export const HOME = "/home/wac";

const DEFAULT_FILE = `export string hello() {
  return "Hello, world!";
}
`;

export type FileMap = Record<string, string>;

export const DEFAULT_FILES: FileMap = { [HOME + "/main.wac"]: DEFAULT_FILE };

/** Convert an absolute path to a display path relative to HOME. */
export function displayPath(abs: string): string {
  const prefix = HOME + "/";
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

/** Convert a relative path to an absolute path under HOME. */
export function absPath(rel: string): string {
  return rel.startsWith("/") ? rel : HOME + "/" + rel;
}

// **`resolveImport` was here and nothing called it.** Exported, and no importer of this module
// asked for it — the editor never resolves a specifier itself, because `compile()` hands the whole
// `FileMap` to `wacCompile` and the compiler does its own resolving. `design/lang/0009` counted it
// as one of the copies of the resolution rule that "have to agree", which made it look like a
// liability to be reconciled; it was a liability nothing could reach, and it did not agree — no
// built-in handling at all, so `core` would have become `/home/wac/core`, and a `..` that popped
// unconditionally, so a path could climb above the root and come back looking local. Deleted rather
// than fixed: the way to have this rule here is to call the compiler's, the way the editor already
// does by handing it the map.

function migrate(files: FileMap): FileMap {
  const prefix = HOME + "/";
  const migrated: FileMap = {};
  let needsMigration = false;
  for (const [k, v] of Object.entries(files)) {
    if (k.startsWith("/")) {
      migrated[k] = v;
    } else {
      migrated[prefix + k] = v;
      needsMigration = true;
    }
  }
  if (needsMigration) saveFiles(migrated);
  return migrated;
}

export function loadFiles(exampleFiles: FileMap): FileMap {
  let userFiles: FileMap = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && Object.keys(parsed).length) {
        userFiles = migrate(parsed as FileMap);
      }
    }
  } catch { /* ignore corrupt data */ }

  // Ensure user has at least one non-example file
  const hasUserFile = Object.keys(userFiles).some((k) => !k.includes("/examples/"));
  if (!hasUserFile) {
    userFiles[HOME + "/main.wac"] = DEFAULT_FILE;
  }

  // Merge: examples are read-only defaults, user files override
  return { ...exampleFiles, ...userFiles };
}

/** Save only user-authored files (not examples). */
export function saveFiles(files: FileMap): void {
  const userFiles: FileMap = {};
  for (const [k, v] of Object.entries(files)) {
    if (!k.includes("/examples/")) {
      userFiles[k] = v;
    }
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(userFiles));
}

