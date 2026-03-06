import * as p from '@clack/prompts';

import type { RunRecord } from '../../core/contracts/run-record.js';
import type { RunSummary } from '../../core/contracts/run-summary.js';
import type { BaselineComparison } from '../../core/contracts/runtime.js';
import type { TrialResult, TrialResultRecord } from '../../core/contracts/trial.js';
import type { RunMetadata } from './run-metadata.js';

function formatPassRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

function signedPassRate(delta: number): string {
  return `${delta >= 0 ? '+' : ''}${formatPassRate(delta)}`;
}

export function formatSuiteText(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return 'unknown';
  }
  return value.trim();
}

export function formatTaskText(value: string | undefined): string {
  if (!value || value.trim().length === 0) {
    return 'unknown';
  }
  return value.trim();
}

function formatRunStatus(status: RunRecord['status']): string {
  return status.toUpperCase();
}

function formatRunTaskId(record: RunRecord): string {
  return record.summary?.taskId ?? record.manifest?.taskId ?? 'unknown';
}

function shortenRunId(runId: string): string {
  const trimmed = runId.trim();
  return trimmed.length <= 8 ? trimmed : trimmed.slice(0, 8);
}

function formatRunTimestamp(value: string | undefined): string | undefined {
  if (!value || value.trim().length === 0) {
    return undefined;
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return value.slice(0, 16).replace('T', ' ') + 'Z';
}

export function formatRunOptionLabel(record: RunRecord): string {
  const runName = record.summary?.runName ?? record.manifest?.runName ?? record.runId;
  const timestamp = formatRunTimestamp(record.manifest?.completedAt ?? record.manifest?.startedAt);
  const suffix = timestamp
    ? `${timestamp} | ${shortenRunId(record.runId)}`
    : shortenRunId(record.runId);
  return `${runName} | ${suffix}`;
}

export function formatRunOptionHint(record: RunRecord, metadata: RunMetadata | undefined): string {
  return `suite: ${formatSuiteText(metadata?.suiteName)} | task: ${formatTaskText(metadata?.taskId)} | runId: ${record.runId}`;
}

export function formatRunOptionStatsHint(record: RunRecord): string {
  if (record.summary) {
    return `status=${record.status} | pass=${formatPassRate(record.summary.passRate)} | task=${record.summary.taskId} | trials=${record.summary.totalTrials}`;
  }

  return `status=${record.status} | task=${formatRunTaskId(record)}`;
}

export function formatSummaryNote(
  summary: RunSummary,
  metadata?: RunMetadata,
  trials: TrialResultRecord[] = [],
): void {
  p.note(formatRunSummaryDetails(summary, metadata, trials), 'Run Summary');
}

export function formatInterruptedRunNote(record: RunRecord, metadata?: RunMetadata): void {
  const lines = [
    `Run ID:       ${record.runId}`,
    `Status:       ${formatRunStatus(record.status)}`,
    `Suite:        ${formatSuiteText(metadata?.suiteName ?? record.manifest?.suiteName)}`,
    `Task:         ${formatTaskText(metadata?.taskId ?? formatRunTaskId(record))}`,
    `Run Name:     ${record.manifest?.runName ?? 'unknown'}`,
    `Started At:   ${record.manifest?.startedAt ?? 'unknown'}`,
  ];

  p.note(lines.join('\n'), 'Run Summary');
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, sortJsonValue(nested)]),
    );
  }

  return value;
}

function indentBlock(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function collectMetricLines(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectMetricLines(item, [...path, String(index)]));
  }

  if (value && typeof value === 'object') {
    return Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([key, nested]) => collectMetricLines(nested, [...path, key]));
  }

  const label = path.join('.');
  const rendered =
    typeof value === 'string'
      ? value
      : value === undefined
        ? 'undefined'
        : String(value);
  return label.length > 0 ? [`${label}: ${rendered}`] : [rendered];
}

function formatMetricsValue(metrics: Record<string, unknown> | undefined): string {
  if (!metrics || Object.keys(metrics).length === 0) {
    return '  (no metrics)';
  }

  return indentBlock(collectMetricLines(sortJsonValue(metrics)).join('\n'));
}

