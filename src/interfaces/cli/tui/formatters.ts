import * as p from '@clack/prompts';

import type { RunSummary, RunSummaryRecord } from '../../../core/contracts/run-summary.js';
import type { BaselineComparison } from '../../../core/contracts/runtime.js';

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function signedPassRate(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${formatPassRate(delta)}`;
}

export function formatSummaryNote(summary: RunSummary): void {
  const lines: string[] = [
    `Run ID:       ${summary.runId}`,
    `Run Name:     ${summary.runName}`,
    `Pass Rate:    ${formatPassRate(summary.passRate)}`,
    `Total Tasks:  ${summary.totalTasks}`,
    `Total Trials: ${summary.totalTrials}`,
  ];

  if (summary.passAtK !== undefined) {
    lines.push(`Pass@K:       ${formatPassRate(summary.passAtK)}`);
  }
  if (summary.passHatK !== undefined) {
    lines.push(`Pass^K:       ${formatPassRate(summary.passHatK)}`);
  }
  if (summary.avgLatencyMs !== undefined) {
    lines.push(`Avg Latency:  ${summary.avgLatencyMs.toFixed(0)}ms`);
  }

  p.note(lines.join('\n'), 'Run Summary');
}

export function formatComparisonNote(comparison: BaselineComparison): void {
  const lines: string[] = [
    `Baseline:        ${comparison.baselineRunId}`,
    `Current:         ${comparison.currentRunId}`,
    `Verdict:         ${comparison.verdict}`,
    `Pass Rate Delta: ${signedPassRate(comparison.passRateDelta)}`,
  ];

  if (comparison.passHatKDelta !== undefined) {
    lines.push(`Pass^K Delta:    ${signedPassRate(comparison.passHatKDelta)}`);
  }
  if (comparison.avgLatencyDelta !== undefined) {
    lines.push(
      `Latency Delta:   ${comparison.avgLatencyDelta >= 0 ? '+' : ''}${comparison.avgLatencyDelta.toFixed(0)}ms`,
    );
  }
  if (comparison.regressions.length > 0) {
    lines.push(`Regressions:     ${comparison.regressions.join(', ')}`);
  }
  if (comparison.improvements.length > 0) {
    lines.push(`Improvements:    ${comparison.improvements.join(', ')}`);
  }

  p.note(lines.join('\n'), 'Baseline Comparison');
}

export function formatRunsTable(records: RunSummaryRecord[]): string {
  if (records.length === 0) {
    return 'No runs found.';
  }

  const header = ['Run ID', 'Run Name', 'Pass Rate', 'Tasks', 'Trials'];
  const rows = records.map((r) => [
    r.summary.runId,
    r.summary.runName,
    formatPassRate(r.summary.passRate),
    String(r.summary.totalTasks),
    String(r.summary.totalTrials),
  ]);

  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => (row[i] ?? '').length)),
  );

  const formatRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? 0)).join('  ');

  const lines = [formatRow(header), widths.map((w) => '-'.repeat(w)).join('  ')];
  for (const row of rows) {
    lines.push(formatRow(row));
  }

  return lines.join('\n');
}
