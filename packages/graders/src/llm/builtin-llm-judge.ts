import type { GraderConfigValidationResult } from '../config-validation.js';
import {
  type AiSdkJudgeProviderOptions,
  type AiSdkJudgeProviderPromptOptions,
  createAiSdkJudgeProvider,
} from './ai-sdk-judge-provider.js';
import type { JudgeProvider } from './judge-provider.js';
import { LlmJudgeGrader } from './llm-judge.js';

export interface BuiltinLlmJudgeProviderOptions {
  profiles: AiSdkJudgeProviderOptions['profiles'];
  promptOptions?: AiSdkJudgeProviderPromptOptions;
}

export interface BuiltinLlmJudgeGraderOptions extends BuiltinLlmJudgeProviderOptions {}

export class BuiltinLlmJudgeProvider implements JudgeProvider {
  private readonly provider: JudgeProvider;

  constructor(options: BuiltinLlmJudgeProviderOptions) {
    this.provider = createAiSdkJudgeProvider({ profiles: options.profiles }, options.promptOptions);
  }

  async evaluate(input: Parameters<JudgeProvider['evaluate']>[0]) {
    return this.provider.evaluate(input);
  }
}

export class BuiltinLlmJudgeConfigValidator {
  constructor(private readonly profiles: AiSdkJudgeProviderOptions['profiles']) {}

  validate(config: { judge: { profile: string } }): GraderConfigValidationResult {
    if (!Object.prototype.hasOwnProperty.call(this.profiles, config.judge.profile)) {
      return {
        valid: false,
        reason: `Judge profile '${config.judge.profile}' is not registered.`,
      };
    }

    return { valid: true };
  }
}

export class BuiltinLlmJudgeGrader extends LlmJudgeGrader {
  constructor(options: BuiltinLlmJudgeGraderOptions) {
    const validator = new BuiltinLlmJudgeConfigValidator(options.profiles);

    super(new BuiltinLlmJudgeProvider(options), {
      validateConfig: (config) => validator.validate(config),
    });
  }
}
