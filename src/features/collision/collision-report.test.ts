import { describe, expect, it } from 'vitest'
import type { CollisionFinding } from '../../domain/collision/collision'
import {
  COLLISION_REPORT_MAX_FINDINGS,
  encodeCollisionReportCsv,
  encodeCollisionReportJson,
} from './collision-report'

function finding(
  pairKey: string,
  kind: CollisionFinding['kind'],
  separationM: number,
  overrides: Partial<CollisionFinding> = {},
): CollisionFinding {
  const [firstEntityId, secondEntityId] = pairKey.split('|') as [string, string]
  return {
    pairKey,
    firstEntityId,
    secondEntityId,
    firstBoxId: 'main',
    secondBoxId: 'main',
    kind,
    separationM,
    sampleIndex: null,
    timeMs: null,
    ...overrides,
  }
}

describe('collision report encoders', () => {
  it('emits a deterministic versioned JSON report with product-safe labels', () => {
    const findings = [
      finding('object:z|robot-link:LINK03', 'near-miss', 0.012),
      finding('object:a|robot-link:LINK02', 'collision', -0.004),
    ]

    const first = encodeCollisionReportJson(findings)
    const second = encodeCollisionReportJson([...findings].reverse())
    const decoded = JSON.parse(first) as {
      schemaVersion: number
      title: string
      clearanceLabel: string
      findings: { pairKey: string; approximateClearanceMm: number }[]
    }

    expect(first).toBe(second)
    expect(decoded.schemaVersion).toBe(1)
    expect(decoded.title).toBe('Geometry Proxy Collision')
    expect(decoded.clearanceLabel).toBe('Approximate Clearance')
    expect(decoded.findings.map((row) => row.pairKey)).toEqual([
      'object:a|robot-link:LINK02',
      'object:z|robot-link:LINK03',
    ])
    expect(decoded.findings[0]?.approximateClearanceMm).toBe(-4)
  })

  it('keeps configured mount contact separate from user ignored pairs', () => {
    const mountPair = 'robot-link:LINK00|workcell:workbench'
    const ignoredPair = 'object:a|robot-link:LINK02'
    const decoded = JSON.parse(encodeCollisionReportJson([], {
      mountContact: { pairKey: mountPair, state: 'contact' },
      ignoredPairKeys: [ignoredPair],
    })) as {
      mountContactPairKey: string | null
      mountContactState: string | null
      ignoredPairKeys: string[]
    }

    expect(decoded.mountContactPairKey).toBe(mountPair)
    expect(decoded.mountContactState).toBe('contact')
    expect(decoded.ignoredPairKeys).toEqual([ignoredPair])
    expect(decoded.ignoredPairKeys).not.toContain(mountPair)
  })

  it('uses stable CSV order and escapes commas, quotes, and newlines', () => {
    const csv = encodeCollisionReportCsv([
      finding('object:z|robot-link:LINK03', 'near-miss', 0.01),
      finding('object:a|robot-link:LINK02', 'collision', -0.002, {
        firstBoxId: 'main,"line\n2',
      }),
    ])

    expect(csv.split('\n')[0]).toBe(
      'Kind,Pair,First Entity,Second Entity,First Box,Second Box,Approximate Clearance (mm),Sample,Time (ms)',
    )
    expect(csv).toContain('collision,object:a|robot-link:LINK02,object:a,robot-link:LINK02,"main,""line\n2"')
    expect(csv.indexOf('collision')).toBeLessThan(csv.indexOf('near-miss'))
  })

  it('caps both exports at 10,000 rows and marks JSON truncation', () => {
    const findings = Array.from(
      { length: COLLISION_REPORT_MAX_FINDINGS + 1 },
      (_, index) =>
        finding('object:a|robot-link:LINK03', 'near-miss', 0.01, {
          sampleIndex: index,
          timeMs: index * 10,
        }),
    )

    const decoded = JSON.parse(encodeCollisionReportJson(findings)) as {
      summary: { exportedFindings: number; totalFindings: number; truncated: boolean }
      findings: unknown[]
    }
    const csvRows = encodeCollisionReportCsv(findings).split('\n')

    expect(decoded.summary).toMatchObject({
      exportedFindings: COLLISION_REPORT_MAX_FINDINGS,
      totalFindings: COLLISION_REPORT_MAX_FINDINGS + 1,
      truncated: true,
    })
    expect(decoded.findings).toHaveLength(COLLISION_REPORT_MAX_FINDINGS)
    expect(csvRows).toHaveLength(COLLISION_REPORT_MAX_FINDINGS + 1)
  })

  it('preserves upstream Worker truncation even when available rows are below the export cap', () => {
    const encoded = (
      encodeCollisionReportJson as unknown as (
        rows: readonly CollisionFinding[],
        metadata: { readonly sourceTruncated: boolean; readonly sampleCount: number },
      ) => string
    )(
      [finding('object:a|robot-link:LINK03', 'collision', -0.001)],
      { sourceTruncated: true, sampleCount: 20_000 },
    )
    const decoded = JSON.parse(encoded) as {
      summary: { truncated: boolean; sampleCount: number }
    }

    expect(decoded.summary).toMatchObject({
      truncated: true,
      sampleCount: 20_000,
    })
  })

  it('is byte-stable for shuffled rows with reversed Entity orientation', () => {
    const canonical = finding(
      'object:a|robot-link:LINK02',
      'collision',
      -0.002,
      { firstBoxId: 'main', secondBoxId: 'main' },
    )
    const reversed: CollisionFinding = {
      ...canonical,
      firstEntityId: canonical.secondEntityId,
      secondEntityId: canonical.firstEntityId,
    }

    expect(encodeCollisionReportJson([canonical, reversed])).toBe(
      encodeCollisionReportJson([reversed, canonical]),
    )
    expect(encodeCollisionReportCsv([canonical, reversed])).toBe(
      encodeCollisionReportCsv([reversed, canonical]),
    )
  })
})
