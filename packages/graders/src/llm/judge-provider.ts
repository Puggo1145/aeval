import type { LanguageModel } from 'ai';

export type JudgeProfileMap = Readonly<Record<string, LanguageModel>>;

export interface JudgeModelConfig {
  profile: string;
}

/**
 * JudgeProvider — protocol for LLM-based semantic evaluation.
 *
 * Core only defines this interface; concrete implementations are injected at
 * composition time.
 */
export interface JudgeProviderInput {
  output: string;
  rubric: string;
  assertions: string[];
  context?: unknown;
  dimension: string;
  judge: JudgeModelConfig;
}

export interface JudgeAssertionResult {
  assertion: string;
  pass: boolean;
  reason: string;
}

export interface JudgeProviderResult {
  pass: boolean;
  score: number;
  reason: string;
  assertions: JudgeAssertionResult[];
  profile: string;
  model?: string;
}

export interface JudgeProvider {
  evaluate(input: JudgeProviderInput): Promise<JudgeProviderResult>;
}
