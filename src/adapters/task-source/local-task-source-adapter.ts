import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parse } from 'yaml';

import type {
  ResolvedDataset,
  TaskSourceAdapter,
} from '../../core/adapters/task-source-adapter.js';
import { RuntimeError, ValidationError } from '../../core/errors/index.js';

const ADAPTER_ID = 'local';
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const DATASET_REF_PREFIX = 'dataset://';
const TAGS_FILE_NAME = '.tags.json';
const DEFAULT_TAG = 'stable';

interface ParsedRef {
  relativePath: string;
}

function normalizeRefPath(pathValue: string, ref: string): string {
  const normalized = pathValue.replaceAll('\\', '/').trim();
  if (normalized.length === 0) {
    throw new ValidationError(
      `Invalid dataset ref '${ref}'. Path after '${DATASET_REF_PREFIX}' must not be empty.`,
      {
        details: {
          field: 'taskSource.ref',
          ref,
        },
      },
    );
  }

  if (normalized.startsWith('/')) {
    throw new ValidationError(`Invalid dataset ref '${ref}'. Absolute path is not allowed.`, {
      details: {
        field: 'taskSource.ref',
        ref,
      },
    });
  }

  const segments = normalized.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) {
    throw new ValidationError(
      `Invalid dataset ref '${ref}'. Path after '${DATASET_REF_PREFIX}' must not be empty.`,
      {
        details: {
          field: 'taskSource.ref',
          ref,
        },
      },
    );
  }

  const hasTraversalSegment = segments.some((segment) => segment === '.' || segment === '..');
  if (hasTraversalSegment) {
    throw new ValidationError(
      `Invalid dataset ref '${ref}'. Relative traversal segments are not allowed.`,
      {
        details: {
          field: 'taskSource.ref',
          ref,
        },
      },
    );
  }

  return segments.join('/');
}

function parseDatasetRef(ref: string): ParsedRef {
  if (!ref.startsWith(DATASET_REF_PREFIX)) {
    throw new ValidationError(
      `Invalid dataset ref '${ref}'. Must start with '${DATASET_REF_PREFIX}'.`,
      {
        details: {
          field: 'taskSource.ref',
          ref,
          expectedPrefix: DATASET_REF_PREFIX,
        },
      },
    );
  }

  const relativePath = normalizeRefPath(ref.slice(DATASET_REF_PREFIX.length), ref);
  return { relativePath };
}

function assertPathInsideRoot(rootPath: string, targetPath: string, ref: string): void {
  const relativePath = relative(rootPath, targetPath);
  const isOutsideRoot =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (!isOutsideRoot) {
    return;
  }

  throw new ValidationError(`Dataset ref '${ref}' points outside configured datasetsRoot.`, {
    details: {
      field: 'taskSource.ref',
      ref,
      datasetsRoot: rootPath,
      targetPath,
    },
  });
}

async function readYamlFiles(
  dirPath: string,
  datasetsRootPath: string,
  ref: string,
): Promise<{ name: string; content: string }[]> {
  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch (cause) {
    throw new RuntimeError(`Failed to read dataset directory '${dirPath}'.`, {
      code: 'RUNTIME_UNEXPECTED',
      details: {
        field: 'taskSource.ref',
        dirPath,
      },
      cause,
    });
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
    try {
      const fileStat = await lstat(filePath);
      if (fileStat.isSymbolicLink()) {
        throw new ValidationError(`Task file '${fileName}' must not be a symbolic link.`, {
          details: {
            field: 'taskSource.ref',
            ref,
            fileName,
            filePath,
          },
        });
      }
      if (!fileStat.isFile()) {
        continue;
      }

      const fileRealPath = await realpath(filePath);
      assertPathInsideRoot(datasetsRootPath, fileRealPath, ref);

      const content = await readFile(fileRealPath, 'utf-8');
      results.push({ name: fileName, content });
    } catch (cause) {
      if (cause instanceof ValidationError) {
        throw cause;
      }

      throw new RuntimeError(`Failed to read task file '${fileName}' from dataset '${ref}'.`, {
        code: 'RUNTIME_UNEXPECTED',
        details: {
          field: 'taskSource.ref',
          ref,
          fileName,
          filePath,
        },
        cause,
      });
    }
  }

  return results;
}

