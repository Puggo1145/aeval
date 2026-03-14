import { createHash } from 'node:crypto';
import canonicalizeModule from 'canonicalize';

const canonicalize = canonicalizeModule as unknown as (value: unknown) => string | undefined;

function serializeCanonicalJson(value: unknown): string {
  const serialized = canonicalize(value);
  if (serialized === undefined) {
    throw new TypeError('Unsupported value type in canonical JSON payload.');
  }

  return serialized;
}

export function computeSha256(value: unknown): string {
  return createHash('sha256').update(serializeCanonicalJson(value)).digest('hex');
}
