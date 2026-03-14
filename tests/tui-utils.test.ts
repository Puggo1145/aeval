import assert from 'node:assert/strict';
import test from 'node:test';

import * as p from '@clack/prompts';

import { CancelError, handleCancel } from '../packages/interface-tui/src/utils.js';

test('handleCancel returns original value when prompt is not canceled', () => {
  assert.equal(handleCancel('ok'), 'ok');
});

test('handleCancel throws CancelError when prompt returns cancel symbol', async () => {
  const controller = new AbortController();
  controller.abort();
  const cancelValue = await p.text({
    message: 'cancel test',
    signal: controller.signal,
  });

  assert.throws(
    () => handleCancel(cancelValue),
    (error: unknown) => {
      assert.ok(error instanceof CancelError);
      return true;
    },
  );
});
