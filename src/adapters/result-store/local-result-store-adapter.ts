import type { Dirent } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  BaselineRecord,
  ClearedResultEntry,
  ResultStoreAdapter,
} from '../../core/adapters/result-store-adapter.js';
import type { RunManifest } from '../../core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../../core/contracts/run-summary.js';
import { SCHEMA_VERSIONS } from '../../core/contracts/schema-versions.js';
import type { TrialResultRecord } from '../../core/contracts/trial.js';
import { StoreError, ValidationError } from '../../core/errors/index.js';
import { ensureNonEmptyString } from '../../core/validation/helpers.js';

const MANIFEST_FILE = 'manifest.json';
const SUMMARY_FILE = 'summary.json';
const TRIALS_DIR = 'trials';
const BASELINE_FILE = 'baseline.json';
const INTERRUPTED_RUN_NAME = 'interrupted';

export interface LocalResultStoreAdapterOptions {
  rootDir: string;
}

function trialFileName(taskId: string, trialIndex: number): string {
  // Encode taskId to avoid collisions between values like "a/b" and "a--b".
  const encodedTaskId = Buffer.from(taskId, 'utf-8').toString('base64url');
  return `${encodedTaskId}-${trialIndex}.json`;
}

function normalizeRunId(runId: string): string {
  const normalized = ensureNonEmptyString(runId, 'runId');

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new ValidationError("Field 'runId' must not contain path separators.", {
      details: {
        field: 'runId',
        value: runId,
      },
    });
  }

  if (normalized === '.' || normalized === '..') {
    throw new ValidationError(`Field 'runId' must not be '${normalized}'.`, {
      details: {
        field: 'runId',
        value: runId,
      },
    });
  }

  return normalized;
}

function assertPathInsideRoot(rootPath: string, targetPath: string, runId: string): void {
  const relativePath = relative(rootPath, targetPath);
  const isOutsideRoot =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (!isOutsideRoot) {
    return;
  }

  throw new ValidationError(`Run '${runId}' points outside configured result store root.`, {
    details: {
      field: 'runId',
      runId,
      rootDir: rootPath,
      targetPath,
    },
  });
}

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  const content = JSON.stringify(data, null, 2);
  await writeFile(filePath, content, 'utf-8');
}

async function readJsonFileOrNull<T>(filePath: string): Promise<T | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    return JSON.parse(content) as T;
  } catch (cause) {
    const errorCode = extractFsErrorCode(cause);
    if (errorCode === 'ENOENT') {
      return null;
    }

    throw new StoreError(`Failed to read file '${filePath}'.`, {
      details: { filePath },
      cause,
    });
  }
}

function extractFsErrorCode(cause: unknown): string | null {
  if (
    typeof cause === 'object' &&
    cause !== null &&
    'code' in cause &&
    typeof (cause as { code?: unknown }).code === 'string'
  ) {
    return (cause as { code: string }).code;
  }
  return null;
}

async function assertResolvedPathInsideRoot(
  rootDirPath: string,
  targetPath: string,
  runId: string,
): Promise<void> {
  await ensureDir(rootDirPath);

  const rootRealPath = await realpath(rootDirPath);
  const targetRealPath = await realpath(targetPath);
  if (!isPathOutsideRoot(rootRealPath, targetRealPath)) {
    return;
  }

  throw new ValidationError(`Run '${runId}' points outside configured result store root.`, {
    details: {
      field: 'runId',
      runId,
      rootDir: rootRealPath,
      targetPath: targetRealPath,
    },
  });
}

async function rejectSymlinkPath(path: string, field: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) {
      return;
    }

    throw new ValidationError(`Field '${field}' must not resolve to a symbolic link.`, {
      details: {
        field,
        path,
      },
    });
  } catch (cause) {
    if (extractFsErrorCode(cause) === 'ENOENT') {
      return;
    }
    throw cause;
  }
}

function toDisplayPath(path: string): string {
  return path.split(sep).join('/');
}

