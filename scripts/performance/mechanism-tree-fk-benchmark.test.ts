import { describe, expect, it } from 'vitest'

import {
  formatMeasuredSourceIdentity,
  fingerprintBenchmarkSourceContent,
  runMechanismTreeFkBenchmark,
} from './mechanism-tree-fk-benchmark.js'

describe('Mechanism Tree FK benchmark', () => {
  it('derives a deterministic measured-source identity instead of claiming a clean commit', () => {
    const sourceReader = (relativePath: string) => `source:${relativePath}`
    const first = fingerprintBenchmarkSourceContent(sourceReader)
    const second = fingerprintBenchmarkSourceContent(sourceReader)

    expect(first).toMatch(/^[a-f0-9]{64}$/)
    expect(second).toBe(first)
    expect(formatMeasuredSourceIdentity('abcdef', first)).toBe(`abcdef+source:${first}`)
  })

  it('prepares coordinates before the timed FK evaluation', () => {
    const originalFromEntries = Object.fromEntries
    let clockRunning = false
    let clockCalls = 0
    Object.fromEntries = ((entries: Iterable<readonly [PropertyKey, unknown]>) => {
      if (clockRunning) throw new Error('Coordinates must not be constructed during the timed evaluation.')
      return originalFromEntries(entries)
    }) as typeof Object.fromEntries

    try {
      const report = runMechanismTreeFkBenchmark({
        warmupCount: 0,
        batchCount: 1,
        samplesPerBatch: 2,
      }, {
        nowMs: () => {
          clockCalls += 1
          clockRunning = clockCalls % 2 === 1
          return clockCalls
        },
        readEnvironment: () => ({
          platform: 'test-platform',
          cpuModel: 'test-cpu',
          logicalCores: 8,
          nodeVersion: 'v0.0.0-test',
          gitCommit: 'test-commit',
        }),
      })

      expect(report.aggregate).toEqual({ p50Ms: 1, p95Ms: 1 })
    } finally {
      Object.fromEntries = originalFromEntries
    }
  })

  it('reports finite sorted percentiles with injected time and environment', () => {
    let now = 0
    const report = runMechanismTreeFkBenchmark({
      warmupCount: 2,
      batchCount: 2,
      samplesPerBatch: 3,
    }, {
      nowMs: () => {
        now += 0.25
        return now
      },
      readEnvironment: () => ({
        platform: 'test-platform',
        cpuModel: 'test-cpu',
        logicalCores: 8,
        nodeVersion: 'v0.0.0-test',
        gitCommit: 'test-commit',
      }),
    })

    expect(report.fixture).toEqual({ bodies: 128, totalJoints: 127, movableJoints: 64, fixedJoints: 63 })
    expect(report.solver).toEqual({ solverKey: 'open-digital-twin/tree-fk', contractVersion: '1' })
    expect(report.environment).toEqual({
      platform: 'test-platform',
      cpuModel: 'test-cpu',
      logicalCores: 8,
      nodeVersion: 'v0.0.0-test',
      gitCommit: 'test-commit',
    })
    expect(report.batches).toHaveLength(2)
    for (const batch of report.batches) {
      expect(Number.isFinite(batch.p50Ms)).toBe(true)
      expect(Number.isFinite(batch.p95Ms)).toBe(true)
      expect(Number.isFinite(batch.maxMs)).toBe(true)
      expect(batch.p50Ms).toBeLessThanOrEqual(batch.p95Ms)
      expect(batch.p95Ms).toBeLessThanOrEqual(batch.maxMs)
    }
    expect(Number.isFinite(report.aggregate.p50Ms)).toBe(true)
    expect(Number.isFinite(report.aggregate.p95Ms)).toBe(true)
    expect(report.aggregate.p50Ms).toBeLessThanOrEqual(report.aggregate.p95Ms)
  })
})
