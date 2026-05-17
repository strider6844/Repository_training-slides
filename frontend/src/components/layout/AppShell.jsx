import { useEffect, useState, useCallback } from "react";
import { Outlet, Link, useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { useWorkspace } from "../../context/WorkspaceContext";
import { CATEGORIES } from "../../lib/categories";
import api from "../../lib/api";
import { Library, LogOut, Search, ChevronRight, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import FolderTree from "./FolderTreeItem";
import WorkspaceSwitcher from "./WorkspaceSwitcher";

function CategorySection({ category, currentCategoryId, currentFolderId }) {
  const { currentId } = useWorkspace();
  const [folders, setFolders] = useState([]);
  const [open, setOpen] = useState(currentCategoryId === category.id);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get(`/folders?category=${category.id}`);
      setFolders(data);
    } catch {
      // ignore
    }
  }, [category.id]);

  useEffect(() => {
    load();
    const handler = (e) => {
      if (!e.detail?.category || e.detail.category === category.id) load();
    };
    const wsHandler = () => load();
    window.addEventListener("folders-changed", handler);
    window.addEventListener("workspace-changed", wsHandler);
    return () => {
      window.removeEventListener("folders-changed", handler);
      window.removeEventListener("workspace-changed", wsHandler);
    };
  }, [load, category.id]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentId]);

  useEffect(() => {
    if (currentCategoryId === category.id) setOpen(true);
  }, [currentCategoryId, category.id]);

  return (
    <div className="mb-1">
      <div className="flex items-center group">
        <button
          onClick={() => setOpen((v) => !v)}
          className="p-1 text-neutral-400 hover:text-neutral-900"
          data-testid={`sidebar-category-toggle-${category.id}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Link
          to={`/c/${category.id}`}
          data-testid={`sidebar-category-${category.id}`}
          className={`flex-1 text-xs font-mono uppercase tracking-[0.15em] py-1 ${
            currentCategoryId === category.id
              ? "text-[#0A0A0A] font-bold"
              : "text-neutral-500 hover:text-neutral-900"
          }`}
        >
          {category.short}
        </Link>
      </div>
      {open && (
        <div className="mt-1">
          {folders.length === 0 && (
            <div className="text-xs text-neutral-400 italic px-3 py-1" style={{ paddingLeft: 26 }}>
              No folders yet
            </div>
          )}
          <FolderTree
            folders={folders}
            currentFolderId={currentFolderId}
            categoryId={category.id}
          />
        </div>
      )}
    </div>
  );
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const match = location.pathname.match(/^\/c\/([^/]+)(?:\/folder\/([^/]+))?/);
  const currentCategoryId = match?.[1];
  const currentFolderId = match?.[2];
  const [search, setSearch] = useState("");

  const main = CATEGORIES.filter((c) => c.group === "main");
  const claude = CATEGORIES.filter((c) => c.group === "claude");

  const submitSearch = (e) => {
    e.preventDefault();
    if (!search.trim()) return;
    navigate(`/search?q=${encodeURIComponent(search.trim())}`);
  };

  const onLogout = async () => {
    await logout();
    toast.success("Signed out");
    navigate("/login");
  };

  return (
    <div className="min-h-screen flex bg-white">
      <aside
        className="w-72 flex-shrink-0 border-r border-neutral-200 h-screen sticky top-0 overflow-y-auto bg-[#FAFAFA] flex flex-col"
        data-testid="app-sidebar"
      >
        <div className="px-5 pt-6 pb-4 border-b border-neutral-200 space-y-3">
          <Link to="/" data-testid="sidebar-logo-link" className="flex items-center gap-2">
            <Library size={20} strokeWidth={1.5} />
            <span className="font-display font-black text-lg tracking-tighter">Slidevault</span>
          </Link>
          <WorkspaceSwitcher />
          <form onSubmit={submitSearch} data-testid="sidebar-search-form">
            <div className="flex items-center gap-2 border border-neutral-200 bg-white px-3 py-2 focus-within:border-[#0A0A0A] transition-colors">
              <Search size={14} className="text-neutral-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search everything…"
                className="flex-1 text-sm bg-transparent focus:outline-none placeholder:text-neutral-400"
                data-testid="sidebar-search-input"
              />
            </div>
          </form>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-4">
          <div>
            <div className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-400">
              Domains
            </div>
            {main.map((c) => (
              <CategorySection
                key={c.id}
                category={c}
                currentCategoryId={currentCategoryId}
                currentFolderId={currentFolderId}
              />
            ))}
          </div>
          <div>
            <div className="px-3 mb-2 text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-400">
              Claude
            </div>
            {claude.map((c) => (
              <CategorySection
                key={c.id}
                category={c}
                currentCategoryId={currentCategoryId}
                currentFolderId={currentFolderId}
              />
            ))}
          </div>
        </nav>

        <div className="border-t border-neutral-200 px-5 py-3 flex items-center justify-between">
          <div className="min-w-0">
            <div className="text-sm font-medium truncate" data-testid="sidebar-user-name">
              {user?.name}
            </div>
            <div className="text-xs text-neutral-500 truncate">{user?.email}</div>
          </div>
          <button
            onClick={onLogout}
            className="p-2 text-neutral-500 hover:text-[#0A0A0A] hover:bg-neutral-100"
            aria-label="Sign out"
            data-testid="sidebar-logout-button"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  );
}

export function reloadFolders(category) {
  window.dispatchEvent(new CustomEvent("folders-changed", { detail: { category } }));
}