async function collectEntriesForDeletion(rootDirPath: string): Promise<ClearedResultEntry[]> {
  async function walk(dirPath: string): Promise<ClearedResultEntry[]> {
    let dirents: Dirent[];
    try {
      dirents = await readdir(dirPath, { withFileTypes: true });
    } catch (cause) {
      if (extractFsErrorCode(cause) === 'ENOENT') {
        return [];
      }
      throw new StoreError(`Failed to read directory '${dirPath}'.`, {
        details: { dirPath },
        cause,
      });
    }

    const sorted = dirents.sort((a, b) => a.name.localeCompare(b.name));
    const entries: ClearedResultEntry[] = [];
    for (const dirent of sorted) {
      const childPath = join(dirPath, dirent.name);
      const relativePath = toDisplayPath(relative(rootDirPath, childPath));
      if (dirent.isDirectory()) {
        entries.push(...(await walk(childPath)));
        entries.push({ path: relativePath, kind: 'dir' });
        continue;
      }

      entries.push({ path: relativePath, kind: 'file' });
    }

    return entries;
  }

  return walk(rootDirPath);
}

function withPrefix(entries: ClearedResultEntry[], prefix: string): ClearedResultEntry[] {
  return entries.map((entry) => ({
    ...entry,
    path: `${prefix}/${entry.path}`,
  }));
}

function summarizeTrialsAsRunSummary(
  runId: string,
  trials: TrialResultRecord[],
): RunSummaryRecord | null {
  if (trials.length === 0) {
    return null;
  }

  const normalizedRunId = normalizeRunId(runId);
  const trialsByTask = new Map<string, TrialResultRecord[]>();

  for (const record of trials) {
    const taskId = record.trial.taskId;
    const existing = trialsByTask.get(taskId) ?? [];
    existing.push(record);
    trialsByTask.set(taskId, existing);
  }

  const totalTasks = trialsByTask.size;
  const totalTrials = trials.length;
  let passAtKCount = 0;
  let passHatKCount = 0;
  let hasMultipleTrials = false;

  for (const taskTrials of trialsByTask.values()) {
    if (taskTrials.length > 1) {
      hasMultipleTrials = true;
    }

    const anyPass = taskTrials.some((trial) => trial.trial.aggregate.pass);
    const allPass = taskTrials.every((trial) => trial.trial.aggregate.pass);
    if (anyPass) {
      passAtKCount++;
    }
    if (allPass) {
      passHatKCount++;
    }
  }

  const latencyValues = trials
    .map((trial) => trial.trial.execution.metrics?.latencyMs)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const avgLatencyMs =
    latencyValues.length > 0
      ? latencyValues.reduce((sum, value) => sum + value, 0) / latencyValues.length
      : undefined;

  const runName =
    trials[0]?.trial.runName && trials[0].trial.runName.trim().length > 0
      ? trials[0].trial.runName.trim()
      : normalizedRunId;

  return {
    runId: normalizedRunId,
    summary: {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId: normalizedRunId,
      runName,
      totalTasks,
      totalTrials,
      passRate: totalTasks > 0 ? passAtKCount / totalTasks : 0,
      ...(hasMultipleTrials
        ? {
            passAtK: totalTasks > 0 ? passAtKCount / totalTasks : 0,
            passHatK: totalTasks > 0 ? passHatKCount / totalTasks : 0,
          }
        : {}),
      ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
    },
  };
}

function summarizeManifestAsRunSummary(runId: string): RunSummaryRecord {
  const normalizedRunId = normalizeRunId(runId);
  return {
    runId: normalizedRunId,
    summary: {
      schemaVersion: SCHEMA_VERSIONS.RUN_SUMMARY,
      runId: normalizedRunId,
      runName: INTERRUPTED_RUN_NAME,
      totalTasks: 0,
      totalTrials: 0,
      passRate: 0,
    },
  };
}

function assertTrialRunIdsMatch(input: TrialResultRecord): void {
  const normalizedRecordRunId = normalizeRunId(input.runId);
  const normalizedTrialRunId = normalizeRunId(input.trial.runId);

  if (normalizedRecordRunId === normalizedTrialRunId) {
    return;
  }

  throw new ValidationError("Field 'trial.runId' must match 'runId'.", {
    details: {
      field: 'trial.runId',
      runId: normalizedRecordRunId,
      trialRunId: normalizedTrialRunId,
    },
  });
}

