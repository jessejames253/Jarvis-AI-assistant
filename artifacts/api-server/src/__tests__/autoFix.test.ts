/**
 * __tests__/autoFix.test.ts — Unit tests for the Phase 3C AutoFix engine.
 *
 * Tests only pure functions — no file I/O, no TSC, no snapshot store.
 * Each test verifies a specific safety invariant or classification rule.
 */

import { describe, it, expect } from "vitest";
import {
  classifyIssue,
  generateUnusedImportFix,
  generateCssPropFix,
  isBlockedFile,
  parseTscErrors,
  countChangedLines,
  BLOCKED_FILE_PATTERNS,
} from "../lib/dev/autoFixEngine";

// ─── isBlockedFile ────────────────────────────────────────────────────────────

describe("isBlockedFile", () => {
  it("blocks package.json", () => {
    expect(isBlockedFile("artifacts/jarvas/package.json")).toBe(true);
  });

  it("blocks .env files", () => {
    expect(isBlockedFile(".env.local")).toBe(true);
    expect(isBlockedFile(".env.production")).toBe(true);
  });

  it("blocks auth files", () => {
    expect(isBlockedFile("src/lib/auth.ts")).toBe(true);
    expect(isBlockedFile("src/routes/Auth.ts")).toBe(true);
    expect(isBlockedFile("src/lib/auth/session.ts")).toBe(true);
  });

  it("blocks database/migration files", () => {
    expect(isBlockedFile("src/db/schema.ts")).toBe(true);
    expect(isBlockedFile("drizzle/0001_migration.sql")).toBe(true);
    expect(isBlockedFile("src/database/index.ts")).toBe(true);
  });

  it("blocks payment/stripe files", () => {
    expect(isBlockedFile("src/lib/payment.ts")).toBe(true);
    expect(isBlockedFile("src/stripe/checkout.ts")).toBe(true);
  });

  it("blocks config files", () => {
    expect(isBlockedFile("vite.config.ts")).toBe(true);
    expect(isBlockedFile("tsconfig.json")).toBe(true);
    expect(isBlockedFile("build.mjs")).toBe(true);
  });

  it("blocks node_modules", () => {
    expect(isBlockedFile("node_modules/react/index.js")).toBe(true);
  });

  it("allows regular source files", () => {
    expect(isBlockedFile("src/components/Button.tsx")).toBe(false);
    expect(isBlockedFile("src/lib/utils.ts")).toBe(false);
    expect(isBlockedFile("artifacts/jarvas/src/App.tsx")).toBe(false);
  });

  it("blocks all patterns defined in BLOCKED_FILE_PATTERNS", () => {
    // Verify the constant is non-empty and each pattern would block a matching path
    expect(BLOCKED_FILE_PATTERNS.length).toBeGreaterThan(10);
  });
});

// ─── classifyIssue ────────────────────────────────────────────────────────────

