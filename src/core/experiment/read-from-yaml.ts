import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { parse as parseYaml } from 'yaml';

/**
 * 从 YAML 文件读取并解析实验配置。
 * 不做字段裁剪与兼容处理；完整对象由 core.loadExperiment 统一校验。
 */
export async function readFromYAML(path: string): Promise<unknown> {
  const raw = await readFile(resolve(path), 'utf-8');
  return parseYaml(raw) as unknown;
}
