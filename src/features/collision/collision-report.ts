import type { CollisionFinding } from '../../domain/collision/collision'

export const COLLISION_REPORT_SCHEMA_VERSION = 1
export const COLLISION_REPORT_MAX_FINDINGS = 10_000

export interface CollisionReportMetadata {
  readonly sourceTruncated?: boolean
  readonly sampleCount?: number | null
}

interface CollisionReportRow {
  readonly kind: CollisionFinding['kind']
  readonly pairKey: string
  readonly firstEntityId: string
  readonly secondEntityId: string
  readonly firstBoxId: string
  readonly secondBoxId: string
  readonly approximateClearanceMm: number
  readonly sampleIndex: number | null
  readonly timeMs: number | null
}

function compareNumberOrNull(
  first: number | null,
  second: number | null,
): number {
  if (first === second) return 0
  if (first === null) return -1
  if (second === null) return 1
  return first - second
}

function compareString(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0
}

function compareFinding(
  first: CollisionFinding,
  second: CollisionFinding,
): number {
  return (
    compareNumberOrNull(first.timeMs, second.timeMs) ||
    compareNumberOrNull(first.sampleIndex, second.sampleIndex) ||
    (first.kind === second.kind ? 0 : first.kind === 'collision' ? -1 : 1) ||
    compareString(first.pairKey, second.pairKey) ||
    compareString(first.firstEntityId, second.firstEntityId) ||
    compareString(first.secondEntityId, second.secondEntityId) ||
    compareString(first.firstBoxId, second.firstBoxId) ||
    compareString(first.secondBoxId, second.secondBoxId) ||
    first.separationM - second.separationM
  )
}

function stableRows(findings: readonly CollisionFinding[]): {
  readonly rows: readonly CollisionReportRow[]
  readonly truncated: boolean
} {
  const ordered = [...findings].sort(compareFinding)
  return {
    rows: ordered.slice(0, COLLISION_REPORT_MAX_FINDINGS).map((finding) => ({
      kind: finding.kind,
      pairKey: finding.pairKey,
      firstEntityId: finding.firstEntityId,
      secondEntityId: finding.secondEntityId,
      firstBoxId: finding.firstBoxId,
      secondBoxId: finding.secondBoxId,
      approximateClearanceMm: finding.separationM * 1_000,
      sampleIndex: finding.sampleIndex,
      timeMs: finding.timeMs,
    })),
    truncated: ordered.length > COLLISION_REPORT_MAX_FINDINGS,
  }
}

export function encodeCollisionReportJson(
  findings: readonly CollisionFinding[],
  metadata: CollisionReportMetadata = {},
): string {
  const { rows, truncated } = stableRows(findings)
  return JSON.stringify(
    {
      schemaVersion: COLLISION_REPORT_SCHEMA_VERSION,
      title: 'Geometry Proxy Collision',
      clearanceLabel: 'Approximate Clearance',
      summary: {
        totalFindings: findings.length,
        exportedFindings: rows.length,
        collisions: findings.filter(({ kind }) => kind === 'collision').length,
        nearMisses: findings.filter(({ kind }) => kind === 'near-miss').length,
        sampleCount: metadata.sampleCount ?? null,
        truncated: metadata.sourceTruncated === true || truncated,
      },
      findings: rows,
    },
    null,
    2,
  )
}

function csvCell(value: string | number | null): string {
  if (value === null) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function encodeCollisionReportCsv(
  findings: readonly CollisionFinding[],
): string {
  const { rows } = stableRows(findings)
  const header = [
    'Kind',
    'Pair',
    'First Entity',
    'Second Entity',
    'First Box',
    'Second Box',
    'Approximate Clearance (mm)',
    'Sample',
    'Time (ms)',
  ]
  return [
    header.join(','),
    ...rows.map((row) =>
      [
        row.kind,
        row.pairKey,
        row.firstEntityId,
        row.secondEntityId,
        row.firstBoxId,
        row.secondBoxId,
        row.approximateClearanceMm,
        row.sampleIndex,
        row.timeMs,
      ]
        .map(csvCell)
        .join(','),
    ),
  ].join('\n')
}