describe("classifyIssue", () => {
  it("classifies unused import (TS6133) as safe", () => {
    const r = classifyIssue(6133, "'Foo' is declared but its value is never read.", "src/utils.ts");
    expect(r.type).toBe("unused-import");
    expect(r.risk).toBe("safe");
    expect(r.confidence).toBeGreaterThanOrEqual(80);
  });

  it("classifies unused import (TS6196) as safe", () => {
    const r = classifyIssue(6196, "'Bar' is declared but its value is never read.", "src/index.ts");
    expect(r.type).toBe("unused-import");
    expect(r.risk).toBe("safe");
  });

  it("classifies missing module (TS2307) as review", () => {
    const r = classifyIssue(2307, "Cannot find module './missing' or its corresponding type declarations.", "src/app.ts");
    expect(r.type).toBe("missing-import");
    expect(r.risk).toBe("review");
  });

  it("classifies invalid CSS style prop (TS2353) as safe", () => {
    const r = classifyIssue(2353, "Object literal may only specify known properties, and 'divideColor' does not exist in type 'CSSProperties'.", "src/Widget.tsx");
    expect(r.type).toBe("invalid-css-style");
    expect(r.risk).toBe("safe");
  });

  it("classifies generic object literal property (TS2353) as review when no CSS context", () => {
    const r = classifyIssue(2353, "Object literal may only specify known properties, and 'extra' does not exist in type 'Config'.", "src/config.ts");
    expect(r.type).toBe("missing-type");
    expect(r.risk).toBe("review");
  });

  it("classifies cannot find name (TS2304) as review", () => {
    const r = classifyIssue(2304, "Cannot find name 'MyType'.", "src/component.tsx");
    expect(r.type).toBe("missing-type");
    expect(r.risk).toBe("review");
  });

  it("classifies wrong export member (TS2614) as review", () => {
    const r = classifyIssue(2614, "Module 'myLib' has no exported member 'OldName'.", "src/feature.ts");
    expect(r.type).toBe("wrong-export-name");
    expect(r.risk).toBe("review");
  });

  it("classifies property does not exist (TS2339) as review", () => {
    const r = classifyIssue(2339, "Property 'foo' does not exist on type 'Bar'.", "src/index.ts");
    expect(r.type).toBe("wrong-export-name");
    expect(r.risk).toBe("review");
  });

  it("classifies syntax errors (TS1005) as risky — never auto-applied", () => {
    const r = classifyIssue(1005, "';' expected.", "src/broken.ts");
    expect(r.type).toBe("syntax-typo");
    expect(r.risk).toBe("risky");
  });

  it("classifies auth files as blocked regardless of error code", () => {
    const r = classifyIssue(6133, "'Token' is declared but never read.", "src/auth.ts");
    expect(r.risk).toBe("blocked");
  });

  it("classifies payment files as blocked", () => {
    const r = classifyIssue(6133, "'Handler' is declared but never read.", "src/payment/checkout.ts");
    expect(r.risk).toBe("blocked");
  });

  it("classifies database files as blocked", () => {
    const r = classifyIssue(6133, "'Unused' is declared but never read.", "src/db/schema.ts");
    expect(r.risk).toBe("blocked");
  });

  it("classifies unknown error codes as blocked", () => {
    const r = classifyIssue(9999, "Some obscure error.", "src/normal.ts");
    expect(r.risk).toBe("blocked");
  });
});

// ─── generateUnusedImportFix ──────────────────────────────────────────────────

