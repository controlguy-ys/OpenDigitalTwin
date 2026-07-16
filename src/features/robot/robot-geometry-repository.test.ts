import { describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { ImportedThreeAsset } from '../import/occt-to-three'
import { RobotGeometryRepository } from './robot-geometry-repository'

function asset(dispose = vi.fn()): ImportedThreeAsset {
  return {
    group: new Group(),
    colliderCenter: [0, 0, 0],
    bounds: {
      min: [-0.1, -0.1, -0.1],
      max: [0.1, 0.1, 0.1],
      size: [0.2, 0.2, 0.2],
      center: [0, 0, 0],
    },
    dispose,
  }
}

describe('RobotGeometryRepository shared-source ownership', () => {
  it('keeps a shared asset alive until its last Link alias is replaced', () => {
    const sharedDispose = vi.fn()
    const repository = new RobotGeometryRepository()
    const shared = asset(sharedDispose)
    const link00Replacement = asset()
    const link01Replacement = asset()
    repository.exchange(new Map<RobotLinkId, ImportedThreeAsset>([
      ['LINK00', shared],
      ['LINK01', shared],
    ]))

    repository.replaceLink('LINK00', link00Replacement)

    expect(repository.get('LINK01')).toBe(shared)
    expect(sharedDispose).not.toHaveBeenCalled()

    repository.replaceLink('LINK01', link01Replacement)

    expect(sharedDispose).toHaveBeenCalledOnce()
  })

  it('disposes an aliased asset only once when replacing the complete map', () => {
    const sharedDispose = vi.fn()
    const repository = new RobotGeometryRepository()
    const shared = asset(sharedDispose)
    repository.exchange(new Map<RobotLinkId, ImportedThreeAsset>([
      ['LINK00', shared],
      ['LINK01', shared],
    ]))

    repository.replace(new Map())

    expect(sharedDispose).toHaveBeenCalledOnce()
  })
})
