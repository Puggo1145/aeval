import { createHash } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parse } from 'yaml';

import type {
  DatasetSelector,
  ResolvedDataset,
  TaskSourceAdapter,
} from '../../core/adapters/task-source-adapter.js';
import { ensureNonEmptyString } from '../../core/validation/helpers.js';

const ADAPTER_ID = 'local';
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const TAGS_FILE_NAME = '.tags.json';
const DEFAULT_TAG = 'stable';

function normalizeDatasetPath(pathValue: string): string {
  const normalized = pathValue.replaceAll('\\', '/').trim();
  if (normalized.length === 0) {
    throw new Error("Field 'dataset' must not be empty.");
  }

  if (normalized.startsWith('/')) {
    throw new Error(`Invalid dataset path '${normalized}'. Absolute path is not allowed.`);
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new Error("Field 'dataset' must not be empty.");
  }

  const hasTraversalSegment = segments.some((segment) => segment === '.' || segment === '..');
  if (hasTraversalSegment) {
    throw new Error(`Invalid dataset path '${normalized}'. Relative traversal segments are not allowed.`);
  }

  return segments.join('/');
}

function ensureNonEmptyStringOption(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }
  return ensureNonEmptyString(value, field);
}

function normalizeOptionalSelector(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return ensureNonEmptyStringOption(value, field);
}

function assertPathInsideRoot(rootPath: string, targetPath: string, dataset: string): void {
  const relativePath = relative(rootPath, targetPath);
  const isOutsideRoot =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (!isOutsideRoot) {
    return;
  }

  throw new Error(`Dataset '${dataset}' points outside configured datasetsRoot.`);
}

async function readYamlFiles(
  dirPath: string,
  datasetsRootPath: string,
  dataset: string,
): Promise<{ name: string; content: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    throw new Error(`Failed to read dataset directory '${dirPath}'.`);
  }

  const yamlFiles = entries
    .filter((entry) => {
      const dotIndex = entry.lastIndexOf('.');
      if (dotIndex < 0) return false;
      return YAML_EXTENSIONS.has(entry.slice(dotIndex).toLowerCase());
    })
    .sort();

  const results: { name: string; content: string }[] = [];
  for (const fileName of yamlFiles) {
    const filePath = join(dirPath, fileName);
    const fileStat = await lstat(filePath);

    if (fileStat.isSymbolicLink()) {
      throw new Error(`Task file '${fileName}' must not be a symbolic link.`);
    }
    if (!fileStat.isFile()) {
      continue;
    }

    const fileRealPath = await realpath(filePath);
    assertPathInsideRoot(datasetsRootPath, fileRealPath, dataset);

    const content = await readFile(fileRealPath, 'utf-8');
    results.push({ name: fileName, content });
  }

  return results;
}

function parseTaskYaml(content: string, fileName: string): unknown {
  try {
    return parse(content);
  } catch {
    throw new Error(`Task file '${fileName}' is not valid YAML.`);
  }
}

function extractTaskFromParsed(parsed: unknown, fileName: string): unknown {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`Task file '${fileName}' does not contain a valid YAML object.`);
  }

  const record = parsed as Record<string, unknown>;
  if (!('task' in record)) {
    throw new Error(`Task file '${fileName}' is missing the top-level 'task' key.`);
  }

  return record.task;
}

function computeDatasetHash(files: { name: string; content: string }[]): string {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(file.name);
    hash.update('\0');
    hash.update(file.content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

function computeRevision(datasetHash: string, selectorRevision?: string): string {
  if (selectorRevision) {
    return selectorRevision;
  }
  return `sha256-${datasetHash.slice(0, 12)}`;
}

function normalizeRevision(value: string, field: 'revision' | 'tag'): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`Field '${field}' must be a non-empty string.`);
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new Error(`Field '${field}' must not contain path separators.`);
  }

  if (normalized === '.' || normalized === '..') {
    throw new Error(`Field '${field}' must not be '${normalized}'.`);
  }

  return normalized;
}

interface ResolvedSelectorRevision {
  revision?: string;
  tasksDirPath: string;
}

function parseTagMap(value: unknown, filePath: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Tag mapping file '${filePath}' must be a JSON object.`);
  }

  const map: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const tag = normalizeRevision(key, 'tag');
    if (typeof rawValue !== 'string') {
      throw new Error(`Tag '${tag}' in '${filePath}' must map to a string revision.`);
    }

    map[tag] = normalizeRevision(rawValue, 'revision');
  }

  return map;
}

async function readTagMap(datasetDirPath: string): Promise<Record<string, string> | null> {
  const tagsFilePath = join(datasetDirPath, TAGS_FILE_NAME);

  let content: string;
  try {
    content = await readFile(tagsFilePath, 'utf-8');
  } catch (cause) {
    const errorCode =
      typeof cause === 'object' &&
      cause !== null &&
      'code' in cause &&
      typeof (cause as { code?: unknown }).code === 'string'
        ? (cause as { code: string }).code
        : null;

    if (errorCode === 'ENOENT') {
      return null;
    }

    throw new Error(`Failed to read tag mapping file '${tagsFilePath}'.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new Error(`Tag mapping file '${tagsFilePath}' is not valid JSON.`);
  }

  return parseTagMap(parsed, tagsFilePath);
}

