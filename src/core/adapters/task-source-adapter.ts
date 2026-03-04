export interface TaskSourceAdapter {
  resolveDataset(): Promise<ResolvedDataset>;
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
