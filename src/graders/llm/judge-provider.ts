/**
 * JudgeProvider — protocol for LLM-based semantic evaluation.
 *
 * Core only defines this interface; concrete implementations (e.g., calling
 * a specific LLM API) are injected at composition time.
 */
export interface JudgeProviderInput {
  output: string;
  rubric: string;
  context?: unknown;
  dimension: string;
}

export interface JudgeProviderResult {
  pass: boolean;
  score?: number;
  reason: string;
  label?: 'PASS' | 'FAIL' | 'UNKNOWN';
}

export interface JudgeProvider {
  evaluate(input: JudgeProviderInput): Promise<JudgeProviderResult>;
}
