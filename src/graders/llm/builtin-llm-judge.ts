import type { GraderConfigValidationResult } from '../config-validation.js';
import {
  type AiSdkJudgeProviderEnvironment,
  type AiSdkJudgeProviderPromptOptions,
  createAiSdkJudgeProvider,
  resolveAiSdkJudgeProviderOptionsFromEnv,
} from './ai-sdk-judge-provider.js';
import type { JudgeModelProvider, JudgeProvider } from './judge-provider.js';

export interface CreateBuiltinLlmJudgeProviderOptions {
  env?: AiSdkJudgeProviderEnvironment;
  promptOptions?: AiSdkJudgeProviderPromptOptions;
}

export function createBuiltinLlmJudgeProvider(
  options: CreateBuiltinLlmJudgeProviderOptions = {},
): JudgeProvider {
  const env = options.env ?? process.env;
  return createAiSdkJudgeProvider(
    resolveAiSdkJudgeProviderOptionsFromEnv(env),
    options.promptOptions,
  );
}

export function createBuiltinLlmJudgeConfigValidator(
  env: AiSdkJudgeProviderEnvironment = process.env,
): (config: { judge: { provider: JudgeModelProvider } }) => GraderConfigValidationResult {
  return (config) => {
    if (config.judge.provider === 'aihubmix' && !env.AIHUBMIX_API_KEY) {
      return {
        valid: false,
        reason: "Judge provider 'aihubmix' requires process.env.AIHUBMIX_API_KEY.",
      };
    }

    return { valid: true };
  };
}
