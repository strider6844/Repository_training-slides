import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import api, { API, formatApiError } from "../lib/api";
import { CATEGORY_BY_ID, FILE_EXT_LABEL } from "../lib/categories";
import { reloadFolders } from "../components/layout/AppShell";
import {
  ChevronRight,
  FolderPlus,
  FilePlus2,
  Link as LinkIcon,
  StickyNote,
  Upload,
  FileText,
  ExternalLink,
  Trash2,
  Folder,
  ArrowUpRight,
  MoreHorizontal,
  Home,
} from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

export default function CategoryPage() {
  const { categoryId, folderId } = useParams();
  const navigate = useNavigate();
  const category = CATEGORY_BY_ID[categoryId];
  const [folders, setFolders] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showAddLink, setShowAddLink] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null); // {type, id, name}
  const dragRef = useRef(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef(null);

  const currentFolder = folders.find((f) => f.id === folderId);
  const visibleFolders = folders.filter((f) =>
    folderId ? f.parent_id === folderId : !f.parent_id
  );
  const visibleItems = items.filter((i) =>
    folderId ? i.folder_id === folderId : !i.folder_id
  );

  const load = useCallback(async () => {
    if (!categoryId) return;
    setLoading(true);
    try {
      const [f, it] = await Promise.all([
        api.get(`/folders?category=${categoryId}`),
        api.get(`/items?category=${categoryId}`),
      ]);
      setFolders(f.data);
      setItems(it.data);
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  }, [categoryId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!category) {
    return (
      <div className="p-12">
        <div>Unknown category</div>
        <Link to="/" className="underline">
          Back home
        </Link>
      </div>
    );
  }

  const createFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      await api.post("/folders", {
        name: newFolderName.trim(),
        category: categoryId,
        parent_id: folderId || null,
      });
      setNewFolderName("");
      setShowNewFolder(false);
      reloadFolders(categoryId);
      await load();
      toast.success("Folder created");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const addLink = async () => {
    if (!linkUrl.trim()) return;
    try {
      let url = linkUrl.trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;
      await api.post("/links", {
        url,
        category: categoryId,
        folder_id: folderId || null,
      });
      setLinkUrl("");
      setShowAddLink(false);
      await load();
      toast.success("Link added");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const createNote = async () => {
    try {
      const { data } = await api.post("/notes", {
        title: "Untitled note",
        category: categoryId,
        folder_id: folderId || null,
        blocks: [{ id: crypto.randomUUID(), type: "paragraph", content: "" }],
      });
      navigate(`/c/${categoryId}/note/${data.id}`);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  const uploadFiles = async (files) => {
    for (const file of files) {
      const ext = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "doc", "docx", "ppt", "pptx"].includes(ext)) {
        toast.error(`Unsupported: ${file.name}`);
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("category", categoryId);
        if (folderId) fd.append("folder_id", folderId);
        await api.post("/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        toast.success(`Uploaded ${file.name}`);
      } catch (err) {
        toast.error(`${file.name}: ${formatApiError(err)}`);
      }
    }
    await load();
  };

  const onDrop = async (e) => {
    e.preventDefault();
    setDragActive(false);
    dragRef.current = false;
    const files = Array.from(e.dataTransfer.files || []);
    if (files.length) await uploadFiles(files);
  };

  const deleteItem = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === "folder") {
        await api.delete(`/folders/${deleteTarget.id}`);
        reloadFolders(categoryId);
      } else {
        await api.delete(`/items/${deleteTarget.id}`);
      }
      toast.success("Deleted");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  // Build breadcrumbs
  const crumbs = [];
  let pointer = currentFolder;
  while (pointer) {
    crumbs.unshift(pointer);
    pointer = folders.find((f) => f.id === pointer.parent_id);
  }

  return (
    <div
      className="page-fade-in"
      data-testid="category-page"
      onDragOver={(e) => {
        e.preventDefault();
        if (!dragRef.current) {
          dragRef.current = true;
          setDragActive(true);
        }
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        if (e.currentTarget === e.target) {
          dragRef.current = false;
          setDragActive(false);
        }
      }}
      onDrop={onDrop}
    >
      {/* Cover banner */}
      <div className="relative h-48 md:h-64 w-full overflow-hidden border-b border-neutral-200">
        <img src={category.cover} alt="" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-white/70 via-transparent to-transparent"></div>
        <div className="absolute bottom-6 left-6 md:left-12 right-6 flex items-end justify-between">
          <div>
            <div
              className={`inline-block ${category.bgSoft} ${category.accent} text-[10px] font-mono uppercase tracking-[0.25em] px-2 py-1 mb-3`}
            >
              {category.group === "claude" ? "Claude · workflow" : "Domain"}
            </div>
            <h1 className="font-display text-3xl md:text-5xl font-black tracking-tighter">
              {category.name}
            </h1>
          </div>
        </div>
      </div>

      <div className="px-6 sm:px-12 py-10 max-w-6xl mx-auto">
        {/* Breadcrumbs */}
        <nav
          className="flex items-center flex-wrap gap-1 text-sm text-neutral-500 mb-6"
          data-testid="breadcrumbs"
        >
          <Link
            to={`/c/${categoryId}`}
            className="hover:text-[#0A0A0A] flex items-center gap-1"
            data-testid="breadcrumb-root"
          >
            <Home size={13} />
            {category.short}
          </Link>
          {crumbs.map((c) => (
            <span key={c.id} className="flex items-center gap-1">
              <ChevronRight size={12} className="text-neutral-300" />
              <Link
                to={`/c/${categoryId}/folder/${c.id}`}
                className="hover:text-[#0A0A0A]"
                data-testid={`breadcrumb-${c.id}`}
              >
                {c.name}
              </Link>
            </span>
          ))}
        </nav>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-2 mb-8">
          <button
            onClick={() => setShowNewFolder(true)}
            data-testid="action-new-folder"
            className="bg-white border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"
          >
            <FolderPlus size={14} /> New folder
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            data-testid="action-upload-file"
            className="bg-white border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"
          >
            <Upload size={14} /> Upload file
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.ppt,.pptx"
            className="hidden"
            onChange={(e) => uploadFiles(Array.from(e.target.files || []))}
            data-testid="file-input"
          />
          <button
            onClick={() => setShowAddLink(true)}
            data-testid="action-add-link"
            className="bg-white border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 flex items-center gap-2"
          >
            <LinkIcon size={14} /> Add link
          </button>
          <button
            onClick={createNote}
            data-testid="action-new-note"
            className="bg-[#0A0A0A] text-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-800 flex items-center gap-2"
          >
            <StickyNote size={14} /> New note
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : (
          <>
            {visibleFolders.length === 0 && visibleItems.length === 0 ? (
              <div
                className={`border-2 border-dashed ${
                  dragActive
                    ? "border-[#0A0A0A] bg-neutral-100"
                    : "border-neutral-300 bg-neutral-50"
                } p-16 text-center transition-colors`}
                data-testid="empty-state"
              >
                <FilePlus2
                  size={32}
                  strokeWidth={1.25}
                  className="mx-auto text-neutral-400 mb-3"
                />
                <h3 className="font-display font-bold text-lg">
                  Nothing here yet
                </h3>
                <p className="text-sm text-neutral-500 mt-1 mb-6">
                  Drag PDF/DOC/PPT here, or use the actions above.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  <button
                    onClick={() => setShowNewFolder(true)}
                    className="bg-white border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
                    data-testid="empty-new-folder"
                  >
                    + Folder
                  </button>
                  <button
                    onClick={createNote}
                    className="bg-[#0A0A0A] text-white px-3 py-1.5 text-sm"
                    data-testid="empty-new-note"
                  >
                    + Note
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-10">
                {visibleFolders.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
                      Folders
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                      {visibleFolders.map((f) => (
                        <div
                          key={f.id}
                          className="group relative border border-neutral-200 bg-white p-4 hard-shadow"
                          data-testid={`folder-card-${f.id}`}
                        >
                          <Link
                            to={`/c/${categoryId}/folder/${f.id}`}
                            className="flex items-center gap-3"
                          >
                            <Folder
                              size={20}
                              className="text-neutral-500"
                              strokeWidth={1.5}
                            />
                            <div className="min-w-0 flex-1">
                              <div className="font-medium truncate">
                                {f.name}
                              </div>
                              <div className="text-xs text-neutral-500">
                                Folder
                              </div>
                            </div>
                          </Link>
                          <RowMenu
                            onDelete={() =>
                              setDeleteTarget({
                                type: "folder",
                                id: f.id,
                                name: f.name,
                              })
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {visibleItems.length > 0 && (
                  <section>
                    <h3 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
                      Documents & notes
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {visibleItems.map((it) => (
                        <ItemCard
                          key={it.id}
                          item={it}
                          categoryId={categoryId}
                          onDelete={() =>
                            setDeleteTarget({
                              type: "item",
                              id: it.id,
                              name: it.title,
                            })
                          }
                        />
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}

            {dragActive && (
              <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-white/70">
                <div className="border-2 border-dashed border-[#0A0A0A] bg-white p-12 text-center">
                  <Upload size={32} className="mx-auto mb-2" />
                  <div className="font-display font-bold text-xl">
                    Drop to upload
                  </div>
                  <div className="text-sm text-neutral-500 mt-1">
                    PDF · DOCX · PPTX
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* New folder dialog */}
      <Dialog open={showNewFolder} onOpenChange={setShowNewFolder}>
        <DialogContent data-testid="new-folder-dialog">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              New folder
            </DialogTitle>
            <DialogDescription>
              Folders nest like Notion. You can drag/drop documents inside.
            </DialogDescription>
          </DialogHeader>
          <input
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createFolder()}
            placeholder="Folder name"
            className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
            autoFocus
            data-testid="new-folder-input"
          />
          <DialogFooter>
            <button
              onClick={() => setShowNewFolder(false)}
              className="bg-white border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
              data-testid="new-folder-cancel"
            >
              Cancel
            </button>
            <button
              onClick={createFolder}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm hover:bg-neutral-800"
              data-testid="new-folder-create"
            >
              Create
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add link dialog */}
      <Dialog open={showAddLink} onOpenChange={setShowAddLink}>
        <DialogContent data-testid="add-link-dialog">
          <DialogHeader>
            <DialogTitle className="font-display tracking-tight">
              Add a web link
            </DialogTitle>
            <DialogDescription>
              We'll auto-fetch the title, description and preview image.
            </DialogDescription>
          </DialogHeader>
          <input
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addLink()}
            placeholder="https://…"
            className="w-full border-b border-neutral-300 bg-transparent py-2 focus:outline-none focus:border-[#0A0A0A]"
            autoFocus
            data-testid="add-link-input"
          />
          <DialogFooter>
            <button
              onClick={() => setShowAddLink(false)}
              className="bg-white border border-neutral-300 px-4 py-2 text-sm"
              data-testid="add-link-cancel"
            >
              Cancel
            </button>
            <button
              onClick={addLink}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm"
              data-testid="add-link-save"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
      >
        <AlertDialogContent data-testid="delete-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display tracking-tight">
              Delete {deleteTarget?.type}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteTarget?.name}"{" "}
              {deleteTarget?.type === "folder"
                ? "and everything inside will be removed."
                : "will be removed."}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="delete-cancel">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={deleteItem}
              className="bg-red-600 hover:bg-red-700 text-white"
              data-testid="delete-confirm"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RowMenu({ onDelete }) {
  return (
    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className="p-1 text-neutral-500 hover:bg-neutral-100 rounded-sm"
            data-testid="row-menu-trigger"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" data-testid="row-menu-content">
          <DropdownMenuItem
            onClick={onDelete}
            className="text-red-600 focus:text-red-600"
            data-testid="row-menu-delete"
          >
            <Trash2 size={14} className="mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function ItemCard({ item, categoryId, onDelete }) {
  if (item.type === "file") {
    return (
      <div
        className="group relative border border-neutral-200 bg-white p-4 hard-shadow"
        data-testid={`item-card-${item.id}`}
      >
        <Link
          to={`/c/${categoryId}/file/${item.id}`}
          className="flex items-start gap-3"
        >
          <div className="w-10 h-12 bg-neutral-100 flex items-center justify-center text-[10px] font-mono font-bold text-neutral-700 flex-shrink-0">
            {FILE_EXT_LABEL[item.ext] || "FILE"}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium truncate">{item.title}</div>
            <div className="text-xs text-neutral-500 mt-1">
              {item.original_filename} · {formatSize(item.size)}
            </div>
          </div>
        </Link>
        <RowMenu onDelete={onDelete} />
      </div>
    );
  }
  if (item.type === "link") {
    return (
      <div
        className="group relative border border-neutral-200 bg-white overflow-hidden hard-shadow"
        data-testid={`item-card-${item.id}`}
      >
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          {item.link_image && (
            <div className="h-28 w-full overflow-hidden border-b border-neutral-200 bg-neutral-50">
              <img
                src={item.link_image}
                alt=""
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.target.style.display = "none";
                }}
              />
            </div>
          )}
          <div className="p-4">
            <div className="flex items-start gap-2">
              <ExternalLink
                size={14}
                className="text-neutral-400 flex-shrink-0 mt-1"
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{item.title}</div>
                {item.link_description && (
                  <div className="text-xs text-neutral-500 mt-1 line-clamp-2">
                    {item.link_description}
                  </div>
                )}
                <div className="text-[10px] font-mono text-neutral-400 mt-2 truncate">
                  {tryHost(item.url)}
                </div>
              </div>
            </div>
          </div>
        </a>
        <RowMenu onDelete={onDelete} />
      </div>
    );
  }
  // note
  return (
    <div
      className="group relative border border-neutral-200 bg-white p-4 hard-shadow"
      data-testid={`item-card-${item.id}`}
    >
      <Link
        to={`/c/${categoryId}/note/${item.id}`}
        className="flex items-start gap-3"
      >
        <div className="w-10 h-12 bg-yellow-100 flex items-center justify-center flex-shrink-0">
          <StickyNote size={16} className="text-yellow-700" strokeWidth={1.5} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{item.title}</div>
          <div className="text-xs text-neutral-500 mt-1">
            Note · {new Date(item.updated_at).toLocaleDateString()}
          </div>
        </div>
      </Link>
      <RowMenu onDelete={onDelete} />
    </div>
  );
}

function formatSize(b) {
  if (!b) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(1)} MB`;
}
function tryHost(url) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