export function createLocalResultStoreAdapter(
  options: LocalResultStoreAdapterOptions,
): ResultStoreAdapter {
  const rootDir = ensureNonEmptyString(options.rootDir, 'rootDir');
  const rootDirPath = resolve(rootDir);

  function runDir(runId: string): string {
    const normalizedRunId = normalizeRunId(runId);
    const dir = resolve(rootDirPath, normalizedRunId);
    assertPathInsideRoot(rootDirPath, dir, normalizedRunId);
    return dir;
  }

  async function writeStrict<T>(operation: () => Promise<T>, context: string): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof ValidationError) {
        throw cause;
      }

      throw new StoreError(`Write failed (strict-only): ${context}`, {
        details: { context, rootDir },
        cause,
      });
    }
  }

  async function listTrialsByRunId(runId: string): Promise<TrialResultRecord[]> {
    const trialsDir = join(runDir(runId), TRIALS_DIR);
    let entries: string[];
    try {
      entries = await readdir(trialsDir);
    } catch (cause) {
      const errorCode = extractFsErrorCode(cause);
      if (errorCode === 'ENOENT') {
        return [];
      }

      throw new StoreError(`Failed to list trials directory '${trialsDir}'.`, {
        details: { runId, trialsDir },
        cause,
      });
    }

    const jsonFiles = entries.filter((e) => e.endsWith('.json')).sort();
    const records: TrialResultRecord[] = [];
    for (const file of jsonFiles) {
      const filePath = join(trialsDir, file);
      const record = await readJsonFileOrNull<TrialResultRecord>(filePath);
      if (record) {
        records.push(record);
      }
    }

    records.sort(
      (a, b) =>
        a.trial.taskId.localeCompare(b.trial.taskId) || a.trial.trialIndex - b.trial.trialIndex,
    );

    return records;
  }

  async function getRunManifestByRunId(runId: string): Promise<RunManifest | null> {
    return readJsonFileOrNull<RunManifest>(join(runDir(runId), MANIFEST_FILE));
  }

  return {
    async saveRunManifest(input: RunManifest): Promise<void> {
      await writeStrict(async () => {
        const dir = runDir(input.runId);
        await rejectSymlinkPath(dir, 'runId');
        await ensureDir(dir);
        await assertResolvedPathInsideRoot(rootDirPath, dir, input.runId);
        await writeJsonFile(join(dir, MANIFEST_FILE), input);
      }, `saveRunManifest(${input.runId})`);
    },

    async saveRunSummary(input: RunSummaryRecord): Promise<void> {
      await writeStrict(async () => {
        const dir = runDir(input.runId);
        await rejectSymlinkPath(dir, 'runId');
        await ensureDir(dir);
        await assertResolvedPathInsideRoot(rootDirPath, dir, input.runId);
        await writeJsonFile(join(dir, SUMMARY_FILE), input);
      }, `saveRunSummary(${input.runId})`);
    },

    async saveTrial(input: TrialResultRecord): Promise<void> {
      await writeStrict(async () => {
        assertTrialRunIdsMatch(input);
        const trialsDir = join(runDir(input.runId), TRIALS_DIR);
        await rejectSymlinkPath(runDir(input.runId), 'runId');
        await rejectSymlinkPath(trialsDir, 'trialsDir');
        await ensureDir(trialsDir);
        await assertResolvedPathInsideRoot(rootDirPath, trialsDir, input.runId);
        const fileName = trialFileName(input.trial.taskId, input.trial.trialIndex);
        await writeJsonFile(join(trialsDir, fileName), input);
      }, `saveTrial(${input.runId}, ${input.trial.taskId}, ${input.trial.trialIndex})`);
    },

    async getRunManifest(runId: string): Promise<RunManifest | null> {
      return getRunManifestByRunId(runId);
    },

    async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
      const normalizedRunId = normalizeRunId(runId);
      const summaryPath = join(runDir(normalizedRunId), SUMMARY_FILE);
      const persisted = await readJsonFileOrNull<RunSummaryRecord>(summaryPath);
      if (persisted) {
        return persisted;
      }

      // Recover interrupted runs that have trial records but no summary.json yet.
      const trials = await listTrialsByRunId(normalizedRunId);
      const trialSummary = summarizeTrialsAsRunSummary(normalizedRunId, trials);
      if (trialSummary) {
        return trialSummary;
      }

      // Recover runs interrupted before first trial completion (manifest-only).
      const manifest = await getRunManifestByRunId(normalizedRunId);
      if (manifest) {
        return summarizeManifestAsRunSummary(normalizedRunId);
      }

      return null;
    },

    async listTrials(runId: string): Promise<TrialResultRecord[]> {
      return listTrialsByRunId(runId);
    },

    async saveBaseline(input: BaselineRecord): Promise<void> {
      await writeStrict(async () => {
        await ensureDir(rootDirPath);
        await writeJsonFile(join(rootDirPath, BASELINE_FILE), input);
      }, 'saveBaseline');
    },

    async getBaselineRunId(): Promise<string | null> {
      const record = await readJsonFileOrNull<BaselineRecord>(join(rootDirPath, BASELINE_FILE));
      return record?.runId ?? null;
    },

    async listRunIds(): Promise<string[]> {
      let entries: string[];
      try {
        entries = await readdir(rootDirPath, { withFileTypes: true }).then((dirents) =>
          dirents.filter((d) => d.isDirectory()).map((d) => d.name),
        );
      } catch (cause) {
        const errorCode = extractFsErrorCode(cause);
        if (errorCode === 'ENOENT') {
          return [];
        }

        throw new StoreError(`Failed to list run directories in '${rootDirPath}'.`, {
          details: { rootDir: rootDirPath },
          cause,
        });
      }

      const runIds: string[] = [];
      for (const dirName of entries) {
        const summaryPath = join(rootDirPath, dirName, SUMMARY_FILE);
        const summary = await readJsonFileOrNull(summaryPath);
        if (summary !== null) {
          runIds.push(dirName);
          continue;
        }

        const trialsDir = join(rootDirPath, dirName, TRIALS_DIR);
        const trialEntries = await readdir(trialsDir).catch((cause) => {
          const errorCode = extractFsErrorCode(cause);
          if (errorCode === 'ENOENT') {
            return [];
          }
          throw new StoreError(`Failed to list trials directory '${trialsDir}'.`, {
            details: { runId: dirName, trialsDir },
            cause,
          });
        });
        const hasTrialRecord = trialEntries.some((entry) => entry.endsWith('.json'));
        if (hasTrialRecord) {
          runIds.push(dirName);
          continue;
        }

        const manifestPath = join(rootDirPath, dirName, MANIFEST_FILE);
        const manifest = await readJsonFileOrNull(manifestPath);
        if (manifest !== null) {
          runIds.push(dirName);
        }
      }

      return runIds.sort();
    },

    async clearAllResults(): Promise<ClearedResultEntry[]> {
      return writeStrict(async () => {
        const deletedEntries = await collectEntriesForDeletion(rootDirPath);
        await rm(rootDirPath, { recursive: true, force: true });
        await ensureDir(rootDirPath);
        return deletedEntries;
      }, 'clearAllResults');
    },

    async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
      return writeStrict(async () => {
        const normalizedRunIds = [...new Set(runIds.map((runId) => normalizeRunId(runId)))].sort();
        if (normalizedRunIds.length === 0) {
          return [];
        }

        const deletedEntries: ClearedResultEntry[] = [];
        const deletedRunIdSet = new Set(normalizedRunIds);

        for (const runId of normalizedRunIds) {
          const dir = runDir(runId);
          await rejectSymlinkPath(dir, 'runId');

          let dirStat;
          try {
            dirStat = await lstat(dir);
          } catch (cause) {
            if (extractFsErrorCode(cause) === 'ENOENT') {
              continue;
            }
            throw cause;
          }

          if (!dirStat.isDirectory()) {
            throw new StoreError(`Expected run path '${dir}' to be a directory.`, {
              details: { runId, dir },
            });
          }

          const runEntries = await collectEntriesForDeletion(dir);
          deletedEntries.push(...withPrefix(runEntries, runId));
          await rm(dir, { recursive: true, force: true });
          deletedEntries.push({ path: runId, kind: 'dir' });
        }

        const baselineRecord = await readJsonFileOrNull<BaselineRecord>(
          join(rootDirPath, BASELINE_FILE),
        );
        const baselineRunId = baselineRecord?.runId ?? null;
        if (baselineRunId && deletedRunIdSet.has(baselineRunId)) {
          const baselinePath = join(rootDirPath, BASELINE_FILE);
          await rm(baselinePath, { force: true });
          deletedEntries.push({ path: BASELINE_FILE, kind: 'file' });
        }

        return deletedEntries;
      }, 'clearResultsByRunIds');
    },
  };
}
