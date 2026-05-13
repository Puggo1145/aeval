import type { CoreApi } from '@aeval/core';

export interface RunMetadata {
  suiteName?: string;
  taskId?: string;
}

function normalizeString(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function readRunMetadata(core: CoreApi, runId: string): Promise<RunMetadata> {
  const manifest = await core.results.getManifest(runId);
  return {
    suiteName: normalizeString(manifest?.suiteName),
    taskId: normalizeString(manifest?.taskId),
  };
}

export async function readRunMetadataMap(
  core: CoreApi,
  runIds: string[],
): Promise<Map<string, RunMetadata>> {
  const uniqueRunIds = [...new Set(runIds)];
  const entries = await Promise.all(
    uniqueRunIds.map(async (runId) => [runId, await readRunMetadata(core, runId)] as const),
  );

  return new Map(entries);
}
