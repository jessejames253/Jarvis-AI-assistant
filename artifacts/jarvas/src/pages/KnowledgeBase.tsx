/**
 * pages/KnowledgeBase.tsx — Jarvis personal Knowledge Base
 *
 * Features:
 *   - Create notes, research links, and facts
 *   - Full-text search across all notes
 *   - Filter by type / category / tag
 *   - Edit and delete notes
 *   - Source badges for notes saved from Safari or iOS Shortcuts
 *   - Mobile-friendly responsive layout
 *
 * iOS Shortcuts integration:
 *   Your session ID (shown in the header) can be used in an iOS Shortcut
 *   to POST directly to /api/kb and save notes from any app.
 */

import { useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare, Plus, Search, BookOpen,
  X, SlidersHorizontal, Smartphone,
} from "lucide-react";
import NoteCard from "@/components/NoteCard";
import NoteEditor from "@/components/NoteEditor";
import {
  fetchNotes, createNote, updateNote, deleteNote, fetchKBStats,
  type Note, type NoteType, type NoteCategory,
  TYPE_LABELS, TYPE_COLORS, CATEGORY_LABELS,
} from "@/lib/kbApi";

// ─── Session ──────────────────────────────────────────────────────────────────

const SESSION_KEY = "jarvas_session_id";
function getSessionId(): string {
  return localStorage.getItem(SESSION_KEY) ?? "default";
}

// ─── Filter types ─────────────────────────────────────────────────────────────

type TypeFilter = NoteType | "all";
type CategoryFilter = NoteCategory | "all";

