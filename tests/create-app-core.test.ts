import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppCore } from '../src/bootstrap/create-app-core.js';
import { ValidationError } from '../src/core/errors/index.js';

test('createAppCore accepts undefined runsRoot and uses default root', () => {
  const core = createAppCore({
    datasetsRoot: '/tmp',
  });

  assert.ok(core);
});

test('createAppCore rejects empty runsRoot string', () => {
  assert.throws(
    () =>
      createAppCore({
        datasetsRoot: '/tmp',
        runsRoot: '   ',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ValidationError);
      assert.equal(error.details?.field, 'runsRoot');
      return true;
    },
  );
});
