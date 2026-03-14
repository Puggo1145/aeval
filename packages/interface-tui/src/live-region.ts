import readline from 'node:readline';

const ANSI_ESCAPE_PATTERN = /\x1b\[(?:\d+;)*\d*[ABCDEFGHJKSTfm]|\x1b\[(s|u)/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_PATTERN, '');
}

export function countTerminalRows(content: string, columns: number): number {
  const safeColumns = Number.isFinite(columns) && columns > 0 ? columns : Number.MAX_SAFE_INTEGER;

  return content.split('\n').reduce((rows, line) => {
    const visibleWidth = stripAnsi(line).length;
    return rows + Math.max(1, Math.ceil(visibleWidth / safeColumns));
  }, 0);
}

export function createLiveRegion(output: NodeJS.WriteStream = process.stdout): {
  render: (content: string) => void;
  clear: () => void;
} {
  const supportsCursorControl = Boolean(output.isTTY);
  let renderedRows = 0;
  let active = false;

  const clearRenderedContent = (): void => {
    if (!supportsCursorControl || !active || renderedRows === 0) {
      return;
    }

    readline.moveCursor(output, 0, -renderedRows);
    readline.cursorTo(output, 0);
    readline.clearScreenDown(output);
  };

  return {
    render: (content: string): void => {
      const normalizedContent = content.replace(/\n+$/u, '');

      if (!supportsCursorControl) {
        output.write(`${normalizedContent}\n`);
        return;
      }

      clearRenderedContent();
      output.write(`${normalizedContent}\n`);
      renderedRows = countTerminalRows(normalizedContent, output.columns ?? 80);
      active = true;
    },
    clear: (): void => {
      clearRenderedContent();
      renderedRows = 0;
      active = false;
    },
  };
}
