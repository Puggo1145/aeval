import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';

import canonicalizeModule from 'canonicalize';
import { parse } from 'yaml';

import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  SuiteSource,
  TaskIndex,
  TaskRef,
  TaskSource,
  Tasks,
} from '../../index.js';
import {
  parseSuiteDocument,
  parseTaskDocument,
  SCHEMA_VERSIONS,
  type SuiteDocument,
  type TaskDocument,
} from '../../index.js';

const ADAPTER_ID = 'local';
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const GLOB_MAGIC_PATTERN = /[*?[{\]}]/;
const canonicalize = canonicalizeModule as unknown as (value: unknown) => string | undefined;

interface SuiteEntry {
  ref: string;
  document: SuiteDocument;
  source: SuiteSource;
}

export interface LocalTaskOptions {
  rootDir: string;
}

function ensureNonEmptyString(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length > 0) {
    return normalized;
  }

  throw new Error(`Field '${field}' must be a non-empty string.`);
}

function normalizeRelativeValue(value: string, field: string): string {
  const normalized = value.replaceAll('\\', '/').trim();
  if (normalized.length === 0) {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }

  if (normalized.startsWith('/')) {
    throw new Error(`Field '${field}' must not be an absolute path.`);
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error(`Field '${field}' must not contain relative traversal segments.`);
  }

  return segments.join('/');
}

function assertPathInsideRoot(rootPath: string, targetPath: string, field: string): void {
  const relativePath = relative(rootPath, targetPath);
  const isOutsideRoot =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (!isOutsideRoot) {
    return;
  }

  throw new Error(`Field '${field}' points outside configured rootDir.`);
}

function toDisplayPath(path: string): string {
  return path.split(sep).join('/');
}

