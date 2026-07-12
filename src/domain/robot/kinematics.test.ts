import { MathUtils, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import {
  CRB15000_DEFINITION,
  LINK_WORLD_ORIGINS,
  type RobotLinkId,
} from './crb15000'
import { createRobotRig, setRigAngles } from './kinematics'

const ZERO_ANGLES = [0, 0, 0, 0, 0, 0] as const

describe('manifest-driven robot kinematics', () => {
  it('builds the manifest hierarchy at the exact zero-pose origins', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)
    setRigAngles(rig, ZERO_ANGLES)
    rig.root.updateMatrixWorld(true)

    expect(rig.baseSlot).toBe(rig.linkSlots.LINK00)
    expect(rig.baseSlot.parent).toBe(rig.root)
    for (const joint of CRB15000_DEFINITION.joints) {
      expect(rig.jointPivots[joint.id].position.toArray()).toEqual(joint.origin)
      expect(rig.jointPivots[joint.id].parent).toBe(
        rig.linkSlots[joint.parentLink],
      )
      expect(rig.linkSlots[joint.childLink].parent).toBe(
        rig.jointPivots[joint.id],
      )
    }

    for (const [linkId, origin] of Object.entries(LINK_WORLD_ORIGINS)) {
      expect(
        rig.linkSlots[linkId as RobotLinkId]
          .getWorldPosition(new Vector3())
          .toArray(),
      ).toEqual(origin)
    }
  })

  it('moves only the selected joint subtree', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)
    setRigAngles(rig, [0, 0, 0, 0, 90, 0])
    rig.root.updateMatrixWorld(true)

    expect(
      rig.linkSlots.LINK04.getWorldPosition(new Vector3()).toArray(),
    ).toEqual([0, 0, 1.155])
    expect(
      rig.linkSlots.LINK06.getWorldPosition(new Vector3()).x,
    ).not.toBeCloseTo(0.635, 4)
  })

  it('sets each pivot quaternion from its manifest axis without accumulation', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)
    setRigAngles(rig, [90, 0, 0, 0, 0, 0])
    setRigAngles(rig, [45, 0, 0, 0, 0, 0])

    const expected = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      MathUtils.degToRad(45),
    )
    expect(rig.jointPivots.J1.quaternion.angleTo(expected)).toBeCloseTo(0, 10)
  })

  it('parents the tool frame to LINK06 and applies the exact Y rotation', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)

    expect(rig.toolFrame.parent).toBe(rig.linkSlots.LINK06)
    expect(rig.toolFrame.rotation.y).toBeCloseTo(Math.PI / 2, 12)
    expect(rig.tcpFrame.parent).toBe(rig.toolFrame)
    expect(rig.tcpFrame.position.toArray()).toEqual([0, 0, 0])
  })

  it('rejects malformed rig angle input before changing a pivot', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)
    const before = rig.jointPivots.J1.quaternion.clone()

    expect(() => setRigAngles(rig, [0, 0, 0] as never)).toThrow(
      'exactly six',
    )
    expect(() =>
      setRigAngles(rig, [0, 0, 0, Number.NaN, 0, 0]),
    ).toThrow('finite')
    expect(rig.jointPivots.J1.quaternion.equals(before)).toBe(true)
  })
})
