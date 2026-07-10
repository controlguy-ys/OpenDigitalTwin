import { useLoader } from '@react-three/fiber'
import { useLayoutEffect, useMemo } from 'react'
import { Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  CRB15000_DEFINITION,
  type RobotLinkId,
} from '../../domain/robot/crb15000'
import {
  createRobotRig,
  setRigAngles,
  type RobotRig,
} from '../../domain/robot/kinematics'
import { jointAngleSelectors, useRobotStore } from '../joints/robot-store'
import { RobotGripper } from './RobotGripper'

export const ROBOT_LINK_ASSETS = [
  { id: 'LINK00', url: '/models/robot/LINK00.glb' },
  { id: 'LINK01', url: '/models/robot/LINK01.glb' },
  { id: 'LINK02', url: '/models/robot/LINK02.glb' },
  { id: 'LINK03', url: '/models/robot/LINK03.glb' },
  { id: 'LINK04', url: '/models/robot/LINK04.glb' },
  { id: 'LINK05', url: '/models/robot/LINK05.glb' },
  { id: 'LINK06', url: '/models/robot/LINK06.glb' },
] as const satisfies readonly { id: RobotLinkId; url: string }[]

export const ROBOT_LINK_URLS: string[] = ROBOT_LINK_ASSETS.map(
  ({ url }) => url,
)

export interface RobotRigRegistration {
  readonly rig: RobotRig
  readonly linkSlots: RobotRig['linkSlots']
  readonly toolFrame: RobotRig['toolFrame']
  readonly links: Record<RobotLinkId, Object3D>
}

interface RobotModelProps {
  registerRig?: (registration: RobotRigRegistration | null) => void
}

export function createRobotRigRegistration(
  rig: RobotRig,
  loadedScenes: readonly Object3D[],
): RobotRigRegistration {
  if (loadedScenes.length !== ROBOT_LINK_ASSETS.length) {
    throw new Error('Robot model requires all seven link scenes')
  }

  const links = {} as Record<RobotLinkId, Object3D>

  for (const [index, { id }] of ROBOT_LINK_ASSETS.entries()) {
    const sourceScene = loadedScenes[index]
    if (sourceScene === undefined) {
      throw new Error(`Missing loaded scene for ${id}`)
    }

    const link = sourceScene.clone(true)
    link.name = `${id}-model`
    link.position.set(0, 0, 0)
    link.quaternion.identity()
    link.scale.set(1, 1, 1)
    link.updateMatrix()
    link.traverse((object) => {
      if (object instanceof Mesh) {
        object.castShadow = true
        object.receiveShadow = true
      }
    })

    links[id] = link
  }

  return {
    rig,
    linkSlots: rig.linkSlots,
    toolFrame: rig.toolFrame,
    links,
  }
}

export function attachRobotRigRegistration(
  registration: RobotRigRegistration,
): void {
  for (const { id } of ROBOT_LINK_ASSETS) {
    const link = registration.links[id]
    const slot = registration.linkSlots[id]

    if (link.parent !== slot) {
      slot.add(link)
    }
  }
}

export function detachRobotRigRegistration(
  registration: RobotRigRegistration,
): void {
  for (const { id } of ROBOT_LINK_ASSETS) {
    registration.links[id].removeFromParent()
  }
}

export function isCompleteRobotRigRegistration(
  registration: RobotRigRegistration,
): boolean {
  return ROBOT_LINK_ASSETS.every(
    ({ id }) => registration.links[id].parent === registration.linkSlots[id],
  )
}

export function describeRobotLoadError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const failedAsset = ROBOT_LINK_ASSETS.find(({ url }) => message.includes(url))

  if (failedAsset === undefined) {
    return message
  }

  const prefix = `Failed to load ${failedAsset.id}: `
  return message.startsWith(prefix) ? message : `${prefix}${message}`
}

export function RobotModel({ registerRig }: RobotModelProps) {
  const loadedLinks = useLoader(GLTFLoader, ROBOT_LINK_URLS)
  const rig = useMemo(() => createRobotRig(CRB15000_DEFINITION), [])
  const loadedScenes = useMemo(
    () => loadedLinks.map(({ scene }) => scene),
    [loadedLinks],
  )
  const registration = useMemo(
    () => createRobotRigRegistration(rig, loadedScenes),
    [loadedScenes, rig],
  )
  const j1 = useRobotStore(jointAngleSelectors[0])
  const j2 = useRobotStore(jointAngleSelectors[1])
  const j3 = useRobotStore(jointAngleSelectors[2])
  const j4 = useRobotStore(jointAngleSelectors[3])
  const j5 = useRobotStore(jointAngleSelectors[4])
  const j6 = useRobotStore(jointAngleSelectors[5])

  useLayoutEffect(() => {
    setRigAngles(rig, [j1, j2, j3, j4, j5, j6])
  }, [j1, j2, j3, j4, j5, j6, rig])

  useLayoutEffect(() => {
    attachRobotRigRegistration(registration)

    if (!isCompleteRobotRigRegistration(registration)) {
      throw new Error('Robot rig registration requires all seven links')
    }

    registerRig?.(registration)

    return () => {
      registerRig?.(null)
      detachRobotRigRegistration(registration)
    }
  }, [registerRig, registration])

  return (
    <>
      <primitive dispose={null} object={rig.root} />
      <RobotGripper toolFrame={rig.toolFrame} />
    </>
  )
}
