const STORAGE_KEY = "wac-files";

export const HOME = "/home/wac";

const DEFAULT_FILE = `export string hello() {
  return "Hello, world!";
}
`;

export type FileMap = Record<string, string>;

/** Convert an absolute path to a display path relative to HOME. */
export function displayPath(abs: string): string {
  const prefix = HOME + "/";
  return abs.startsWith(prefix) ? abs.slice(prefix.length) : abs;
}

/** Convert a relative path to an absolute path under HOME. */
export function absPath(rel: string): string {
  return rel.startsWith("/") ? rel : HOME + "/" + rel;
}

/** Resolve a relative import path against a base file's absolute path. */
export function resolveImport(base: string, rel: string): string {
  const parts = base.slice(0, base.lastIndexOf("/") + 1).split("/").filter(Boolean);
  for (const s of rel.split("/")) {
    if (s === "..") parts.pop();
    else if (s !== ".") parts.push(s);
  }
  return "/" + parts.join("/");
}

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