export function formatRunSummaryDetails(
  summary: RunSummary,
  metadata?: RunMetadata,
  trials: TrialResultRecord[] = [],
): string {
  const lines: string[] = [
    `Run ID:       ${summary.runId}`,
    `Suite:        ${formatSuiteText(metadata?.suiteName)}`,
    `Task:         ${formatTaskText(metadata?.taskId ?? summary.taskId)}`,
    `Run Name:     ${summary.runName}`,
    `Pass Rate:    ${formatPassRate(summary.passRate)}`,
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

  if (trials.length > 0) {
    lines.push('', 'Metrics:');
    for (const record of trials) {
      lines.push(`  Trial #${record.trial.trialIndex}:`);
      lines.push(formatMetricsValue(record.trial.execution.metrics));
    }
  }

  return lines.join('\n');
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

function getTerminalWidth(): number {
  const columns = process.stdout.columns;
  return typeof columns === 'number' && columns > 0 ? columns : 120;
}

function formatBoundedTable(
  header: string[],
  rows: string[][],
  maxWidths: number[],
  minWidths: number[] = [],
): string {
  const spacingWidth = 2;
  const widths = header.map((title, index) => {
    const contentWidth = Math.max(title.length, ...rows.map((row) => (row[index] ?? '').length));
    const minWidth = minWidths[index] ?? title.length;
    const maxWidth = maxWidths[index] ?? contentWidth;
    return Math.max(minWidth, Math.min(contentWidth, maxWidth));
  });

  const terminalWidth = getTerminalWidth();
  const usedWidth =
    widths.reduce((sum, width) => sum + width, 0) + spacingWidth * Math.max(0, header.length - 1);

  if (usedWidth > terminalWidth) {
    let overflow = usedWidth - terminalWidth;
    for (let index = 0; index < widths.length && overflow > 0; index += 1) {
      const minWidth = minWidths[index] ?? header[index]?.length ?? 1;
      const shrinkable = widths[index] - minWidth;
      if (shrinkable <= 0) {
        continue;
      }

      const shrinkBy = Math.min(shrinkable, overflow);
      widths[index] -= shrinkBy;
      overflow -= shrinkBy;
    }
  }

  const separator = ' '.repeat(spacingWidth);
  const formatRow = (cells: string[]): string =>
    cells
      .map((cell, index) =>
        truncateText(cell, widths[index] ?? cell.length).padEnd(widths[index] ?? 0),
      )
      .join(separator);

  return [
    formatRow(header),
    widths.map((width) => '-'.repeat(width)).join(separator),
    ...rows.map((row) => formatRow(row)),
  ].join('\n');
}

export function formatRunsTable(
  records: RunRecord[],
  metadataByRunId: ReadonlyMap<string, RunMetadata> = new Map(),
): string {
  if (records.length === 0) {
    return 'No runs found.';
  }

  const header = ['Run ID', 'Status', 'Suite', 'Task', 'Run Name', 'Pass Rate', 'Trials'];
  const rows = records.map((r) => [
    r.runId,
    formatRunStatus(r.status),
    formatSuiteText(metadataByRunId.get(r.runId)?.suiteName),
    formatTaskText(metadataByRunId.get(r.runId)?.taskId ?? formatRunTaskId(r)),
    r.summary?.runName ?? r.manifest?.runName ?? 'unknown',
    r.summary ? formatPassRate(r.summary.passRate) : '-',
    r.summary ? String(r.summary.totalTrials) : '-',
  ]);

  return formatBoundedTable(header, rows, [20, 12, 18, 28, 18, 10, 8], [10, 6, 8, 12, 8, 9, 6]);
}

export function formatTrialsTable(records: TrialResultRecord[]): string {
  if (records.length === 0) {
    return 'No trials found.';
  }

  const header = ['Task ID', 'Trial', 'Status', 'Score', 'Duration'];
  const rows = records.map((record) => {
    const trial = record.trial;
    return [
      trial.taskId,
      String(trial.trialIndex),
      trial.aggregate.pass ? 'PASS' : 'FAIL',
      trial.aggregate.score !== undefined ? trial.aggregate.score.toFixed(2) : '-',
      `${trial.timings.durationMs}ms`,
    ];
  });

  return formatBoundedTable(header, rows, [36, 8, 8, 8, 12], [12, 5, 6, 5, 8]);
}

function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

export function formatTrialGraderDetails(trial: TrialResult): string {
  const score = trial.aggregate.score !== undefined ? trial.aggregate.score.toFixed(2) : '-';
  const error = trial.execution.error;
  const lines = [
    `Task:      ${trial.taskId}`,
    `Trial:     #${trial.trialIndex}`,
    `Aggregate: ${trial.aggregate.pass ? 'PASS' : 'FAIL'} (score=${score})`,
    `Run:       ${trial.runName} (${trial.runId})`,
    `Duration:  ${trial.timings.durationMs}ms`,
  ];

  if (error) {
    const code = error.code ?? 'unknown';
    const retryable = error.retryable === undefined ? 'unknown' : error.retryable ? 'yes' : 'no';
    lines.push('', 'Error:');
    lines.push(`  Type:      ${error.type}`);
    lines.push(`  Code:      ${code}`);
    lines.push(`  Retryable: ${retryable}`);
    lines.push(`  Message:   ${error.message}`);
  }

  lines.push(
    '',
    'Metrics:',
    formatMetricsValue(trial.execution.metrics),
    '',
    'Graders:',
  );

  if (trial.graderResults.length === 0) {
    lines.push('  (no grader results)');
    return lines.join('\n');
  }

  for (const grader of trial.graderResults) {
    const graderScore = grader.result.score !== undefined ? grader.result.score.toFixed(2) : '-';
    lines.push(
      `  [${grader.result.pass ? 'PASS' : 'FAIL'}] ${grader.name} (${grader.type}) score=${graderScore}`,
    );
    lines.push(`    reason: ${truncateText(grader.result.reason, 140)}`);
  }

  return lines.join('\n');
}
