import { Euler, Group, MathUtils, Quaternion, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import type { SerializableTransform } from '../equipment/equipment'
import {
  CRB15000_DEFINITION,
  LINK_WORLD_ORIGINS,
  type RobotLinkId,
} from './crb15000'
import {
  computeRobotWorldMatrices,
  createRobotRig,
  setRigAngles,
  type RobotGeometryTransforms,
  type RobotToolFrameTransforms,
} from './kinematics'

const ZERO_ANGLES = [0, 0, 0, 0, 0, 0] as const

const LINK_IDS = Object.keys(LINK_WORLD_ORIGINS) as RobotLinkId[]

function quaternion(roll: number, pitch: number, yaw: number) {
  return new Quaternion().setFromEuler(new Euler(roll, pitch, yaw, 'ZYX')).toArray()
}

function applyTransform(group: Group, transform: SerializableTransform): void {
  group.position.set(...transform.position)
  group.quaternion.set(...transform.quaternion).normalize()
  group.scale.set(...transform.scale)
  group.updateMatrix()
}

function expectMatrixParity(
  actual: readonly number[],
  expected: readonly number[],
): void {
  expect(actual).toHaveLength(16)
  actual.forEach((value, index) =>
    expect(value).toBeCloseTo(expected[index]!, 11),
  )
}

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

    expect(rig.flangeFrame.parent).toBe(rig.linkSlots.LINK06)
    expect(rig.toolFrame.parent).toBe(rig.flangeFrame)
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

  it.each([
    ['zero', ZERO_ANGLES],
    ['non-zero', [35, -42, 18, 71, -33, 109] as const],
  ])(
    'matches every rendered slot, geometry, Flange, Tool, and TCP matrix at %s pose',
    (_label, anglesDeg) => {
      const rootPose: SerializableTransform = {
        position: [0.3, -0.2, 1.15],
        quaternion: quaternion(0.13, -0.27, 0.41),
        scale: [1, 1, 1],
      }
      const geometryTransforms = Object.fromEntries(
        LINK_IDS.map((linkId, index) => [
          linkId,
          {
            position: [0.01 * index, -0.005 * index, 0.002 * index],
            quaternion: quaternion(0.01 * index, -0.02 * index, 0.03 * index),
            scale: [1 + 0.01 * index, 1 + 0.02 * index, 1 + 0.03 * index],
          },
        ]),
      ) as RobotGeometryTransforms
      const toolFrames: RobotToolFrameTransforms = {
        flange: {
          position: [0.01, 0.02, -0.03],
          quaternion: quaternion(0.02, 0.01, -0.04),
          scale: [1, 1, 1],
        },
        tool: {
          position: [0, 0, 0.04],
          quaternion: quaternion(0, CRB15000_DEFINITION.toolRotationYRad, 0),
          scale: [1, 1, 1],
        },
        tcp: {
          position: [0.02, -0.01, 0.12],
          quaternion: quaternion(0.03, -0.05, 0.07),
          scale: [1, 1, 1],
        },
      }
      const rig = createRobotRig(CRB15000_DEFINITION)
      applyTransform(rig.root, rootPose)
      applyTransform(rig.flangeFrame, toolFrames.flange)
      applyTransform(rig.toolFrame, toolFrames.tool)
      applyTransform(rig.tcpFrame, toolFrames.tcp)
      const geometryObjects = {} as Record<RobotLinkId, Group>
      for (const linkId of LINK_IDS) {
        const object = new Group()
        applyTransform(object, geometryTransforms[linkId])
        rig.linkSlots[linkId].add(object)
        geometryObjects[linkId] = object
      }
      setRigAngles(rig, anglesDeg)
      rig.root.updateMatrixWorld(true)

      const computed = computeRobotWorldMatrices(
        CRB15000_DEFINITION,
        geometryTransforms,
        toolFrames,
        anglesDeg,
        rootPose,
      )

      for (const linkId of LINK_IDS) {
        expectMatrixParity(
          computed.linkSlots[linkId],
          rig.linkSlots[linkId].matrixWorld.elements,
        )
        expectMatrixParity(
          computed.linkGeometry[linkId],
          geometryObjects[linkId].matrixWorld.elements,
        )
      }
      expectMatrixParity(computed.flange, rig.flangeFrame.matrixWorld.elements)
      expectMatrixParity(computed.tool, rig.toolFrame.matrixWorld.elements)
      expectMatrixParity(computed.tcp, rig.tcpFrame.matrixWorld.elements)
    },
  )
})