function parseTaskYaml(content: string, fileName: string): unknown {
  try {
    return parse(content);
  } catch (cause) {
    throw new ValidationError(`Task file '${fileName}' is not valid YAML.`, {
      details: {
        field: 'taskSource',
        fileName,
      },
      cause,
    });
  }
}

function extractTaskFromParsed(parsed: unknown, fileName: string): unknown {
  if (typeof parsed !== 'object' || parsed === null) {
    throw new ValidationError(`Task file '${fileName}' does not contain a valid YAML object.`, {
      details: {
        field: 'taskSource',
        fileName,
      },
    });
  }

  const record = parsed as Record<string, unknown>;
  if (!('task' in record)) {
    throw new ValidationError(`Task file '${fileName}' is missing the top-level 'task' key.`, {
      details: {
        field: 'taskSource',
        fileName,
      },
    });
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

function normalizeRevision(
  value: string,
  field: 'taskSource.selector.revision' | 'taskSource.selector.tag',
): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new ValidationError(`Field '${field}' must be a non-empty string.`, {
      details: {
        field,
        value,
      },
    });
  }

  if (normalized.includes('/') || normalized.includes('\\')) {
    throw new ValidationError(`Field '${field}' must not contain path separators.`, {
      details: {
        field,
        value,
      },
    });
  }

  if (normalized === '.' || normalized === '..') {
    throw new ValidationError(`Field '${field}' must not be '${normalized}'.`, {
      details: {
        field,
        value,
      },
    });
  }

  return normalized;
}

interface ResolvedSelectorRevision {
  revision?: string;
  tasksDirPath: string;
}

