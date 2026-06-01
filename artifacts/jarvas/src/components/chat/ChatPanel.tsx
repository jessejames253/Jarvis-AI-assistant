import { type ReactNode } from "react";

interface ChatPanelProps {
  children: ReactNode;
}

export function ChatPanel({ children }: ChatPanelProps) {
  return (
    <div className="flex flex-col h-[100dvh] w-full bg-background scan-overlay overflow-hidden">
      <div className="fixed inset-0 bg-grid opacity-60 pointer-events-none" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-96 h-64 bg-primary/5 rounded-full blur-3xl pointer-events-none" />
      <div className="fixed bottom-24 right-8 w-64 h-64 bg-accent/5 rounded-full blur-3xl pointer-events-none" />
      {children}
    </div>
  );
}
