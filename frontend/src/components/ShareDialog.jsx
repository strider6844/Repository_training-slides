import { useEffect, useState } from "react";
import api, { formatApiError } from "../lib/api";
import { Share2, Copy, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";

export default function ShareDialog({ open, onOpenChange, itemId, initialSlug, initialEnabled }) {
  const [slug, setSlug] = useState(initialSlug || null);
  const [enabled, setEnabled] = useState(!!initialEnabled);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setSlug(initialSlug || null);
      setEnabled(!!initialEnabled);
      setCopied(false);
    }
  }, [open, initialSlug, initialEnabled]);

  const shareUrl = slug ? `${window.location.origin}/s/${slug}` : "";

  const enable = async () => {
    setLoading(true);
    try {
      const { data } = await api.post(`/items/${itemId}/share`);
      setSlug(data.slug);
      setEnabled(true);
      toast.success("Share link enabled");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const disable = async () => {
    setLoading(true);
    try {
      await api.delete(`/items/${itemId}/share`);
      setEnabled(false);
      toast.success("Share link disabled");
    } catch (err) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="share-dialog">
        <DialogHeader>
          <DialogTitle className="font-display tracking-tight flex items-center gap-2">
            <Share2 size={18} /> Share publicly
          </DialogTitle>
          <DialogDescription>
            Anyone with the link can view this item read-only. No sign-in needed.
          </DialogDescription>
        </DialogHeader>

        {!enabled ? (
          <div className="py-2">
            <button
              onClick={enable}
              disabled={loading}
              className="bg-[#0A0A0A] text-white px-4 py-2 text-sm disabled:opacity-50"
              data-testid="share-enable-button"
            >
              {loading ? "Working…" : "Generate share link"}
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-stretch gap-1 border border-neutral-200 bg-white">
              <input
                value={shareUrl}
                readOnly
                className="flex-1 bg-transparent px-3 py-2 text-sm font-mono focus:outline-none"
                data-testid="share-url-input"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={copy}
                className="bg-[#0A0A0A] text-white px-3 text-xs font-mono uppercase tracking-[0.15em] hover:bg-neutral-800 flex items-center gap-1"
                data-testid="share-copy-button"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <button
              onClick={disable}
              disabled={loading}
              className="text-sm text-red-600 hover:underline flex items-center gap-1"
              data-testid="share-disable-button"
            >
              <X size={12} /> Disable share link
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
