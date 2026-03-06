import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, matchesGlob, relative, resolve, sep } from 'node:path';

import { parse } from 'yaml';

import type {
  ResolvedSuite,
  ResolvedTask,
  SuiteDescriptor,
  TaskIndex,
  TaskRef,
  TaskSourceAdapter,
} from '../../core/adapters/task-source-adapter.js';
import { SCHEMA_VERSIONS } from '../../core/contracts/schema-versions.js';
import type { SuiteDefinition } from '../../core/contracts/suite.js';
import type { TaskDefinition } from '../../core/contracts/task.js';
import { computeSha256 } from '../../core/utils/hash.js';
import { ensureNonEmptyString } from '../../core/validation/helpers.js';
import { validateSuiteDefinition } from '../../core/validation/suite-validator.js';
import { validateTaskDefinition } from '../../core/validation/task-validator.js';

const ADAPTER_ID = 'local';
const YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const GLOB_MAGIC_PATTERN = /[*?[{\]}]/;

interface SuiteEntry {
  ref: string;
  suite: SuiteDefinition;
}

export interface LocalTaskSourceAdapterOptions {
  rootDir: string;
}

/**
 * 将用户提供的相对路径规范化为稳定的斜杠格式，并提前拒绝空值、
 * 绝对路径和包含路径穿越的输入。
 */
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

/**
 * 约束所有解析后的文件系统路径，确保 suite 发现和 task 加载
 * 都不会逃出配置的 adapter 根目录。
 */
function assertPathInsideRoot(rootPath: string, targetPath: string, field: string): void {
  const relativePath = relative(rootPath, targetPath);
  const isOutsideRoot =
    relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);

  if (!isOutsideRoot) {
    return;
  }

  throw new Error(`Field '${field}' points outside configured rootDir.`);
}

/**
 * 将平台相关的路径分隔符转换成稳定的显示用 ref。
 */
function toDisplayPath(path: string): string {
  return path.split(sep).join('/');
}

/**
 * 读取 YAML 文件，并要求文档根节点必须是对象，便于后续
 * suite/task 校验在一致的数据形状上运行。
 */
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

/**
 * 从给定起点目录开始，以确定性顺序递归收集 YAML 文件，同时拒绝符号链接
 * 以及任何 realpath 后逃出 adapter 根目录的路径。
 */
async function collectYamlFiles(
  startDirRealPath: string,
  rootDirRealPath: string,
): Promise<string[]> {
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

/**
 * 发现 rootDir 下的全部 suite 文档，完成校验，并在 suite id 重复时快速失败。
 */
async function scanSuites(rootDirRealPath: string): Promise<SuiteEntry[]> {
  const yamlFiles = await collectYamlFiles(rootDirRealPath, rootDirRealPath);
  const entries: SuiteEntry[] = [];

  for (const filePath of yamlFiles) {
    const document = await readYamlObject(filePath, 'suite file');
    if (document.schemaVersion !== SCHEMA_VERSIONS.SUITE) {
      continue;
    }

    const suite = validateSuiteDefinition(document);
    entries.push({
      ref: toDisplayPath(relative(rootDirRealPath, filePath)),
      suite,
    });
  }

  entries.sort((a, b) => a.suite.id.localeCompare(b.suite.id) || a.ref.localeCompare(b.ref));

  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.suite.id)) {
      throw new Error(`Suite id '${entry.suite.id}' must be unique under rootDir.`);
    }
    seenIds.add(entry.suite.id);
  }

  return entries;
}

/**
 * 使用与 task ref 相同的路径安全规则来规范化 suite discover glob。
 */
function normalizeDiscoverPattern(pattern: string): string {
  return normalizeRelativeValue(pattern, 'suite.discover');
}

/**
 * 判断 discover 路径片段是否包含 glob 元字符，用于截断出可直接定位的静态前缀。
 */
function hasGlobMagic(segment: string): boolean {
  return GLOB_MAGIC_PATTERN.test(segment);
}

/**
 * 基于 discover 模式提取静态前缀，便于只扫描该模式覆盖的目录范围。
 */
function getDiscoverStaticPrefix(pattern: string): string {
  const segments = pattern.split('/');
  const firstGlobIndex = segments.findIndex((segment) => hasGlobMagic(segment));
  if (firstGlobIndex < 0) {
    return pattern;
  }

  return segments.slice(0, firstGlobIndex).join('/');
}

/**
 * 解析单条 discover 规则，只在它对应的路径范围内收集匹配到的 task 文件 ref。
 */
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

/**
 * 将完整的 task 定义投影为更轻量的 suite task index 结构。
 */
