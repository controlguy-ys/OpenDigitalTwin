import { Group, Quaternion, Vector3 } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION } from '../../domain/robot/crb15000'
import { createRobotRig } from '../../domain/robot/kinematics'
import {
  ROBOT_LINK_ASSETS,
  attachRobotRigRegistration,
  createRobotRigRegistration,
  describeRobotLoadError,
  detachRobotRigRegistration,
  isCompleteRobotRigRegistration,
} from './RobotModel'

vi.mock('@react-three/fiber', () => ({
  createPortal: vi.fn(),
  useLoader: vi.fn(),
}))

function createLoadedScenes() {
  return ROBOT_LINK_ASSETS.map(({ id }, index) => {
    const scene = new Group()
    scene.name = `${id}-source`
    scene.position.set(index + 1, index + 2, index + 3)
    scene.rotation.set(0.1, 0.2, 0.3)
    scene.scale.setScalar(2)
    return scene
  })
}

function linkModelsForSlot(
  registration: ReturnType<typeof createRobotRigRegistration>,
  id: (typeof ROBOT_LINK_ASSETS)[number]['id'],
) {
  return registration.linkSlots[id].children.filter(
    (child) => child.name === `${id}-model`,
  )
}

describe('RobotModel asset registration', () => {
  it('keeps one ordered LINK id and URL source', () => {
    expect(ROBOT_LINK_ASSETS).toEqual([
      { id: 'LINK00', url: '/models/robot/LINK00.glb' },
      { id: 'LINK01', url: '/models/robot/LINK01.glb' },
      { id: 'LINK02', url: '/models/robot/LINK02.glb' },
      { id: 'LINK03', url: '/models/robot/LINK03.glb' },
      { id: 'LINK04', url: '/models/robot/LINK04.glb' },
      { id: 'LINK05', url: '/models/robot/LINK05.glb' },
      { id: 'LINK06', url: '/models/robot/LINK06.glb' },
    ])
  })

  it('creates detached identity clones without mutating rig slots', () => {
    const loadedScenes = createLoadedScenes()

    const rig = createRobotRig(CRB15000_DEFINITION)
    const registration = createRobotRigRegistration(rig, loadedScenes)

    for (const [index, { id }] of ROBOT_LINK_ASSETS.entries()) {
      const attached = registration.links[id]
      expect(attached).not.toBe(loadedScenes[index])
      expect(attached.parent).toBeNull()
      expect(attached.position).toEqual(new Vector3(0, 0, 0))
      expect(attached.quaternion.toArray()).toEqual(
        new Quaternion(0, 0, 0, 1).toArray(),
      )
      expect(attached.scale).toEqual(new Vector3(1, 1, 1))
      expect(registration.linkSlots[id].children).not.toContain(attached)
    }

    expect(isCompleteRobotRigRegistration(registration)).toBe(false)
  })

  it('attaches exactly one model per slot and removes the retained set on cleanup', () => {
    const registration = createRobotRigRegistration(
      createRobotRig(CRB15000_DEFINITION),
      createLoadedScenes(),
    )

    attachRobotRigRegistration(registration)

    for (const { id } of ROBOT_LINK_ASSETS) {
      expect(registration.links[id].parent).toBe(registration.linkSlots[id])
      expect(linkModelsForSlot(registration, id)).toEqual([
        registration.links[id],
      ])
    }
    expect(isCompleteRobotRigRegistration(registration)).toBe(true)

    detachRobotRigRegistration(registration)

    for (const { id } of ROBOT_LINK_ASSETS) {
      expect(registration.links[id].parent).toBeNull()
      expect(linkModelsForSlot(registration, id)).toHaveLength(0)
    }
    expect(isCompleteRobotRigRegistration(registration)).toBe(false)
  })

  it('keeps one retained model per slot across StrictMode-style setup cycles', () => {
    const rig = createRobotRig(CRB15000_DEFINITION)
    const discardedRegistration = createRobotRigRegistration(
      rig,
      createLoadedScenes(),
    )
    const retainedRegistration = createRobotRigRegistration(
      rig,
      createLoadedScenes(),
    )

    for (const { id } of ROBOT_LINK_ASSETS) {
      expect(discardedRegistration.links[id].parent).toBeNull()
      expect(retainedRegistration.links[id].parent).toBeNull()
      expect(linkModelsForSlot(retainedRegistration, id)).toHaveLength(0)
    }

    attachRobotRigRegistration(retainedRegistration)
    detachRobotRigRegistration(retainedRegistration)
    attachRobotRigRegistration(retainedRegistration)

    for (const { id } of ROBOT_LINK_ASSETS) {
      expect(linkModelsForSlot(retainedRegistration, id)).toEqual([
        retainedRegistration.links[id],
      ])
      expect(discardedRegistration.links[id].parent).toBeNull()
    }

    detachRobotRigRegistration(retainedRegistration)
    for (const { id } of ROBOT_LINK_ASSETS) {
      expect(linkModelsForSlot(retainedRegistration, id)).toHaveLength(0)
    }
  })

  it('names the exact failed LINK id without dropping the loader message', () => {
    const error = new Error(
      'fetch for "/models/robot/LINK04.glb" responded with 404: Not Found',
    )

    expect(describeRobotLoadError(error)).toBe(
      'Failed to load LINK04: fetch for "/models/robot/LINK04.glb" responded with 404: Not Found',
    )
  })
})