async function readYamlObject(filePath: string, label: string): Promise<Record<string, unknown>> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`Failed to read ${label} '${filePath}'.`);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch {
    throw new Error(`${label} '${filePath}' is not valid YAML.`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} '${filePath}' must contain a YAML object.`);
  }

  return parsed as Record<string, unknown>;
}

function computeSha256(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError('Unsupported value type in canonical JSON payload.');
  }

  return createHash('sha256').update(serialized).digest('hex');
}

async function collectYamlFiles(startDirRealPath: string, rootDirRealPath: string): Promise<string[]> {
  async function walk(dirPath: string): Promise<string[]> {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    const entries = dirents.sort((a, b) => a.name.localeCompare(b.name));
    const files: string[] = [];

    for (const dirent of entries) {
      const entryPath = resolve(dirPath, dirent.name);
      const entryStat = await lstat(entryPath);
      if (entryStat.isSymbolicLink()) {
        throw new Error(`Symbolic links are not allowed under rootDir: '${entryPath}'.`);
      }

      if (dirent.isDirectory()) {
        files.push(...(await walk(entryPath)));
        continue;
      }

      const extension = dirent.name.slice(dirent.name.lastIndexOf('.')).toLowerCase();
      if (!YAML_EXTENSIONS.has(extension)) {
        continue;
      }

      const realEntryPath = await realpath(entryPath);
      assertPathInsideRoot(rootDirRealPath, realEntryPath, 'rootDir');
      files.push(realEntryPath);
    }

    return files;
  }

  return walk(startDirRealPath);
}

async function scanSuites(rootDirRealPath: string): Promise<SuiteEntry[]> {
  const yamlFiles = await collectYamlFiles(rootDirRealPath, rootDirRealPath);
  const entries: SuiteEntry[] = [];

  for (const filePath of yamlFiles) {
    const document = await readYamlObject(filePath, 'suite file');
    if (document.schemaVersion !== SCHEMA_VERSIONS.SUITE) {
      continue;
    }

    const ref = toDisplayPath(relative(rootDirRealPath, filePath));
    entries.push({
      ref,
      document: parseSuiteDocument(document),
      source: {
        adapter: ADAPTER_ID,
        ref,
        fetchedAt: new Date().toISOString(),
      },
    });
  }

  entries.sort((a, b) => a.document.id.localeCompare(b.document.id) || a.ref.localeCompare(b.ref));

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.document.id)) {
      throw new Error(`Suite id '${entry.document.id}' must be unique under rootDir.`);
    }
    seenIds.add(entry.document.id);
  }

  return entries;
}

function normalizeDiscoverPattern(pattern: string): string {
  return normalizeRelativeValue(pattern, 'suite.discover');
}

function hasGlobMagic(segment: string): boolean {
  return GLOB_MAGIC_PATTERN.test(segment);
}

function getDiscoverStaticPrefix(pattern: string): string {
  const segments = pattern.split('/');
  const firstGlobIndex = segments.findIndex((segment) => hasGlobMagic(segment));
  if (firstGlobIndex < 0) {
    return pattern;
  }

  return segments.slice(0, firstGlobIndex).join('/');
}

async function collectTaskRefsForDiscoverPattern(
  rootDirRealPath: string,
  pattern: string,
): Promise<string[]> {
  const staticPrefix = getDiscoverStaticPrefix(pattern);
  const scanStartPath =
    staticPrefix.length === 0 ? rootDirRealPath : resolve(rootDirRealPath, staticPrefix);
  assertPathInsideRoot(rootDirRealPath, scanStartPath, 'suite.discover');

  const startStat = await lstat(scanStartPath).catch(() => null);
  if (startStat === null) {
    return [];
  }

  if (startStat.isSymbolicLink()) {
    throw new Error(`Symbolic links are not allowed under rootDir: '${scanStartPath}'.`);
  }

  if (startStat.isDirectory()) {
    const startDirRealPath = await realpath(scanStartPath);
    assertPathInsideRoot(rootDirRealPath, startDirRealPath, 'suite.discover');

    return (await collectYamlFiles(startDirRealPath, rootDirRealPath))
      .map((filePath) => toDisplayPath(relative(rootDirRealPath, filePath)))
      .filter((fileRef) => matchesGlob(fileRef, pattern))
      .sort();
  }

  if (!startStat.isFile()) {
    return [];
  }

  const realFilePath = await realpath(scanStartPath);
  assertPathInsideRoot(rootDirRealPath, realFilePath, 'suite.discover');
  const fileRef = toDisplayPath(relative(rootDirRealPath, realFilePath));
  const extension = fileRef.slice(fileRef.lastIndexOf('.')).toLowerCase();
  if (!YAML_EXTENSIONS.has(extension) || !matchesGlob(fileRef, pattern)) {
    return [];
  }

  return [fileRef];
}

function taskIndexFromTask(task: TaskDocument, suiteId: string, ref: string): TaskIndex {
  return {
    id: task.id,
    ...(task.desc !== undefined ? { desc: task.desc } : {}),
    ...(task.category !== undefined ? { category: task.category } : {}),
    ...(task.capability !== undefined ? { capability: task.capability } : {}),
    ...(task.tier !== undefined ? { tier: task.tier } : {}),
    ...(task.difficulty !== undefined ? { difficulty: task.difficulty } : {}),
    ...(task.tags !== undefined ? { tags: [...task.tags] } : {}),
    runCount: task.provider.runs.length,
    taskRef: {
      suiteId,
      ref,
    },
  };
}

async function resolveTaskFile(
  rootDirRealPath: string,
  taskRef: TaskRef,
  options?: { skipSuiteDocument?: boolean },
): Promise<{ ref: string; document: TaskDocument; source: TaskSource } | null> {
  ensureNonEmptyString(taskRef.suiteId, 'taskRef.suiteId');
  const normalizedRef = normalizeRelativeValue(taskRef.ref, 'taskRef.ref');
  const taskPath = resolve(rootDirRealPath, normalizedRef);
  assertPathInsideRoot(rootDirRealPath, taskPath, 'taskRef.ref');

  const taskRealPath = await realpath(taskPath).catch(() => {
    throw new Error(`Task '${normalizedRef}' was not found under rootDir.`);
  });
  assertPathInsideRoot(rootDirRealPath, taskRealPath, 'taskRef.ref');

  const document = await readYamlObject(taskRealPath, 'task file');
  if (options?.skipSuiteDocument && document.schemaVersion === SCHEMA_VERSIONS.SUITE) {
    return null;
  }

  const revision = `sha256-${computeSha256(document).slice(0, 12)}`;
  const source: TaskSource = {
    adapter: ADAPTER_ID,
    ref: normalizedRef,
    revision,
    fetchedAt: new Date().toISOString(),
  };

  return {
    ref: normalizedRef,
    document: parseTaskDocument(document),
    source,
  };
}

export class LocalTask implements Tasks {
  private readonly rootDir: string;
  private readonly absoluteRootDir: string;

  constructor(options: LocalTaskOptions) {
    this.rootDir = ensureNonEmptyString(options.rootDir, 'rootDir');
    this.absoluteRootDir = resolve(this.rootDir);
  }

  async listSuites(): Promise<SuiteDescriptor[]> {
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const suites = await scanSuites(rootDirRealPath);
    return suites.map((entry) => ({
      id: entry.document.id,
      name: entry.document.name,
      ref: entry.ref,
    }));
  }

  async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const entry = await this.findSuiteEntry(suiteId);
    const patterns = entry.document.discover.map((pattern) => normalizeDiscoverPattern(pattern));
    const matchedTaskRefs = Array.from(
      new Set(
        (
          await Promise.all(
            patterns.map((pattern) => collectTaskRefsForDiscoverPattern(rootDirRealPath, pattern)),
          )
        ).flat(),
      ),
    ).sort();

    if (matchedTaskRefs.length === 0) {
      throw new Error(`Suite '${entry.document.id}' did not match any task files.`);
    }

    const seenTaskIds = new Set<string>();
    const taskIndexes: TaskIndex[] = [];
    for (const fileRef of matchedTaskRefs) {
      const resolvedTask = await resolveTaskFile(
        rootDirRealPath,
        {
          suiteId: entry.document.id,
          ref: fileRef,
        },
        { skipSuiteDocument: true },
      );
      if (resolvedTask === null) {
        continue;
      }

      const { document } = resolvedTask;

      if (seenTaskIds.has(document.id)) {
        throw new Error(`Task id '${document.id}' must be unique within suite '${entry.document.id}'.`);
      }
      seenTaskIds.add(document.id);
      taskIndexes.push(taskIndexFromTask(document, entry.document.id, fileRef));
    }

    return {
      document: entry.document,
      source: entry.source,
      taskIndexes,
    };
  }

  async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const resolvedTask = await resolveTaskFile(rootDirRealPath, taskRef);
    if (resolvedTask === null) {
      throw new Error(`Task '${taskRef.ref}' resolves to a suite document, not a task document.`);
    }

    return {
      document: resolvedTask.document,
      source: resolvedTask.source,
    };
  }

  private async resolveRootDirRealPath(): Promise<string> {
    return realpath(this.absoluteRootDir).catch(() => this.absoluteRootDir);
  }

  private async findSuiteEntry(suiteId: string): Promise<SuiteEntry> {
    const normalizedSuiteId = ensureNonEmptyString(suiteId, 'suiteId');
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const suites = await scanSuites(rootDirRealPath);
    const entry = suites.find((candidate) => candidate.document.id === normalizedSuiteId);
    if (entry) {
      return entry;
    }

    throw new Error(`Suite '${normalizedSuiteId}' was not found under rootDir.`);
  }
}
