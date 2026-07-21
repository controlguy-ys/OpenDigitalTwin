import { useEffect, useState, type ReactNode } from 'react'
import {
  BoxGeometry,
  Mesh,
  MeshBasicMaterial,
} from 'three'

import { computeSerialRobotPoseV4 } from '../../../core/robot-runtime/serial-kinematics.js'
import type { WorkcellProjectV4 } from '../../../core/project-v4/index.js'
import type { CollisionGeometryProxyV4 } from '../../collision/v4/scene-entity-adapter-v4.js'
import {
  HACKATHON_HANDOVER_IDS_V4,
} from '../../project/v4/hackathon-handover-sample-v4.js'
import type { HandoverZoneOwnerV4 } from './handover-demo-runtime-store.js'

export const HANDOVER_SHARED_ZONE_COLORS_V4 = Object.freeze({
  NONE: 'rgb(148,163,184)',
  'NED2-A': 'rgb(34,211,238)',
  'NED2-B': 'rgb(245,158,11)',
} satisfies Readonly<Record<HandoverZoneOwnerV4, string>>)

const NO_COLLISION_PROXIES_V4 = Object.freeze(
  [] as CollisionGeometryProxyV4[],
)

export interface HandoverDemoSceneLayerResourcesV4 {
  readonly sharedZone: Mesh<BoxGeometry, MeshBasicMaterial>
  readonly collisionProxies: readonly CollisionGeometryProxyV4[]
  setOwner(owner: HandoverZoneOwnerV4): void
  dispose(): void
}

function sharedZoneWorldPoseV4(project: WorkcellProjectV4) {
  const robot = project.robots.find(
    ({ id }) => id === HACKATHON_HANDOVER_IDS_V4.robotAId,
  )
  const definition = project.robotDefinitions.find(
    ({ id }) => id === robot?.definitionId,
  )
  const job = project.jobs.find(
    ({ id }) => id === HACKATHON_HANDOVER_IDS_V4.jobId,
  )
  const sharedStep = job?.steps[3]
  if (robot === undefined || definition === undefined || sharedStep?.kind !== 'joint-pose') {
    throw new Error('The Hackathon Handover Shared Zone pose is unavailable.')
  }
  const pose = computeSerialRobotPoseV4(
    definition,
    sharedStep.jointValues,
    robot.localBasePose,
  ).frameWorldPoses[robot.selectedTcpFrameId]
  if (pose === undefined) {
    throw new Error('The Hackathon Handover Shared Zone TCP is unavailable.')
  }
  return pose
}

export function createHandoverDemoSceneLayerResourcesV4(
  project: WorkcellProjectV4,
  owner: HandoverZoneOwnerV4,
): HandoverDemoSceneLayerResourcesV4 {
  const geometry = new BoxGeometry(0.22, 0.22, 0.18)
  const material = new MeshBasicMaterial({
    color: HANDOVER_SHARED_ZONE_COLORS_V4[owner],
    opacity: 0.42,
    transparent: true,
    wireframe: true,
    depthWrite: false,
  })
  const sharedZone = new Mesh(geometry, material)
  const pose = sharedZoneWorldPoseV4(project)
  sharedZone.name = HACKATHON_HANDOVER_IDS_V4.sharedZoneId
  sharedZone.position.set(...pose.positionM)
  sharedZone.quaternion.set(...pose.quaternion)
  sharedZone.userData = { sharedZoneOwner: owner }
  let disposed = false

  return Object.freeze({
    sharedZone,
    collisionProxies: NO_COLLISION_PROXIES_V4,
    setOwner(nextOwner: HandoverZoneOwnerV4) {
      if (disposed) return
      material.color.set(HANDOVER_SHARED_ZONE_COLORS_V4[nextOwner])
      sharedZone.userData.sharedZoneOwner = nextOwner
    },
    dispose() {
      if (disposed) return
      disposed = true
      sharedZone.removeFromParent()
      geometry.dispose()
      material.dispose()
    },
  })
}

export interface HandoverDemoSceneLayerPropsV4 {
  readonly project: WorkcellProjectV4
  readonly owner: HandoverZoneOwnerV4
}

export function HandoverDemoSceneLayerV4({
  project,
  owner,
}: HandoverDemoSceneLayerPropsV4): ReactNode {
  const [resources, setResources] = useState<
    HandoverDemoSceneLayerResourcesV4 | null
  >(null)

  useEffect(() => {
    const nextResources = createHandoverDemoSceneLayerResourcesV4(project, 'NONE')
    setResources(nextResources)
    return () => {
      nextResources.dispose()
    }
  }, [project])

  useEffect(() => {
    resources?.setOwner(owner)
  }, [owner, resources])

  return resources === null ? null : <primitive object={resources.sharedZone} />
}
