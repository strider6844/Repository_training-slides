import { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { CATEGORY_BY_ID, FILE_EXT_LABEL } from "../lib/categories";
import { Folder, FileText, StickyNote, ExternalLink, Search } from "lucide-react";
import { toast } from "sonner";

export default function SearchPage() {
  const [params] = useSearchParams();
  const q = params.get("q") || "";
  const [results, setResults] = useState({ folders: [], items: [] });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!q.trim()) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get(`/search?q=${encodeURIComponent(q)}`);
        setResults(data);
      } catch (err) {
        toast.error(formatApiError(err));
      } finally {
        setLoading(false);
      }
    })();
  }, [q]);

  return (
    <div
      className="page-fade-in pt-16 pb-32 px-6 md:px-12 max-w-5xl mx-auto"
      data-testid="search-page"
    >
      <div className="mb-10">
        <div className="text-xs font-mono uppercase tracking-[0.3em] text-neutral-400 mb-3">
          Search
        </div>
        <h1 className="font-display text-4xl md:text-5xl font-black tracking-tighter flex items-center gap-3">
          <Search size={32} strokeWidth={1.5} />
          {q || "Type to search"}
        </h1>
        <p className="mt-2 text-neutral-500 text-sm">
          {loading
            ? "Searching…"
            : `${results.folders.length} folders · ${results.items.length} documents & notes`}
        </p>
      </div>

      {results.folders.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
            Folders
          </h2>
          <div className="space-y-1">
            {results.folders.map((f) => (
              <Link
                key={f.id}
                to={`/c/${f.category}/folder/${f.id}`}
                className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 border border-transparent hover:border-neutral-200"
                data-testid={`search-folder-${f.id}`}
              >
                <Folder size={16} strokeWidth={1.5} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{f.name}</div>
                  <div className="text-xs text-neutral-500">
                    {CATEGORY_BY_ID[f.category]?.name}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {results.items.length > 0 && (
        <section>
          <h2 className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-500 mb-3 border-b border-neutral-200 pb-2">
            Documents & Notes
          </h2>
          <div className="space-y-1">
            {results.items.map((i) => {
              const link =
                i.type === "note"
                  ? `/c/${i.category}/note/${i.id}`
                  : i.type === "file"
                    ? `/c/${i.category}/file/${i.id}`
                    : null;
              const Icon =
                i.type === "note"
                  ? StickyNote
                  : i.type === "file"
                    ? FileText
                    : ExternalLink;
              const inner = (
                <>
                  <Icon size={16} strokeWidth={1.5} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{i.title}</div>
                    <div className="text-xs text-neutral-500 truncate">
                      {CATEGORY_BY_ID[i.category]?.name} · {i.type === "file" ? FILE_EXT_LABEL[i.ext] || "FILE" : i.type}
                    </div>
                  </div>
                </>
              );
              if (link)
                return (
                  <Link
                    key={i.id}
                    to={link}
                    className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 border border-transparent hover:border-neutral-200"
                    data-testid={`search-item-${i.id}`}
                  >
                    {inner}
                  </Link>
                );
              return (
                <a
                  key={i.id}
                  href={i.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2 hover:bg-neutral-50 border border-transparent hover:border-neutral-200"
                  data-testid={`search-item-${i.id}`}
                >
                  {inner}
                </a>
              );
            })}
          </div>
        </section>
      )}

      {!loading && q && results.folders.length === 0 && results.items.length === 0 && (
        <div
          className="border-2 border-dashed border-neutral-200 p-16 text-center text-neutral-500"
          data-testid="search-no-results"
        >
          No results for "{q}"
        </div>
      )}
    </div>
  );
}