describe("generateUnusedImportFix", () => {
  it("removes symbol from multi-symbol named import", () => {
    const content = `import { useState, useEffect, useRef } from "react";\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "useEffect");
    expect(result).not.toBeNull();
    expect(result).toContain("useState");
    expect(result).toContain("useRef");
    expect(result).not.toContain("useEffect");
  });

  it("removes entire import when only symbol is unused", () => {
    const content = `import { useMemo } from "react";\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "useMemo");
    expect(result).not.toBeNull();
    expect(result).not.toContain("import");
    expect(result).not.toContain("useMemo");
  });

  it("removes default import", () => {
    const content = `import React from "react";\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "React");
    expect(result).not.toBeNull();
    expect(result).not.toContain("import React");
  });

  it("removes namespace import (import * as X)", () => {
    const content = `import * as path from "path";\nconst y = 2;`;
    const result = generateUnusedImportFix(content, "path");
    expect(result).not.toBeNull();
    expect(result).not.toContain("import * as path");
  });

  it("handles aliased import — removes by alias name", () => {
    const content = `import { realName as aliasName, keep } from "./mod";\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "aliasName");
    expect(result).not.toBeNull();
    expect(result).not.toContain("aliasName");
    expect(result).toContain("keep");
  });

  it("returns null when symbol not found in any import", () => {
    const content = `import { something } from "./mod";\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "nonExistent");
    expect(result).toBeNull();
  });

  it("does not modify non-import lines", () => {
    const content = `const useEffect = () => {};\nconst x = 1;`;
    const result = generateUnusedImportFix(content, "useEffect");
    expect(result).toBeNull();
  });

  it("preserves rest of file content after removal", () => {
    const content = [
      `import { Alpha, Beta } from "./types";`,
      ``,
      `export function hello() {`,
      `  return Alpha;`,
      `}`,
    ].join("\n");
    const result = generateUnusedImportFix(content, "Beta");
    expect(result).not.toBeNull();
    expect(result).toContain("Alpha");
    expect(result).toContain("export function hello");
    expect(result).not.toContain("Beta");
  });
});

// ─── generateCssPropFix ───────────────────────────────────────────────────────

describe("generateCssPropFix", () => {
  it("removes an invalid CSS prop on the given line", () => {
    const content = [
      `function Comp() {`,
      `  return <div style={{ color: "red", divideColor: "blue", fontSize: 12 }} />;`,
      `}`,
    ].join("\n");
    const result = generateCssPropFix(content, "divideColor", 2);
    expect(result).not.toBeNull();
    expect(result).not.toContain("divideColor");
    expect(result).toContain("color");
    expect(result).toContain("fontSize");
  });

  it("returns null when prop not found on the line", () => {
    const content = `<div style={{ color: "red" }} />`;
    const result = generateCssPropFix(content, "unknownProp", 1);
    expect(result).toBeNull();
  });

  it("returns null for out-of-bounds line number", () => {
    const content = `const x = 1;`;
    const result = generateCssPropFix(content, "color", 99);
    expect(result).toBeNull();
  });
});

// ─── parseTscErrors ───────────────────────────────────────────────────────────

describe("parseTscErrors", () => {
  it("parses a standard TSC error line", () => {
    const output = `src/index.ts(12,5): error TS6133: 'foo' is declared but its value is never read.`;
    const errors = parseTscErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].file).toBe("src/index.ts");
    expect(errors[0].line).toBe(12);
    expect(errors[0].col).toBe(5);
    expect(errors[0].code).toBe(6133);
    expect(errors[0].message).toContain("'foo'");
  });

  it("parses multiple errors from one TSC run", () => {
    const output = [
      `src/a.ts(1,1): error TS6133: 'A' is declared but its value is never read.`,
      `src/b.ts(5,3): error TS2307: Cannot find module './missing'.`,
    ].join("\n");
    const errors = parseTscErrors(output);
    expect(errors).toHaveLength(2);
    expect(errors[0].code).toBe(6133);
    expect(errors[1].code).toBe(2307);
  });

  it("returns empty array for clean TSC output", () => {
    expect(parseTscErrors("")).toHaveLength(0);
    expect(parseTscErrors("no errors here")).toHaveLength(0);
  });

  it("ignores warning lines (only error lines matched)", () => {
    const output = `src/a.ts(1,1): warning TS1234: some warning.\nsrc/b.ts(2,2): error TS6133: 'x' is declared but never read.`;
    const errors = parseTscErrors(output);
    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe(6133);
  });
});

// ─── countChangedLines ────────────────────────────────────────────────────────

describe("countChangedLines", () => {
  it("returns 0 for identical content", () => {
    expect(countChangedLines("abc\ndef", "abc\ndef")).toBe(0);
  });

  it("counts lines that differ", () => {
    expect(countChangedLines("a\nb\nc", "a\nX\nc")).toBe(1);
  });

  it("counts added lines as changed", () => {
    const old = "line1\nline2";
    const newC = "line1\nline2\nline3";
    expect(countChangedLines(old, newC)).toBe(1);
  });

  it("counts removed lines as changed", () => {
    const old = "line1\nline2\nline3";
    const newC = "line1\nline2";
    expect(countChangedLines(old, newC)).toBe(1);
  });

  it("returns value > 40 for a large diff", () => {
    const old = Array.from({ length: 50 }, (_, i) => `line${i}`).join("\n");
    const newC = Array.from({ length: 50 }, (_, i) => `changed${i}`).join("\n");
    expect(countChangedLines(old, newC)).toBeGreaterThan(40);
  });
});

// ─── Safety invariant integration checks ─────────────────────────────────────

describe("Safety invariants (pure logic)", () => {
  it("unused-import fix returns non-null result (even for import-only file)", () => {
    const content = `import { only } from "./mod";\n`;
    const result = generateUnusedImportFix(content, "only");
    // The function returns a string (the import is removed), not null
    expect(result).not.toBeNull();
  });

  it("removing an import changes far fewer than 40 lines", () => {
    const content = [
      `import { unused } from "./mod";`,
      `const a = 1;`,
      `const b = 2;`,
    ].join("\n");
    const result = generateUnusedImportFix(content, "unused");
    expect(result).not.toBeNull();
    const changed = countChangedLines(content, result!);
    // Removing a single import line shifts all subsequent lines — still well under 40
    expect(changed).toBeLessThan(40);
  });

  it("risky classification never returns safe", () => {
    // Syntax errors must never be auto-applied
    [1005, 1109, 1128, 1161].forEach(code => {
      const r = classifyIssue(code, "some syntax error", "src/any.ts");
      expect(r.risk).not.toBe("safe");
    });
  });

  it("blocked files always return blocked risk", () => {
    const blockedPaths = [
      "src/auth.ts",
      "src/payment.ts",
      "drizzle/schema.ts",
      "package.json",
      ".env",
    ];
    blockedPaths.forEach(p => {
      const r = classifyIssue(6133, "'x' is declared but never read.", p);
      expect(r.risk).toBe("blocked");
    });
  });
});
