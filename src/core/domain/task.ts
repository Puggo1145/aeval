import type { TaskSource } from '../adapters/task-source-adapter.js';
import type {
  TaskDocument,
  TaskExecutionDocument,
  TaskGraderStrategy,
  TaskGradersDocument,
  WeightedGraderLayerDocument,
} from '../contracts/task.js';
import { parseTaskDocument } from '../contracts/task.js';
import { ValidationError } from '../errors/index.js';
import { cloneAndFreezeRecord } from '../utils/immutability.js';
import { GraderLayer } from './grader-layer.js';
import { Run } from './run.js';

export interface TaskInit {
  document: unknown;
  source?: TaskSource;
}

export class Task {
  readonly schemaVersion: TaskDocument['schemaVersion'];
  readonly id: string;
  readonly desc?: string;
  readonly category?: string;
  readonly capability?: string;
  readonly tier?: string;
  readonly difficulty?: string;
  readonly tags?: readonly string[];
  readonly lifecycle?: Readonly<Record<string, unknown>>;
  readonly trackedMetrics?: Readonly<Record<string, unknown>>;
  readonly providerId: string;
  readonly runs: readonly Run[];
  readonly graderStrategy: TaskGraderStrategy;
  readonly graderLayers: readonly GraderLayer[];
  readonly passThreshold?: number;
  readonly execution: Readonly<TaskExecutionDocument>;
  readonly source?: TaskSource;

  constructor(input: TaskInit) {
    const document = parseTaskDocument(input.document);

    this.schemaVersion = document.schemaVersion;
    this.id = document.id;
    this.providerId = document.provider.id;
    this.runs = Object.freeze(document.provider.runs.map((run) => Run.fromDocument(run)));
    this.graderStrategy = document.graders.strategy;
    this.graderLayers = Object.freeze(
      document.graders.layers.map((layer) => GraderLayer.fromDocument(layer)),
    );
    this.execution = Object.freeze({
      timeoutMs: document.execution.timeoutMs,
      // 以下可选配置在运行时通过 execution policy 归一化函数补齐默认值。
      // Task 应该反映的是用户实际配置了什么，在这里承担默认值逻辑会让 Task 偏离用户的真实配置表达。
      ...(document.execution.retryOnError !== undefined
        ? { retryOnError: document.execution.retryOnError }
        : {}),
      ...(document.execution.trialsPerTask !== undefined
        ? { trialsPerTask: document.execution.trialsPerTask }
        : {}),
      ...(document.execution.maxConcurrency !== undefined
        ? { maxConcurrency: document.execution.maxConcurrency }
        : {}),
    });

    if (document.desc !== undefined) {
      this.desc = document.desc;
    }
    if (document.category !== undefined) {
      this.category = document.category;
    }
    if (document.capability !== undefined) {
      this.capability = document.capability;
    }
    if (document.tier !== undefined) {
      this.tier = document.tier;
    }
    if (document.difficulty !== undefined) {
      this.difficulty = document.difficulty;
    }
    if (document.tags !== undefined) {
      this.tags = Object.freeze([...document.tags]);
    }
    if (document.lifecycle !== undefined) {
      this.lifecycle = cloneAndFreezeRecord(document.lifecycle);
    }
    if (document.trackedMetrics !== undefined) {
      this.trackedMetrics = cloneAndFreezeRecord(document.trackedMetrics);
    }
    if ('passThreshold' in document.graders && document.graders.passThreshold !== undefined) {
      this.passThreshold = document.graders.passThreshold;
    }
    if (input.source !== undefined) {
      this.source = Object.freeze({ ...input.source });
    }

    this.assertInvariants();
  }

  static fromDocument(document: unknown, source?: TaskSource): Task {
    return new Task({ document, source });
  }

  toDocument(): TaskDocument {
    this.assertInvariants();

    const graders: TaskGradersDocument =
      this.graderStrategy === 'WEIGHTED'
        ? {
            strategy: 'WEIGHTED',
            passThreshold: this.requireWeightedPassThreshold(),
            layers: this.graderLayers.map((layer) => {
              if (layer.weight === undefined) {
                throw new ValidationError(
                  `Weighted task '${this.id}' is missing grader layer weights.`,
                  {
                    details: {
                      field: 'task.graders.layers[].weight',
                      taskId: this.id,
                    },
                  },
                );
              }

              return layer.toDocument() as WeightedGraderLayerDocument;
            }),
          }
        : {
            strategy: this.graderStrategy,
            layers: this.graderLayers.map((layer) => layer.toDocument()),
          };

    return {
      schemaVersion: this.schemaVersion,
      id: this.id,
      ...(this.desc !== undefined ? { desc: this.desc } : {}),
      ...(this.category !== undefined ? { category: this.category } : {}),
      ...(this.capability !== undefined ? { capability: this.capability } : {}),
      ...(this.tier !== undefined ? { tier: this.tier } : {}),
      ...(this.difficulty !== undefined ? { difficulty: this.difficulty } : {}),
      ...(this.tags !== undefined ? { tags: [...this.tags] } : {}),
      ...(this.lifecycle !== undefined ? { lifecycle: { ...this.lifecycle } } : {}),
      provider: {
        id: this.providerId,
        runs: this.runs.map((run) => run.toDocument()),
      },
      graders,
      ...(this.trackedMetrics !== undefined ? { trackedMetrics: { ...this.trackedMetrics } } : {}),
      execution: { ...this.execution },
    };
  }

  private assertInvariants(): void {
    if (this.graderStrategy !== 'WEIGHTED') {
      return;
    }

    this.requireWeightedPassThreshold();

    for (const [layerIndex, layer] of this.graderLayers.entries()) {
      if (layer.weight === undefined) {
        throw new ValidationError(
          `Weighted task '${this.id}' is missing a weight for grader layer '${layer.name}'.`,
          {
            details: {
              field: `task.graders.layers[${layerIndex}].weight`,
              taskId: this.id,
              layerName: layer.name,
            },
          },
        );
      }
    }
  }

  private requireWeightedPassThreshold(): number {
    if (this.passThreshold === undefined) {
      throw new ValidationError(`Weighted task '${this.id}' is missing passThreshold.`, {
        details: {
          field: 'task.graders.passThreshold',
          taskId: this.id,
        },
      });
    }

    return this.passThreshold;
  }
}
