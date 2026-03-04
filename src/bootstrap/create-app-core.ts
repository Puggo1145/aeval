import { createConsoleObserverAdapter } from '../adapters/observer/index.js';
import { createLocalResultStoreAdapter } from '../adapters/result-store/index.js';
import { createLocalTaskSourceAdapter } from '../adapters/task-source/index.js';
import { type CoreApi, createCore } from '../core/api/index.js';
import { InMemoryGraderRegistry } from '../core/runtime/grader-registry.js';
import { InMemoryProviderRegistry } from '../core/runtime/provider-registry.js';
import { registerBuiltinGraders } from '../graders/register-builtins.js';
import { registerReferenceProvider } from '../providers/index.js';

export function createAppCore(): CoreApi {
  const graderRegistry = new InMemoryGraderRegistry();
  registerBuiltinGraders(graderRegistry);

  const providerRegistry = new InMemoryProviderRegistry();
  registerReferenceProvider(providerRegistry);

  return createCore({
    taskSourceAdapter: createLocalTaskSourceAdapter({
      datasetsRoot: '.datasets',
    }),
    resultStoreAdapter: createLocalResultStoreAdapter({ rootDir: '.youeval/runs' }),
    providerRegistry,
    graderRegistry,
    observerAdapters: [createConsoleObserverAdapter()],
  });
}
