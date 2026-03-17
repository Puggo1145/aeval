import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';
import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  SuiteSource,
  TaskRef,
  TaskSource,
  Tasks,
} from '@youmindinc/youeval-core';
import { SCHEMA_VERSIONS } from '@youmindinc/youeval-core';
import canonicalizeModule from 'canonicalize';
import { parse } from 'yaml';

const ADAPTER_ID = 'local';
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const GLOB_MAGIC_PATTERN = /[*?[{\]}]/;
const IGNORED_DIRECTORY_NAMES = new Set(['node_modules']);
const canonicalize = canonicalizeModule as unknown as (value: unknown) => string | undefined;

interface SuiteEntry {
  ref: string;
  document: unknown;
  suite: SuiteMetadata;
  source: SuiteSource;
}

interface SuiteMetadata {
  id: string;
  name: string;
  discover: string[];
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

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }

  return ensureNonEmptyString(value, field);
}

function readSuiteMetadata(document: Record<string, unknown>, ref: string): SuiteMetadata {
  const discover = document.discover;
  if (!Array.isArray(discover) || !discover.every((pattern) => typeof pattern === 'string')) {
    throw new Error(`Suite file '${ref}' must define discover as an array of strings.`);
  }

  return {
    id: readRequiredString(document.id, `suite.id (${ref})`),
    name: readRequiredString(document.name, `suite.name (${ref})`),
    discover: [...discover],
  };
}

async function collectYamlFiles(
  startDirRealPath: string,
  rootDirRealPath: string,
): Promise<string[]> {
  async function walk(dirPath: string): Promise<string[]> {
    const dirents = await readdir(dirPath, { withFileTypes: true });
    const files: string[] = [];

    for (const dirent of dirents) {
      if (dirent.isDirectory() && IGNORED_DIRECTORY_NAMES.has(dirent.name)) {
        continue;
      }

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
      document,
      suite: readSuiteMetadata(document, ref),
      source: {
        adapter: ADAPTER_ID,
        ref,
      },
    });
  }

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.suite.id)) {
      throw new Error(`Suite id '${entry.suite.id}' must be unique under rootDir.`);
    }
    seenIds.add(entry.suite.id);
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
      .filter((fileRef) => matchesGlob(fileRef, pattern));
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

async function resolveYamlFile(
  rootDirRealPath: string,
  taskRef: TaskRef,
): Promise<{ ref: string; document: Record<string, unknown>; source: TaskSource }> {
  ensureNonEmptyString(taskRef.suiteId, 'taskRef.suiteId');
  const normalizedRef = normalizeRelativeValue(taskRef.ref, 'taskRef.ref');
  const taskPath = resolve(rootDirRealPath, normalizedRef);
  assertPathInsideRoot(rootDirRealPath, taskPath, 'taskRef.ref');

  const taskRealPath = await realpath(taskPath).catch(() => {
    throw new Error(`Task '${normalizedRef}' was not found under rootDir.`);
  });
  assertPathInsideRoot(rootDirRealPath, taskRealPath, 'taskRef.ref');

  const document = await readYamlObject(taskRealPath, 'task file');
  const revision = `sha256-${computeSha256(document).slice(0, 12)}`;
  const source: TaskSource = {
    adapter: ADAPTER_ID,
    ref: normalizedRef,
    revision,
  };

  return {
    ref: normalizedRef,
    document,
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
      id: entry.suite.id,
      name: entry.suite.name,
      ref: entry.ref,
    }));
  }

  async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const entry = await this.findSuiteEntry(suiteId);
    const patterns = entry.suite.discover.map((pattern) => normalizeDiscoverPattern(pattern));
    if (patterns.length === 0) {
      return {
        document: entry.document,
        source: entry.source,
        taskRefs: [],
      };
    }

    const matchedTaskRefs = Array.from(
      new Set(
        (
          await Promise.all(
            patterns.map((pattern) => collectTaskRefsForDiscoverPattern(rootDirRealPath, pattern)),
          )
        ).flat(),
      ),
    );

    if (matchedTaskRefs.length === 0) {
      throw new Error(`Suite '${entry.suite.id}' did not match any task files.`);
    }

    const taskRefs: TaskRef[] = [];
    for (const fileRef of matchedTaskRefs) {
      const resolvedTask = await resolveYamlFile(rootDirRealPath, {
        suiteId: entry.suite.id,
        ref: fileRef,
      });
      if (resolvedTask.document.schemaVersion === SCHEMA_VERSIONS.SUITE) {
        continue;
      }

      if (resolvedTask.document.schemaVersion !== SCHEMA_VERSIONS.TASK) {
        throw new Error(
          `Task file '${resolvedTask.ref}' must declare schemaVersion '${SCHEMA_VERSIONS.TASK}'.`,
        );
      }

      taskRefs.push({
        suiteId: entry.suite.id,
        ref: fileRef,
      });
    }

    return {
      document: entry.document,
      source: entry.source,
      taskRefs,
    };
  }

  async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
    const rootDirRealPath = await this.resolveRootDirRealPath();
    const resolvedTask = await resolveYamlFile(rootDirRealPath, taskRef);
    if (resolvedTask.document.schemaVersion === SCHEMA_VERSIONS.SUITE) {
      throw new Error(`Task '${taskRef.ref}' resolves to a suite document, not a task document.`);
    }
    if (resolvedTask.document.schemaVersion !== SCHEMA_VERSIONS.TASK) {
      throw new Error(
        `Task file '${resolvedTask.ref}' must declare schemaVersion '${SCHEMA_VERSIONS.TASK}'.`,
      );
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
    const entry = suites.find((candidate) => candidate.suite.id === normalizedSuiteId);
    if (entry) {
      return entry;
    }

    throw new Error(`Suite '${normalizedSuiteId}' was not found under rootDir.`);
  }
}
