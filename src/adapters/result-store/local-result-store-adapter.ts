import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  BaselineRecord,
  ResultStoreAdapter,
} from '../../core/adapters/result-store-adapter.js';
import type { RunManifest } from '../../core/contracts/run-manifest.js';
import type { RunSummaryRecord } from '../../core/contracts/run-summary.js';
import type { TrialResultRecord } from '../../core/contracts/trial.js';
import { StoreError, ValidationError } from '../../core/errors/index.js';
import { ensureNonEmptyString } from '../../core/validation/helpers.js';

const MANIFEST_FILE = 'manifest.json';
const SUMMARY_FILE = 'summary.json';
const TRIALS_DIR = 'trials';
const BASELINE_FILE = 'baseline.json';

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
  return (
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
  );
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

  async function writeStrict(operation: () => Promise<void>, context: string): Promise<void> {
    try {
      await operation();
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
      return readJsonFileOrNull<RunManifest>(join(runDir(runId), MANIFEST_FILE));
    },

    async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
      return readJsonFileOrNull<RunSummaryRecord>(join(runDir(runId), SUMMARY_FILE));
    },

    async listTrials(runId: string): Promise<TrialResultRecord[]> {
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
        entries = await readdir(rootDirPath, { withFileTypes: true })
          .then((dirents) =>
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
        }
      }

      return runIds.sort();
    },
  };
}
