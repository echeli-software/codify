import { type CriterionResult, type RubricCriterion } from '@codify/domain';

/**
 * LLM-judge seam for AI-prompt rubric criteria of kind `llm`. The
 * deterministic criteria (keyword/regex/word-count) are graded in
 * `@codify/domain`; only `llm` criteria reach a provider.
 *
 * Prod wires a real model (Claude) behind this interface. Locally a
 * DevHeuristicGrader judges deterministically — it checks whether the response
 * covers the criterion's `concepts` — so the full grade → reward loop runs
 * offline, instantly, and reproducibly (the "3s p95" target is trivially met).
 * Mirrors the BillingProvider / CodeExecutionProvider dev-stub pattern.
 */

export const AI_GRADER = Symbol('AI_GRADER');

export interface GradeContext {
  promptText: string;
  contextText?: string | null;
}

export interface AiGrader {
  readonly mode: 'dev' | 'llm';
  /** Judge the `llm`-kind criteria; deterministic ones are handled upstream. */
  judge(
    response: string,
    criteria: RubricCriterion[],
    ctx: GradeContext,
  ): Promise<CriterionResult[]>;
}

export class DevHeuristicGrader implements AiGrader {
  readonly mode = 'dev' as const;

  async judge(
    response: string,
    criteria: RubricCriterion[],
  ): Promise<CriterionResult[]> {
    const text = response.normalize('NFKD').toLowerCase();
    const words = (text.match(/\S+/g) ?? []).length;
    return criteria.map((c) => {
      const concepts = c.config?.concepts ?? [];
      if (concepts.length === 0) {
        // No concept list → reward a non-trivial, on-task answer.
        const passed = words >= 20;
        return {
          id: c.id,
          label: c.label,
          weight: c.weight,
          passed,
          detail: passed ? 'substantive answer' : 'answer too short',
        };
      }
      const hit = concepts.filter((k) =>
        text.includes(k.normalize('NFKD').toLowerCase()),
      );
      // Cover at least half the concepts to satisfy the criterion.
      const passed = hit.length * 2 >= concepts.length;
      return {
        id: c.id,
        label: c.label,
        weight: c.weight,
        passed,
        detail: passed
          ? `covers ${hit.length}/${concepts.length} concepts`
          : `covers only ${hit.length}/${concepts.length} concepts`,
      };
    });
  }
}