function taskIndexFromTask(task: TaskDefinition, suiteId: string, ref: string): TaskIndex {
  return {
    id: task.id,
    ...(task.desc !== undefined ? { desc: task.desc } : {}),
    ...(task.category !== undefined ? { category: task.category } : {}),
    ...(task.capability !== undefined ? { capability: task.capability } : {}),
    ...(task.tier !== undefined ? { tier: task.tier } : {}),
    ...(task.difficulty !== undefined ? { difficulty: task.difficulty } : {}),
    ...(task.tags !== undefined ? { tags: task.tags } : {}),
    runCount: task.provider.runs.length,
    taskRef: {
      suiteId,
      ref,
    },
  };
}

/**
 * 将单个 task ref 解析为已校验的 task 定义，并补上基于文档内容生成的
 * source revision 元数据。
 */
async function resolveTaskFile(
  rootDirRealPath: string,
  taskRef: TaskRef,
  options?: { skipSuiteDocument?: boolean },
): Promise<{ ref: string; task: TaskDefinition; revision: string } | null> {
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

  const task = validateTaskDefinition(document);
  const revision = `sha256-${computeSha256(document).slice(0, 12)}`;

  return {
    ref: normalizedRef,
    task,
    revision,
  };
}

export function createLocalTaskSourceAdapter(
  options: LocalTaskSourceAdapterOptions,
): TaskSourceAdapter {
  const rootDir = ensureNonEmptyString(options.rootDir, 'rootDir');
  const absoluteRootDir = resolve(rootDir);

  /**
   * 尝试解析配置的根目录为真实路径（realpath），
   * 若 realpath 失败则返回绝对路径以便后续处理和一致的错误信息。
   */
  async function resolveRootDirRealPath(): Promise<string> {
    return realpath(absoluteRootDir).catch(() => absoluteRootDir);
  }

  /**
   * 按需重新扫描 suites，并返回对应 id 的唯一 suite 条目。
   */
  async function findSuiteEntry(suiteId: string): Promise<SuiteEntry> {
    const normalizedSuiteId = ensureNonEmptyString(suiteId, 'suiteId');
    const rootDirRealPath = await resolveRootDirRealPath();
    const suites = await scanSuites(rootDirRealPath);
    const entry = suites.find((candidate) => candidate.suite.id === normalizedSuiteId);
    if (entry) {
      return entry;
    }

    throw new Error(`Suite '${normalizedSuiteId}' was not found under rootDir.`);
  }

  return {
    async listSuites(): Promise<SuiteDescriptor[]> {
      const rootDirRealPath = await resolveRootDirRealPath();
      const suites = await scanSuites(rootDirRealPath);
      return suites.map((entry) => ({
        id: entry.suite.id,
        name: entry.suite.name,
        ref: entry.ref,
      }));
    },

    async resolveSuite(suiteId: string): Promise<ResolvedSuite> {
      const rootDirRealPath = await resolveRootDirRealPath();
      const entry = await findSuiteEntry(suiteId);
      const patterns = entry.suite.discover.map((pattern) => normalizeDiscoverPattern(pattern));
      const matchedTaskRefs = Array.from(
        new Set(
          (
            await Promise.all(
              patterns.map((pattern) =>
                collectTaskRefsForDiscoverPattern(rootDirRealPath, pattern),
              ),
            )
          ).flat(),
        ),
      ).sort();

      if (matchedTaskRefs.length === 0) {
        throw new Error(`Suite '${entry.suite.id}' did not match any task files.`);
      }

      const seenTaskIds = new Set<string>();
      const taskIndexes: TaskIndex[] = [];
      for (const fileRef of matchedTaskRefs) {
        const resolvedTask = await resolveTaskFile(
          rootDirRealPath,
          {
            suiteId: entry.suite.id,
            ref: fileRef,
          },
          { skipSuiteDocument: true },
        );
        if (resolvedTask === null) {
          continue;
        }

        const { task } = resolvedTask;

        if (seenTaskIds.has(task.id)) {
          throw new Error(`Task id '${task.id}' must be unique within suite '${entry.suite.id}'.`);
        }
        seenTaskIds.add(task.id);
        taskIndexes.push(taskIndexFromTask(task, entry.suite.id, fileRef));
      }

      return {
        source: {
          adapter: ADAPTER_ID,
          ref: entry.ref,
          fetchedAt: new Date().toISOString(),
        },
        suite: entry.suite,
        tasks: taskIndexes,
      };
    },

    async resolveTask(taskRef: TaskRef): Promise<ResolvedTask> {
      const rootDirRealPath = await resolveRootDirRealPath();
      const resolvedTask = await resolveTaskFile(rootDirRealPath, taskRef);
      if (resolvedTask === null) {
        throw new Error(`Task '${taskRef.ref}' resolves to a suite document, not a task document.`);
      }

      const { ref, task, revision } = resolvedTask;

      return {
        source: {
          adapter: ADAPTER_ID,
          ref,
          revision,
          fetchedAt: new Date().toISOString(),
        },
        task,
      };
    },
  };
}
