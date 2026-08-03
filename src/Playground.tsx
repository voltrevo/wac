import { useState, useCallback, useEffect } from "react";
import WacEditor from "./editor/WacEditor";
import OutputPanel from "./editor/OutputPanel";
import FileTree from "./editor/FileTree";
import { loadFiles, saveFiles, displayPath, absPath, DEFAULT_FILES, type FileMap } from "./editor/file-store";
import { allExampleFiles } from "./editor/examples";

const EXAMPLE_FILES = allExampleFiles();
const ORIGINALS: FileMap = { ...DEFAULT_FILES, ...EXAMPLE_FILES };

export default function Playground() {
  const [files, setFiles] = useState<FileMap>(() => loadFiles(EXAMPLE_FILES));
  const [active, setActive] = useState(() => {
    const all = loadFiles(EXAMPLE_FILES);
    const userFile = Object.keys(all).find((k) => !k.includes("/examples/"));
    return userFile ?? Object.keys(all)[0];
  });

  const persist = useCallback((next: FileMap) => {
    setFiles(next);
    saveFiles(next);
  }, []);

  const handleChange = useCallback(
    (content: string) => {
      persist({ ...files, [active]: content });
    },
    [files, active, persist]
  );

  const addFile = () => {
    const rel = prompt("File path (relative to /home/wac/):");
    if (!rel) return;
    const abs = absPath(rel);
    if (abs in files) return;
    const next = { ...files, [abs]: "" };
    persist(next);
    setActive(abs);
  };

  const deleteFile = (name: string) => {
    if (name in ORIGINALS) return;
    const userKeys = Object.keys(files).filter((k) => !k.includes("/examples/"));
    if (userKeys.length <= 1) return;
    if (!confirm(`Delete "${displayPath(name)}"?`)) return;
    const next = { ...files };
    delete next[name];
    persist(next);
    if (active === name) setActive(Object.keys(next)[0]);
  };

  const renameFile = (oldName: string) => {
    if (oldName in ORIGINALS) return;
    const newName = prompt("Rename to:", displayPath(oldName));
    if (!newName) return;
    const newAbs = absPath(newName);
    if (newAbs === oldName || newAbs in files) return;
    const next: FileMap = {};
    for (const [k, v] of Object.entries(files)) {
      next[k === oldName ? newAbs : k] = v;
    }
    persist(next);
    if (active === oldName) setActive(newAbs);
  };

  const [treeOpen, setTreeOpen] = useState(true);

  useEffect(() => {
    const handle = (ev: KeyboardEvent) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === "b") {
        ev.preventDefault();
        setTreeOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, []);

  return (
    <div style={{ margin: "1rem 2rem 2rem", height: "calc(100vh - 3rem)", display: "flex", flexDirection: "column", gap: 10, fontFamily: "system-ui", color: "#e2e8f0" }}>
      {/* A bar that does not go away. The only way back used to be the wordmark inside the file
          tree, so collapsing the tree with Ctrl+B left the page with no exit at all. */}
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 16,
          flexShrink: 0,
          fontSize: 13,
        }}
      >
        <a
          href="#/"
          style={{
            fontFamily: "ui-monospace, monospace",
            fontSize: 18,
            fontWeight: 700,
            color: "#c084fc",
            textDecoration: "none",
          }}
        >
          wac<span style={{ color: "#2dd4bf" }}>;</span>
        </a>
        <a href="#/" style={{ color: "#9ca3af", textDecoration: "none" }}>&larr; home</a>
        <a href="shell.html" style={{ color: "#9ca3af", textDecoration: "none" }}>shell demo</a>
        <a
          href="https://github.com/voltrevo/wac/tree/master/spec"
          target="_blank"
          rel="noopener"
          style={{ color: "#9ca3af", textDecoration: "none" }}
        >
          spec
        </a>
        <a
          href="https://github.com/voltrevo/wac"
          target="_blank"
          rel="noopener"
          style={{ color: "#9ca3af", textDecoration: "none" }}
        >
          github
        </a>
        <span style={{ marginLeft: "auto", color: "#4a4a5a" }}>
          everything compiles in this tab · Ctrl+B toggles the files
        </span>
      </header>

    <div style={{ flex: 1, minHeight: 0, display: "flex", gap: 12 }}>
      {treeOpen ? (
        <div style={{ width: 220, flexShrink: 0, display: "flex", flexDirection: "column" }}>
          <FileTree
            files={files}
            active={active}
            onSelect={setActive}
            onAdd={addFile}
            onDelete={deleteFile}
            onRename={renameFile}
            onCollapse={() => setTreeOpen(false)}
          />
        </div>
      ) : (
        <button
          onClick={() => setTreeOpen(true)}
          title="Show file tree (Ctrl+B)"
          style={{
            background: "#181825",
            border: "1px solid #2e2e3e",
            borderRadius: 4,
            color: "#6b7280",
            cursor: "pointer",
            padding: "8px 6px",
            fontSize: 14,
            alignSelf: "flex-start",
            flexShrink: 0,
          }}
        >
          {"\u25b6"}
        </button>
      )}

      <div style={{ flex: "1 1 55%", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "6px 12px", borderBottom: "1px solid #2e2e3e", backgroundColor: "#181825", borderRadius: "4px 4px 0 0", fontSize: 13, color: "#6b7280", flexShrink: 0 }}>
          {displayPath(active)}
          {active in ORIGINALS && (
            <button
              onClick={() => {
                const next = { ...files, [active]: ORIGINALS[active] };
                persist(next);
              }}
              style={{
                marginLeft: "auto",
                background: "none",
                border: "1px solid #2e2e3e",
                borderRadius: 4,
                color: "#6b7280",
                cursor: "pointer",
                fontSize: 11,
                padding: "2px 8px",
                visibility: files[active] !== ORIGINALS[active] ? "visible" : "hidden",
              }}
            >
              Clear Changes
            </button>
          )}
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WacEditor key={active} value={files[active]} onChange={handleChange} files={files} fileName={active} />
        </div>
      </div>

      <div style={{ flex: "1 1 40%", minWidth: 0 }}>
        <OutputPanel files={files} fileName={active} />
      </div>
    </div>
    </div>
  );
}
