import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { formatApiError } from "../lib/api";
import { CATEGORY_BY_ID, FILE_EXT_LABEL } from "../lib/categories";
import { ChevronLeft, Download, Sparkles, RotateCw, X } from "lucide-react";
import { toast } from "sonner";

function renderMarkdown(md) {
  if (!md) return null;
  // Lightweight MD: headings, bullets, numbered, bold
  const lines = md.split("\n");
  const out = [];
  let listBuf = null;
  let listType = null;
  const flushList = () => {
    if (!listBuf) return;
    const Tag = listType === "ol" ? "ol" : "ul";
    out.push(
      <Tag
        key={`l-${out.length}`}
        className={
          listType === "ol"
            ? "list-decimal pl-6 my-2 space-y-1 text-sm"
            : "list-disc pl-6 my-2 space-y-1 text-sm"
        }
      >
        {listBuf.map((item, i) => (
          <li key={i} dangerouslySetInnerHTML={{ __html: inline(item) }} />
        ))}
      </Tag>
    );
    listBuf = null;
    listType = null;
  };
  const inline = (t) =>
    t
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, '<code class="font-mono bg-neutral-100 px-1 py-0.5 text-xs">$1</code>');

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^##\s+/.test(line)) {
      flushList();
      out.push(
        <h3
          key={`h2-${out.length}`}
          className="font-display text-lg font-bold tracking-tight mt-5 mb-2 border-b border-neutral-200 pb-1"
        >
          {line.replace(/^##\s+/, "")}
        </h3>
      );
    } else if (/^#\s+/.test(line)) {
      flushList();
      out.push(
        <h2 key={`h1-${out.length}`} className="font-display text-xl font-bold mt-5 mb-2">
          {line.replace(/^#\s+/, "")}
        </h2>
      );
    } else if (/^[-*]\s+/.test(line)) {
      if (listType !== "ul") flushList();
      listType = "ul";
      listBuf = listBuf || [];
      listBuf.push(line.replace(/^[-*]\s+/, ""));
    } else if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") flushList();
      listType = "ol";
      listBuf = listBuf || [];
      listBuf.push(line.replace(/^\d+\.\s+/, ""));
    } else if (line.trim() === "") {
      flushList();
    } else {
      flushList();
      out.push(
        <p
          key={`p-${out.length}`}
          className="text-sm leading-relaxed my-2"
          dangerouslySetInnerHTML={{ __html: inline(line) }}
        />
      );
    }
  }
  flushList();
  return out;
}

