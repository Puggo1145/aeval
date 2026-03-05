import type { CoreApi } from '../../core/api/index.js';

function normalizeExperiment(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function readRunExperiment(core: CoreApi, runId: string): Promise<string | undefined> {
  const manifest = await core.getRunManifest(runId);
  return (
    normalizeExperiment((manifest as { exp?: unknown } | null)?.exp) ??
    normalizeExperiment((manifest as { experiment?: unknown } | null)?.experiment) ??
    normalizeExperiment(manifest?.experimentName)
  );
}

export async function readRunExperiments(
  core: CoreApi,
  runIds: string[],
): Promise<Map<string, string>> {
  const uniqueRunIds = [...new Set(runIds)];
  const entries = await Promise.all(
    uniqueRunIds.map(async (runId) => [runId, await readRunExperiment(core, runId)] as const),
  );

  const map = new Map<string, string>();
  for (const [runId, experiment] of entries) {
    if (experiment) {
      map.set(runId, experiment);
    }
  }
  return map;
}
