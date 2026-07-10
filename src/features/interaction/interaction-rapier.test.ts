import RAPIER from '@dimforge/rapier3d-compat'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import { CRB15000_DEFINITION } from '../../domain/robot/crb15000'
import { createRobotRig, setRigAngles } from '../../domain/robot/kinematics'
import {
  CUP01_PICK_ANGLES_DEG,
  GRASP_SENSOR_HALF_EXTENTS,
  getGraspSensorWorldTransform,
} from './interaction-math'

beforeAll(async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  try {
    await RAPIER.init()
  } finally {
    warning.mockRestore()
  }
})

describe('Rapier grasp sensor fixture', () => {
  it('emits an actual intersection entry at the fixed pick pose and exit after moving away', () => {
    const mount = new Group()
    mount.position.set(0, 0, 1.08)
    const rig = createRobotRig(CRB15000_DEFINITION)
    mount.add(rig.root)
    setRigAngles(rig, CUP01_PICK_ANGLES_DEG)
    mount.updateWorldMatrix(true, true)
    const sensor = getGraspSensorWorldTransform(rig.toolFrame)

    const world = new RAPIER.World({ x: 0, y: 0, z: 0 })
    const events = new RAPIER.EventQueue(true)
    const sensorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased()
        .setTranslation(...sensor.position)
        .setRotation({
          x: sensor.quaternion[0],
          y: sensor.quaternion[1],
          z: sensor.quaternion[2],
          w: sensor.quaternion[3],
        }),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(...GRASP_SENSOR_HALF_EXTENTS)
        .setSensor(true)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS)
        .setActiveCollisionTypes(RAPIER.ActiveCollisionTypes.ALL),
      sensorBody,
    )
    const cupBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0.75, 0, 1.15),
    )
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.055, 0.055, 0.075),
      cupBody,
    )

    const transitions: boolean[] = []
    world.step(events)
    events.drainCollisionEvents((_first, _second, started) => {
      transitions.push(started)
    })

    sensorBody.setTranslation({ x: 3, y: 3, z: 3 }, true)
    world.step(events)
    events.drainCollisionEvents((_first, _second, started) => {
      transitions.push(started)
    })

    expect(transitions).toEqual([true, false])
    world.free()
  })
})