const TYPE_OPTIONS: { value: TypeFilter; label: string }[] = [
  { value: "all",      label: "All" },
  { value: "note",     label: "Notes" },
  { value: "research", label: "Research" },
  { value: "fact",     label: "Facts" },
];

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all",      label: "All categories" },
  { value: "work",     label: "Work" },
  { value: "personal", label: "Personal" },
  { value: "coding",   label: "Coding" },
  { value: "ideas",    label: "Ideas" },
  { value: "research", label: "Research" },
  { value: "other",    label: "Other" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function FilterPill({
  active, onClick, color, children,
}: { active: boolean; onClick: () => void; color?: string; children: React.ReactNode }) {
  const c = color ?? "hsl(194 100% 55%)";
  return (
    <button
      onClick={onClick}
      className="rounded-full px-3 py-1 text-xs font-medium transition-all duration-150 whitespace-nowrap"
      style={{
        borderWidth: 1, borderStyle: "solid",
        borderColor: active ? `${c}80` : "hsl(210 15% 22%)",
        background: active ? `${c}18` : "transparent",
        color: active ? c : "hsl(196 30% 45%)",
      }}
    >
      {children}
    </button>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 px-4 text-center">
      <div className="w-16 h-16 rounded-2xl border flex items-center justify-center mb-5"
        style={{ borderColor: "hsl(194 100% 55% / 0.3)", background: "hsl(194 100% 55% / 0.05)" }}>
        <BookOpen className="w-7 h-7" style={{ color: "hsl(194 100% 60%)" }} />
      </div>
      <h3 className="font-display font-bold text-lg tracking-widest mb-2" style={{ color: "hsl(196 80% 85%)" }}>
        KNOWLEDGE BASE EMPTY
      </h3>
      <p className="text-sm text-muted-foreground mb-6 max-w-sm">
        Add notes, research links, and facts here. Jarvis will check your Knowledge Base before searching the web or using built-in answers.
      </p>
      <button
        onClick={onAdd}
        className="flex items-center gap-2 rounded-xl px-6 py-2.5 text-sm font-semibold tracking-wider glow-primary"
        style={{ background: "hsl(194 100% 55%)", color: "hsl(220 20% 6%)" }}
      >
        <Plus className="w-4 h-4" /> ADD FIRST NOTE
      </button>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function KnowledgeBase() {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const sessionId = getSessionId();

  // ── UI state
  const [searchQ, setSearchQ]       = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [catFilter, setCatFilter]   = useState<CategoryFilter>("all");
  const [activeTag, setActiveTag]   = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showIOSInfo, setShowIOSInfo] = useState(false);

  // ── Editor state
  const [editorOpen, setEditorOpen]   = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);

  // ── Queries
  const notesQuery = useQuery({
    queryKey: ["kb", sessionId, searchQ, typeFilter, catFilter],
    queryFn: () =>
      fetchNotes(sessionId, {
        q: searchQ || undefined,
        type: typeFilter !== "all" ? typeFilter : undefined,
        category: catFilter !== "all" ? catFilter : undefined,
      }),
  });

  const statsQuery = useQuery({
    queryKey: ["kb-stats", sessionId],
    queryFn: () => fetchKBStats(sessionId),
  });

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["kb", sessionId] });
    qc.invalidateQueries({ queryKey: ["kb-stats", sessionId] });
  }, [qc, sessionId]);

  // ── Mutations
  const addNote = useMutation({
    mutationFn: (data: Parameters<typeof createNote>[0]) => createNote(data),
    onSuccess: invalidate,
  });

  const editNote = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Parameters<typeof updateNote>[2] }) =>
      updateNote(id, sessionId, updates),
    onSuccess: invalidate,
  });

  const removeNote = useMutation({
    mutationFn: (id: string) => deleteNote(id, sessionId),
    onSuccess: invalidate,
  });

  // ── Computed notes (apply tag filter client-side)
  const rawNotes = notesQuery.data ?? [];
  const notes = activeTag
    ? rawNotes.filter((n) => n.tags.includes(activeTag))
    : rawNotes;

  const stats = statsQuery.data;
  const allTags = stats?.tags ?? [];

  // ── Handlers
  const openCreate = () => { setEditingNote(null); setEditorOpen(true); };
  const openEdit = (note: Note) => { setEditingNote(note); setEditorOpen(true); };

  const handleSave = async (data: Parameters<typeof addNote.mutateAsync>[0] extends { sessionId: string } ? Omit<Parameters<typeof addNote.mutateAsync>[0], "sessionId"> : never) => {
    if (editingNote) {
      await editNote.mutateAsync({ id: editingNote.id, updates: data });
    } else {
      await addNote.mutateAsync({ sessionId, ...data });
    }
  };

  const clearSearch = () => { setSearchQ(""); setTypeFilter("all"); setCatFilter("all"); setActiveTag(null); };
  const hasFilters = searchQ || typeFilter !== "all" || catFilter !== "all" || activeTag;

  return (
    <div className="flex flex-col min-h-screen bg-background scan-overlay">
      <div className="fixed inset-0 bg-grid opacity-40 pointer-events-none" />

      {/* ── Header ── */}
      <header className="sticky top-0 z-20 flex-shrink-0 flex items-center justify-between gap-3 px-4 sm:px-8 py-4 border-b border-border/60 bg-background/90 backdrop-blur-sm">
        <div className="flex items-center gap-4 min-w-0">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-1.5 text-xs font-medium tracking-wider transition-colors hover:text-primary flex-shrink-0"
            style={{ color: "hsl(196 40% 45%)" }}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">CHAT</span>
          </button>
          <span style={{ color: "hsl(210 15% 25%)" }}>·</span>
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/40 flex items-center justify-center flex-shrink-0">
              <span className="font-display text-primary font-black text-sm">J</span>
            </div>
            <h1 className="font-display font-bold text-base sm:text-lg tracking-widest truncate" style={{ color: "hsl(194 100% 60%)" }}>
              KNOWLEDGE BASE
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* iOS integration info */}
          <button
            onClick={() => setShowIOSInfo((v) => !v)}
            className="w-8 h-8 rounded-xl border flex items-center justify-center transition-colors hover:border-primary/40"
            style={{
              borderColor: showIOSInfo ? "hsl(264 80% 70% / 0.4)" : "hsl(210 15% 22%)",
              color: showIOSInfo ? "hsl(264 80% 70%)" : "hsl(196 40% 45%)",
            }}
            title="iOS Shortcuts integration"
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-semibold tracking-wider transition-all hover:opacity-80 glow-primary"
            style={{ background: "hsl(194 100% 55%)", color: "hsl(220 20% 6%)" }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>ADD NOTE</span>
          </button>
        </div>
      </header>

      {/* iOS info banner */}
      {showIOSInfo && (
        <div
          className="relative z-10 px-4 sm:px-8 py-4 border-b text-sm"
          style={{ background: "hsl(264 80% 70% / 0.07)", borderColor: "hsl(264 80% 70% / 0.25)" }}
        >
          <div className="max-w-3xl mx-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold mb-1" style={{ color: "hsl(264 80% 75%)" }}>
                  iOS Shortcuts / Safari Share Sheet
                </p>
                <p className="text-xs text-muted-foreground mb-2">
                  Save anything to your Knowledge Base from any iOS app. Create a Shortcut that POSTs to:
                </p>
                <code
                  className="text-xs rounded px-2 py-1 font-mono block mb-2"
                  style={{ background: "hsl(220 20% 10%)", color: "hsl(194 100% 65%)" }}
                >
                  POST {window.location.origin}/api/kb
                </code>
                <p className="text-xs text-muted-foreground">
                  Body: <code className="text-xs font-mono" style={{ color: "hsl(38 100% 65%)" }}>
                    {`{ "sessionId": "${sessionId.slice(0, 8)}…", "title": "…", "content": "…", "source": "shortcut" }`}
                  </code>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  For Safari Share Sheet, add <code className="font-mono" style={{ color: "hsl(38 100% 65%)" }}>"url"</code> and <code className="font-mono" style={{ color: "hsl(38 100% 65%)" }}>"source": "safari"</code> to the body.
                </p>
              </div>
              <button onClick={() => setShowIOSInfo(false)} className="flex-shrink-0 mt-0.5">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="relative z-10 flex-1 px-4 sm:px-8 py-6 max-w-6xl mx-auto w-full">

        {/* ── Search + filter bar ── */}
        <div className="flex gap-2 mb-5">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search notes, facts, research…"
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              className="w-full rounded-xl border bg-card pl-9 pr-4 py-2.5 text-sm outline-none focus:border-primary/60 transition-colors placeholder:text-muted-foreground"
              style={{ borderColor: "hsl(210 15% 22%)", color: "hsl(196 80% 85%)" }}
            />
            {searchQ && (
              <button
                onClick={() => setSearchQ("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters((v) => !v)}
            className="w-10 h-10 rounded-xl border flex items-center justify-center transition-colors"
            style={{
              borderColor: showFilters || hasFilters ? "hsl(194 100% 55% / 0.4)" : "hsl(210 15% 22%)",
              color: showFilters || hasFilters ? "hsl(194 100% 60%)" : "hsl(196 40% 45%)",
              background: showFilters || hasFilters ? "hsl(194 100% 55% / 0.08)" : "transparent",
            }}
            title="Filters"
          >
            <SlidersHorizontal className="w-4 h-4" />
          </button>
        </div>

        {/* Filters panel */}
        {showFilters && (
          <div
            className="rounded-2xl border p-4 mb-5"
            style={{ background: "hsl(220 20% 7%)", borderColor: "hsl(210 15% 20%)" }}
          >
            <div className="flex flex-col gap-3">
              <div>
                <p className="text-xs tracking-wider text-muted-foreground mb-2">TYPE</p>
                <div className="flex flex-wrap gap-1.5">
                  {TYPE_OPTIONS.map((o) => (
                    <FilterPill
                      key={o.value}
                      active={typeFilter === o.value}
                      onClick={() => setTypeFilter(o.value)}
                      color={o.value !== "all" ? TYPE_COLORS[o.value as NoteType] : undefined}
                    >
                      {o.label}
                      {stats && o.value !== "all" && ` (${stats.byType[o.value as NoteType]})`}
                    </FilterPill>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs tracking-wider text-muted-foreground mb-2">CATEGORY</p>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_OPTIONS.map((o) => (
                    <FilterPill
                      key={o.value}
                      active={catFilter === o.value}
                      onClick={() => setCatFilter(o.value)}
                    >
                      {o.label}
                    </FilterPill>
                  ))}
                </div>
              </div>
              {allTags.length > 0 && (
                <div>
                  <p className="text-xs tracking-wider text-muted-foreground mb-2">TAGS</p>
                  <div className="flex flex-wrap gap-1.5">
                    {allTags.map((tag) => (
                      <FilterPill
                        key={tag}
                        active={activeTag === tag}
                        onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                      >
                        #{tag}
                      </FilterPill>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Active filter summary + clear */}
        {hasFilters && (
          <div className="flex items-center gap-2 mb-4">
            <p className="text-xs text-muted-foreground">
              {notes.length} result{notes.length !== 1 ? "s" : ""}
              {searchQ && ` for "${searchQ}"`}
              {typeFilter !== "all" && ` · ${TYPE_LABELS[typeFilter as NoteType]}`}
              {catFilter !== "all" && ` · ${CATEGORY_LABELS[catFilter as NoteCategory]}`}
              {activeTag && ` · #${activeTag}`}
            </p>
            <button
              onClick={clearSearch}
              className="text-xs underline decoration-dotted"
              style={{ color: "hsl(194 100% 55%)" }}
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Stats pills (compact) ── */}
        {stats && stats.total > 0 && !hasFilters && (
          <div className="flex flex-wrap gap-2 mb-6">
            <span
              className="rounded-full px-3 py-1 text-xs font-medium"
              style={{ background: "hsl(194 100% 55% / 0.1)", color: "hsl(194 100% 65%)" }}
            >
              {stats.total} notes
            </span>
            {stats.byType.note > 0 && (
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "hsl(194 100% 55% / 0.08)", color: "hsl(194 100% 55%)" }}>
                📝 {stats.byType.note}
              </span>
            )}
            {stats.byType.research > 0 && (
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "hsl(264 80% 70% / 0.08)", color: "hsl(264 80% 70%)" }}>
                🔗 {stats.byType.research}
              </span>
            )}
            {stats.byType.fact > 0 && (
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "hsl(38 100% 60% / 0.08)", color: "hsl(38 100% 60%)" }}>
                💡 {stats.byType.fact}
              </span>
            )}
            {stats.bySource.safari > 0 && (
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "hsl(38 100% 60% / 0.08)", color: "hsl(38 100% 60%)" }}>
                Safari: {stats.bySource.safari}
              </span>
            )}
            {stats.bySource.shortcut > 0 && (
              <span className="rounded-full px-3 py-1 text-xs" style={{ background: "hsl(264 80% 70% / 0.08)", color: "hsl(264 80% 70%)" }}>
                Shortcut: {stats.bySource.shortcut}
              </span>
            )}
          </div>
        )}

        {/* ── Notes grid ── */}
        {notesQuery.isLoading && (
          <p className="text-xs text-muted-foreground text-center py-12">Loading notes…</p>
        )}

        {!notesQuery.isLoading && notes.length === 0 && !hasFilters && (
          <EmptyState onAdd={openCreate} />
        )}

        {!notesQuery.isLoading && notes.length === 0 && hasFilters && (
          <div className="text-center py-16">
            <p className="text-sm text-muted-foreground mb-3">No notes match the current filters.</p>
            <button onClick={clearSearch} className="text-xs underline" style={{ color: "hsl(194 100% 60%)" }}>
              Clear filters
            </button>
          </div>
        )}

        {notes.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {notes.map((note) => (
              <NoteCard
                key={note.id}
                note={note}
                onEdit={openEdit}
                onDelete={(id) => removeNote.mutate(id)}
                searchQuery={searchQ}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Note editor modal ── */}
      <NoteEditor
        isOpen={editorOpen}
        note={editingNote}
        onClose={() => { setEditorOpen(false); setEditingNote(null); }}
        onSave={handleSave as Parameters<typeof NoteEditor>[0]["onSave"]}
      />
    </div>
  );
}
