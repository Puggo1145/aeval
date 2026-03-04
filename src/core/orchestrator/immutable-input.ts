/**
 * 检查值是否为纯对象（plain object）。
 * 纯对象是指原型为 Object.prototype 或 null 的对象。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 递归深拷贝值。
 * 对数组和纯对象进行深拷贝，其他类型直接返回。
 */
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

/**
 * 递归深度冻结对象。
 * 使用 WeakSet 跟踪已访问对象，避免循环引用导致无限递归。
 */
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
