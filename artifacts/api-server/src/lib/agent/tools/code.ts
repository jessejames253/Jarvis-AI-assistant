/**
 * agent/tools/code.ts — Safe JavaScript execution sandbox using Node vm module
 *
 * Supports JavaScript only (Python/etc are stubbed to a friendly message).
 * Captures console.log output and the final expression value.
 * Hard timeout: 5 seconds.
 */

import vm from "vm";

export interface CodeResult {
  language: string;
  output: string;
  error?: string;
  executionMs: number;
}

export async function runCode(code: string, language = "javascript"): Promise<CodeResult> {
  const lang = language.toLowerCase().trim();
  const start = Date.now();

  if (!["javascript", "js"].includes(lang)) {
    return {
      language: lang,
      output: `[Sandbox only supports JavaScript — ${lang} execution is not available in this environment]`,
      executionMs: Date.now() - start,
    };
  }

  const outputLines: string[] = [];

  const sandbox = {
    console: {
      log: (...args: unknown[]) => outputLines.push(args.map(stringify).join(" ")),
      error: (...args: unknown[]) => outputLines.push("[error] " + args.map(stringify).join(" ")),
      warn: (...args: unknown[]) => outputLines.push("[warn] " + args.map(stringify).join(" ")),
      info: (...args: unknown[]) => outputLines.push(args.map(stringify).join(" ")),
    },
    Math,
    JSON,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Map,
    Set,
    Promise,
  };

  try {
    const ctx = vm.createContext(sandbox);
    const result = vm.runInContext(code, ctx, { timeout: 5000 });

    // If the final expression yields a value, include it
    if (result !== undefined && result !== null) {
      outputLines.push(stringify(result));
    }

    const output = outputLines.join("\n") || "(no output)";
    return { language: "javascript", output, executionMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      language: "javascript",
      output: outputLines.join("\n"),
      error: msg,
      executionMs: Date.now() - start,
    };
  }
}

function stringify(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}
