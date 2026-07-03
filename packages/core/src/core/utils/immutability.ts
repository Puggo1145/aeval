/**
 * Whether a value is a plain object that is safe to clone recursively.
 * Only objects whose prototype is `Object.prototype` or `null` qualify, so
 * class instances are never treated as deep-clonable data.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Recursively clone arrays and plain objects; return other values as-is.
 * Cloning before freezing detaches internal state from caller references.
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
 * Freeze every node in an object graph. A `WeakSet` tracks visited objects to
 * survive circular references.
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
 * Deep-clone then deep-freeze a value, producing a read-only snapshot that
 * cannot be mutated externally after construction.
 */
export function cloneAndFreeze<T>(value: T): Readonly<T> {
  const cloned = cloneValue(value);
  deepFreeze(cloned, new WeakSet<object>());
  return cloned;
}

/**
 * Record-typed convenience wrapper; empty input yields a frozen empty object
 * so callers do not need their own null handling.
 */
export function cloneAndFreezeRecord(
  input: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> {
  return cloneAndFreeze(input ?? {}) as Readonly<Record<string, unknown>>;
}
