import { createConsoleObserverAdapter } from '../adapters/observer/index.js';
import { createLocalResultStoreAdapter } from '../adapters/result-store/index.js';
import { createLocalTaskSourceAdapter } from '../adapters/task-source/index.js';
import { type CoreApi, createCore } from '../core/api/index.js';
import { ValidationError } from '../core/errors/index.js';
import { InMemoryGraderRegistry } from '../core/runtime/grader-registry.js';
import { InMemoryProviderRegistry } from '../core/runtime/provider-registry.js';
import type { JudgeProvider } from '../graders/llm/judge-provider.js';
import { registerBuiltinGraders } from '../graders/register-builtins.js';
import { registerReferenceProvider } from '../providers/index.js';

export interface AppCoreOptions {
  datasetsRoot: string;
  /** Root directory for storing run results. Defaults to '.youeval/runs'. */
  runsRoot?: string;
  /** Optional JudgeProvider for the llm-judge grader. */
  judgeProvider?: JudgeProvider;
}

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  throw new ValidationError(`Field '${field}' must be a non-empty string.`, {
    details: {
      field,
      value,
    },
  });
}

export function createAppCore(options: AppCoreOptions): CoreApi {
  const datasetsRoot = ensureNonEmptyString(options.datasetsRoot, 'datasetsRoot');
  const runsRoot =
    options.runsRoot === undefined
      ? '.youeval/runs'
      : ensureNonEmptyString(options.runsRoot, 'runsRoot');

  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry, { judgeProvider: options.judgeProvider });

  const providerRegistry = new InMemoryProviderRegistry();
  registerReferenceProvider(providerRegistry);

  return createCore({
    taskSourceAdapters: {
      local: createLocalTaskSourceAdapter({ datasetsRoot }),
    },
    resultStoreAdapters: {
      local: createLocalResultStoreAdapter({ rootDir: runsRoot }),
    },
    providerRegistry,
    graderRegistry,
    observerAdapters: {
      console: createConsoleObserverAdapter(),
    },
  });
}
