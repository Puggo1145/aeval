import assert from 'node:assert/strict';
import test from 'node:test';

import { createAppCore } from '../src/bootstrap/create-app-core.js';

test('createAppCore returns a valid CoreApi instance', () => {
  const core = createAppCore();

  assert.ok(core);
  assert.equal(typeof core.loadExperiment, 'function');
  assert.equal(typeof core.getRunSummary, 'function');
  assert.equal(typeof core.listTrials, 'function');
  assert.equal(typeof core.setBaseline, 'function');
  assert.equal(typeof core.compareBaseline, 'function');
  assert.equal(typeof core.listRuns, 'function');
});
