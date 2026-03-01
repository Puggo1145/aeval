import { createLocalTaskSourceAdapter } from '../adapters/task-source/index.js';
import { type CoreApi, createCore } from '../core/api/index.js';
import { ValidationError } from '../core/errors/index.js';
import { InMemoryGraderRegistry } from '../core/runtime/grader-registry.js';
import { InMemoryProviderRegistry } from '../core/runtime/provider-registry.js';
import type { JudgeProvider } from '../graders/llm/judge-provider.js';
import { registerBuiltinGraders } from '../graders/register-builtins.js';

export interface AppCoreOptions {
  datasetsRoot: string;
  /** Optional JudgeProvider for the llm-judge grader. */
  judgeProvider?: JudgeProvider;
}

function ensureDatasetsRoot(value: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  throw new ValidationError("Field 'datasetsRoot' must be a non-empty string.", {
    details: {
      field: 'datasetsRoot',
      value,
    },
  });
}

export function createAppCore(options: AppCoreOptions): CoreApi {
  const datasetsRoot = ensureDatasetsRoot(options.datasetsRoot);

  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry, { judgeProvider: options.judgeProvider });

  return createCore({
    taskSourceAdapters: {
      local: createLocalTaskSourceAdapter({ datasetsRoot }),
    },
    resultStoreAdapters: {},
    providerRegistry: new InMemoryProviderRegistry(),
    graderRegistry,
  });
}
