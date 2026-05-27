/**
 * lib/agentProfiles.ts — Multi-Agent System v1: Specialist profiles + assignment
 *
 * Defines 6 specialist agent personas. Stores them in .jarvas-data/agents/agents.json.
 * Assignment is read-only: matches a goal + changeType to the best agent and
 * explains why, returning a confidence score.  No code is executed here.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { PROJECT_ROOT } from "./dev/tools";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AgentRole =
  | "architect" | "coder" | "debugger" | "tester" | "deployment" | "memory";

export type ChangeType =
  | "feature" | "bugfix" | "refactor" | "api" | "frontend" | "data" | "test" | "docs";

export interface AgentProfile {
  id:                   string;
  name:                 string;
  role:                 AgentRole;
  description:          string;
  specialties:          string[];
  keywords:             string[];
  preferredChangeTypes: ChangeType[];
  color:                string;   // hsl string for UI
  emoji:                string;
  createdAt:            string;
}

export interface AssignmentRequest {
  goal:        string;
  changeType:  ChangeType;
  context?:    string;
}

export interface AssignmentResult {
  agentId:        string;
  agentName:      string;
  role:           AgentRole;
  confidence:     number;   // 0-100
  reason:         string;
  matchedKeywords: string[];
  alternates:     Array<{ agentId: string; agentName: string; confidence: number }>;
  assignedAt:     string;
  request:        AssignmentRequest;
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const STORE_DIR       = path.join(PROJECT_ROOT, ".jarvas-data", "agents");
const PROFILES_FILE   = path.join(STORE_DIR, "agents.json");
const ASSIGNMENT_FILE = path.join(STORE_DIR, "last-assignment.json");

// ─── Default profiles ─────────────────────────────────────────────────────────

const DEFAULT_PROFILES: AgentProfile[] = [
  {
    id:                   "architect",
    name:                 "Architect Agent",
    role:                 "architect",
    description:          "Designs systems, defines API contracts, models data structures, and makes high-level architectural decisions. Best for planning new features before any code is written.",
    specialties:          ["System Design", "API Contracts", "Data Modeling", "Module Structure", "Interface Definitions", "Architecture Decisions"],
    keywords:             ["design", "architecture", "structure", "schema", "interface", "contract", "system", "module", "model", "plan", "blueprint", "pattern", "api design", "diagram", "dependency", "layout"],
    preferredChangeTypes: ["feature", "api", "refactor"],
    color:                "hsl(264 80% 68%)",
    emoji:                "🏛️",
    createdAt:            new Date().toISOString(),
  },
  {
    id:                   "coder",
    name:                 "Coder Agent",
    role:                 "coder",
    description:          "Implements features, writes new code, builds components, and translates specs into working software. Best for direct implementation tasks.",
    specialties:          ["Feature Implementation", "Component Building", "API Development", "Frontend UI", "Backend Logic", "Algorithm Writing"],
    keywords:             ["implement", "build", "create", "add", "code", "write", "feature", "function", "component", "route", "handler", "hook", "class", "method", "endpoint", "integrate"],
    preferredChangeTypes: ["feature", "frontend", "api", "refactor"],
    color:                "hsl(150 70% 55%)",
    emoji:                "⚡",
    createdAt:            new Date().toISOString(),
  },
  {
    id:                   "debugger",
    name:                 "Debug Agent",
    role:                 "debugger",
    description:          "Diagnoses errors, traces bugs, fixes crashes, and investigates unexpected behavior. Best for anything broken or behaving incorrectly.",
    specialties:          ["Error Diagnosis", "Stack Trace Analysis", "Root Cause Finding", "Regression Fixing", "Performance Profiling", "Log Analysis"],
    keywords:             ["bug", "error", "fix", "crash", "broken", "debug", "trace", "failure", "exception", "issue", "wrong", "incorrect", "unexpected", "regression", "investigate", "diagnose", "problem"],
    preferredChangeTypes: ["bugfix", "refactor"],
    color:                "hsl(355 80% 65%)",
    emoji:                "🔍",
    createdAt:            new Date().toISOString(),
  },
  {
    id:                   "tester",
    name:                 "Test Agent",
    role:                 "tester",
    description:          "Writes tests, improves coverage, validates correctness, and designs test plans. Best for any testing, QA, or validation work.",
    specialties:          ["Unit Testing", "Integration Testing", "E2E Testing", "Test Coverage", "Mock Design", "Test Plan Creation", "Validation Logic"],
    keywords:             ["test", "spec", "coverage", "validate", "verify", "assert", "mock", "e2e", "unit", "integration", "qa", "quality", "check", "pass", "fail", "scenario", "suite"],
    preferredChangeTypes: ["test", "bugfix", "feature"],
    color:                "hsl(38 100% 60%)",
    emoji:                "🧪",
    createdAt:            new Date().toISOString(),
  },
  {
    id:                   "deployment",
    name:                 "Deployment Agent",
    role:                 "deployment",
    description:          "Handles CI/CD, Docker, environment configuration, production releases, and infrastructure setup. Best for anything related to shipping and running the app.",
    specialties:          ["CI/CD Pipelines", "Docker / Containers", "Environment Config", "Production Releases", "Infrastructure Setup", "Secret Management", "Health Monitoring"],
    keywords:             ["deploy", "production", "release", "docker", "environment", "config", "build", "publish", "ci", "cd", "pipeline", "container", "infrastructure", "secret", "env", "server", "host", "staging"],
    preferredChangeTypes: ["docs", "data"],
    color:                "hsl(196 80% 58%)",
    emoji:                "🚀",
    createdAt:            new Date().toISOString(),
  },
  {
    id:                   "memory",
    name:                 "Memory Agent",
    role:                 "memory",
    description:          "Manages knowledge bases, session context, user preferences, and long-term memory stores. Best for anything involving recall, retention, or structured knowledge.",
    specialties:          ["Knowledge Base Management", "Session Context", "User Preferences", "Long-Term Memory", "Context Retrieval", "Data Persistence", "Semantic Search"],
    keywords:             ["memory", "session", "context", "remember", "store", "retrieve", "knowledge", "cache", "recall", "persist", "preference", "history", "state", "kb", "search", "index", "embedding"],
    preferredChangeTypes: ["data", "feature"],
    color:                "hsl(280 70% 65%)",
    emoji:                "🧠",
    createdAt:            new Date().toISOString(),
  },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
}

export function loadProfiles(): AgentProfile[] {
  ensureDir();
  if (!existsSync(PROFILES_FILE)) {
    writeFileSync(PROFILES_FILE, JSON.stringify(DEFAULT_PROFILES, null, 2) + "\n", "utf-8");
    return DEFAULT_PROFILES;
  }
  try {
    return JSON.parse(readFileSync(PROFILES_FILE, "utf-8")) as AgentProfile[];
  } catch {
    return DEFAULT_PROFILES;
  }
}

export function readLastAssignment(): AssignmentResult | null {
  try {
    return JSON.parse(readFileSync(ASSIGNMENT_FILE, "utf-8")) as AssignmentResult;
  } catch { return null; }
}

function saveAssignment(result: AssignmentResult): void {
  ensureDir();
  writeFileSync(ASSIGNMENT_FILE, JSON.stringify(result, null, 2) + "\n", "utf-8");
}

// ─── Assignment engine ────────────────────────────────────────────────────────

interface ScoredAgent {
  profile:         AgentProfile;
  score:           number;
  matchedKeywords: string[];
}

function scoreAgent(profile: AgentProfile, goal: string, changeType: ChangeType): ScoredAgent {
  const haystack = goal.toLowerCase();
  const words    = haystack.split(/\W+/).filter(Boolean);

  const matchedKeywords: string[] = [];
  let keywordScore = 0;

  for (const kw of profile.keywords) {
    const kwLower = kw.toLowerCase();
    if (haystack.includes(kwLower)) {
      matchedKeywords.push(kw);
      // Longer keyword matches worth more (multi-word phrases)
      keywordScore += kwLower.includes(" ") ? 2 : 1;
    }
  }

  // Partial word matches (stem matching)
  for (const word of words) {
    if (word.length < 4) continue;
    for (const kw of profile.keywords) {
      if (!matchedKeywords.includes(kw) && kw.toLowerCase().startsWith(word.slice(0, 4))) {
        keywordScore += 0.5;
      }
    }
  }

  // changeType bonus
  const changeTypeBonus = profile.preferredChangeTypes.includes(changeType) ? 3 : 0;

  return {
    profile,
    score:           keywordScore + changeTypeBonus,
    matchedKeywords: [...new Set(matchedKeywords)],
  };
}

function buildReason(winner: ScoredAgent, changeType: ChangeType): string {
  const kws = winner.matchedKeywords.slice(0, 4);
  const changeBonus = winner.profile.preferredChangeTypes.includes(changeType);

  const parts: string[] = [
    `${winner.profile.name} is best suited for this task.`,
  ];

  if (kws.length > 0) {
    parts.push(`The goal matches ${winner.profile.name}'s expertise in: ${kws.join(", ")}.`);
  }

  if (changeBonus) {
    parts.push(`"${changeType}" changes are a preferred specialisation for this agent.`);
  }

  parts.push(winner.profile.description.split(".")[0] + ".");

  return parts.join(" ");
}

export function assignAgent(req: AssignmentRequest): AssignmentResult {
  const profiles = loadProfiles();
  const fullText = `${req.goal} ${req.context ?? ""}`;

  const scored: ScoredAgent[] = profiles.map(p =>
    scoreAgent(p, fullText, req.changeType),
  );

  // Sort descending by score; break ties by preferredChangeType match
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aMatch = a.profile.preferredChangeTypes.includes(req.changeType) ? 1 : 0;
    const bMatch = b.profile.preferredChangeTypes.includes(req.changeType) ? 1 : 0;
    return bMatch - aMatch;
  });

  const winner    = scored[0];
  const maxScore  = Math.max(...scored.map(s => s.score));

  // Confidence: normalise winner score to 0-100; minimum 30 when score > 0
  const rawConf   = maxScore > 0 ? (winner.score / maxScore) * 100 : 40;
  const confidence = Math.min(100, Math.max(30, Math.round(rawConf)));

  const alternates = scored.slice(1, 3).map(s => ({
    agentId:    s.profile.id,
    agentName:  s.profile.name,
    confidence: maxScore > 0 ? Math.round((s.score / maxScore) * confidence * 0.85) : 25,
  }));

  const result: AssignmentResult = {
    agentId:         winner.profile.id,
    agentName:       winner.profile.name,
    role:            winner.profile.role,
    confidence,
    reason:          buildReason(winner, req.changeType),
    matchedKeywords: winner.matchedKeywords,
    alternates,
    assignedAt:      new Date().toISOString(),
    request:         req,
  };

  saveAssignment(result);
  return result;
}
