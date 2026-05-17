import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Folder } from "lucide-react";

function flattenTree(folders, expanded) {
  const childrenByParent = {};
  for (const f of folders) {
    const k = f.parent_id || "__root__";
    if (!childrenByParent[k]) childrenByParent[k] = [];
    childrenByParent[k].push(f);
  }
  const out = [];
  const stack = [];
  const roots = childrenByParent["__root__"] || [];
  for (let i = roots.length - 1; i >= 0; i--) {
    stack.push({ folder: roots[i], level: 1 });
  }
  while (stack.length) {
    const { folder, level } = stack.pop();
    const children = childrenByParent[folder.id] || [];
    out.push({ folder, level, hasChildren: children.length > 0 });
    const isOpen = expanded[folder.id] !== false; // default open
    if (isOpen) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ folder: children[i], level: level + 1 });
      }
    }
  }
  return out;
}

export default function FolderTree({ folders, currentFolderId, categoryId }) {
  const [expanded, setExpanded] = useState({});
  const navigate = useNavigate();
  const visible = useMemo(() => flattenTree(folders, expanded), [folders, expanded]);

  const toggle = (id) => setExpanded((s) => ({ ...s, [id]: s[id] === false ? true : false }));

  return (
    <div>
      {visible.map(({ folder, level, hasChildren }) => {
        const isActive = currentFolderId === folder.id;
        const isOpen = expanded[folder.id] !== false;
        return (
          <div
            key={folder.id}
            className={`group flex items-center gap-1 pr-2 py-1 cursor-pointer rounded-sm hover:bg-neutral-100 transition-colors ${
              isActive ? "bg-neutral-100 font-medium" : ""
            }`}
            style={{ paddingLeft: 8 + level * 14 }}
            onClick={() => navigate(`/c/${categoryId}/folder/${folder.id}`)}
            data-testid={`sidebar-folder-${folder.id}`}
          >
            <button
              onClick={(e) => {
                e.stopPropagation();
                toggle(folder.id);
              }}
              className="p-0.5 text-neutral-400 hover:text-neutral-900 rounded-sm"
              aria-label="toggle"
              data-testid={`sidebar-folder-toggle-${folder.id}`}
            >
              {hasChildren ? (
                isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />
              ) : (
                <span className="w-3.5 inline-block" />
              )}
            </button>
            <Folder size={14} className="text-neutral-500 flex-shrink-0" strokeWidth={1.5} />
            <span className="text-sm truncate flex-1">{folder.name}</span>
          </div>
        );
      })}
    </div>
  );
}
