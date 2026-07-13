import { createPortal, useLoader, type ThreeEvent } from '@react-three/fiber'
import {
  Fragment,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Euler, MathUtils, Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotLinkGeometryRecordV1 } from '../../domain/project/project'
import {
  createRobotRig,
  setRigAngles,
  type RobotRig,
} from '../../domain/robot/kinematics'
import { jointAngleSelectors, useRobotStore } from '../joints/robot-store'
import { useInteractionStore } from '../interaction/interaction-store'
import { ROBOT_LINK_COLLISION_BOUNDS } from '../interaction/robot-collision-bounds'
import { getRobotLinkOutlineState } from '../interaction/outline-state'
import { RobotGripper } from './RobotGripper'
import { robotGeometryRepository } from './robot-geometry-repository'
import {
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from './robot-configuration-store'
import { useRobotGeometryStore } from './robot-geometry-store'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { registerGeometryEntity } from '../collision/geometry-entity-registry'
import { robotLinkToGeometryEntity } from '../collision/scene-entity-adapter'
import {
  createCollisionEntityOutlineSelector,
  useCollisionStore,
} from '../collision/collision-store'

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

const ROBOT_COLLISION_OUTLINE_SELECTORS = {
  LINK00: createCollisionEntityOutlineSelector('robot-link:LINK00'),
  LINK01: createCollisionEntityOutlineSelector('robot-link:LINK01'),
  LINK02: createCollisionEntityOutlineSelector('robot-link:LINK02'),
  LINK03: createCollisionEntityOutlineSelector('robot-link:LINK03'),
  LINK04: createCollisionEntityOutlineSelector('robot-link:LINK04'),
  LINK05: createCollisionEntityOutlineSelector('robot-link:LINK05'),
  LINK06: createCollisionEntityOutlineSelector('robot-link:LINK06'),
} as const satisfies Record<RobotLinkId, ReturnType<typeof createCollisionEntityOutlineSelector>>

export interface RobotRigRegistration {
  readonly rig: RobotRig
  readonly linkSlots: RobotRig['linkSlots']
  readonly toolFrame: RobotRig['toolFrame']
  readonly tcpFrame: RobotRig['tcpFrame']
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
    tcpFrame: rig.tcpFrame,
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

export function createRobotLinkInteractionPortal(
  linkId: RobotLinkId,
  children: ReactNode,
  container: Object3D,
) {
  return (
    <Fragment key={`robot-link:${linkId}-interaction`}>
      {createPortal(children, container)}
    </Fragment>
  )
}

export function registerRobotGeometryEntities(
  registration: RobotRigRegistration,
  geometryRecords: readonly RobotLinkGeometryRecordV1[],
  colliderRevision = 0,
  hiddenEntityIds: readonly string[] = [],
): () => void {
  if (hiddenEntityIds.includes('robot')) return () => undefined
  const recordsByLink = new Map(
    geometryRecords.map((record) => [record.linkId, record]),
  )
  const cleanups: (() => void)[] = []

  for (const { id } of ROBOT_LINK_ASSETS) {
    const record = recordsByLink.get(id)
    if (hiddenEntityIds.includes(id) || record?.visible === false) continue
    const bounds = record ?? {
      linkId: id,
      collisionCenter: ROBOT_LINK_COLLISION_BOUNDS[id].center,
      collisionHalfExtents: ROBOT_LINK_COLLISION_BOUNDS[id].halfExtents,
    }
    cleanups.push(
      registerGeometryEntity(
        robotLinkToGeometryEntity(
          bounds,
          registration.links[id],
          colliderRevision,
        ),
      ),
    )
  }

  return () => {
    for (const cleanup of cleanups.reverse()) cleanup()
  }
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
  const configuration = useRobotConfigurationStore((state) => state.configuration)
  const definition = useMemo(
    () => robotConfigurationToDefinition(configuration),
    [configuration],
  )
  const geometryRevision = useSyncExternalStore(
    robotGeometryRepository.subscribe,
    robotGeometryRepository.getSnapshot,
    robotGeometryRepository.getSnapshot,
  )
  const geometryRecords = useRobotGeometryStore((state) => state.links)
  const tcpTransform = useCoordinateFrameStore((state) => state.frames.tcp)
  const geometryRecordsByLink = useMemo(
    () => new Map(geometryRecords.map((record) => [record.linkId, record])),
    [geometryRecords],
  )
  const rig = useMemo(() => createRobotRig(definition), [definition])
  const loadedScenes = useMemo(
    () =>
      ROBOT_LINK_ASSETS.map(
        ({ id }, index) =>
          robotGeometryRepository.get(id)?.group ?? loadedLinks[index]!.scene,
      ),
    [geometryRevision, loadedLinks],
  )
  const registration = useMemo(() => {
    const next = createRobotRigRegistration(rig, loadedScenes)
    for (const { id } of ROBOT_LINK_ASSETS) {
      const geometry = geometryRecordsByLink.get(id)
      if (geometry === undefined) continue
      next.links[id].position.set(...geometry.localTransform.position)
      next.links[id].quaternion.set(...geometry.localTransform.quaternion)
      next.links[id].scale.set(...geometry.localTransform.scale)
      next.links[id].updateMatrix()
    }
    return next
  }, [geometryRecordsByLink, loadedScenes, rig])
  const j1 = useRobotStore(jointAngleSelectors[0])
  const j2 = useRobotStore(jointAngleSelectors[1])
  const j3 = useRobotStore(jointAngleSelectors[2])
  const j4 = useRobotStore(jointAngleSelectors[3])
  const j5 = useRobotStore(jointAngleSelectors[4])
  const j6 = useRobotStore(jointAngleSelectors[5])
  const selection = useInteractionStore((state) => state.selection)
  const robotCollisionOutlines = {
    LINK00: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK00),
    LINK01: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK01),
    LINK02: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK02),
    LINK03: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK03),
    LINK04: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK04),
    LINK05: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK05),
    LINK06: useCollisionStore(ROBOT_COLLISION_OUTLINE_SELECTORS.LINK06),
  } as const satisfies Record<RobotLinkId, 'collision' | 'near-miss' | null>
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const selectRobotLink = useInteractionStore((state) => state.selectRobotLink)

  useLayoutEffect(() => {
    rig.root.position.set(...configuration.basePosition)
    rig.root.quaternion.setFromEuler(
      new Euler(
        MathUtils.degToRad(configuration.baseRotationDeg[0]),
        MathUtils.degToRad(configuration.baseRotationDeg[1]),
        MathUtils.degToRad(configuration.baseRotationDeg[2]),
        'ZYX',
      ),
    )
    rig.root.updateMatrix()
  }, [configuration.basePosition, configuration.baseRotationDeg, rig.root])

  useLayoutEffect(() => {
    setRigAngles(rig, [j1, j2, j3, j4, j5, j6])
  }, [j1, j2, j3, j4, j5, j6, rig])

  useLayoutEffect(() => {
    rig.tcpFrame.position.set(...tcpTransform.position)
    rig.tcpFrame.quaternion.set(...tcpTransform.quaternion).normalize()
    rig.tcpFrame.updateMatrix()
  }, [rig.tcpFrame, tcpTransform])

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

  useLayoutEffect(
    () =>
      registerRobotGeometryEntities(
        registration,
        geometryRecords,
        geometryRevision,
        hiddenEntityIds,
      ),
    [
      geometryRecords,
      geometryRevision,
      hiddenEntityIds,
      registration,
    ],
  )

  useLayoutEffect(() => {
    rig.root.visible = !hiddenEntityIds.includes('robot')
    for (const { id } of ROBOT_LINK_ASSETS) {
      registration.links[id].visible =
        (geometryRecordsByLink.get(id)?.visible ?? true) &&
        !hiddenEntityIds.includes(id)
    }
  }, [geometryRecordsByLink, hiddenEntityIds, registration.links, rig.root])

  const linkInteractionPortals = ROBOT_LINK_ASSETS.flatMap(({ id }) => {
    if (hiddenEntityIds.includes(id)) {
      return []
    }
    const geometry = geometryRecordsByLink.get(id)
    const bounds = geometry === undefined
      ? ROBOT_LINK_COLLISION_BOUNDS[id]
      : {
          center: geometry.collisionCenter,
          halfExtents: geometry.collisionHalfExtents,
        }
    const outlineState =
      robotCollisionOutlines[id] ?? getRobotLinkOutlineState(selection, id, [])
    const selected = outlineState === 'selection'
    const collision = outlineState === 'collision'
    const nearMiss = outlineState === 'near-miss'
    return [
      createRobotLinkInteractionPortal(
        id,
        <group name={`${id}-interaction`}>
          <mesh
            name={`${id}-selection-target`}
            onPointerDown={(event: ThreeEvent<PointerEvent>) => {
              event.stopPropagation()
              selectRobotLink(id)
            }}
            position={bounds.center}
            userData={{ robotLinkId: id, selected, collision }}
          >
            <boxGeometry
              args={[
                bounds.halfExtents[0] * 2,
                bounds.halfExtents[1] * 2,
                bounds.halfExtents[2] * 2,
              ]}
            />
            <meshBasicMaterial
              depthWrite={false}
              opacity={0}
              transparent
            />
          </mesh>
          {outlineState === null ? null : (
            <mesh
              name={`${id}-${outlineState}-outline`}
              position={bounds.center}
              renderOrder={1000}
              userData={{
                robotLinkId: id,
                outline: outlineState,
              }}
            >
              <boxGeometry
                args={[
                  bounds.halfExtents[0] * 2.04,
                  bounds.halfExtents[1] * 2.04,
                  bounds.halfExtents[2] * 2.04,
                ]}
              />
              <meshBasicMaterial
                color={
                  collision ? '#ff3b30' : nearMiss ? '#f5c542' : '#4da3ff'
                }
                depthTest={false}
                opacity={0.86}
                transparent
                wireframe
              />
            </mesh>
          )}
        </group>,
        registration.linkSlots[id],
      ),
    ]
  })

  return (
    <>
      <primitive dispose={null} object={rig.root} />
      <RobotGripper
        collisionActive={!hiddenEntityIds.includes('robot')}
        tcpFrame={rig.tcpFrame}
      />
      {linkInteractionPortals}
    </>
  )
}
