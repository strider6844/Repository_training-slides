import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import { API } from "../lib/api";
import { FILE_EXT_LABEL } from "../lib/categories";
import { Library, Download, ExternalLink, Lock, FileText } from "lucide-react";

export default function PublicItemPage() {
  const { slug } = useParams();
  const [item, setItem] = useState(null);
  const [error, setError] = useState(null);
  const [blobUrl, setBlobUrl] = useState(null);

  useEffect(() => {
    let revoke;
    (async () => {
      try {
        const { data } = await axios.get(`${API}/public/items/${slug}`);
        setItem(data);
        if (data.type === "file") {
          const resp = await axios.get(`${API}/public/items/${slug}/download`, {
            responseType: "blob",
          });
          const url = URL.createObjectURL(resp.data);
          revoke = url;
          setBlobUrl(url);
        }
      } catch (err) {
        setError(err.response?.data?.detail || "Not found");
      }
    })();
    return () => {
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [slug]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <Lock size={32} strokeWidth={1.5} className="mb-3 text-neutral-400" />
        <h1 className="font-display text-2xl font-black tracking-tighter">
          Link unavailable
        </h1>
        <p className="text-sm text-neutral-500 mt-2 max-w-md">{error}</p>
        <Link
          to="/"
          className="mt-6 text-sm underline underline-offset-4"
          data-testid="public-go-home"
        >
          Go to Slidevault
        </Link>
      </div>
    );
  }

  if (!item) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-neutral-400">
        Loading…
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white" data-testid="public-item-page">
      <header className="border-b border-neutral-200 px-6 md:px-12 py-4 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" data-testid="public-logo">
          <Library size={20} strokeWidth={1.5} />
          <span className="font-display font-black tracking-tighter">Slidevault</span>
        </Link>
        <div className="text-[10px] font-mono uppercase tracking-[0.25em] text-neutral-400">
          Shared · read only
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 md:px-12 py-10 page-fade-in">
        <div className="mb-6">
          <div className="text-xs font-mono uppercase tracking-[0.2em] text-neutral-400 mb-2">
            {item.type === "file"
              ? FILE_EXT_LABEL[item.ext] || "Document"
              : item.type === "note"
                ? "Note"
                : "Link"}
          </div>
          <h1 className="font-display text-3xl md:text-5xl font-black tracking-tighter">
            {item.title}
          </h1>
        </div>

        {item.type === "file" && (
          <>
            <div className="flex gap-2 mb-6">
              {blobUrl && (
                <a
                  href={blobUrl}
                  download={item.original_filename}
                  className="bg-[#0A0A0A] text-white px-4 py-2 text-sm flex items-center gap-2"
                  data-testid="public-download-button"
                >
                  <Download size={14} /> Download
                </a>
              )}
            </div>
            <div
              className="border border-neutral-200 bg-neutral-50 overflow-hidden"
              style={{ height: "78vh" }}
            >
              {!blobUrl ? (
                <div className="h-full flex items-center justify-center text-sm text-neutral-400">
                  Loading file…
                </div>
              ) : item.ext === "pdf" ? (
                <iframe
                  src={blobUrl}
                  title={item.title}
                  className="w-full h-full"
                  data-testid="public-pdf-iframe"
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-3 p-8 text-center">
                  <FileText size={32} strokeWidth={1.5} />
                  <div className="font-display text-lg font-bold">
                    Preview not available in browser
                  </div>
                  <a
                    href={blobUrl}
                    download={item.original_filename}
                    className="bg-[#0A0A0A] text-white px-4 py-2 text-sm flex items-center gap-2"
                  >
                    <Download size={14} /> Download
                  </a>
                </div>
              )}
            </div>
          </>
        )}

        {item.type === "note" && (
          <div data-testid="public-note-content">
            <PublicNoteRender blocks={item.blocks || []} />
          </div>
        )}

        {item.type === "link" && (
          <div className="border border-neutral-200 bg-white p-6">
            {item.link_image && (
              <div className="h-48 w-full overflow-hidden mb-4 border border-neutral-200">
                <img src={item.link_image} alt="" className="w-full h-full object-cover" />
              </div>
            )}
            <div className="text-lg font-medium mb-2">{item.link_title || item.title}</div>
            {item.link_description && (
              <p className="text-sm text-neutral-600 mb-4">{item.link_description}</p>
            )}
            <a
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm inline-flex items-center gap-2"
              data-testid="public-open-link"
            >
              <ExternalLink size={14} /> Open link
            </a>
          </div>
        )}

        <div className="mt-12 text-center text-xs font-mono uppercase tracking-[0.25em] text-neutral-400 border-t border-neutral-100 pt-6">
          Shared via Slidevault
        </div>
      </div>
    </div>
  );
}

function PublicNoteRender({ blocks }) {
  return (
    <article className="prose-like space-y-2">
      {blocks.map((b, i) => {
        const key = b.id || i;
        if (b.type === "h1")
          return (
            <h2 key={key} className="font-display text-3xl font-black tracking-tighter mt-6">
              {b.content}
            </h2>
          );
        if (b.type === "h2")
          return (
            <h3 key={key} className="font-display text-2xl font-bold mt-5">
              {b.content}
            </h3>
          );
        if (b.type === "h3")
          return (
            <h4 key={key} className="font-display text-xl font-semibold mt-4">
              {b.content}
            </h4>
          );
        if (b.type === "bullet")
          return (
            <div key={key} className="flex items-baseline gap-2">
              <span>•</span>
              <span>{b.content}</span>
            </div>
          );
        if (b.type === "numbered")
          return (
            <div key={key} className="flex items-baseline gap-2">
              <span>{i + 1}.</span>
              <span>{b.content}</span>
            </div>
          );
        if (b.type === "todo")
          return (
            <div key={key} className="flex items-baseline gap-2">
              <input type="checkbox" checked={!!b.checked} readOnly />
              <span className={b.checked ? "line-through text-neutral-400" : ""}>
                {b.content}
              </span>
            </div>
          );
        if (b.type === "quote")
          return (
            <blockquote
              key={key}
              className="border-l-4 border-[#0A0A0A] pl-4 py-1 my-4 bg-neutral-50 text-lg italic"
            >
              {b.content}
            </blockquote>
          );
        if (b.type === "code")
          return (
            <pre
              key={key}
              className="bg-[#0A0A0A] text-white p-4 font-mono text-sm overflow-x-auto my-3"
            >
              {b.content}
            </pre>
          );
        if (b.type === "callout")
          return (
            <div
              key={key}
              className="border border-neutral-200 bg-neutral-50 p-3 my-3"
            >
              {b.content}
            </div>
          );
        if (b.type === "divider")
          return (
            <hr
              key={key}
              className="my-6 border-t border-dashed border-neutral-300"
            />
          );
        if (b.type === "embed")
          return (
            <a
              key={key}
              href={b.content}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-700 underline underline-offset-4 block my-2"
            >
              {b.content}
            </a>
          );
        if (b.type === "table" && b.rows) {
          return (
            <table key={key} className="border-collapse my-3">
              <tbody>
                {b.rows.map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td
                        key={ci}
                        className="border border-neutral-300 px-3 py-1 text-sm min-w-[120px]"
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          );
        }
        return (
          <p key={key} className="text-sm leading-relaxed">
            {b.content}
          </p>
        );
      })}
    </article>
  );
}