export default function FileViewerPage() {
  const { categoryId, itemId } = useParams();
  const category = CATEGORY_BY_ID[categoryId];
  const [item, setItem] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summary, setSummary] = useState(null);
  const [summarizing, setSummarizing] = useState(false);

  useEffect(() => {
    let revoke;
    (async () => {
      try {
        const { data } = await api.get(`/items/${itemId}`);
        setItem(data);
        if (data.ai_summary) setSummary(data.ai_summary);
        const resp = await api.get(`/files/${itemId}/download`, {
          responseType: "blob",
        });
        const url = URL.createObjectURL(resp.data);
        revoke = url;
        setBlobUrl(url);
      } catch (err) {
        toast.error(formatApiError(err));
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [itemId]);

  const summarize = async (force = false) => {
    setSummarizing(true);
    setSummaryOpen(true);
    try {
      if (force) {
        await api.delete(`/items/${itemId}/summary`);
        setSummary(null);
      }
      const { data } = await api.post(`/items/${itemId}/summarize`);
      setSummary(data.summary);
      if (!data.cached) toast.success("Summary generated");
    } catch (err) {
      toast.error(formatApiError(err));
      if (!summary) setSummaryOpen(false);
    } finally {
      setSummarizing(false);
    }
  };

  if (!item) {
    return <div className="p-12 text-sm text-neutral-400">Loading…</div>;
  }

  const isPdf = item.ext === "pdf";

  return (
    <div className="page-fade-in pt-8 pb-12 px-6 md:px-12 max-w-7xl mx-auto" data-testid="file-viewer-page">
      <div className="flex items-center justify-between mb-6">
        <Link
          to={
            item.folder_id
              ? `/c/${categoryId}/folder/${item.folder_id}`
              : `/c/${categoryId}`
          }
          className="flex items-center gap-2 text-sm text-neutral-500 hover:text-[#0A0A0A]"
          data-testid="file-back-link"
        >
          <ChevronLeft size={14} /> Back to {category?.short}
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={() => summarize(false)}
            disabled={summarizing}
            className="bg-white border border-[#0A0A0A] text-[#0A0A0A] px-4 py-2 text-sm flex items-center gap-2 hover:bg-neutral-50 disabled:opacity-50"
            data-testid="file-summarize-button"
          >
            <Sparkles size={14} />{" "}
            {summarizing
              ? "Summarising…"
              : summary
                ? "View AI Summary"
                : "AI Summary"}
          </button>
          {blobUrl && (
            <a
              href={blobUrl}
              download={item.original_filename}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm flex items-center gap-2 hover:bg-neutral-800"
              data-testid="file-download-button"
            >
              <Download size={14} /> Download
            </a>
          )}
        </div>
      </div>

      <div className="mb-6">
        <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mb-2">
          {FILE_EXT_LABEL[item.ext] || "File"}
        </div>
        <h1 className="font-display text-3xl md:text-4xl font-black tracking-tighter">
          {item.title}
        </h1>
        <div className="text-sm text-neutral-500 mt-2">
          {item.original_filename} · uploaded{" "}
          {new Date(item.created_at).toLocaleDateString()}
        </div>
      </div>

      <div
        className={`grid gap-6 ${summaryOpen ? "lg:grid-cols-[1fr_22rem]" : "grid-cols-1"}`}
      >
        <div className="border border-neutral-200 bg-neutral-50 overflow-hidden" style={{ height: "75vh" }}>
          {!blobUrl ? (
            <div className="h-full flex items-center justify-center text-sm text-neutral-400">
              Loading file…
            </div>
          ) : isPdf ? (
            <iframe
              src={blobUrl}
              title={item.title}
              className="w-full h-full"
              data-testid="file-pdf-iframe"
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="w-16 h-20 bg-white border border-neutral-200 flex items-center justify-center font-mono font-bold text-neutral-700">
                {FILE_EXT_LABEL[item.ext]}
              </div>
              <div className="font-display text-xl font-bold">
                Preview not available in browser
              </div>
              <p className="text-sm text-neutral-500 max-w-sm">
                Download the file to open in Microsoft Office or your preferred editor.
              </p>
              <a
                href={blobUrl}
                download={item.original_filename}
                className="bg-[#0A0A0A] text-white px-4 py-2 text-sm flex items-center gap-2 mt-3"
                data-testid="file-download-fallback"
              >
                <Download size={14} /> Download {FILE_EXT_LABEL[item.ext]}
              </a>
            </div>
          )}
        </div>

        {summaryOpen && (
          <aside
            className="border border-neutral-200 bg-white overflow-hidden flex flex-col"
            style={{ maxHeight: "75vh" }}
            data-testid="ai-summary-panel"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 bg-[#0A0A0A] text-white">
              <div className="flex items-center gap-2">
                <Sparkles size={14} />
                <span className="text-xs font-mono uppercase tracking-[0.2em]">
                  AI Summary
                </span>
              </div>
              <div className="flex items-center gap-1">
                {summary && !summarizing && (
                  <button
                    onClick={() => summarize(true)}
                    className="p-1 hover:bg-neutral-800 rounded-sm"
                    title="Regenerate"
                    data-testid="ai-summary-regenerate"
                  >
                    <RotateCw size={13} />
                  </button>
                )}
                <button
                  onClick={() => setSummaryOpen(false)}
                  className="p-1 hover:bg-neutral-800 rounded-sm"
                  data-testid="ai-summary-close"
                >
                  <X size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-5">
              {summarizing ? (
                <div className="space-y-2 animate-pulse" data-testid="ai-summary-loading">
                  <div className="h-3 bg-neutral-200 w-3/4"></div>
                  <div className="h-3 bg-neutral-200 w-full"></div>
                  <div className="h-3 bg-neutral-200 w-5/6"></div>
                  <div className="h-3 bg-neutral-200 w-2/3 mt-4"></div>
                  <div className="h-3 bg-neutral-200 w-full"></div>
                  <p className="text-xs text-neutral-400 font-mono uppercase tracking-[0.2em] pt-3">
                    Claude is reading the deck…
                  </p>
                </div>
              ) : summary ? (
                <div data-testid="ai-summary-content">{renderMarkdown(summary)}</div>
              ) : (
                <p className="text-sm text-neutral-500">No summary yet.</p>
              )}
            </div>
            <div className="px-4 py-2 border-t border-neutral-200 text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-400">
              Powered by Claude Sonnet 4.5
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
