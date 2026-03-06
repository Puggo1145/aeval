import assert from 'node:assert/strict';
import test from 'node:test';

import { computeSha256 } from '../src/core/utils/hash.js';

test('computeSha256 is stable across object key order and ignores undefined fields', () => {
  const hash1 = computeSha256({
    z: 1,
    a: {
      y: true,
      x: undefined,
    },
  });

  const hash2 = computeSha256({
    a: {
      x: undefined,
      y: true,
    },
    z: 1,
  });

  assert.equal(hash1, hash2);
});

test('computeSha256 rejects unsupported canonical JSON values', () => {
  assert.throws(() => computeSha256(() => 'nope'), /Unsupported value type/);
});
