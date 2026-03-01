export interface TaskSourceAdapter {
  resolveDataset(input: {
    ref: string;
    selector?: {
      revision?: string;
      tag?: string;
    };
  }): Promise<ResolvedDataset>;
}

export interface ResolvedDataset {
  source: {
    adapter: string;
    ref: string;
    revision: string;
    fetchedAt: string;
  };
  tasks: unknown[];
  datasetHash: string;
}