async function resolveTasksDirectoryByRevision(
  datasetDirPath: string,
  revision: string,
  dataset: string,
): Promise<string> {
  const revisionDirPath = resolve(datasetDirPath, 'revisions', revision);
  assertPathInsideRoot(datasetDirPath, revisionDirPath, dataset);

  let dirStat: Stats;
  try {
    dirStat = await stat(revisionDirPath);
  } catch {
    throw new Error(`Revision '${revision}' is not found for dataset '${dataset}'.`);
  }

  if (!dirStat.isDirectory()) {
    throw new Error(`Revision path '${revisionDirPath}' must be a directory.`);
  }

  return revisionDirPath;
}

async function resolveSelectorRevision(
  datasetDirPath: string,
  input: { dataset: string; revision?: string; tag?: string },
): Promise<ResolvedSelectorRevision> {
  const selectorRevision = input.revision;
  const selectorTag = input.tag;

  if (selectorRevision && selectorTag) {
    throw new Error(
      "Fields 'revision' and 'tag' cannot be used together.",
    );
  }

  if (selectorRevision) {
    const normalizedRevision = normalizeRevision(selectorRevision, 'revision');
    const revisionTasksDirPath = await resolveTasksDirectoryByRevision(
      datasetDirPath,
      normalizedRevision,
      input.dataset,
    );
    return {
      revision: normalizedRevision,
      tasksDirPath: revisionTasksDirPath,
    };
  }

  const tagMap = await readTagMap(datasetDirPath);
  const normalizedTag = selectorTag
    ? normalizeRevision(selectorTag, 'tag')
    : null;
  const effectiveTag = normalizedTag ?? DEFAULT_TAG;
  const mappedRevision = tagMap?.[effectiveTag];

  if (normalizedTag && !mappedRevision) {
    throw new Error(`Tag '${normalizedTag}' is not found for dataset '${input.dataset}'.`);
  }

  if (!mappedRevision) {
    return {
      tasksDirPath: datasetDirPath,
    };
  }

  return {
    revision: mappedRevision,
    tasksDirPath: await resolveTasksDirectoryByRevision(
      datasetDirPath,
      mappedRevision,
      input.dataset,
    ),
  };
}

export interface LocalTaskSourceAdapterOptions {
  datasetsRoot: unknown;
}

export function createLocalTaskSourceAdapter(
  options: LocalTaskSourceAdapterOptions,
): TaskSourceAdapter {
  const datasetsRoot = ensureNonEmptyStringOption(
    options.datasetsRoot,
    'datasetsRoot',
  );
  const absoluteDatasetsRoot = resolve(datasetsRoot);

  return {
    async resolveDataset(selector: DatasetSelector) {
      const dataset = normalizeDatasetPath(selector.dataset);
      const requestedRevision = normalizeOptionalSelector(
        selector.revision,
        'revision',
      );
      const requestedTag = normalizeOptionalSelector(selector.tag, 'tag');

      const datasetDir = resolve(absoluteDatasetsRoot, dataset);
      assertPathInsideRoot(absoluteDatasetsRoot, datasetDir, dataset);

      let datasetsRootRealPath = absoluteDatasetsRoot;
      try {
        datasetsRootRealPath = await realpath(absoluteDatasetsRoot);
      } catch {
        // keep absolute path fallback
      }

      let dirStat: Stats;
      try {
        dirStat = await stat(datasetDir);
      } catch {
        throw new Error(`Dataset directory '${datasetDir}' not found for dataset '${dataset}'.`);
      }
      if (!dirStat.isDirectory()) {
        throw new Error(`Dataset path '${datasetDir}' exists but is not a directory.`);
      }

      let datasetDirRealPath: string;
      try {
        datasetDirRealPath = await realpath(datasetDir);
      } catch {
        throw new Error(`Dataset directory '${datasetDir}' not found for dataset '${dataset}'.`);
      }

      assertPathInsideRoot(datasetsRootRealPath, datasetDirRealPath, dataset);

      const resolvedSelector = await resolveSelectorRevision(datasetDirRealPath, {
        dataset,
        revision: requestedRevision,
        tag: requestedTag,
      });
      const selectedTasksDirPath = await realpath(resolvedSelector.tasksDirPath);
      assertPathInsideRoot(datasetsRootRealPath, selectedTasksDirPath, dataset);

      const yamlFiles = await readYamlFiles(selectedTasksDirPath, datasetsRootRealPath, dataset);
      if (yamlFiles.length === 0) {
        throw new Error(
          `Dataset '${dataset}' contains no YAML task files in '${selectedTasksDirPath}'.`,
        );
      }

      const datasetHash = computeDatasetHash(yamlFiles);
      const revision = computeRevision(datasetHash, resolvedSelector.revision);

      const tasks: unknown[] = [];
      for (const file of yamlFiles) {
        const parsedTaskFile = parseTaskYaml(file.content, file.name);
        const task = extractTaskFromParsed(parsedTaskFile, file.name);
        tasks.push(task);
      }

      return {
        source: {
          adapter: ADAPTER_ID,
          ref: dataset,
          revision,
          fetchedAt: new Date().toISOString(),
        },
        tasks,
        datasetHash,
      } satisfies ResolvedDataset;
    },
  };
}
