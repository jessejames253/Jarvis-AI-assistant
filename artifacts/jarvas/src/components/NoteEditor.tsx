import { useState, useEffect } from "react";
import { X, Save, BookOpen } from "lucide-react";
import type { Note, NoteType, NoteCategory } from "@/lib/kbApi";
import { TYPE_LABELS, CATEGORY_LABELS } from "@/lib/kbApi";

interface Props {
  isOpen: boolean;
  note?: Note | null;       // null/undefined = create mode, Note = edit mode
  onClose: () => void;
  onSave: (data: {
    title: string;
    content: string;
    type: NoteType;
    category: NoteCategory;
    tags: string[];
    url?: string;
  }) => Promise<void>;
}

const NOTE_TYPES: NoteType[] = ["note", "research", "fact"];
const CATEGORIES: NoteCategory[] = ["personal", "work", "coding", "ideas", "research", "other"];

const TYPE_COLORS: Record<NoteType, string> = {
  note:     "hsl(194 100% 55%)",
  research: "hsl(264 80% 70%)",
  fact:     "hsl(38 100% 60%)",
};

export default function NoteEditor({ isOpen, note, onClose, onSave }: Props) {
  const [title, setTitle]       = useState("");
  const [content, setContent]   = useState("");
  const [type, setType]         = useState<NoteType>("note");
  const [category, setCategory] = useState<NoteCategory>("personal");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags]         = useState<string[]>([]);
  const [url, setUrl]           = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");

  // Populate form when editing an existing note
  useEffect(() => {
    if (note) {
      setTitle(note.title);
      setContent(note.content);
      setType(note.type as NoteType);
      setCategory(note.category as NoteCategory);
      setTags(note.tags);
      setUrl(note.url ?? "");
    } else {
      setTitle(""); setContent(""); setType("note");
      setCategory("personal"); setTags([]); setUrl(""); setTagInput("");
    }
    setError("");
  }, [note, isOpen]);

  if (!isOpen) return null;

  const isEdit = !!note;

  const addTag = () => {
    const raw = tagInput.trim().toLowerCase().replace(/[^a-z0-9\-]/g, "");
    if (raw && !tags.includes(raw)) setTags((prev) => [...prev, raw]);
    setTagInput("");
  };

  const removeTag = (tag: string) => setTags((prev) => prev.filter((t) => t !== tag));

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); }
    if (e.key === "Backspace" && !tagInput && tags.length) {
      setTags((prev) => prev.slice(0, -1));
    }
  };

  const handleClose = () => { setError(""); onClose(); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setError("Title is required"); return; }
    if (!content.trim()) { setError("Content is required"); return; }
    setLoading(true); setError("");
    try {
      await onSave({
        title: title.trim(),
        content: content.trim(),
        type, category, tags,
        url: url.trim() || undefined,
      });
      handleClose();
    } catch {
      setError("Failed to save note. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = "w-full rounded-xl border bg-background px-3 py-2.5 text-sm outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground";
  const inputStyle = { borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />

      <div
        className="relative z-10 w-full sm:max-w-xl rounded-t-2xl sm:rounded-2xl border shadow-2xl flex flex-col"
        style={{
          background: "hsl(220 20% 8%)",
          borderColor: "hsl(194 100% 55% / 0.3)",
          maxHeight: "90vh",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 pt-5 pb-4 border-b flex-shrink-0" style={{ borderColor: "hsl(210 15% 18%)" }}>
          <BookOpen className="w-4 h-4" style={{ color: "hsl(194 100% 60%)" }} />
          <h2 className="font-display font-bold tracking-widest text-sm" style={{ color: "hsl(194 100% 60%)" }}>
            {isEdit ? "EDIT NOTE" : "ADD TO KNOWLEDGE BASE"}
          </h2>
          <button onClick={handleClose} className="ml-auto rounded-lg p-1 hover:bg-white/5 transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Form body — scrollable */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 overflow-y-auto px-5 py-4">

          {/* Type pills */}
          <div className="flex gap-2">
            {NOTE_TYPES.map((t) => (
              <button
                key={t} type="button"
                onClick={() => setType(t)}
                className="flex-1 rounded-xl border py-2 text-xs font-semibold tracking-wider transition-all duration-150"
                style={{
                  borderColor: type === t ? TYPE_COLORS[t] : "hsl(210 15% 22%)",
                  background: type === t ? `${TYPE_COLORS[t]}18` : "transparent",
                  color: type === t ? TYPE_COLORS[t] : "hsl(196 40% 45%)",
                }}
              >
                {TYPE_LABELS[t]}
              </button>
            ))}
          </div>

          {/* Title */}
          <div>
            <label className="mb-1 block text-xs tracking-wider text-muted-foreground">TITLE</label>
            <input
              autoFocus
              type="text"
              placeholder="Note title…"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </div>

          {/* Content */}
          <div>
            <label className="mb-1 block text-xs tracking-wider text-muted-foreground">CONTENT</label>
            <textarea
              placeholder={
                type === "research" ? "Paste research notes, key points, or a summary…"
                : type === "fact"   ? "State the fact clearly and concisely…"
                :                    "Your note content…"
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              className={`${inputCls} resize-none`}
              style={inputStyle}
            />
          </div>

          {/* URL (for research links) */}
          {(type === "research" || url) && (
            <div>
              <label className="mb-1 block text-xs tracking-wider text-muted-foreground">
                URL <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <input
                type="url"
                placeholder="https://…"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                className={inputCls}
                style={inputStyle}
              />
            </div>
          )}

          {/* Category */}
          <div>
            <label className="mb-1 block text-xs tracking-wider text-muted-foreground">CATEGORY</label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => (
                <button
                  key={c} type="button"
                  onClick={() => setCategory(c)}
                  className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150"
                  style={{
                    borderWidth: 1, borderStyle: "solid",
                    borderColor: category === c ? "hsl(194 100% 55% / 0.5)" : "hsl(210 15% 22%)",
                    background: category === c ? "hsl(194 100% 55% / 0.12)" : "transparent",
                    color: category === c ? "hsl(194 100% 65%)" : "hsl(196 30% 45%)",
                  }}
                >
                  {CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="mb-1 block text-xs tracking-wider text-muted-foreground">TAGS</label>
            <div
              className="flex flex-wrap items-center gap-1.5 rounded-xl border p-2 cursor-text"
              style={{ borderColor: "hsl(210 15% 22%)", minHeight: "42px" }}
              onClick={() => document.getElementById("tag-input")?.focus()}
            >
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs"
                  style={{ background: "hsl(194 100% 55% / 0.12)", color: "hsl(194 100% 65%)" }}
                >
                  #{tag}
                  <button type="button" onClick={() => removeTag(tag)} className="opacity-60 hover:opacity-100">×</button>
                </span>
              ))}
              <input
                id="tag-input"
                type="text"
                placeholder={tags.length ? "" : "Add tags (Enter to add)…"}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value.replace(/,/g, ""))}
                onKeyDown={handleTagKeyDown}
                onBlur={addTag}
                className="flex-1 min-w-[80px] bg-transparent outline-none text-xs placeholder:text-muted-foreground"
                style={{ color: "hsl(196 80% 85%)" }}
              />
            </div>
          </div>

          {/* Research link button for non-research types */}
          {type !== "research" && !url && (
            <button
              type="button"
              onClick={() => setType("research")}
              className="text-xs text-left underline decoration-dotted"
              style={{ color: "hsl(194 100% 50%)" }}
            >
              + Add a URL link
            </button>
          )}

          {error && <p className="text-xs" style={{ color: "hsl(355 80% 65%)" }}>{error}</p>}
        </form>

        {/* Footer */}
        <div className="flex gap-3 px-5 pb-5 pt-3 flex-shrink-0 border-t" style={{ borderColor: "hsl(210 15% 18%)" }}>
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 rounded-xl border py-2.5 text-sm font-medium transition-colors hover:bg-white/5"
            style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 40% 50%)" }}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={loading || !title.trim() || !content.trim()}
            className="flex-1 flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold tracking-wider transition-all disabled:opacity-40 disabled:cursor-not-allowed glow-primary"
            style={{ background: "hsl(194 100% 55%)", color: "hsl(220 20% 6%)" }}
          >
            <Save className="w-3.5 h-3.5" />
            {loading ? "SAVING…" : isEdit ? "UPDATE" : "SAVE NOTE"}
          </button>
        </div>
      </div>
    </div>
  );
}
