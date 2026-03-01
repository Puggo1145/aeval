import type { ObserverAdapter } from '../adapters/observer-adapter.js';
import type { ResultStoreAdapter } from '../adapters/result-store-adapter.js';
import type { TaskSourceAdapter } from '../adapters/task-source-adapter.js';
import type { ExperimentDefinition } from '../contracts/experiment.js';
import type {
  Grader,
  GraderRegistry,
  ProviderRegistry,
  TaskProvider,
} from '../contracts/runtime.js';
import { ERROR_CODES, RuntimeError } from '../errors/index.js';

interface MissingDependencyDetails extends Record<string, unknown> {
  field: string;
  dependencyType: string;
  requestedId: string;
  available: string[];
}

function throwMissingDependencyError(details: MissingDependencyDetails): never {
  throw new RuntimeError(
    `Unable to resolve ${details.dependencyType} '${details.requestedId}' from '${details.field}'.`,
    {
      code: ERROR_CODES.RUNTIME_DEPENDENCY_MISSING,
      details,
    },
  );
}

function resolveAdapterOrThrow<TAdapter>(
  adapters: Readonly<Record<string, TAdapter>> | undefined,
  adapterId: string,
  field: string,
  dependencyType: string,
): TAdapter {
  const normalizedAdapterId = adapterId.trim();
  if (normalizedAdapterId.length === 0) {
    throwMissingDependencyError({
      field,
      dependencyType,
      requestedId: adapterId,
      available: adapters ? Object.keys(adapters) : [],
    });
  }

  if (adapters && Object.hasOwn(adapters, normalizedAdapterId)) {
    const adapter = adapters[normalizedAdapterId];
    if (adapter !== undefined) {
      return adapter;
    }
  }

  throwMissingDependencyError({
    field,
    dependencyType,
    requestedId: normalizedAdapterId,
    available: adapters ? Object.keys(adapters) : [],
  });
}

export interface RuntimeDependencyContainer {
  taskSourceAdapters: Readonly<Record<string, TaskSourceAdapter>>;
  resultStoreAdapters: Readonly<Record<string, ResultStoreAdapter>>;
  observerAdapters?: Readonly<Record<string, ObserverAdapter>>;
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
}

export interface ResolvedRuntimeDependencies {
  taskSourceAdapter: TaskSourceAdapter;
  resultStoreAdapter: ResultStoreAdapter;
  observerAdapters: ObserverAdapter[];
  providerRegistry: ProviderRegistry;
  graderRegistry: GraderRegistry;
}

export function resolveRuntimeDependencies(
  experiment: ExperimentDefinition,
  dependencies: RuntimeDependencyContainer,
): ResolvedRuntimeDependencies {
  const taskSourceAdapter = resolveAdapterOrThrow(
    dependencies.taskSourceAdapters,
    experiment.taskSource.adapter,
    'experiment.taskSource.adapter',
    'taskSourceAdapter',
  );

  const resultStoreAdapter = resolveAdapterOrThrow(
    dependencies.resultStoreAdapters,
    experiment.resultStore.adapter,
    'experiment.resultStore.adapter',
    'resultStoreAdapter',
  );

  const observerAdapters =
    experiment.observers?.map((observer, index) =>
      resolveAdapterOrThrow(
        dependencies.observerAdapters,
        observer.type,
        `experiment.observers[${index}].type`,
        'observerAdapter',
      ),
    ) ?? [];

  return {
    taskSourceAdapter,
    resultStoreAdapter,
    observerAdapters,
    providerRegistry: dependencies.providerRegistry,
    graderRegistry: dependencies.graderRegistry,
  };
}

export function resolveProviderOrThrow(
  providerId: string,
  providerRegistry: ProviderRegistry,
): TaskProvider {
  const normalizedProviderId = providerId.trim();
  const provider = providerRegistry.get(normalizedProviderId);
  if (provider) {
    return provider;
  }

  throwMissingDependencyError({
    field: 'task.provider.id',
    dependencyType: 'provider',
    requestedId: normalizedProviderId,
    available: providerRegistry.list(),
  });
}

export function resolveGraderOrThrow(type: string, graderRegistry: GraderRegistry): Grader {
  const normalizedType = type.trim();
  const grader = graderRegistry.get(normalizedType);
  if (grader) {
    return grader;
  }

  throwMissingDependencyError({
    field: 'task.graders.layers[].type',
    dependencyType: 'grader',
    requestedId: normalizedType,
    available: graderRegistry.list(),
  });
}
