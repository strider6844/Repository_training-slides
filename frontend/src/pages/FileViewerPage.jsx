import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api, { API, formatApiError } from "../lib/api";
import { CATEGORY_BY_ID, FILE_EXT_LABEL } from "../lib/categories";
import { ChevronLeft, Download, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export default function FileViewerPage() {
  const { categoryId, itemId } = useParams();
  const category = CATEGORY_BY_ID[categoryId];
  const [item, setItem] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let revoke;
    (async () => {
      try {
        const { data } = await api.get(`/items/${itemId}`);
        setItem(data);
        // Fetch the file as blob (auth via cookie)
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

  if (!item) {
    return <div className="p-12 text-sm text-neutral-400">Loading…</div>;
  }

  const isPdf = item.ext === "pdf";

  return (
    <div className="page-fade-in pt-8 pb-12 px-6 md:px-12 max-w-6xl mx-auto" data-testid="file-viewer-page">
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
    </div>
  );
}
