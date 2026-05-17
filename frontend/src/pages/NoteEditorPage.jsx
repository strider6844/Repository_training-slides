import { useEffect, useState, useRef, useCallback } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { CATEGORY_BY_ID } from "../lib/categories";
import {
  ChevronLeft,
  Type,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  Lightbulb,
  Table as TableIcon,
  Trash2,
  GripVertical,
  Plus,
  Link as LinkIcon,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import ShareDialog from "../components/ShareDialog";

const BLOCK_TYPES = [
  { type: "paragraph", label: "Text", icon: Type, placeholder: "Type something…" },
  { type: "h1", label: "Heading 1", icon: Heading1, placeholder: "Heading 1" },
  { type: "h2", label: "Heading 2", icon: Heading2, placeholder: "Heading 2" },
  { type: "h3", label: "Heading 3", icon: Heading3, placeholder: "Heading 3" },
  { type: "bullet", label: "Bulleted list", icon: List, placeholder: "List item" },
  { type: "numbered", label: "Numbered list", icon: ListOrdered, placeholder: "List item" },
  { type: "todo", label: "To-do", icon: CheckSquare, placeholder: "To-do" },
  { type: "quote", label: "Quote", icon: Quote, placeholder: "Quote" },
  { type: "code", label: "Code", icon: Code, placeholder: "Code" },
  { type: "callout", label: "Callout", icon: Lightbulb, placeholder: "Callout" },
  { type: "divider", label: "Divider", icon: Minus },
  { type: "table", label: "Table", icon: TableIcon },
  { type: "embed", label: "Embed / link", icon: LinkIcon, placeholder: "https://…" },
];

const newBlock = (type = "paragraph", extras = {}) => ({
  id: crypto.randomUUID(),
  type,
  content: "",
  ...(type === "todo" ? { checked: false } : {}),
  ...(type === "code" ? { language: "plain" } : {}),
  ...(type === "table"
    ? {
        rows: [
          ["", "", ""],
          ["", "", ""],
        ],
      }
    : {}),
  ...extras,
});

export default function NoteEditorPage() {
  const { categoryId, itemId } = useParams();
  const navigate = useNavigate();
  const category = CATEGORY_BY_ID[categoryId];
  const [note, setNote] = useState(null);
  const [title, setTitle] = useState("");
  const [blocks, setBlocks] = useState([]);
  const [saving, setSaving] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const debounceRef = useRef(null);
  const initialLoad = useRef(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get(`/items/${itemId}`);
        setNote(data);
        setTitle(data.title || "");
        setBlocks(
          (data.blocks && data.blocks.length > 0
            ? data.blocks
            : [newBlock()]
          ).map((b) => ({ ...b, id: b.id || crypto.randomUUID() }))
        );
        initialLoad.current = true;
      } catch (err) {
        toast.error(formatApiError(err));
        navigate(`/c/${categoryId}`);
      }
    })();
  }, [itemId, categoryId, navigate]);

  // Autosave
  useEffect(() => {
    if (!note) return;
    if (initialLoad.current) {
      initialLoad.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setSaving(true);
        await api.patch(`/items/${itemId}`, { title, blocks });
      } catch (err) {
        toast.error(formatApiError(err));
      } finally {
        setSaving(false);
      }
    }, 700);
    return () => clearTimeout(debounceRef.current);
  }, [title, blocks, itemId, note]);

  const updateBlock = useCallback((id, patch) => {
    setBlocks((bs) => bs.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }, []);

  const insertBlockAfter = (id, type = "paragraph") => {
    setBlocks((bs) => {
      const idx = bs.findIndex((b) => b.id === id);
      const next = [...bs];
      const nb = newBlock(type);
      next.splice(idx + 1, 0, nb);
      return next;
    });
  };

  const changeBlockType = (id, type) => {
    setBlocks((bs) =>
      bs.map((b) =>
        b.id === id
          ? { ...newBlock(type), id: b.id, content: b.content || "" }
          : b
      )
    );
  };

  const removeBlock = (id) => {
    setBlocks((bs) => {
      if (bs.length === 1) return [newBlock()];
      return bs.filter((b) => b.id !== id);
    });
  };

  const moveBlock = (id, dir) => {
    setBlocks((bs) => {
      const idx = bs.findIndex((b) => b.id === id);
      if (idx < 0) return bs;
      const next = [...bs];
      const target = idx + dir;
      if (target < 0 || target >= bs.length) return bs;
      const tmp = next[target];
      next[target] = next[idx];
      next[idx] = tmp;
      return next;
    });
  };

  if (!note) {
    return (
      <div className="p-12 text-sm text-neutral-400">Loading note…</div>
    );
  }

  return (
    <div className="page-fade-in pt-12 pb-32 px-6 sm:px-12 md:px-24 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <Link
          to={
            note.folder_id
              ? `/c/${categoryId}/folder/${note.folder_id}`
              : `/c/${categoryId}`
          }
          className="flex items-center gap-2 text-sm text-neutral-500 hover:text-[#0A0A0A]"
          data-testid="note-back-link"
        >
          <ChevronLeft size={14} /> Back to {category?.short}
        </Link>
        <div className="flex items-center gap-3">
          {note.share_enabled && (
            <span className="text-emerald-700 bg-emerald-50 px-2 py-0.5 text-[10px] font-mono uppercase tracking-[0.15em]">
              Shared
            </span>
          )}
          <button
            onClick={() => setShareOpen(true)}
            className="text-sm flex items-center gap-1 text-neutral-500 hover:text-[#0A0A0A]"
            data-testid="note-share-button"
          >
            <Share2 size={14} /> Share
          </button>
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400">
            {saving ? "Saving…" : "Saved"}
          </div>
        </div>
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Untitled"
        className="font-display text-4xl md:text-5xl font-black tracking-tighter w-full bg-transparent border-none focus:outline-none placeholder:text-neutral-300 mb-8"
        data-testid="note-title-input"
      />

      <div className="space-y-1" data-testid="note-blocks">
        {blocks.map((b, i) => (
          <BlockRow
            key={b.id}
            block={b}
            index={i}
            onChange={(patch) => updateBlock(b.id, patch)}
            onEnter={() => insertBlockAfter(b.id)}
            onTypeChange={(t) => changeBlockType(b.id, t)}
            onRemove={() => removeBlock(b.id)}
            onMoveUp={() => moveBlock(b.id, -1)}
            onMoveDown={() => moveBlock(b.id, +1)}
          />
        ))}
        <button
          onClick={() => setBlocks((bs) => [...bs, newBlock()])}
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-[#0A0A0A] py-2"
          data-testid="add-block-button"
        >
          <Plus size={14} /> Add block
        </button>
      </div>

      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        itemId={itemId}
        initialSlug={note.share_slug}
        initialEnabled={note.share_enabled}
      />
    </div>
  );
}

function BlockTypeMenu({ onSelect }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="p-1 text-neutral-300 hover:text-neutral-700"
          data-testid="block-add-trigger"
        >
          <Plus size={14} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
        {BLOCK_TYPES.map((t) => {
          const Icon = t.icon;
          return (
            <DropdownMenuItem
              key={t.type}
              onClick={() => onSelect(t.type)}
              data-testid={`block-type-${t.type}`}
            >
              <Icon size={14} className="mr-2" /> {t.label}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BlockRow({
  block,
  onChange,
  onEnter,
  onTypeChange,
  onRemove,
  onMoveUp,
  onMoveDown,
}) {
  return (
    <div className="group flex items-start gap-1 -ml-12 pl-12 relative" data-testid={`block-row-${block.id}`}>
      <div className="absolute left-0 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <BlockTypeMenu onSelect={onTypeChange} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-1 text-neutral-300 hover:text-neutral-700"
              data-testid="block-handle"
            >
              <GripVertical size={14} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onMoveUp} data-testid="block-move-up">
              Move up
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onMoveDown} data-testid="block-move-down">
              Move down
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={onRemove}
              className="text-red-600 focus:text-red-600"
              data-testid="block-delete"
            >
              <Trash2 size={13} className="mr-2" /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="flex-1 min-w-0">
        <BlockContent block={block} onChange={onChange} onEnter={onEnter} />
      </div>
    </div>
  );
}

function BlockContent({ block, onChange, onEnter }) {
  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey && block.type !== "code" && block.type !== "table") {
      e.preventDefault();
      onEnter();
    }
  };
  const baseInput =
    "w-full bg-transparent border-none focus:outline-none placeholder:text-neutral-300";
  switch (block.type) {
    case "h1":
      return (
        <input
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          onKeyDown={handleKey}
          placeholder="Heading 1"
          className={`${baseInput} font-display text-3xl font-black tracking-tight py-2`}
          data-testid="block-h1-input"
        />
      );
    case "h2":
      return (
        <input
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          onKeyDown={handleKey}
          placeholder="Heading 2"
          className={`${baseInput} font-display text-2xl font-bold tracking-tight py-1.5`}
          data-testid="block-h2-input"
        />
      );
    case "h3":
      return (
        <input
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          onKeyDown={handleKey}
          placeholder="Heading 3"
          className={`${baseInput} font-display text-xl font-semibold py-1`}
          data-testid="block-h3-input"
        />
      );
    case "bullet":
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-neutral-500">•</span>
          <input
            value={block.content}
            onChange={(e) => onChange({ content: e.target.value })}
            onKeyDown={handleKey}
            placeholder="List item"
            className={`${baseInput} py-1`}
            data-testid="block-bullet-input"
          />
        </div>
      );
    case "numbered":
      return (
        <div className="flex items-baseline gap-2">
          <span className="text-neutral-500">1.</span>
          <input
            value={block.content}
            onChange={(e) => onChange({ content: e.target.value })}
            onKeyDown={handleKey}
            placeholder="List item"
            className={`${baseInput} py-1`}
            data-testid="block-numbered-input"
          />
        </div>
      );
    case "todo":
      return (
        <div className="flex items-baseline gap-2">
          <input
            type="checkbox"
            checked={!!block.checked}
            onChange={(e) => onChange({ checked: e.target.checked })}
            data-testid="block-todo-checkbox"
          />
          <input
            value={block.content}
            onChange={(e) => onChange({ content: e.target.value })}
            onKeyDown={handleKey}
            placeholder="To-do"
            className={`${baseInput} py-1 ${block.checked ? "line-through text-neutral-400" : ""}`}
            data-testid="block-todo-input"
          />
        </div>
      );
    case "quote":
      return (
        <div className="border-l-4 border-[#0A0A0A] pl-4 py-1 bg-neutral-50">
          <input
            value={block.content}
            onChange={(e) => onChange({ content: e.target.value })}
            onKeyDown={handleKey}
            placeholder="Quote"
            className={`${baseInput} text-lg italic`}
            data-testid="block-quote-input"
          />
        </div>
      );
    case "callout":
      return (
        <div className="flex gap-3 p-3 border border-neutral-200 bg-neutral-50 items-start">
          <Lightbulb size={16} className="text-yellow-600 mt-1 flex-shrink-0" />
          <input
            value={block.content}
            onChange={(e) => onChange({ content: e.target.value })}
            onKeyDown={handleKey}
            placeholder="Callout"
            className={`${baseInput}`}
            data-testid="block-callout-input"
          />
        </div>
      );
    case "code":
      return (
        <textarea
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          placeholder="// code"
          rows={Math.max(3, (block.content || "").split("\n").length + 1)}
          className="w-full bg-[#0A0A0A] text-white p-4 font-mono text-sm resize-none focus:outline-none placeholder:text-neutral-500"
          data-testid="block-code-input"
        />
      );
    case "divider":
      return <div className="my-4 border-t border-dashed border-neutral-300 w-full" data-testid="block-divider" />;
    case "embed":
      return (
        <input
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          onKeyDown={handleKey}
          placeholder="https://…"
          className={`${baseInput} text-blue-700 underline underline-offset-4`}
          data-testid="block-embed-input"
        />
      );
    case "table":
      return <TableBlock block={block} onChange={onChange} />;
    default:
      return (
        <input
          value={block.content}
          onChange={(e) => onChange({ content: e.target.value })}
          onKeyDown={handleKey}
          placeholder="Type something…"
          className={`${baseInput} py-1 text-base leading-relaxed`}
          data-testid="block-paragraph-input"
        />
      );
  }
}

function TableBlock({ block, onChange }) {
  const rows = block.rows || [["", ""]];
  const setCell = (r, c, v) => {
    const next = rows.map((row) => [...row]);
    next[r][c] = v;
    onChange({ rows: next });
  };
  const addRow = () => onChange({ rows: [...rows, rows[0].map(() => "")] });
  const addCol = () => onChange({ rows: rows.map((r) => [...r, ""]) });
  return (
    <div className="my-2 overflow-x-auto" data-testid="block-table">
      <table className="border-collapse">
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="border border-neutral-300 p-0">
                  <input
                    value={cell}
                    onChange={(e) => setCell(ri, ci, e.target.value)}
                    className="px-3 py-1 min-w-[120px] bg-transparent focus:outline-none focus:bg-neutral-50"
                    data-testid={`table-cell-${ri}-${ci}`}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 mt-1">
        <button
          onClick={addRow}
          className="text-xs text-neutral-500 hover:text-[#0A0A0A]"
          data-testid="table-add-row"
        >
          + Row
        </button>
        <button
          onClick={addCol}
          className="text-xs text-neutral-500 hover:text-[#0A0A0A]"
          data-testid="table-add-col"
        >
          + Column
        </button>
      </div>
    </div>
  );
}
