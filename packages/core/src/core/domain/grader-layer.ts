import type { TaskGraderLayerDocument, WeightedGraderLayerDocument } from '../contracts/task.js';
import { cloneAndFreezeRecord } from '../utils/immutability.js';
import { ensureNonEmptyString } from '../validation/helpers.js';

export type GraderLayerDocument = TaskGraderLayerDocument | WeightedGraderLayerDocument;

export interface GraderLayerInit {
  name: string;
  type: string;
  config?: Record<string, unknown>;
  weight?: number;
}

export class GraderLayer {
  readonly name: string;
  readonly type: string;
  readonly config: Readonly<Record<string, unknown>>;
  readonly weight?: number;

  constructor(input: GraderLayerInit) {
    this.name = ensureNonEmptyString(input.name, 'task.graders.layers[].name');
    this.type = ensureNonEmptyString(input.type, 'task.graders.layers[].type');
    this.config = cloneAndFreezeRecord(input.config);

    if (input.weight !== undefined) {
      this.weight = input.weight;
    }
  }

  static fromDocument(document: GraderLayerDocument): GraderLayer {
    return new GraderLayer({
      name: document.name,
      type: document.type,
      config: document.config,
      ...('weight' in document ? { weight: document.weight } : {}),
    });
  }

  toDocument(): GraderLayerDocument {
    return {
      name: this.name,
      type: this.type,
      ...(Object.keys(this.config).length > 0 ? { config: { ...this.config } } : {}),
      ...(this.weight !== undefined ? { weight: this.weight } : {}),
    };
  }
}
