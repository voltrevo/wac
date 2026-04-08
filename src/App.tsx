import { useState, useCallback, useRef, useEffect } from "react";
import WacEditor from "./editor/WacEditor";
import OutputPanel from "./editor/OutputPanel";
import { loadFiles, saveFiles, displayPath, absPath, type FileMap } from "./editor/file-store";
import { EXAMPLES, getCategories } from "./editor/examples";

export default function App() {
  const [files, setFiles] = useState<FileMap>(loadFiles);
  const [active, setActive] = useState(() => Object.keys(loadFiles())[0]);

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
    const keys = Object.keys(files);
    if (keys.length <= 1) return;
    if (!confirm(`Delete "${displayPath(name)}"?`)) return;
    const next = { ...files };
    delete next[name];
    persist(next);
    if (active === name) setActive(Object.keys(next)[0]);
  };

  const renameFile = (oldName: string) => {
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

  const [examplesOpen, setExamplesOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!examplesOpen) return;
    const handle = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setExamplesOpen(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [examplesOpen]);

  const loadExample = (idx: number) => {
    const ex = EXAMPLES[idx];
    persist(ex.files);
    setActive(Object.keys(ex.files)[0]);
    setExamplesOpen(false);
  };

  const tabs = Object.keys(files);
  const categories = getCategories();

  return (
    <div style={{ margin: "2rem", height: "calc(100vh - 4rem)", display: "flex", gap: 12, fontFamily: "system-ui", color: "#e2e8f0" }}>
      <div style={{ flex: "1 1 55%", display: "flex", flexDirection: "column", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 0, borderBottom: "1px solid #2e2e3e", flexShrink: 0, backgroundColor: "#181825", borderRadius: "4px 4px 0 0" }}>
          {tabs.map((name) => (
            <div
              key={name}
              style={{
                display: "flex",
                alignItems: "center",
                padding: "6px 12px",
                cursor: "pointer",
                background: name === active ? "#1e1e2e" : "#181825",
                borderBottom: name === active ? "2px solid #c084fc" : "2px solid transparent",
                color: name === active ? "#e2e8f0" : "#6b7280",
                fontSize: 13,
                userSelect: "none",
              }}
            >
              <span
                onClick={() => setActive(name)}
                onDoubleClick={() => renameFile(name)}
                title="Click to select, double-click to rename"
              >
                {displayPath(name)}
              </span>
              {tabs.length > 1 && (
                <span
                  onClick={(e) => { e.stopPropagation(); deleteFile(name); }}
                  style={{ marginLeft: 8, opacity: 0.4, cursor: "pointer", fontSize: 11 }}
                  title="Delete file"
                >
                  ✕
                </span>
              )}
            </div>
          ))}
          <button
            onClick={addFile}
            style={{
              marginLeft: 4,
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 18,
              padding: "4px 10px",
              opacity: 0.5,
              color: "#6b7280",
            }}
            title="New file"
          >
            +
          </button>
          <div style={{ position: "relative", marginLeft: "auto" }} ref={menuRef}>
            <button
              onClick={() => setExamplesOpen(!examplesOpen)}
              style={{
                background: examplesOpen ? "#2e2e3e" : "none",
                border: "1px solid #2e2e3e",
                borderRadius: 4,
                cursor: "pointer",
                fontSize: 12,
                padding: "3px 10px",
                color: "#9ca3af",
              }}
            >
              Examples
            </button>
            {examplesOpen && (
              <div style={{
                position: "absolute",
                top: "100%",
                right: 0,
                marginTop: 4,
                backgroundColor: "#181825",
                border: "1px solid #2e2e3e",
                borderRadius: 6,
                padding: "6px 0",
                zIndex: 100,
                width: 240,
                maxHeight: 400,
                overflowY: "auto",
                boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
              }}>
                {categories.map((cat) => (
                  <div key={cat}>
                    <div style={{ padding: "6px 14px 2px", fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {cat}
                    </div>
                    {EXAMPLES.map((ex, i) => ex.category !== cat ? null : (
                      <button
                        key={i}
                        onClick={() => loadExample(i)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          background: "none",
                          border: "none",
                          padding: "5px 14px",
                          fontSize: 13,
                          color: "#e2e8f0",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#2e2e3e")}
                        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
                      >
                        {ex.name}
                        {Object.keys(ex.files).length > 1 && (
                          <span style={{ color: "#6b7280", fontSize: 11, marginLeft: 6 }}>
                            {Object.keys(ex.files).length} files
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <WacEditor key={active} value={files[active]} onChange={handleChange} files={files} fileName={active} />
        </div>
      </div>
      <div style={{ flex: "1 1 45%", minWidth: 0 }}>
        <OutputPanel files={files} fileName={active} />
      </div>
    </div>
  );
}
