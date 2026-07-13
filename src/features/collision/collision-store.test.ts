import { describe, expect, it } from 'vitest'
import type {
  CollisionDiagnostic,
  CollisionFinding,
  CollisionPolicy,
} from '../../domain/collision/collision'
import { createCollisionStore } from './collision-store'

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
})
