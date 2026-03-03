import { readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import * as p from '@clack/prompts';

class CancelError extends Error {
  constructor() {
    super('Operation cancelled.');
    this.name = 'CancelError';
  }
}

export { CancelError };

export function handleCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel('Operation cancelled.');
    throw new CancelError();
  }
  return value;
}

async function listYamlFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && /\.ya?ml$/i.test(e.name))
      .map((e) => resolve(join(dir, e.name)))
      .sort();
  } catch {
    return [];
  }
}

export async function discoverExperimentFiles(): Promise<string[]> {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const dir of ['experiments', '.']) {
    const files = await listYamlFiles(dir);
    for (const file of files) {
      if (!seen.has(file)) {
        seen.add(file);
        results.push(file);
      }
    }
  }

  return results;
}
