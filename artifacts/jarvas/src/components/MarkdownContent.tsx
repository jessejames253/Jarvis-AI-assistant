/**
 * MarkdownContent.tsx — Jarvis-themed markdown renderer
 *
 * Renders Claude's markdown responses with:
 *   - Syntax-highlighted fenced code blocks (JS/TS/Python/JSON + more)
 *   - Inline code with cyan glow
 *   - Proper headings, lists, bold/italic, blockquotes
 *   - Mobile-friendly horizontal scroll on code blocks
 *   - Copy-to-clipboard on code blocks
 */

import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import type { Components } from "react-markdown";

// ─── Jarvis syntax theme ──────────────────────────────────────────────────────

const jarvisTheme: Record<string, React.CSSProperties> = {
  'code[class*="language-"]': {
    color: "hsl(196 80% 82%)",
    background: "none",
    fontFamily: "Menlo, 'Cascadia Code', 'Fira Code', monospace",
    fontSize: "0.8rem",
    lineHeight: "1.6",
    tabSize: 2,
  },
  'pre[class*="language-"]': {
    color: "hsl(196 80% 82%)",
    background: "hsl(222 28% 6%)",
    padding: "0",
    margin: "0",
    overflow: "auto",
  },
  comment: { color: "hsl(196 35% 40%)", fontStyle: "italic" },
  prolog: { color: "hsl(196 35% 40%)" },
  doctype: { color: "hsl(196 35% 40%)" },
  cdata: { color: "hsl(196 35% 40%)" },
  punctuation: { color: "hsl(196 50% 58%)" },
  property: { color: "hsl(194 100% 68%)" },
  tag: { color: "hsl(194 100% 65%)" },
  boolean: { color: "hsl(38 100% 65%)" },
  number: { color: "hsl(38 100% 65%)" },
  constant: { color: "hsl(38 100% 65%)" },
  symbol: { color: "hsl(38 100% 65%)" },
  selector: { color: "hsl(142 65% 62%)" },
  "attr-name": { color: "hsl(194 100% 68%)" },
  string: { color: "hsl(264 70% 78%)" },
  char: { color: "hsl(264 70% 78%)" },
  builtin: { color: "hsl(142 65% 62%)" },
  operator: { color: "hsl(194 80% 75%)" },
  entity: { color: "hsl(38 100% 65%)", cursor: "help" },
  url: { color: "hsl(194 80% 75%)" },
  keyword: { color: "hsl(194 100% 62%)", fontWeight: "600" },
  regex: { color: "hsl(38 100% 65%)" },
  important: { color: "hsl(0 72% 65%)", fontWeight: "bold" },
  bold: { fontWeight: "bold" },
  italic: { fontStyle: "italic" },
  "class-name": { color: "hsl(142 65% 65%)" },
  function: { color: "hsl(142 65% 65%)" },
  variable: { color: "hsl(194 80% 78%)" },
  parameter: { color: "hsl(196 60% 72%)" },
  "attr-value": { color: "hsl(264 70% 78%)" },
  namespace: { opacity: 0.7 },
  deleted: { color: "hsl(0 72% 65%)" },
  inserted: { color: "hsl(142 65% 62%)" },
};

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  }, [code]);

  return (
    <button
      onClick={copy}
      className="code-copy-btn"
      aria-label="Copy code"
      title="Copy"
    >
      {copied ? (
        <span style={{ color: "hsl(142 65% 62%)" }}>✓ COPIED</span>
      ) : (
        <span>COPY</span>
      )}
    </button>
  );
}

// ─── Custom renderers ─────────────────────────────────────────────────────────

const components: Components = {
  // ── Fenced code blocks ──────────────────────────────────────────────────────
  code({ className, children, ...props }) {
    const match = /language-(\w+)/.exec(className ?? "");
    const isBlock = match !== null || String(children).includes("\n");
    const codeString = String(children).replace(/\n$/, "");
    const language = match?.[1] ?? "text";

    if (!isBlock) {
      // Inline code
      return (
        <code className="jarvis-inline-code" {...props}>
          {children}
        </code>
      );
    }

    return (
      <div className="jarvis-code-block">
        <div className="jarvis-code-header">
          <span className="jarvis-code-lang">{language.toUpperCase()}</span>
          <CopyButton code={codeString} />
        </div>
        <div className="jarvis-code-scroll">
          <SyntaxHighlighter
            language={language}
            style={jarvisTheme}
            customStyle={{
              margin: 0,
              padding: "1rem",
              background: "transparent",
              fontSize: "0.8rem",
              lineHeight: "1.6",
            }}
            codeTagProps={{ style: { fontFamily: "Menlo, 'Cascadia Code', 'Fira Code', monospace" } }}
            PreTag="div"
          >
            {codeString}
          </SyntaxHighlighter>
        </div>
      </div>
    );
  },

  // ── Paragraphs ──────────────────────────────────────────────────────────────
  p({ children }) {
    return (
      <p className="jarvis-md-p">{children}</p>
    );
  },

  // ── Headings ────────────────────────────────────────────────────────────────
  h1({ children }) {
    return <h1 className="jarvis-md-h1">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="jarvis-md-h2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="jarvis-md-h3">{children}</h3>;
  },

  // ── Lists ───────────────────────────────────────────────────────────────────
  ul({ children }) {
    return <ul className="jarvis-md-ul">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="jarvis-md-ol">{children}</ol>;
  },
  li({ children }) {
    return <li className="jarvis-md-li">{children}</li>;
  },

  // ── Blockquote ──────────────────────────────────────────────────────────────
  blockquote({ children }) {
    return <blockquote className="jarvis-md-blockquote">{children}</blockquote>;
  },

  // ── Strong / em ─────────────────────────────────────────────────────────────
  strong({ children }) {
    return <strong className="jarvis-md-strong">{children}</strong>;
  },
  em({ children }) {
    return <em className="jarvis-md-em">{children}</em>;
  },

  // ── Horizontal rule ─────────────────────────────────────────────────────────
  hr() {
    return <hr className="jarvis-md-hr" />;
  },

  // ── Links ───────────────────────────────────────────────────────────────────
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="jarvis-md-a">
        {children}
      </a>
    );
  },

  // ── Tables (GFM) ────────────────────────────────────────────────────────────
  table({ children }) {
    return (
      <div className="jarvis-md-table-wrap">
        <table className="jarvis-md-table">{children}</table>
      </div>
    );
  },
  th({ children }) {
    return <th className="jarvis-md-th">{children}</th>;
  },
  td({ children }) {
    return <td className="jarvis-md-td">{children}</td>;
  },
};

// ─── Main export ──────────────────────────────────────────────────────────────

export default function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="jarvis-md-root">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
