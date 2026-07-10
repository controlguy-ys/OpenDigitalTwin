import { describe, expect, it } from 'vitest'
import { Group, MathUtils, Quaternion } from 'three'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import { CRB15000_DEFINITION } from '../../domain/robot/crb15000'
import { createRobotRig, setRigAngles } from '../../domain/robot/kinematics'
import {
  CUP01_PICK_ANGLES_DEG,
  GRASP_SENSOR_HALF_EXTENTS,
  GRASP_SENSOR_LOCAL_CENTER,
  chooseNearestGraspCandidate,
  composeWorldTransform,
  computeGripOffset,
  getGraspSensorWorldTransform,
  intersectsGraspSensor,
  isCollisionPairAllowed,
  snapTransformToWorkbench,
} from './interaction-math'

const IDENTITY: SerializableTransform = {
  position: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
  scale: [1, 1, 1],
}

describe('grasp transform math', () => {
  it('releases to toolWorld multiplied by the captured grip offset', () => {
    const toolWorld: SerializableTransform = {
      position: [1.2, -0.4, 1.3],
      quaternion: [0, 0, Math.sin(Math.PI / 8), Math.cos(Math.PI / 8)],
      scale: [1, 1, 1],
    }
    const equipmentWorld: SerializableTransform = {
      position: [1.25, -0.31, 1.39],
      quaternion: [0, Math.sin(Math.PI / 12), 0, Math.cos(Math.PI / 12)],
      scale: [1.5, 0.8, 1.2],
    }

    const gripOffset = computeGripOffset(toolWorld, equipmentWorld)
    const released = composeWorldTransform(toolWorld, gripOffset)

    for (const [index, value] of equipmentWorld.position.entries()) {
      expect(released.position[index]).toBeCloseTo(value, 7)
    }
    for (const [index, value] of equipmentWorld.quaternion.entries()) {
      expect(released.quaternion[index]).toBeCloseTo(value, 7)
    }
    for (const [index, value] of equipmentWorld.scale.entries()) {
      expect(released.scale[index]).toBeCloseTo(value, 7)
    }
  })

  it('chooses nearest candidate with an id tie-break and no candidate fallback', () => {
    expect(
      chooseNearestGraspCandidate([
        { equipmentId: 'cup-02', distanceSq: 0.04 },
        { equipmentId: 'cup-01', distanceSq: 0.04 },
        { equipmentId: 'cup-03', distanceSq: 0.09 },
      ]),
    ).toBe('cup-01')
    expect(chooseNearestGraspCandidate([])).toBeNull()
  })
})

describe('workbench release snap', () => {
  const center: [number, number, number] = [0, 0, 0]
  const halfExtents: [number, number, number] = [0.05, 0.05, 0.075]

  it.each([
    ['zero gap', 0, 1.155],
    ['two millimeter gap', 0.002, 1.155],
    ['larger gap', 0.0021, 1.1571],
  ] as const)('handles a %s without exceeding the 2 mm snap limit', (_name, gap, expectedZ) => {
    const released: SerializableTransform = {
      ...IDENTITY,
      position: [0.4, 0.2, 1.08 + halfExtents[2] + gap],
    }

    expect(
      snapTransformToWorkbench(released, center, halfExtents, 1.08).position[2],
    ).toBeCloseTo(expectedZ, 6)
  })

  it('uses rotated scaled collider bounds while preserving rotation and scale', () => {
    const quaternion = new Quaternion().setFromAxisAngle(
      { x: 1, y: 0, z: 0 },
      MathUtils.degToRad(90),
    )
    const released: SerializableTransform = {
      position: [0.4, 0.2, 1.08 + 0.1 + 0.0015],
      quaternion: quaternion.toArray(),
      scale: [2, 2, 0.5],
    }

    const snapped = snapTransformToWorkbench(
      released,
      [0, 0, 0],
      [0.05, 0.05, 0.075],
      1.08,
    )

    expect(snapped.position[2]).toBeCloseTo(1.18, 6)
    expect(snapped.quaternion).toEqual(released.quaternion)
    expect(snapped.scale).toEqual(released.scale)
  })
})

describe('fixed grasp fixture', () => {
  it('places the local-Z sensor on Cup 01 at the verified joint pose and outside it at zero', () => {
    const mount = new Group()
    mount.position.set(0, 0, 1.08)
    const rig = createRobotRig(CRB15000_DEFINITION)
    mount.add(rig.root)
    setRigAngles(rig, CUP01_PICK_ANGLES_DEG)
    mount.updateWorldMatrix(true, true)

    const sensor = getGraspSensorWorldTransform(rig.toolFrame)
    expect(GRASP_SENSOR_LOCAL_CENTER).toEqual([0, 0, 0.09])
    expect(GRASP_SENSOR_HALF_EXTENTS).toEqual([0.1, 0.08, 0.1])
    expect(sensor.position[0]).toBeCloseTo(0.63696, 4)
    expect(sensor.position[1]).toBeCloseTo(0.00066, 4)
    expect(sensor.position[2]).toBeCloseTo(1.22478, 4)
    expect(
      intersectsGraspSensor(sensor, GRASP_SENSOR_HALF_EXTENTS, {
        ...IDENTITY,
        position: [0.75, 0, 1.15],
      }, [0, 0, 0], [0.055, 0.055, 0.075]),
    ).toBe(true)

    setRigAngles(rig, [0, 0, 0, 0, 0, 0])
    mount.updateWorldMatrix(true, true)
    expect(
      intersectsGraspSensor(
        getGraspSensorWorldTransform(rig.toolFrame),
        GRASP_SENSOR_HALF_EXTENTS,
        { ...IDENTITY, position: [0.75, 0, 1.15] },
        [0, 0, 0],
        [0.055, 0.055, 0.075],
      ),
    ).toBe(false)
  })
})

describe('collision exclusions', () => {
  it('allows intended pairs and excludes adjacent, grasp, and mount pairs symmetrically', () => {
    expect(
      isCollisionPairAllowed('robot-link:LINK04', 'equipment:cup-01'),
    ).toBe(true)
    expect(
      isCollisionPairAllowed('equipment:cup-01', 'robot-link:LINK04'),
    ).toBe(true)
    expect(
      isCollisionPairAllowed('robot-link:LINK02', 'robot-link:LINK04'),
    ).toBe(true)
    expect(
      isCollisionPairAllowed('robot-link:LINK02', 'robot-link:LINK03'),
    ).toBe(false)
    expect(
      isCollisionPairAllowed('robot-link:LINK00', 'workcell:workbench'),
    ).toBe(false)
    expect(
      isCollisionPairAllowed('robot-link:LINK03', 'workcell:workbench'),
    ).toBe(true)
    expect(
      isCollisionPairAllowed('grasp-sensor', 'equipment:cup-01'),
    ).toBe(false)
    expect(
      isCollisionPairAllowed('equipment:cup-01', 'workcell:workbench'),
    ).toBe(false)
  })
})
