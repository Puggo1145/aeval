function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item));
  }

  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      cloned[key] = cloneValue(value[key]);
    }
    return cloned;
  }

  return value;
}

function deepFreezeValue(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  const target = value as Record<string, unknown>;
  if (visited.has(target)) {
    return;
  }
  visited.add(target);

  for (const key of Object.keys(target)) {
    deepFreezeValue(target[key], visited);
  }

  Object.freeze(target);
}

/**
 * 复制并深度冻结输入，避免 provider 在运行时篡改 run/task 下发参数。
 */
export function cloneAndDeepFreezeRecord(
  input: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> {
  const cloned = cloneValue(input ?? {}) as Record<string, unknown>;
  deepFreezeValue(cloned, new WeakSet<object>());
  return cloned;
}
