import assert from 'node:assert/strict';
import test from 'node:test';

import { createBoundedAsyncChannel } from '../packages/core/src/core/orchestrator/bounded-async-channel.js';

test('bounded channel supports basic push/next flow', async () => {
  const channel = createBoundedAsyncChannel<number>(2);

  assert.equal(await channel.push(1), true);
  assert.equal(await channel.push(2), true);

  assert.deepEqual(await channel.next(), { done: false, value: 1 });
  assert.deepEqual(await channel.next(), { done: false, value: 2 });
});

test('bounded channel applies backpressure when full', async () => {
  const channel = createBoundedAsyncChannel<number>(1);
  assert.equal(await channel.push(1), true);

  let secondPushResolved = false;
  const secondPushPromise = channel.push(2).then((accepted) => {
    secondPushResolved = true;
    return accepted;
  });

  await Promise.resolve();
  assert.equal(secondPushResolved, false);

  assert.deepEqual(await channel.next(), { done: false, value: 1 });
  assert.equal(await secondPushPromise, true);
  assert.deepEqual(await channel.next(), { done: false, value: 2 });
});

test('bounded channel close wakes pending producers and rejects late pushes', async () => {
  const channel = createBoundedAsyncChannel<number>(1);
  assert.equal(await channel.push(1), true);

  const blockedPushPromise = channel.push(2);
  await Promise.resolve();

  channel.close();

  assert.equal(await blockedPushPromise, false);
  assert.equal(await channel.push(3), false);
});

test('bounded channel drains queued items then ends async iteration after close', async () => {
  const channel = createBoundedAsyncChannel<number>(4);
  assert.equal(await channel.push(10), true);
  assert.equal(await channel.push(20), true);
  channel.close();

  const received: number[] = [];
  for await (const item of channel) {
    received.push(item);
  }

  assert.deepEqual(received, [10, 20]);
  assert.deepEqual(await channel.next(), { done: true, value: undefined });
});
