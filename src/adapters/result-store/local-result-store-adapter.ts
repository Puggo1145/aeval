import type { Dirent, Stats } from 'node:fs';
import { lstat, mkdir, readdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type {
  BaselineRecord,
  ClearedResultEntry,
  RunManifestRecord,
  RunSummaryRecord,
  Stores,
  TrialResultRecord,
} from '../../index.js';

const MANIFEST_FILE = 'manifest.json';
const SUMMARY_FILE = 'summary.json';
const TRIALS_DIR = 'trials';
const BASELINE_FILE = 'baseline.json';

export interface LocalStoreOptions {
  rootDir: string;
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class StoreError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StoreError';
  }
}

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  throw new ValidationError(`Field '${field}' must be a non-empty string.`);
}

function trialFileName(taskId: string, trialIndex: number): string {
  const encodedTaskId = Buffer.from(taskId, 'utf-8').toString('base64url');
  return `${encodedTaskId}-${trialIndex}.json`;
}

function normalizeRunId(runId: string): string {
  const normalized = ensureNonEmptyString(runId, 'runId');

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new ValidationError("Field 'runId' must not contain path separators.");
  }

  if (normalized === '.' || normalized === '..') {
    throw new ValidationError(`Field 'runId' must not be '${normalized}'.`);
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

  throw new ValidationError(`Run '${runId}' points outside configured result store root.`);
}

function isPathOutsideRoot(rootPath: string, targetPath: string): boolean {
  const relativePath = relative(rootPath, targetPath);
  return relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

async function ensureDir(dirPath: string): Promise<void> {
  await mkdir(dirPath, { recursive: true });
}

async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
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

    throw new StoreError(`Failed to read file '${filePath}'.`, { cause });
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

  throw new ValidationError(`Run '${runId}' points outside configured result store root.`);
}

async function rejectSymlinkPath(path: string, field: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isSymbolicLink()) {
      return;
    }

    throw new ValidationError(`Field '${field}' must not resolve to a symbolic link.`);
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
      throw new StoreError(`Failed to read directory '${dirPath}'.`, { cause });
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

function assertTrialRunIdsMatch(input: TrialResultRecord): void {
  const normalizedRecordRunId = normalizeRunId(input.runId);
  const normalizedTrialRunId = normalizeRunId(input.trial.runId);

  if (normalizedRecordRunId === normalizedTrialRunId) {
    return;
  }

  throw new ValidationError("Field 'trial.runId' must match 'runId'.");
}

export class LocalStore implements Stores {
  private readonly rootDir: string;
  private readonly rootDirPath: string;

  constructor(options: LocalStoreOptions) {
    this.rootDir = ensureNonEmptyString(options.rootDir, 'rootDir');
    this.rootDirPath = resolve(this.rootDir);
  }

  async saveRunManifest(input: RunManifestRecord): Promise<void> {
    await this.writeStrict(async () => {
      const dir = this.runDir(input.runId);
      await rejectSymlinkPath(dir, 'runId');
      await ensureDir(dir);
      await assertResolvedPathInsideRoot(this.rootDirPath, dir, input.runId);
      await writeJsonFile(join(dir, MANIFEST_FILE), input);
    }, `saveRunManifest(${input.runId})`);
  }

  async saveRunSummary(input: RunSummaryRecord): Promise<void> {
    await this.writeStrict(async () => {
      const dir = this.runDir(input.runId);
      await rejectSymlinkPath(dir, 'runId');
      await ensureDir(dir);
      await assertResolvedPathInsideRoot(this.rootDirPath, dir, input.runId);
      await writeJsonFile(join(dir, SUMMARY_FILE), input);
    }, `saveRunSummary(${input.runId})`);
  }

  async saveTrial(input: TrialResultRecord): Promise<void> {
    await this.writeStrict(async () => {
      assertTrialRunIdsMatch(input);
      const trialsDir = join(this.runDir(input.runId), TRIALS_DIR);
      await rejectSymlinkPath(this.runDir(input.runId), 'runId');
      await rejectSymlinkPath(trialsDir, 'trialsDir');
      await ensureDir(trialsDir);
      await assertResolvedPathInsideRoot(this.rootDirPath, trialsDir, input.runId);
      const fileName = trialFileName(input.trial.taskId, input.trial.trialIndex);
      await writeJsonFile(join(trialsDir, fileName), input);
    }, `saveTrial(${input.runId}, ${input.trial.taskId}, ${input.trial.trialIndex})`);
  }

  async getRunManifest(runId: string): Promise<RunManifestRecord | null> {
    return readJsonFileOrNull<RunManifestRecord>(join(this.runDir(runId), MANIFEST_FILE));
  }

  async getRunSummary(runId: string): Promise<RunSummaryRecord | null> {
    const normalizedRunId = normalizeRunId(runId);
    const summaryPath = join(this.runDir(normalizedRunId), SUMMARY_FILE);
    return readJsonFileOrNull<RunSummaryRecord>(summaryPath);
  }

