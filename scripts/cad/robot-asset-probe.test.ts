import { describe, expect, it } from 'vitest'

import { CRB15000_DEFINITION } from '../../src/domain/robot/crb15000'
import { probeStepLink } from './convert-robot'

describe('CRB15000 source CAD', () => {
  it('locks the 12/1.27 joint definition', () => {
    expect(CRB15000_DEFINITION.joints.map((joint) => joint.origin)).toEqual([
      [0, 0, 0.338],
      [0, 0, 0],
      [0, 0, 0.707],
      [0, 0, 0.11],
      [0.534, 0, 0],
      [0.101, 0, 0.08],
    ])
    expect(
      CRB15000_DEFINITION.joints.map((joint) => [joint.minDeg, joint.maxDeg]),
    ).toEqual([
      [-270, 270],
      [-180, 180],
      [-225, 85],
      [-180, 180],
      [-180, 180],
      [-270, 270],
    ])
  })

  it('lets OCCT normalize the inch LINK05 directly to metres', async () => {
    const probe = await probeStepLink('LINK05')

    expect(probe.bounds.min[0]).toBeCloseTo(0.40657, 4)
    expect(probe.bounds.min[1]).toBeCloseTo(-0.0935, 4)
    expect(probe.bounds.min[2]).toBeCloseTo(1.101, 4)
    expect(probe.bounds.max[0]).toBeCloseTo(0.602, 4)
    expect(probe.bounds.max[2]).toBeCloseTo(1.28775, 4)
  }, 30_000)
})
