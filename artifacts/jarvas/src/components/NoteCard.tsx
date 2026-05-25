import { useState } from "react";
import { ExternalLink, Pencil, Trash2 } from "lucide-react";
import type { Note, NoteType } from "@/lib/kbApi";
import { TYPE_COLORS, TYPE_LABELS, TYPE_EMOJIS, CATEGORY_LABELS } from "@/lib/kbApi";

interface Props {
  note: Note;
  onEdit: (note: Note) => void;
  onDelete: (noteId: string) => void;
  searchQuery?: string;
}

/** Highlight matched query terms in a text snippet */
function highlight(text: string, query?: string): React.ReactNode {
  if (!query?.trim()) return text;
  const words = query.trim().split(/\s+/).filter((w) => w.length > 2);
  if (!words.length) return text;
  const regex = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  const parts = text.split(regex);
  return parts.map((part, i) =>
    regex.test(part)
      ? <mark key={i} style={{ background: "hsl(194 100% 55% / 0.25)", color: "hsl(194 100% 80%)", borderRadius: "2px" }}>{part}</mark>
      : part
  );
}

const SOURCE_BADGE: Record<string, { label: string; color: string } | undefined> = {
  safari:   { label: "Safari",   color: "hsl(38 100% 60%)" },
  shortcut: { label: "Shortcut", color: "hsl(264 80% 70%)" },
  chat:     { label: "Chat",     color: "hsl(194 100% 55%)" },
};

export default function NoteCard({ note, onEdit, onDelete, searchQuery }: Props) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const typeColor = TYPE_COLORS[note.type as NoteType];
  const excerpt = note.content.length > 180
    ? note.content.slice(0, 180).trim() + "…"
    : note.content;

  const relDate = (() => {
    const d = new Date(note.updatedAt);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days}d ago`;
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  })();

  const sourceBadge = SOURCE_BADGE[note.source];

  return (
    <div
      className="group relative flex flex-col gap-2.5 rounded-2xl border p-4 transition-all duration-200 hover:border-white/10"
      style={{
        background: "hsl(220 20% 7%)",
        borderColor: "hsl(210 15% 20%)",
        borderTopColor: typeColor,
        borderTopWidth: "2px",
      }}
    >
      {/* Actions */}
      <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(note)}
          className="rounded-lg p-1.5 hover:bg-white/5 transition-colors"
          style={{ color: "hsl(194 100% 55%)" }}
          title="Edit note"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
        {confirmDelete ? (
          <button
            onClick={() => { onDelete(note.id); setConfirmDelete(false); }}
            className="rounded-lg px-2 py-1 text-xs font-semibold transition-colors"
            style={{ background: "hsl(355 80% 60% / 0.2)", color: "hsl(355 80% 65%)" }}
          >
            Sure?
          </button>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            onBlur={() => setTimeout(() => setConfirmDelete(false), 300)}
            className="rounded-lg p-1.5 hover:bg-red-500/10 transition-colors"
            style={{ color: "hsl(355 80% 60%)" }}
            title="Delete note"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Header: type + category */}
      <div className="flex items-center gap-2 pr-16">
        <span className="text-sm">{TYPE_EMOJIS[note.type as NoteType]}</span>
        <span
          className="rounded px-1.5 py-0.5 text-xs font-semibold"
          style={{ color: typeColor, background: `${typeColor}18` }}
        >
          {TYPE_LABELS[note.type as NoteType]}
        </span>
        <span className="text-xs text-muted-foreground">
          {CATEGORY_LABELS[note.category as keyof typeof CATEGORY_LABELS]}
        </span>
        {sourceBadge && (
          <span
            className="ml-auto rounded px-1.5 py-0.5 text-xs"
            style={{ color: sourceBadge.color, background: `${sourceBadge.color}18` }}
          >
            {sourceBadge.label}
          </span>
        )}
      </div>

      {/* Title */}
      <h3 className="text-sm font-semibold leading-snug" style={{ color: "hsl(196 80% 88%)" }}>
        {highlight(note.title, searchQuery)}
      </h3>

      {/* Content preview */}
      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-3">
        {highlight(excerpt, searchQuery)}
      </p>

      {/* URL */}
      {note.url && (
        <a
          href={note.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs transition-colors hover:opacity-80 truncate"
          style={{ color: "hsl(194 100% 55%)" }}
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{note.url}</span>
        </a>
      )}

      {/* Tags */}
      {note.tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full px-2 py-0.5 text-xs"
              style={{ background: "hsl(194 100% 55% / 0.08)", color: "hsl(194 100% 60%)" }}
            >
              #{tag}
            </span>
          ))}
        </div>
      )}

      {/* Footer */}
      <p className="text-xs text-muted-foreground mt-auto">{relDate}</p>
    </div>
  );
}
