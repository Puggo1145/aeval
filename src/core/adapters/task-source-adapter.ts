export interface DatasetSelector {
  dataset: string;
  revision?: string;
  tag?: string;
}

export interface TaskSourceAdapter {
  resolveDataset(selector: DatasetSelector): Promise<ResolvedDataset>;
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