function parseTagMap(value: unknown, filePath: string): Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ValidationError(`Tag mapping file '${filePath}' must be a JSON object.`, {
      details: {
        field: 'taskSource.selector.tag',
        filePath,
      },
    });
  }

  const map: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    const tag = normalizeRevision(key, 'taskSource.selector.tag');
    if (typeof rawValue !== 'string') {
      throw new ValidationError(`Tag '${tag}' in '${filePath}' must map to a string revision.`, {
        details: {
          field: 'taskSource.selector.tag',
          filePath,
          tag,
          value: rawValue,
        },
      });
    }

    map[tag] = normalizeRevision(rawValue, 'taskSource.selector.revision');
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

    throw new RuntimeError(`Failed to read tag mapping file '${tagsFilePath}'.`, {
      code: 'RUNTIME_UNEXPECTED',
      details: {
        field: 'taskSource.selector.tag',
        tagsFilePath,
      },
      cause,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch (cause) {
    throw new ValidationError(`Tag mapping file '${tagsFilePath}' is not valid JSON.`, {
      details: {
        field: 'taskSource.selector.tag',
        tagsFilePath,
      },
      cause,
    });
  }

  return parseTagMap(parsed, tagsFilePath);
}

async function resolveTasksDirectoryByRevision(
  datasetDirPath: string,
  revision: string,
  ref: string,
): Promise<string> {
  const revisionDirPath = resolve(datasetDirPath, 'revisions', revision);
  assertPathInsideRoot(datasetDirPath, revisionDirPath, ref);

  let dirStat;
  try {
    dirStat = await stat(revisionDirPath);
  } catch (cause) {
    throw new ValidationError(`Revision '${revision}' is not found for dataset '${ref}'.`, {
      details: {
        field: 'taskSource.selector.revision',
        ref,
        revision,
        revisionDirPath,
      },
      cause,
    });
  }

  if (!dirStat.isDirectory()) {
    throw new ValidationError(`Revision path '${revisionDirPath}' must be a directory.`, {
      details: {
        field: 'taskSource.selector.revision',
        ref,
        revision,
        revisionDirPath,
      },
    });
  }

  return revisionDirPath;
}

async function resolveSelectorRevision(
  datasetDirPath: string,
  input: { ref: string; selector?: { revision?: string; tag?: string } },
): Promise<ResolvedSelectorRevision> {
  const selectorRevision = input.selector?.revision;
  const selectorTag = input.selector?.tag;

  if (selectorRevision && selectorTag) {
    throw new ValidationError(
      "Fields 'taskSource.selector.revision' and 'taskSource.selector.tag' cannot be used together.",
      {
        details: {
          field: 'taskSource.selector',
          ref: input.ref,
        },
      },
    );
  }

  if (selectorRevision) {
    const normalizedRevision = normalizeRevision(selectorRevision, 'taskSource.selector.revision');
    const revisionTasksDirPath = await resolveTasksDirectoryByRevision(
      datasetDirPath,
      normalizedRevision,
      input.ref,
    );
    return {
      revision: normalizedRevision,
      tasksDirPath: revisionTasksDirPath,
    };
  }

  const tagMap = await readTagMap(datasetDirPath);
  const normalizedTag = selectorTag
    ? normalizeRevision(selectorTag, 'taskSource.selector.tag')
    : null;
  const effectiveTag = normalizedTag ?? DEFAULT_TAG;
  const mappedRevision = tagMap?.[effectiveTag];

  if (normalizedTag && !mappedRevision) {
    throw new ValidationError(`Tag '${normalizedTag}' is not found for dataset '${input.ref}'.`, {
      details: {
        field: 'taskSource.selector.tag',
        ref: input.ref,
        tag: normalizedTag,
      },
    });
  }

  if (!mappedRevision) {
    return {
      tasksDirPath: datasetDirPath,
    };
  }

  return {
    revision: mappedRevision,
    tasksDirPath: await resolveTasksDirectoryByRevision(datasetDirPath, mappedRevision, input.ref),
  };
}

export interface LocalTaskSourceAdapterOptions {
  datasetsRoot: string;
}

export function createLocalTaskSourceAdapter(
  options: LocalTaskSourceAdapterOptions,
): TaskSourceAdapter {
  const absoluteDatasetsRoot = resolve(options.datasetsRoot);

  return {
    async resolveDataset(input) {
      const { ref, selector } = input;

      const parsed = parseDatasetRef(ref);
      const datasetDir = resolve(absoluteDatasetsRoot, parsed.relativePath);
      assertPathInsideRoot(absoluteDatasetsRoot, datasetDir, ref);

      let datasetsRootRealPath = absoluteDatasetsRoot;
      try {
        datasetsRootRealPath = await realpath(absoluteDatasetsRoot);
      } catch {
        // 保持绝对路径兜底
      }

      let datasetDirRealPath = datasetDir;
      try {
        const dirStat = await stat(datasetDir);
        if (!dirStat.isDirectory()) {
          throw new ValidationError(`Dataset path '${datasetDir}' exists but is not a directory.`, {
            details: {
              field: 'taskSource.ref',
              ref,
              datasetDir,
            },
          });
        }
        datasetDirRealPath = await realpath(datasetDir);
      } catch (cause) {
        if (cause instanceof ValidationError) throw cause;
        throw new RuntimeError(`Dataset directory '${datasetDir}' not found for ref '${ref}'.`, {
          code: 'RUNTIME_UNEXPECTED',
          details: {
            field: 'taskSource.ref',
            ref,
            datasetDir,
          },
          cause,
        });
      }

      assertPathInsideRoot(datasetsRootRealPath, datasetDirRealPath, ref);

      const resolvedSelector = await resolveSelectorRevision(datasetDirRealPath, { ref, selector });
      const selectedTasksDirPath = await realpath(resolvedSelector.tasksDirPath);
      assertPathInsideRoot(datasetsRootRealPath, selectedTasksDirPath, ref);

      const yamlFiles = await readYamlFiles(selectedTasksDirPath, datasetsRootRealPath, ref);
      if (yamlFiles.length === 0) {
        throw new ValidationError(
          `Dataset '${ref}' contains no YAML task files in '${selectedTasksDirPath}'.`,
          {
            details: {
              field: 'taskSource.ref',
              ref,
              datasetDir: selectedTasksDirPath,
            },
          },
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
          ref,
          revision,
          fetchedAt: new Date().toISOString(),
        },
        tasks,
        datasetHash,
      } satisfies ResolvedDataset;
    },
  };
}
