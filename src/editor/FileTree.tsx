import { useState } from "react";
import { displayPath, type FileMap } from "./file-store";

interface TreeNode {
  name: string;
  fullPath: string;
  children: TreeNode[];
  isFile: boolean;
}

function buildTree(files: FileMap): TreeNode {
  const root: TreeNode = { name: "", fullPath: "", children: [], isFile: false };

  for (const abs of Object.keys(files)) {
    const rel = displayPath(abs);
    const parts = rel.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      const isFile = i === parts.length - 1;
      let child = node.children.find((c) => c.name === name && c.isFile === isFile);
      if (!child) {
        child = { name, fullPath: isFile ? abs : "", children: [], isFile };
        node.children.push(child);
      }
      node = child;
    }
  }

  // Sort: dirs first, then files, alphabetically within each
  const sortNode = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortNode);
  };
  sortNode(root);

  return root;
}

function TreeEntry({
  node,
  depth,
  active,
  onSelect,
  onDelete,
  onRename,
  collapsed,
  toggleCollapsed,
  fileCount,
}: {
  node: TreeNode;
  depth: number;
  active: string;
  onSelect: (path: string) => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
  collapsed: Set<string>;
  toggleCollapsed: (key: string) => void;
  fileCount: number;
}) {
  const indent = depth * 14;

  if (node.isFile) {
    const isActive = node.fullPath === active;
    return (
      <div
        onClick={() => onSelect(node.fullPath)}
        onDoubleClick={() => onRename(node.fullPath)}
        title="Click to open, double-click to rename"
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 8px 3px",
          paddingLeft: indent + 8,
          cursor: "pointer",
          fontSize: 13,
          color: isActive ? "#e2e8f0" : "#9ca3af",
          backgroundColor: isActive ? "#2e2e3e" : "transparent",
          borderLeft: isActive ? "2px solid #c084fc" : "2px solid transparent",
          userSelect: "none",
        }}
      >
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {node.name}
        </span>
        {fileCount > 1 && (
          <span
            onClick={(ev) => { ev.stopPropagation(); onDelete(node.fullPath); }}
            style={{ opacity: 0.3, cursor: "pointer", fontSize: 10, marginLeft: 4 }}
            title="Delete"
          >
            ✕
          </span>
        )}
      </div>
    );
  }

  // Directory
  const key = depth + ":" + node.name;
  const isCollapsed = collapsed.has(key);

  return (
    <>
      <div
        onClick={() => toggleCollapsed(key)}
        style={{
          display: "flex",
          alignItems: "center",
          padding: "3px 8px",
          paddingLeft: indent + 8,
          cursor: "pointer",
          fontSize: 12,
          color: "#6b7280",
          userSelect: "none",
        }}
      >
        <span style={{ width: 14, fontSize: 10, flexShrink: 0 }}>{isCollapsed ? "\u25b6" : "\u25bc"}</span>
        <span>{node.name}/</span>
      </div>
      {!isCollapsed &&
        node.children.map((child) => (
          <TreeEntry
            key={child.name + (child.isFile ? ":f" : ":d")}
            node={child}
            depth={depth + 1}
            active={active}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
            collapsed={collapsed}
            toggleCollapsed={toggleCollapsed}
            fileCount={fileCount}
          />
        ))}
    </>
  );
}

interface Props {
  files: FileMap;
  active: string;
  onSelect: (path: string) => void;
  onAdd: () => void;
  onDelete: (path: string) => void;
  onRename: (path: string) => void;
  onCollapse?: () => void;
}

export default function FileTree({ files, active, onSelect, onAdd, onDelete, onRename, onCollapse }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const tree = buildTree(files);
  const fileCount = Object.keys(files).length;

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#181825", borderRadius: 4, border: "1px solid #2e2e3e", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 8px", borderBottom: "1px solid #2e2e3e", flexShrink: 0 }}>
        {onCollapse && (
          <button
            onClick={onCollapse}
            title="Collapse file tree (Ctrl+B)"
            style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: "#6b7280", padding: "0 4px 0 0" }}
          >
            {"\u25c0"}
          </button>
        )}
        <span style={{ fontSize: 11, color: "#6b7280", textTransform: "uppercase", letterSpacing: "0.05em", flex: 1 }}>
          Files
        </span>
        <button
          onClick={onAdd}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: 16, color: "#6b7280", padding: "0 4px" }}
          title="New file"
        >
          +
        </button>
      </div>
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {tree.children.map((child) => (
          <TreeEntry
            key={child.name + (child.isFile ? ":f" : ":d")}
            node={child}
            depth={0}
            active={active}
            onSelect={onSelect}
            onDelete={onDelete}
            onRename={onRename}
            collapsed={collapsed}
            toggleCollapsed={toggleCollapsed}
            fileCount={fileCount}
          />
        ))}
      </div>
    </div>
  );
}