  async listTrials(runId: string): Promise<TrialResultRecord[]> {
    const trialsDir = join(this.runDir(runId), TRIALS_DIR);
    let entries: string[];
    try {
      entries = await readdir(trialsDir);
    } catch (cause) {
      const errorCode = extractFsErrorCode(cause);
      if (errorCode === 'ENOENT') {
        return [];
      }

      throw new StoreError(`Failed to list trials directory '${trialsDir}'.`, { cause });
    }

    const jsonFiles = entries.filter((entry) => entry.endsWith('.json')).sort();
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

  async saveBaseline(input: BaselineRecord): Promise<void> {
    await this.writeStrict(async () => {
      await ensureDir(this.rootDirPath);
      await writeJsonFile(join(this.rootDirPath, BASELINE_FILE), input);
    }, 'saveBaseline');
  }

  async getBaselineRunId(): Promise<string | null> {
    const record = await readJsonFileOrNull<BaselineRecord>(join(this.rootDirPath, BASELINE_FILE));
    return record?.runId ?? null;
  }

  async listRunIds(): Promise<string[]> {
    let entries: string[];
    try {
      entries = await readdir(this.rootDirPath, { withFileTypes: true }).then((dirents) =>
        dirents.filter((dirent) => dirent.isDirectory()).map((dirent) => dirent.name),
      );
    } catch (cause) {
      const errorCode = extractFsErrorCode(cause);
      if (errorCode === 'ENOENT') {
        return [];
      }

      throw new StoreError(`Failed to list run directories in '${this.rootDirPath}'.`, { cause });
    }

    const runIds: string[] = [];
    for (const dirName of entries) {
      const summaryPath = join(this.rootDirPath, dirName, SUMMARY_FILE);
      const summary = await readJsonFileOrNull(summaryPath);
      if (summary !== null) {
        runIds.push(dirName);
        continue;
      }

      const trialsDir = join(this.rootDirPath, dirName, TRIALS_DIR);
      const trialEntries = await readdir(trialsDir).catch((cause) => {
        const errorCode = extractFsErrorCode(cause);
        if (errorCode === 'ENOENT') {
          return [];
        }
        throw new StoreError(`Failed to list trials directory '${trialsDir}'.`, { cause });
      });
      const hasTrialRecord = trialEntries.some((entry) => entry.endsWith('.json'));
      if (hasTrialRecord) {
        runIds.push(dirName);
        continue;
      }

      const manifestPath = join(this.rootDirPath, dirName, MANIFEST_FILE);
      const manifest = await readJsonFileOrNull(manifestPath);
      if (manifest !== null) {
        runIds.push(dirName);
      }
    }

    return runIds.sort();
  }

  async clearAllResults(): Promise<ClearedResultEntry[]> {
    return this.writeStrict(async () => {
      const deletedEntries = await collectEntriesForDeletion(this.rootDirPath);
      await rm(this.rootDirPath, { recursive: true, force: true });
      await ensureDir(this.rootDirPath);
      return deletedEntries;
    }, 'clearAllResults');
  }

  async clearResultsByRunIds(runIds: string[]): Promise<ClearedResultEntry[]> {
    return this.writeStrict(async () => {
      const normalizedRunIds = [...new Set(runIds.map((runId) => normalizeRunId(runId)))].sort();
      if (normalizedRunIds.length === 0) {
        return [];
      }

      const deletedEntries: ClearedResultEntry[] = [];
      const deletedRunIdSet = new Set(normalizedRunIds);

      for (const runId of normalizedRunIds) {
        const dir = this.runDir(runId);
        await rejectSymlinkPath(dir, 'runId');

        let dirStat: Stats;
        try {
          dirStat = await lstat(dir);
        } catch (cause) {
          if (extractFsErrorCode(cause) === 'ENOENT') {
            continue;
          }
          throw cause;
        }

        if (!dirStat.isDirectory()) {
          throw new StoreError(`Expected run path '${dir}' to be a directory.`);
        }

        const runEntries = await collectEntriesForDeletion(dir);
        deletedEntries.push(...withPrefix(runEntries, runId));
        await rm(dir, { recursive: true, force: true });
        deletedEntries.push({ path: runId, kind: 'dir' });
      }

      const baselineRecord = await readJsonFileOrNull<BaselineRecord>(
        join(this.rootDirPath, BASELINE_FILE),
      );
      const baselineRunId = baselineRecord?.runId ?? null;
      if (baselineRunId && deletedRunIdSet.has(baselineRunId)) {
        const baselinePath = join(this.rootDirPath, BASELINE_FILE);
        await rm(baselinePath, { force: true });
        deletedEntries.push({ path: BASELINE_FILE, kind: 'file' });
      }

      return deletedEntries;
    }, 'clearResultsByRunIds');
  }

  private runDir(runId: string): string {
    const normalizedRunId = normalizeRunId(runId);
    const dir = resolve(this.rootDirPath, normalizedRunId);
    assertPathInsideRoot(this.rootDirPath, dir, normalizedRunId);
    return dir;
  }

  private async writeStrict<T>(operation: () => Promise<T>, context: string): Promise<T> {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof ValidationError) {
        throw cause;
      }

      throw new StoreError(`Write failed (strict-only): ${context}`, { cause });
    }
  }
}
