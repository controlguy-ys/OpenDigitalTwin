import { describe, expect, it } from 'vitest'
import type { CollisionFinding } from '../../domain/collision/collision'
import {
  getEquipmentOutlineState,
  getExternalEntityOutlineState,
  getRobotLinkOutlineState,
  hasActiveCollision,
} from './outline-state'

describe('semantic interaction outlines', () => {
  const pairs = [
    'equipment:cup-01|robot-link:LINK04',
    'robot-link:LINK03|workcell:workbench',
  ] as const

  it('lets collision red win and only outlines a held asset when selected or colliding', () => {
    expect(getEquipmentOutlineState('cup-01', true, pairs)).toBe('collision')
    expect(getEquipmentOutlineState('cup-02', true, pairs)).toBe('selection')
    expect(getEquipmentOutlineState('cup-02', false, pairs)).toBeNull()
  })

  it('outlines every link for whole-robot selection and marks workbench collision', () => {
    expect(
      getRobotLinkOutlineState({ kind: 'robot' }, 'LINK02', []),
    ).toBe('selection')
    expect(
      getRobotLinkOutlineState({ kind: 'robot' }, 'LINK04', pairs),
    ).toBe('collision')
    expect(hasActiveCollision('workcell:workbench', pairs)).toBe(true)
  })

  it('uses red for collision, yellow for near miss, and focuses one finding pair', () => {
    const findings: CollisionFinding[] = [
      {
        pairKey: 'object:cup-01|robot-link:LINK04',
        firstEntityId: 'object:cup-01',
        secondEntityId: 'robot-link:LINK04',
        firstBoxId: 'main',
        secondBoxId: 'main',
        kind: 'collision',
        separationM: -0.01,
        sampleIndex: null,
        timeMs: null,
      },
      {
        pairKey: 'object:fixture-01|robot-link:LINK03',
        firstEntityId: 'object:fixture-01',
        secondEntityId: 'robot-link:LINK03',
        firstBoxId: 'main',
        secondBoxId: 'main',
        kind: 'near-miss',
        separationM: 0.02,
        sampleIndex: null,
        timeMs: null,
      },
    ]

    expect(
      getExternalEntityOutlineState('object:fixture-01', false, findings),
    ).toBe('near-miss')
    expect(
      getRobotLinkOutlineState(null, 'LINK04', findings),
    ).toBe('collision')
    expect(
      getRobotLinkOutlineState(
        null,
        'LINK04',
        findings,
        'object:fixture-01|robot-link:LINK03',
      ),
    ).toBeNull()
    expect(
      getRobotLinkOutlineState(
        null,
        'LINK03',
        findings,
        'object:fixture-01|robot-link:LINK03',
      ),
    ).toBe('near-miss')
  })
})
