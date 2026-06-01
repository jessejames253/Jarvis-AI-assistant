/**
 * Shared types for Chat components.
 * Extracted from Chat.tsx to enable component splitting.
 */

import type { DebugInfo } from "@/components/DebugPanel";
import type { ToolCallInfo } from "@/components/ToolStatusBubble";
import type { FrontendPlan } from "@/lib/plannerApi";

export type AgentStatus = "idle" | "thinking" | "researching" | "processing" | "error";

export const STATUS_CONFIG: Record<AgentStatus, { label: string; color: string; glow: string }> = {
  idle:        { label: "READY",         color: "hsl(194 100% 55%)", glow: "0 0 8px rgba(0,200,255,0.5), 0 0 24px rgba(0,200,255,0.2)" },
  thinking:    { label: "THINKING",      color: "hsl(264 80% 72%)",  glow: "0 0 12px rgba(140,80,255,0.6), 0 0 28px rgba(140,80,255,0.2)" },
  researching: { label: "SEARCHING WEB", color: "hsl(194 100% 70%)", glow: "0 0 16px rgba(0,220,255,0.7), 0 0 36px rgba(0,220,255,0.3)" },
  processing:  { label: "PROCESSING",    color: "hsl(38 100% 62%)",  glow: "0 0 12px rgba(255,160,0,0.55), 0 0 28px rgba(255,160,0,0.2)" },
  error:       { label: "ERROR",         color: "hsl(355 80% 62%)",  glow: "0 0 12px rgba(255,60,60,0.55), 0 0 28px rgba(255,60,60,0.2)" },
};

export interface Source {
  title: string;
  url: string;
  description: string;
}

export interface PatchProposalRef {
  patchId:     string;
  file:        string;
  description: string;
  riskLevel?:  "low" | "medium" | "high";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  sources?: Source[];
  isSearch?: boolean;
  isFakeSearch?: boolean;
  debug?: DebugInfo;
  toolCalls?: ToolCallInfo[];
  plan?: FrontendPlan;
  autoRouted?: boolean;
  patchProposal?: PatchProposalRef;
}
