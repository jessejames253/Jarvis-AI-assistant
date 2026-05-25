/**
 * agent/tools/calculator.ts — Safe deterministic math evaluator
 */

export interface CalcResult {
  expression: string;
  result: number;
  formatted: string;
}

function sanitize(expr: string): string {
  return expr
    .replace(/\^/g, "**")
    .replace(/[^0-9\s\+\-\*\/\(\)\.\%eE]/g, "");
}

export function calculate(expression: string): CalcResult {
  const clean = sanitize(expression.trim());
  if (!clean || !/\d/.test(clean)) {
    throw new Error(`Cannot evaluate: "${expression}"`);
  }

  // eslint-disable-next-line no-new-func
  const raw = Function(`"use strict"; return (${clean})`)() as unknown;
  if (typeof raw !== "number" || !isFinite(raw)) {
    throw new Error(`Result is not a finite number`);
  }

  const formatted = Number.isInteger(raw)
    ? raw.toLocaleString()
    : parseFloat(raw.toPrecision(10)).toString();

  return { expression: clean, result: raw, formatted };
}
