import assert from 'node:assert/strict';
import test from 'node:test';

import { countTerminalRows, createLiveRegion } from '../src/interfaces/tui/live-region.js';

class MockWriteStream {
  public readonly chunks: string[] = [];
  public readonly columns: number;
  public readonly isTTY: boolean;

  constructor({ columns = 80, isTTY = true }: { columns?: number; isTTY?: boolean } = {}) {
    this.columns = columns;
    this.isTTY = isTTY;
  }

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  flush(): string {
    return this.chunks.join('');
  }

  reset(): void {
    this.chunks.length = 0;
  }
}

test('countTerminalRows ignores ANSI color codes when calculating wrapped rows', () => {
  assert.equal(countTerminalRows('\x1b[35m1234567890\x1b[0m', 4), 3);
});

test('createLiveRegion redraws content in place for TTY output', () => {
  const output = new MockWriteStream({ columns: 20, isTTY: true }) as unknown as NodeJS.WriteStream;
  const region = createLiveRegion(output);

  region.render('task · run-a\n\nfirst log');
  assert.equal((output as unknown as MockWriteStream).flush(), 'task · run-a\n\nfirst log\n');

  (output as unknown as MockWriteStream).reset();
  region.render('task · run-a\n\nsecond log');

  const rewrittenOutput = (output as unknown as MockWriteStream).flush();
  assert.match(rewrittenOutput, /\u001b\[3A/u);
  assert.match(rewrittenOutput, /\u001b\[0J/u);
  assert.match(rewrittenOutput, /second log\n$/u);
});
