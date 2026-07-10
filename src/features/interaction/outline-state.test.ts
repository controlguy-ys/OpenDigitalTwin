import { describe, expect, it } from 'vitest'
import {
  getEquipmentOutlineState,
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
})
