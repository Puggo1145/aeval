import type { GraderConfigValidationResult } from '../config-validation.js';
import {
  type AiSdkJudgeProviderEnvironment,
  type AiSdkJudgeProviderPromptOptions,
  createAiSdkJudgeProvider,
  resolveAiSdkJudgeProviderOptionsFromEnv,
} from './ai-sdk-judge-provider.js';
import type { JudgeModelProvider, JudgeProvider } from './judge-provider.js';

export interface BuiltinLlmJudgeProviderOptions {
  env?: AiSdkJudgeProviderEnvironment;
  promptOptions?: AiSdkJudgeProviderPromptOptions;
}

export class BuiltinLlmJudgeProvider implements JudgeProvider {
  private readonly provider: JudgeProvider;

  constructor(options: BuiltinLlmJudgeProviderOptions = {}) {
    const env = options.env ?? process.env;
    this.provider = createAiSdkJudgeProvider(
      resolveAiSdkJudgeProviderOptionsFromEnv(env),
      options.promptOptions,
    );
  }

  async evaluate(input: Parameters<JudgeProvider['evaluate']>[0]) {
    return this.provider.evaluate(input);
  }
}

export class BuiltinLlmJudgeConfigValidator {
  constructor(private readonly env: AiSdkJudgeProviderEnvironment = process.env) {}

  validate(config: { judge: { provider: JudgeModelProvider } }): GraderConfigValidationResult {
    if (config.judge.provider === 'aihubmix' && !this.env.AIHUBMIX_API_KEY) {
      return {
        valid: false,
        reason: "Judge provider 'aihubmix' requires process.env.AIHUBMIX_API_KEY.",
      };
    }

    return { valid: true };
  }
}
