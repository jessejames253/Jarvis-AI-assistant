import type { Tool, ToolInput, ToolOutput } from "../types";

/** Safely evaluates a numeric expression string */
function safeEval(expr: string): number | null {
  try {
    const sanitized = expr
      .replace(/\^/g, "**")     // convert ^ to JS exponent operator
      .replace(/[^0-9\s\+\-\*\/\(\)\.\%]/g, ""); // strip anything non-numeric

    if (!sanitized.trim() || !/\d/.test(sanitized)) return null;

    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${sanitized})`)() as unknown;
    if (typeof result === "number" && isFinite(result)) return result;
    return null;
  } catch {
    return null;
  }
}

/** Extracts a numeric expression (must contain digits AND an operator) */
function extractExpression(msg: string): string | null {
  // Find all digit-containing runs, then pick the one that has an operator
  const candidates = msg.match(/\d[\d\s\+\-\*\/\^\(\)\.%]*[\d\)]/g) ?? [];
  const expr = candidates.find((c) => /[\+\-\*\/\^%]/.test(c));
  if (expr) return expr.trim();
  // Fallback: look for a standalone arithmetic pattern
  const inline = msg.match(/\d+\s*[\+\-\*\/\^%]\s*\d+(?:\s*[\+\-\*\/\^%]\s*\d+)*/)?.[0];
  return inline?.trim() ?? null;
}

export const mathTool: Tool = {
  name: "math",
  description: "Handles arithmetic calculations and math questions",
  handles: ["math"],
  async execute(input: ToolInput): Promise<ToolOutput> {
    const expr = extractExpression(input.message);
    const reasoning: string[] = ["Intent: math/calculation"];

    if (expr) {
      reasoning.push(`Expression extracted: "${expr}"`);
      const result = safeEval(expr);

      if (result !== null) {
        reasoning.push(`Evaluated: ${expr} = ${result}`);
        reasoning.push("Result formatted as bold inline answer");

        // Format nicely: remove trailing .0 for whole numbers
        const formatted = Number.isInteger(result) ? result.toString() : result.toFixed(6).replace(/\.?0+$/, "");
        return {
          response: `**${expr.trim()} = ${formatted}**`,
          action: "arithmetic_eval",
          mode: "calculator",
          reasoning,
        };
      }

      reasoning.push("Expression could not be safely evaluated — asking for clarification");
    } else {
      reasoning.push("No evaluatable expression found — routing to math explanation");
    }

    // Couldn't evaluate — ask for clarification or explain the concept
    const isConceptual = /\b(what is|explain|how does|tell me about)\b/i.test(input.message);
    if (isConceptual) {
      reasoning.push("Conceptual math question detected — providing explanation prompt");
      return {
        response:
          "Happy to explain that math concept. Could you be more specific about what aspect you'd like me to cover? " +
          "For example: the formula, how it's applied, or a worked example?",
        action: "math_explain",
        mode: "calculator",
        reasoning,
      };
    }

    return {
      response:
        "I can evaluate arithmetic expressions directly — just write it out clearly, like `12 * (34 + 5)`. " +
        "For more complex problems, share the full equation and I'll work through it step by step.",
      action: "math_clarify",
      mode: "calculator",
      reasoning,
    };
  },
};
