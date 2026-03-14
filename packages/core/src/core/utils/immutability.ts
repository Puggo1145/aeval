/**
 * 判断一个值是否为可安全递归处理的 plain object。
 * 这里只接受原型为 `Object.prototype` 或 `null` 的对象，
 * 避免把 class 实例等非普通对象误当作可深拷贝结构处理。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * 递归克隆数组和 plain object，其他值保持原样返回。
 * 这样可以在冻结前先断开与输入对象的引用关系，避免外部后续修改影响内部状态。
 */
function cloneValue<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneValue(item)) as T;
  }

  if (isPlainObject(value)) {
    const cloned: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      cloned[key] = cloneValue(value[key]);
    }
    return cloned as T;
  }

  return value;
}

/**
 * 递归冻结对象图中的每一层节点。
 * 使用 `WeakSet` 记录已访问对象，避免循环引用导致无限递归。
 */
function deepFreeze(value: unknown, visited: WeakSet<object>): void {
  if (value === null || typeof value !== 'object') {
    return;
  }

  const target = value as Record<string, unknown>;
  if (visited.has(target)) {
    return;
  }
  visited.add(target);

  if (Array.isArray(target)) {
    for (const item of target) {
      deepFreeze(item, visited);
    }
    Object.freeze(target);
    return;
  }

  for (const key of Object.keys(target)) {
    deepFreeze(target[key], visited);
  }

  Object.freeze(target);
}

/**
 * 对任意输入执行“先深拷贝，再深冻结”。
 * 用于构造只读快照，保证运行时对象在创建后不再被外部修改。
 */
export function cloneAndFreeze<T>(value: T): Readonly<T> {
  const cloned = cloneValue(value);
  deepFreeze(cloned, new WeakSet<object>());
  return cloned;
}

/**
 * 针对记录类型的便捷封装。
 * 当输入为空时返回一个冻结后的空对象，统一调用方的空值处理逻辑。
 */
export function cloneAndFreezeRecord(
  input: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> {
  return cloneAndFreeze(input ?? {}) as Readonly<Record<string, unknown>>;
}
