import { describe, expect, it } from 'vitest'
import type {
  CollisionDiagnostic,
  CollisionFinding,
  CollisionPolicy,
} from '../../domain/collision/collision'
import {
  createCollisionStore,
  type CollisionValidationReport,
} from './collision-store'

const POLICY: CollisionPolicy = {
  enabled: true,
  warningDistanceM: 0.1,
  ignoredPairKeys: [],
  enabledRobotSelfPairs: [],
}

const FINDING: CollisionFinding = {
  pairKey: 'object:cup-01|robot-link:LINK03',
  firstEntityId: 'object:cup-01',
  secondEntityId: 'robot-link:LINK03',
  firstBoxId: 'main',
  secondBoxId: 'main',
  kind: 'collision',
  separationM: -0.05,
  sampleIndex: null,
  timeMs: null,
}

describe('collision store', () => {
  it('atomically replaces policy, findings, and diagnostics with owned values', () => {
    const store = createCollisionStore()
    const ignoredPairKeys = ['object:cup-01|robot-link:LINK03']
    const findings: CollisionFinding[] = [{ ...FINDING }]
    const diagnostics: CollisionDiagnostic[] = [
      { entityId: 'object:missing', message: 'Scene object is unavailable.' },
    ]

    store.getState().replaceCollisionState({
      policy: { ...POLICY, ignoredPairKeys },
      currentFindings: findings,
      diagnostics,
    })

    ignoredPairKeys[0] = 'mutated'
    findings[0] = { ...FINDING, separationM: -99 }
    diagnostics[0] = { entityId: 'mutated', message: 'mutated' }
    const state = store.getState()
    expect(state.policy.ignoredPairKeys).toEqual([
      'object:cup-01|robot-link:LINK03',
    ])
    expect(state.currentFindings[0]?.separationM).toBe(-0.05)
    expect(state.diagnostics[0]?.entityId).toBe('object:missing')
  })

  it('rejects invalid replacement without partially changing state', () => {
    const store = createCollisionStore()
    const before = store.getState()

    expect(() =>
      store.getState().replaceCollisionState({
        policy: { ...POLICY, warningDistanceM: Number.NaN },
        currentFindings: [FINDING],
        diagnostics: [],
      }),
    ).toThrow(/warning distance/i)

    const after = store.getState()
    expect(after.policy).toEqual(before.policy)
    expect(after.currentFindings).toEqual(before.currentFindings)
    expect(after.diagnostics).toEqual(before.diagnostics)
  })

  it('updates finite policy values and rejects invalid warning distances', () => {
    const store = createCollisionStore()

    store.getState().setCollisionEnabled(false)
    store.getState().setWarningDistanceM(0.125)

    expect(store.getState().policy).toMatchObject({
      enabled: false,
      warningDistanceM: 0.125,
    })
    expect(() => store.getState().setWarningDistanceM(Infinity)).toThrow(
      /warning distance/i,
    )
    expect(store.getState().policy.warningDistanceM).toBe(0.125)
  })

  it('canonicalizes, persists, and restores ignored pairs without duplicates', () => {
    const store = createCollisionStore()

    store
      .getState()
      .ignorePair('robot-link:LINK03|object:cup-01')
    store
      .getState()
      .ignorePair('object:cup-01|robot-link:LINK03')

    expect(store.getState().policy.ignoredPairKeys).toEqual([
      'object:cup-01|robot-link:LINK03',
    ])

    store
      .getState()
      .restorePair('robot-link:LINK03|object:cup-01')
    expect(store.getState().policy.ignoredPairKeys).toEqual([])
  })

  it('replaces current findings and diagnostics in one state transition', () => {
    const store = createCollisionStore()
    const transitions: CollisionFinding[][] = []
    const unsubscribe = store.subscribe((state) => {
      transitions.push([...state.currentFindings])
    })

    store.getState().replaceCollisionState({
      policy: POLICY,
      currentFindings: [FINDING],
      diagnostics: [
        { entityId: 'object:missing', message: 'Scene object is unavailable.' },
      ],
    })
    unsubscribe()

    expect(transitions).toHaveLength(1)
    expect(transitions[0]).toEqual([FINDING])
    expect(store.getState().diagnostics).toHaveLength(1)
  })

  it('owns validation rows and keeps a stale report visible with its error', () => {
    const store = createCollisionStore()
    const findings: CollisionFinding[] = [
      { ...FINDING, sampleIndex: 4, timeMs: 250 },
    ]
    const report: CollisionValidationReport = {
      revision: 'sequence-17',
      sampleCount: 12,
      findings,
      truncated: false,
    }

    store.getState().setValidationReport(report)
    findings[0] = { ...FINDING, separationM: -99 }
    store.getState().markValidationReportStale('Worker stopped unexpectedly.')

    expect(store.getState().validationReport?.findings[0]?.separationM).toBe(
      -0.05,
    )
    expect(store.getState().validationReportStale).toBe(true)
    expect(store.getState().validationReportError).toBe(
      'Worker stopped unexpectedly.',
    )
  })

  it('keeps panel navigation and pause state out of runtime replacements', () => {
    const store = createCollisionStore()
    store.getState().setSelectedFindingIndex(3)
    store.getState().setPausePlaybackOnCollision(false)

    store.getState().replaceCollisionState({
      policy: POLICY,
      currentFindings: [FINDING],
      diagnostics: [],
    })

    expect(store.getState().selectedFindingIndex).toBe(0)
    expect(store.getState().pausePlaybackOnCollision).toBe(false)
  })

  it('preserves runtime slice references when only panel navigation changes', () => {
    const store = createCollisionStore()
    store.getState().replaceCollisionState({
      policy: POLICY,
      currentFindings: [FINDING],
      diagnostics: [],
    })
    const findings = store.getState().currentFindings
    const diagnostics = store.getState().diagnostics

    store.getState().setSelectedFindingIndex(0)

    expect(store.getState().currentFindings).toBe(findings)
    expect(store.getState().diagnostics).toBe(diagnostics)
  })
})
