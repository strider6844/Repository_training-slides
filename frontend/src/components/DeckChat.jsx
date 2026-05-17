import { useEffect, useRef, useState } from "react";
import api, { formatApiError } from "../lib/api";
import { Send, Trash2, Sparkles, User } from "lucide-react";
import { toast } from "sonner";

function renderInline(s) {
  // bold, code, links
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, '<code class="font-mono bg-neutral-100 px-1 text-xs">$1</code>')
    .replace(/\n/g, "<br/>");
}

export default function DeckChat({ itemId }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef(null);

  const load = async () => {
    try {
      const { data } = await api.get(`/items/${itemId}/chat`);
      setMessages(data.messages || []);
      setLoaded(true);
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  const send = async (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    // Optimistic user message
    setMessages((m) => [...m, { role: "user", content: text, ts: new Date().toISOString() }]);
    setSending(true);
    try {
      const { data } = await api.post(`/items/${itemId}/chat`, { message: text });
      setMessages(data.messages);
    } catch (err) {
      toast.error(formatApiError(err));
      setMessages((m) => m.slice(0, -1)); // roll back optimistic
    } finally {
      setSending(false);
    }
  };

  const clear = async () => {
    try {
      await api.delete(`/items/${itemId}/chat`);
      setMessages([]);
      toast.success("Chat cleared");
    } catch (err) {
      toast.error(formatApiError(err));
    }
  };

  return (
    <div className="flex flex-col h-full" data-testid="deck-chat">
      <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-200">
        <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-neutral-500">
          {messages.length} message{messages.length === 1 ? "" : "s"}
        </div>
        {messages.length > 0 && (
          <button
            onClick={clear}
            className="text-xs text-neutral-500 hover:text-red-600 flex items-center gap-1"
            data-testid="chat-clear-button"
          >
            <Trash2 size={12} /> Clear
          </button>
        )}
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
        data-testid="chat-messages"
      >
        {!loaded ? (
          <div className="text-sm text-neutral-400">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-neutral-500 py-8 text-center">
            <Sparkles size={18} strokeWidth={1.5} className="mx-auto mb-2 text-neutral-400" />
            Ask anything about this deck.
            <br />
            <span className="text-xs text-neutral-400">
              e.g. "What are the three pillars covered here?"
            </span>
          </div>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}
              data-testid={`chat-message-${m.role}`}
            >
              {m.role === "assistant" && (
                <div className="w-6 h-6 bg-[#0A0A0A] text-white flex items-center justify-center flex-shrink-0">
                  <Sparkles size={11} />
                </div>
              )}
              <div
                className={`max-w-[85%] px-3 py-2 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-[#0A0A0A] text-white"
                    : "bg-neutral-100 text-neutral-900"
                }`}
                dangerouslySetInnerHTML={{ __html: renderInline(m.content) }}
              />
              {m.role === "user" && (
                <div className="w-6 h-6 bg-neutral-300 text-neutral-700 flex items-center justify-center flex-shrink-0">
                  <User size={11} />
                </div>
              )}
            </div>
          ))
        )}
        {sending && (
          <div className="flex gap-2 justify-start" data-testid="chat-sending">
            <div className="w-6 h-6 bg-[#0A0A0A] text-white flex items-center justify-center flex-shrink-0">
              <Sparkles size={11} />
            </div>
            <div className="bg-neutral-100 px-3 py-2 text-sm text-neutral-500 italic">
              Thinking…
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="border-t border-neutral-200 p-3 flex items-stretch gap-1"
        data-testid="chat-input-form"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about this deck…"
          className="flex-1 border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:border-[#0A0A0A]"
          disabled={sending}
          data-testid="chat-input"
        />
        <button
          type="submit"
          disabled={!input.trim() || sending}
          className="bg-[#0A0A0A] text-white px-3 hover:bg-neutral-800 disabled:opacity-50 flex items-center"
          data-testid="chat-send-button"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}
