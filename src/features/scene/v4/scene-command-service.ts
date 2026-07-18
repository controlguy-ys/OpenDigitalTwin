import {
  CYLINDER_RADIAL_SEGMENTS_V4,
  composeRigidTransformV4,
  failProjectV4,
  validateWorkcellProjectV4,
  type FrameIdV4,
  type RigidTransformV4,
  type RobotIdV4,
  type SceneGroupIdV4,
  type SpatialEntityIdV4,
  type Vector3V4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { PersistedVisibilityTargetV4 } from '../../interaction/v4/scene-selection.js'
import type { ProjectMutationPortV4 } from '../../project/v4/project-mutation-port.js'
import { selectSpatialEntityOpcUaBindingV4 } from './spatial-entity-opcua-binding.js'

export interface CreateBoxCommandV4 {
  readonly name: string
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
  readonly dimensionsM: Vector3V4
  readonly color: `#${string}`
  readonly groupId: SceneGroupIdV4 | null
}

export interface CreateCylinderCommandV4 {
  readonly name: string
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
  readonly radiusM: number
  readonly heightM: number
  readonly color: `#${string}`
  readonly groupId: SceneGroupIdV4 | null
}

export type RenameTargetV4 =
  | { readonly kind: 'robot'; readonly robotId: RobotIdV4 }
  | { readonly kind: 'spatial-entity'; readonly entityId: SpatialEntityIdV4 }
  | { readonly kind: 'scene-group'; readonly groupId: SceneGroupIdV4 }
  | { readonly kind: 'scene-frame'; readonly frameId: FrameIdV4 }
  | {
      readonly kind: 'entity-frame'
      readonly entityId: SpatialEntityIdV4
      readonly frameId: FrameIdV4
    }

export interface RobotBaseEditV4 {
  readonly robotId: RobotIdV4
  readonly baseParentFrameId: FrameIdV4
  readonly localBasePose: RigidTransformV4
  readonly intentionalMountEntityId: SpatialEntityIdV4 | null
}

export interface MovingFrameEditV4 {
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly parentFrameId: FrameIdV4
  readonly localPose: RigidTransformV4
}

export interface ConfigureSpatialEntityOpcUaBindingCommandV4 {
  readonly entityId: SpatialEntityIdV4
  readonly endpointUrl: string
  readonly publishingIntervalMs: number
  readonly positionUnit: 'm' | 'mm'
  readonly nodeIds: Readonly<{
    x: string
    y: string
    z: string
    roll: string
    pitch: string
    yaw: string
  }>
  readonly numericStatusNodeId?: string | undefined
}

type StatusTargetV4 =
  | { readonly kind: 'robot'; readonly robotId: RobotIdV4 }
  | { readonly kind: 'spatial-entity'; readonly entityId: SpatialEntityIdV4 }

export interface SceneCommandServiceV4 {
  createBox(command: CreateBoxCommandV4): Promise<SpatialEntityIdV4>
  createCylinder(command: CreateCylinderCommandV4): Promise<SpatialEntityIdV4>
  createGroup(name: string, parentGroupId: SceneGroupIdV4 | null): Promise<SceneGroupIdV4>
  rename(target: RenameTargetV4, name: string): Promise<void>
  setPersistedVisibility(
    target: PersistedVisibilityTargetV4,
    visible: boolean,
  ): Promise<void>
  setSpatialEntityLocalPose(
    entityId: SpatialEntityIdV4,
    localPose: RigidTransformV4,
  ): Promise<void>
  setSpatialEntityGroup(
    entityId: SpatialEntityIdV4,
    groupId: SceneGroupIdV4 | null,
  ): Promise<void>
  setRobotBase(command: RobotBaseEditV4): Promise<void>
  setSelectedToolFrames(
    robotId: RobotIdV4,
    toolFrameId: FrameIdV4,
    tcpFrameId: FrameIdV4,
  ): Promise<void>
  setSceneFrameLocalPose(
    frameId: FrameIdV4,
    localPose: RigidTransformV4,
  ): Promise<void>
  setMovingFrame(command: MovingFrameEditV4): Promise<void>
  configureSpatialEntityOpcUaBinding(
    command: ConfigureSpatialEntityOpcUaBindingCommandV4,
  ): Promise<void>
  takeSpatialEntityManualControl(entityId: SpatialEntityIdV4): Promise<void>
  setNumericStatus(target: StatusTargetV4, value: number): Promise<void>
  setStatusOverlayVisible(target: StatusTargetV4, visible: boolean): Promise<void>
  reparentGroup(
    groupId: SceneGroupIdV4,
    parentGroupId: SceneGroupIdV4 | null,
  ): Promise<void>
  ungroup(groupId: SceneGroupIdV4): Promise<void>
  deleteSpatialEntity(entityId: SpatialEntityIdV4): Promise<void>
  deleteGroupAndContents(groupId: SceneGroupIdV4): Promise<void>
}

export interface SceneCommandServiceOptionsV4 {
  readonly mutations: ProjectMutationPortV4
  readonly createId: () => string
}

function commandFailure(code: string, path: string, message: string): never {
  failProjectV4(
    code,
    path,
    message,
    'Refresh the Scene authoring state, correct the command, and try again.',
  )
}

function clonePose(pose: RigidTransformV4): RigidTransformV4 {
  return {
    positionM: [...pose.positionM],
    quaternion: [...pose.quaternion],
  }
}

function cloneVector(vector: Vector3V4): Vector3V4 {
  return [...vector]
}

function validateCandidate(project: WorkcellProjectV4): WorkcellProjectV4 {
  return validateWorkcellProjectV4(project)
}

function requireRobot(project: WorkcellProjectV4, robotId: RobotIdV4) {
  const robot = project.robots.find(({ id }) => id === robotId)
  if (robot === undefined) {
    commandFailure(
      'ROBOT_INSTANCE_NOT_FOUND',
      `$.robots.${robotId}`,
      `Robot Instance ${robotId} does not exist.`,
    )
  }
  return robot
}

function requireEntity(project: WorkcellProjectV4, entityId: SpatialEntityIdV4) {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  if (entity === undefined) {
    commandFailure(
      'SPATIAL_ENTITY_NOT_FOUND',
      `$.spatialEntities.${entityId}`,
      `Spatial Entity ${entityId} does not exist.`,
    )
  }
  return entity
}

function requireGroup(project: WorkcellProjectV4, groupId: SceneGroupIdV4) {
  const group = project.sceneGroups.find(({ id }) => id === groupId)
  if (group === undefined) {
    commandFailure(
      'SCENE_GROUP_NOT_FOUND',
      `$.sceneGroups.${groupId}`,
      `Scene Group ${groupId} does not exist.`,
    )
  }
  return group
}

function requireSceneFrame(project: WorkcellProjectV4, frameId: FrameIdV4) {
  const frame = project.scene.frames.find(({ id }) => id === frameId)
  if (frame === undefined) {
    commandFailure(
      'FRAME_PARENT_NOT_FOUND',
      `$.scene.frames.${frameId}`,
      `Scene Frame ${frameId} does not exist.`,
    )
  }
  return frame
}

function requireGlobalFrame(project: WorkcellProjectV4, frameId: FrameIdV4): void {
  if (project.scene.frames.some(({ id }) => id === frameId)) return
  for (const entity of project.spatialEntities) {
    if (
      entity.graspFrames.some(({ frameId: candidateId }) => candidateId === frameId)
      || entity.movingFrames.some(({ frameId: candidateId }) => candidateId === frameId)
    ) {
      return
    }
  }
  commandFailure(
    'FRAME_PARENT_NOT_FOUND',
    `$.frames.${frameId}`,
    `Frame ${frameId} does not exist.`,
  )
}

function requireRobotBaseParent(project: WorkcellProjectV4, frameId: FrameIdV4): void {
  if (project.scene.frames.some(({ id }) => id === frameId)) return
  if (project.spatialEntities.some((entity) => (
    entity.movingFrames.some(({ frameId: candidateId }) => candidateId === frameId)
  ))) return
  commandFailure(
    'ROBOT_BASE_PARENT_INVALID',
    '$.baseParentFrameId',
    'Robot Base parent must be a Scene Frame or Moving Frame.',
  )
}

function replaceEntity(
  project: WorkcellProjectV4,
  entityId: SpatialEntityIdV4,
  replacement: WorkcellProjectV4['spatialEntities'][number],
): WorkcellProjectV4 {
  return {
    ...project,
    spatialEntities: project.spatialEntities.map((entity) => (
      entity.id === entityId ? replacement : entity
    )),
  }
}

function replaceRobot(
  project: WorkcellProjectV4,
  robotId: RobotIdV4,
  replacement: WorkcellProjectV4['robots'][number],
): WorkcellProjectV4 {
  return {
    ...project,
    robots: project.robots.map((robot) => robot.id === robotId ? replacement : robot),
  }
}

function assertManualStatus(sourceOwnership: string, path: string): void {
  if (sourceOwnership !== 'manual') {
    commandFailure(
      'NUMERIC_STATUS_OWNERSHIP_CONFLICT',
      path,
      `Numeric Status is owned by ${sourceOwnership}, not manual authoring.`,
    )
  }
}

const IDENTITY_POSE_V4: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function opcUaModeForSpatialEntityBinding(
  mode: WorkcellProjectV4['opcUa']['mode'],
): WorkcellProjectV4['opcUa']['mode'] {
  if (mode === 'off') return 'client'
  if (mode === 'server') return 'bridge'
  return mode
}

function ownerEndpointId(owner: string): string | null {
  return owner.startsWith('opcua:') ? owner.slice('opcua:'.length) : null
}

function mappingTargetsEntityFrame(
  mapping: WorkcellProjectV4['opcUa']['mappings'][number],
  entityId: SpatialEntityIdV4,
): boolean {
  return mapping.leaves.some((leaf) => (
    leaf.projectTarget.type === 'entity-frame' && leaf.projectTarget.entityId === entityId
  ))
}

function mappingTargetsEntityStatus(
  mapping: WorkcellProjectV4['opcUa']['mappings'][number],
  entityId: SpatialEntityIdV4,
): boolean {
  return mapping.leaves.some((leaf) => (
    leaf.projectTarget.type === 'entity-status' && leaf.projectTarget.entityId === entityId
  ))
}

function pruneMappingLeaves(
  mappings: WorkcellProjectV4['opcUa']['mappings'],
  shouldRemove: (leaf: WorkcellProjectV4['opcUa']['mappings'][number]['leaves'][number]) => boolean,
): WorkcellProjectV4['opcUa']['mappings'] {
  return mappings.flatMap((mapping) => {
    const leaves = mapping.leaves.filter((leaf) => !shouldRemove(leaf))
    return leaves.length === 0 ? [] : [{ ...mapping, leaves }]
  })
}

function endpointIsSharedOutsideEntity(
  project: WorkcellProjectV4,
  endpointId: string,
  entityId: SpatialEntityIdV4,
): boolean {
  const owner = `opcua:${endpointId}`
  if (project.spatialEntities.some((entity) => (
    entity.id !== entityId
    && (entity.transformOwner === owner || entity.numericStatus.sourceOwnership === owner)
  ))) return true
  return project.opcUa.mappings.some((mapping) => (
    mapping.endpointId === endpointId
    && !mapping.leaves.every((leaf) => (
      (leaf.projectTarget.type === 'entity-frame' || leaf.projectTarget.type === 'entity-status')
      && leaf.projectTarget.entityId === entityId
    ))
  )) || project.opcUa.actionBindings.some((binding) => binding.endpointId === endpointId)
    || (() => {
      const channelIds = new Set<string>([
        ...project.opcUa.mappings
          .filter((mapping) => mapping.endpointId === endpointId)
          .map((mapping) => mapping.id),
        ...project.opcUa.actionBindings
          .filter((binding) => binding.endpointId === endpointId)
          .map((binding) => binding.id),
      ])
      return project.opcUa.bridgeRoutes.some((route) => (
        channelIds.has(route.sourceChannelId) || channelIds.has(route.destinationChannelId)
      ))
    })()
}

function poseMappingLeaves(
  entityId: SpatialEntityIdV4,
  frameId: FrameIdV4,
  nodeIds: ConfigureSpatialEntityOpcUaBindingCommandV4['nodeIds'],
  positionUnit: ConfigureSpatialEntityOpcUaBindingCommandV4['positionUnit'],
) {
  const positionScale = positionUnit === 'mm' ? 0.001 : 1
  const positionUnitName = positionUnit === 'mm' ? 'millimetre' : 'metre'
  const target = { type: 'entity-frame' as const, entityId, frameId }
  return [
    ['positionM', 0, nodeIds.x, positionScale, positionUnitName],
    ['positionM', 1, nodeIds.y, positionScale, positionUnitName],
    ['positionM', 2, nodeIds.z, positionScale, positionUnitName],
    ['rpyDegrees', 0, nodeIds.roll, 1, 'degree'],
    ['rpyDegrees', 1, nodeIds.pitch, 1, 'degree'],
    ['rpyDegrees', 2, nodeIds.yaw, 1, 'degree'],
  ].map(([root, index, nodeId, scale, unit]) => ({
    leafPath: [root as string, index as number],
    nodeId: nodeId as string,
    projectTarget: target,
    opcUaDataType: 'Double' as const,
    projectDataType: 'number' as const,
    scale: scale as number,
    offset: 0,
    unit: unit as string,
    required: true,
  }))
}

function primitiveEntity(
  id: SpatialEntityIdV4,
  command: {
    readonly name: string
    readonly parentFrameId: FrameIdV4
    readonly localPose: RigidTransformV4
    readonly groupId: SceneGroupIdV4 | null
  },
  geometry: WorkcellProjectV4['spatialEntities'][number]['geometry'],
): WorkcellProjectV4['spatialEntities'][number] {
  return {
    id,
    name: command.name,
    geometry,
    parentFrameId: command.parentFrameId,
    localPose: command.localPose,
    visible: true,
    groupId: command.groupId,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: true, frameId: null },
    },
    graspable: false,
    graspFrames: [],
    movingFrames: [],
  }
}

export function createSceneCommandServiceV4(
  options: SceneCommandServiceOptionsV4,
): SceneCommandServiceV4 {
  const service: SceneCommandServiceV4 = {
    async createBox(command) {
      const entityId = options.createId()
      const snapshot = {
        name: command.name,
        parentFrameId: command.parentFrameId,
        localPose: clonePose(command.localPose),
        dimensionsM: cloneVector(command.dimensionsM),
        color: command.color,
        groupId: command.groupId,
      }
      await options.mutations.replaceFromActive({
        description: `Create Box ${entityId}`,
        mutate(active) {
          requireGlobalFrame(active, snapshot.parentFrameId)
          if (snapshot.groupId !== null) requireGroup(active, snapshot.groupId)
          return validateCandidate({
            ...active,
            spatialEntities: [
              ...active.spatialEntities,
              primitiveEntity(entityId, snapshot, {
                kind: 'box',
                dimensionsM: snapshot.dimensionsM,
                color: snapshot.color,
              }),
            ],
          })
        },
      })
      return entityId
    },

    async createCylinder(command) {
      const entityId = options.createId()
      const snapshot = {
        name: command.name,
        parentFrameId: command.parentFrameId,
        localPose: clonePose(command.localPose),
        radiusM: command.radiusM,
        heightM: command.heightM,
        color: command.color,
        groupId: command.groupId,
      }
      await options.mutations.replaceFromActive({
        description: `Create Cylinder ${entityId}`,
        mutate(active) {
          requireGlobalFrame(active, snapshot.parentFrameId)
          if (snapshot.groupId !== null) requireGroup(active, snapshot.groupId)
          return validateCandidate({
            ...active,
            spatialEntities: [
              ...active.spatialEntities,
              primitiveEntity(entityId, snapshot, {
                kind: 'cylinder',
                radiusM: snapshot.radiusM,
                heightM: snapshot.heightM,
                axis: 'z',
                radialSegments: CYLINDER_RADIAL_SEGMENTS_V4,
                color: snapshot.color,
              }),
            ],
          })
        },
      })
      return entityId
    },

    async createGroup(name, parentGroupId) {
      const groupId = options.createId()
      await options.mutations.replaceFromActive({
        description: `Create Scene Group ${groupId}`,
        mutate(active) {
          if (parentGroupId !== null) requireGroup(active, parentGroupId)
          return validateCandidate({
            ...active,
            sceneGroups: [
              ...active.sceneGroups,
              { id: groupId, name, parentGroupId, visible: true },
            ],
          })
        },
      })
      return groupId
    },

    async rename(target, name) {
      const snapshot = { ...target } as RenameTargetV4
      await options.mutations.replaceFromActive({
        description: `Rename ${snapshot.kind}`,
        mutate(active) {
          switch (snapshot.kind) {
            case 'robot': {
              const robot = requireRobot(active, snapshot.robotId)
              return validateCandidate(replaceRobot(active, robot.id, { ...robot, name }))
            }
            case 'spatial-entity': {
              const entity = requireEntity(active, snapshot.entityId)
              return validateCandidate(replaceEntity(active, entity.id, { ...entity, name }))
            }
            case 'scene-group': {
              const targetGroup = requireGroup(active, snapshot.groupId)
              return validateCandidate({
                ...active,
                sceneGroups: active.sceneGroups.map((candidate) => (
                  candidate.id === targetGroup.id ? { ...candidate, name } : candidate
                )),
              })
            }
            case 'scene-frame': {
              const frame = requireSceneFrame(active, snapshot.frameId)
              return validateCandidate({
                ...active,
                scene: {
                  frames: active.scene.frames.map((candidate) => (
                    candidate.id === frame.id ? { ...candidate, name } : candidate
                  )),
                },
              })
            }
            case 'entity-frame': {
              const entity = requireEntity(active, snapshot.entityId)
              const hasGraspFrame = entity.graspFrames.some(({ frameId }) => frameId === snapshot.frameId)
              const hasMovingFrame = entity.movingFrames.some(({ frameId }) => frameId === snapshot.frameId)
              if (!hasGraspFrame && !hasMovingFrame) {
                commandFailure(
                  'FRAME_PARENT_NOT_FOUND',
                  `$.spatialEntities.${snapshot.entityId}.frames.${snapshot.frameId}`,
                  `Entity Frame ${snapshot.frameId} does not belong to ${snapshot.entityId}.`,
                )
              }
              return validateCandidate(replaceEntity(active, entity.id, {
                ...entity,
                graspFrames: hasGraspFrame
                  ? entity.graspFrames.map((frame) => (
                      frame.frameId === snapshot.frameId ? { ...frame, name } : frame
                    ))
                  : entity.graspFrames,
                movingFrames: hasMovingFrame
                  ? entity.movingFrames.map((frame) => (
                      frame.frameId === snapshot.frameId ? { ...frame, name } : frame
                    ))
                  : entity.movingFrames,
              }))
            }
          }
        },
      })
    },

    async setPersistedVisibility(target, visible) {
      const snapshot = { ...target } as PersistedVisibilityTargetV4
      await options.mutations.replaceFromActive({
        description: `Set ${snapshot.kind} visibility`,
        mutate(active) {
          switch (snapshot.kind) {
            case 'robot': {
              const robot = requireRobot(active, snapshot.robotId)
              return validateCandidate(replaceRobot(active, robot.id, { ...robot, visible }))
            }
            case 'spatial-entity': {
              const entity = requireEntity(active, snapshot.entityId)
              return validateCandidate(replaceEntity(active, entity.id, { ...entity, visible }))
            }
            case 'scene-group': {
              const targetGroup = requireGroup(active, snapshot.groupId)
              return validateCandidate({
                ...active,
                sceneGroups: active.sceneGroups.map((candidate) => (
                  candidate.id === targetGroup.id ? { ...candidate, visible } : candidate
                )),
              })
            }
          }
        },
      })
    },

    async setSpatialEntityLocalPose(entityId, localPose) {
      const pose = clonePose(localPose)
      await options.mutations.replaceFromActive({
        description: `Set Spatial Entity ${entityId} pose`,
        mutate(active) {
          const entity = requireEntity(active, entityId)
          if (entity.transformOwner !== 'manual') {
            commandFailure(
              'SPATIAL_ENTITY_TRANSFORM_OWNERSHIP_CONFLICT',
              `$.spatialEntities.${entityId}.transformOwner`,
              `Spatial Entity transform is owned by ${entity.transformOwner}.`,
            )
          }
          return validateCandidate(replaceEntity(active, entity.id, {
            ...entity,
            localPose: pose,
          }))
        },
      })
    },

    async setSpatialEntityGroup(entityId, groupId) {
      await options.mutations.replaceFromActive({
        description: `Set Spatial Entity ${entityId} Group`,
        mutate(active) {
          const entity = requireEntity(active, entityId)
          if (groupId !== null) requireGroup(active, groupId)
          return validateCandidate(replaceEntity(active, entity.id, { ...entity, groupId }))
        },
      })
    },

    async setRobotBase(command) {
      const snapshot = {
        robotId: command.robotId,
        baseParentFrameId: command.baseParentFrameId,
        localBasePose: clonePose(command.localBasePose),
        intentionalMountEntityId: command.intentionalMountEntityId,
      }
      await options.mutations.replaceFromActive({
        description: `Set Robot ${snapshot.robotId} Base`,
        mutate(active) {
          const robot = requireRobot(active, snapshot.robotId)
          requireRobotBaseParent(active, snapshot.baseParentFrameId)
          if (snapshot.intentionalMountEntityId !== null) {
            requireEntity(active, snapshot.intentionalMountEntityId)
          }
          return validateCandidate(replaceRobot(active, robot.id, {
            ...robot,
            baseParentFrameId: snapshot.baseParentFrameId,
            localBasePose: snapshot.localBasePose,
            intentionalMountEntityId: snapshot.intentionalMountEntityId,
          }))
        },
      })
    },

    async setSelectedToolFrames(robotId, toolFrameId, tcpFrameId) {
      await options.mutations.replaceFromActive({
        description: `Set Robot ${robotId} Tool and TCP`,
        mutate(active) {
          const robot = requireRobot(active, robotId)
          const definition = active.robotDefinitions.find(({ id }) => id === robot.definitionId)
          if (definition === undefined) {
            commandFailure(
              'ROBOT_DEFINITION_NOT_FOUND',
              `$.robotDefinitions.${robot.definitionId}`,
              `Robot Definition ${robot.definitionId} does not exist.`,
            )
          }
          if (!definition.frames.some(({ id }) => id === toolFrameId)) {
            commandFailure(
              'ROBOT_FRAME_NOT_FOUND',
              '$.selectedToolFrameId',
              `Tool Frame ${toolFrameId} does not belong to Robot ${robotId}.`,
            )
          }
          const tcp = definition.frames.find(({ id }) => id === tcpFrameId)
          if (tcp?.role !== 'tcp') {
            commandFailure(
              'ROBOT_TCP_FRAME_INVALID',
              '$.selectedTcpFrameId',
              `TCP Frame ${tcpFrameId} must exist and have the tcp role.`,
            )
          }
          return validateCandidate(replaceRobot(active, robot.id, {
            ...robot,
            selectedToolFrameId: toolFrameId,
            selectedTcpFrameId: tcpFrameId,
          }))
        },
      })
    },

    async setSceneFrameLocalPose(frameId, localPose) {
      const pose = clonePose(localPose)
      await options.mutations.replaceFromActive({
        description: `Set Scene Frame ${frameId} pose`,
        mutate(active) {
          const frame = requireSceneFrame(active, frameId)
          if (frame.role === 'world') {
            commandFailure(
              'WORLD_FRAME_READ_ONLY',
              `$.scene.frames.${frameId}`,
              'The sole World Frame pose is read-only.',
            )
          }
          return validateCandidate({
            ...active,
            scene: {
              frames: active.scene.frames.map((candidate) => (
                candidate.id === frame.id ? { ...candidate, localPose: pose } : candidate
              )),
            },
          })
        },
      })
    },

    async setMovingFrame(command) {
      const snapshot = {
        entityId: command.entityId,
        frameId: command.frameId,
        parentFrameId: command.parentFrameId,
        localPose: clonePose(command.localPose),
      }
      await options.mutations.replaceFromActive({
        description: `Set Moving Frame ${snapshot.frameId}`,
        mutate(active) {
          const entity = requireEntity(active, snapshot.entityId)
          const frame = entity.movingFrames.find(({ frameId }) => frameId === snapshot.frameId)
          if (frame === undefined) {
            commandFailure(
              'FRAME_PARENT_NOT_FOUND',
              `$.spatialEntities.${snapshot.entityId}.movingFrames.${snapshot.frameId}`,
              `Moving Frame ${snapshot.frameId} does not belong to ${snapshot.entityId}.`,
            )
          }
          if (frame.sourceOwnership !== 'manual') {
            commandFailure(
              'MOVING_FRAME_OWNERSHIP_CONFLICT',
              `$.spatialEntities.${snapshot.entityId}.movingFrames.${snapshot.frameId}.sourceOwnership`,
              `Moving Frame is owned by ${frame.sourceOwnership}.`,
            )
          }
          requireGlobalFrame(active, snapshot.parentFrameId)
          return validateCandidate(replaceEntity(active, entity.id, {
            ...entity,
            movingFrames: entity.movingFrames.map((candidate) => (
              candidate.frameId === frame.frameId
                ? {
                    ...candidate,
                    parentFrameId: snapshot.parentFrameId,
                    localPose: snapshot.localPose,
                  }
                : candidate
            )),
          }))
        },
      })
    },

    async configureSpatialEntityOpcUaBinding(command) {
      const snapshot = {
        entityId: command.entityId,
        endpointUrl: command.endpointUrl,
        publishingIntervalMs: command.publishingIntervalMs,
        positionUnit: command.positionUnit,
        nodeIds: { ...command.nodeIds },
        numericStatusNodeId: command.numericStatusNodeId,
      }
      await options.mutations.replaceFromActive({
        description: `Configure OPC UA binding for Spatial Entity ${snapshot.entityId}`,
        mutate(active) {
          const entity = requireEntity(active, snapshot.entityId)
          const existing = selectSpatialEntityOpcUaBindingV4(active, entity.id)
          const currentOwnerEndpointId = ownerEndpointId(entity.transformOwner)
          if (entity.transformOwner !== 'manual' && currentOwnerEndpointId === null) {
            commandFailure(
              'SPATIAL_ENTITY_TRANSFORM_OWNERSHIP_CONFLICT',
              `$.spatialEntities.${entity.id}.transformOwner`,
              `Spatial Entity transform is owned by ${entity.transformOwner}.`,
            )
          }
          const currentEndpoint = currentOwnerEndpointId === null
            ? undefined
            : active.opcUa.endpoints.find(({ endpointId }) => endpointId === currentOwnerEndpointId)
          const matchingEndpoint = active.opcUa.endpoints.find((endpoint) => (
            endpoint.endpointUrl === snapshot.endpointUrl && endpoint.enabled
          ))
          const currentEndpointIsShared = currentEndpoint !== undefined
            && endpointIsSharedOutsideEntity(active, currentEndpoint.endpointId, entity.id)
          const keepCurrentEndpoint = currentEndpoint !== undefined && (
            currentEndpoint.endpointUrl === snapshot.endpointUrl || !currentEndpointIsShared
          )
          const endpointId = keepCurrentEndpoint
            ? currentEndpoint!.endpointId
            : matchingEndpoint?.endpointId ?? options.createId()
          const endpointIsShared = endpointIsSharedOutsideEntity(active, endpointId, entity.id)
          const currentFrame = entity.movingFrames.find((frame) => (
            frame.frameId === entity.parentFrameId
            && currentOwnerEndpointId !== null
            && frame.sourceOwnership === `opcua:${currentOwnerEndpointId}`
          ))
          const frameId = existing?.frameId ?? currentFrame?.frameId ?? options.createId()
          const reusablePoseMapping = active.opcUa.mappings.find((mapping) => (
            mapping.id === existing?.poseMappingId
            || (
              currentOwnerEndpointId !== null
              && mapping.endpointId === currentOwnerEndpointId
              && mappingTargetsEntityFrame(mapping, entity.id)
              && mapping.leaves.every((leaf) => (
                leaf.projectTarget.type === 'entity-frame'
                && leaf.projectTarget.entityId === entity.id
              ))
            )
          ))
          const poseMappingId = reusablePoseMapping?.id ?? options.createId()
          const reusableStatusMapping = active.opcUa.mappings.find((mapping) => (
            mappingTargetsEntityStatus(mapping, entity.id)
            && mapping.leaves.every((leaf) => (
              leaf.projectTarget.type === 'entity-status'
              && leaf.projectTarget.entityId === entity.id
            ))
          ))
          const statusMappingId = snapshot.numericStatusNodeId === undefined
            ? null
            : reusableStatusMapping?.id ?? options.createId()
          const owner = `opcua:${endpointId}` as const
          const endpoint = {
            endpointId,
            name: `OPC UA ${entity.name}`,
            endpointUrl: snapshot.endpointUrl,
            enabled: true,
            publishingIntervalMs: snapshot.publishingIntervalMs,
            reconnectDelayMs: 1_000,
          }
          const baselineFrame = currentFrame === undefined ? {
            frameId,
            name: `${entity.name} OPC UA Frame`,
            parentFrameId: entity.parentFrameId,
            localPose: clonePose(entity.localPose),
            sourceOwnership: owner,
          } : null
          const poseMapping = {
            id: poseMappingId,
            endpointId,
            direction: 'read' as const,
            publishingIntervalMs: snapshot.publishingIntervalMs,
            coherenceGroupId: `entity:${entity.id}:pose`,
            sourceOwnership: owner,
            interpolationMode: 'shortest-quaternion' as const,
            coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw' as const,
            leaves: poseMappingLeaves(entity.id, frameId, snapshot.nodeIds, snapshot.positionUnit),
          }
          const statusMapping = statusMappingId === null ? null : {
            id: statusMappingId,
            endpointId,
            direction: 'read' as const,
            publishingIntervalMs: snapshot.publishingIntervalMs,
            coherenceGroupId: null,
            sourceOwnership: owner,
            interpolationMode: 'none' as const,
            coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw' as const,
            leaves: [{
              leafPath: [],
              nodeId: snapshot.numericStatusNodeId!,
              projectTarget: { type: 'entity-status' as const, entityId: entity.id },
              opcUaDataType: 'Double' as const,
              projectDataType: 'number' as const,
              scale: 1,
              offset: 0,
              unit: 'number',
              required: true,
            }],
          }
          const mappingsWithoutPose = pruneMappingLeaves(active.opcUa.mappings, (leaf) => (
            leaf.projectTarget.type === 'entity-frame' && leaf.projectTarget.entityId === entity.id
          ))
          const mappingsWithoutStatus = pruneMappingLeaves(mappingsWithoutPose, (leaf) => (
            leaf.projectTarget.type === 'entity-status' && leaf.projectTarget.entityId === entity.id
          ))
          return validateCandidate({
            ...active,
            spatialEntities: active.spatialEntities.map((candidate) => (
              candidate.id !== entity.id ? candidate : {
                ...candidate,
                parentFrameId: frameId,
                localPose: IDENTITY_POSE_V4,
                transformOwner: owner,
                numericStatus: {
                  ...candidate.numericStatus,
                  sourceOwnership: statusMapping === null ? 'manual' : owner,
                },
                movingFrames: currentFrame === undefined
                  ? [...candidate.movingFrames, baselineFrame!]
                  : candidate.movingFrames.map((frame) => (
                      frame.frameId === frameId ? { ...frame, sourceOwnership: owner } : frame
                    )),
              }
            )),
            opcUa: {
              ...active.opcUa,
              mode: opcUaModeForSpatialEntityBinding(active.opcUa.mode),
              endpoints: active.opcUa.endpoints.some(({ endpointId: id }) => id === endpointId)
                ? active.opcUa.endpoints.map((candidate) => {
                    if (candidate.endpointId !== endpointId) return candidate
                    // A shared endpoint is shared configuration: a rebinding
                    // may revive it, but must not overwrite its peer settings.
                    return endpointIsShared ? { ...candidate, enabled: true } : endpoint
                  })
                : [...active.opcUa.endpoints, endpoint],
              mappings: [
                ...mappingsWithoutStatus,
                poseMapping,
                ...(statusMapping === null ? [] : [statusMapping]),
              ],
            },
          })
        },
      })
    },

    async takeSpatialEntityManualControl(entityId) {
      await options.mutations.replaceFromActive({
        description: `Take manual control of Spatial Entity ${entityId}`,
        mutate(active) {
          const entity = requireEntity(active, entityId)
          const endpointId = ownerEndpointId(entity.transformOwner)
          if (endpointId === null) {
            commandFailure(
              'SPATIAL_ENTITY_OPCUA_BINDING_NOT_FOUND',
              `$.spatialEntities.${entity.id}`,
              'Spatial Entity does not have one complete OPC UA transform binding.',
            )
          }
          const frame = entity.movingFrames.find(({ frameId, sourceOwnership }) => (
            frameId === entity.parentFrameId && sourceOwnership === `opcua:${endpointId}`
          ))
          const mappings = pruneMappingLeaves(active.opcUa.mappings, (leaf) => (
            leaf.projectTarget.type === 'entity-frame' && leaf.projectTarget.entityId === entity.id
          ))
          return validateCandidate({
            ...active,
            spatialEntities: active.spatialEntities.map((candidate) => (
              candidate.id !== entity.id ? candidate : {
                ...candidate,
                parentFrameId: frame?.parentFrameId ?? candidate.parentFrameId,
                localPose: frame === undefined
                  ? candidate.localPose
                  : composeRigidTransformV4(frame.localPose, candidate.localPose),
                transformOwner: 'manual',
                movingFrames: candidate.movingFrames.filter(({ sourceOwnership }) => (
                  sourceOwnership !== `opcua:${endpointId}`
                )),
              }
            )),
            opcUa: {
              ...active.opcUa,
              mappings,
            },
          })
        },
      })
    },

    async setNumericStatus(target, value) {
      const snapshot = { ...target } as StatusTargetV4
      await options.mutations.replaceFromActive({
        description: `Set ${snapshot.kind} numeric Status`,
        mutate(active) {
          if (snapshot.kind === 'robot') {
            const robot = requireRobot(active, snapshot.robotId)
            assertManualStatus(robot.numericStatus.sourceOwnership, `$.robots.${robot.id}.numericStatus`)
            return validateCandidate(replaceRobot(active, robot.id, {
              ...robot,
              numericStatus: { ...robot.numericStatus, value },
            }))
          }
          const entity = requireEntity(active, snapshot.entityId)
          assertManualStatus(entity.numericStatus.sourceOwnership, `$.spatialEntities.${entity.id}.numericStatus`)
          return validateCandidate(replaceEntity(active, entity.id, {
            ...entity,
            numericStatus: { ...entity.numericStatus, value },
          }))
        },
      })
    },

    async setStatusOverlayVisible(target, visible) {
      const snapshot = { ...target } as StatusTargetV4
      await options.mutations.replaceFromActive({
        description: `Set ${snapshot.kind} Status overlay visibility`,
        mutate(active) {
          if (snapshot.kind === 'robot') {
            const robot = requireRobot(active, snapshot.robotId)
            return validateCandidate(replaceRobot(active, robot.id, {
              ...robot,
              numericStatus: {
                ...robot.numericStatus,
                overlay: { ...robot.numericStatus.overlay, visible },
              },
            }))
          }
          const entity = requireEntity(active, snapshot.entityId)
          return validateCandidate(replaceEntity(active, entity.id, {
            ...entity,
            numericStatus: {
              ...entity.numericStatus,
              overlay: { ...entity.numericStatus.overlay, visible },
            },
          }))
        },
      })
    },

    async reparentGroup(groupId, parentGroupId) {
      await options.mutations.replaceFromActive({
        description: `Reparent Scene Group ${groupId}`,
        mutate(active) {
          const target = requireGroup(active, groupId)
          if (parentGroupId !== null) requireGroup(active, parentGroupId)
          return validateCandidate({
            ...active,
            sceneGroups: active.sceneGroups.map((candidate) => (
              candidate.id === target.id ? { ...candidate, parentGroupId } : candidate
            )),
          })
        },
      })
    },

    async ungroup(groupId) {
      await options.mutations.replaceFromActive({
        description: `Ungroup Scene Group ${groupId}`,
        mutate(active) {
          const target = requireGroup(active, groupId)
          return validateCandidate({
            ...active,
            sceneGroups: active.sceneGroups
              .filter(({ id }) => id !== target.id)
              .map((candidate) => (
                candidate.parentGroupId === target.id
                  ? { ...candidate, parentGroupId: target.parentGroupId }
                  : candidate
              )),
            spatialEntities: active.spatialEntities.map((entity) => (
              entity.groupId === target.id
                ? { ...entity, groupId: target.parentGroupId }
                : entity
            )),
          })
        },
      })
    },

    async deleteSpatialEntity(entityId) {
      await options.mutations.replaceFromActive({
        description: `Delete Spatial Entity ${entityId}`,
        mutate(active) {
          const target = requireEntity(active, entityId)
          if (!target.removable) {
            commandFailure(
              'SPATIAL_ENTITY_NOT_REMOVABLE',
              `$.spatialEntities.${entityId}.removable`,
              `Spatial Entity ${entityId} is not removable.`,
            )
          }
          return validateCandidate({
            ...active,
            spatialEntities: active.spatialEntities.filter(({ id }) => id !== target.id),
            opcUa: {
              ...active.opcUa,
              mappings: pruneMappingLeaves(active.opcUa.mappings, (leaf) => (
                (leaf.projectTarget.type === 'entity-frame' || leaf.projectTarget.type === 'entity-status')
                && leaf.projectTarget.entityId === target.id
              )),
            },
          })
        },
      })
    },

    async deleteGroupAndContents(groupId) {
      await options.mutations.replaceFromActive({
        description: `Delete Scene Group ${groupId} and contents`,
        mutate(active) {
          requireGroup(active, groupId)
          const descendantIds = new Set<SceneGroupIdV4>([groupId])
          let changed = true
          while (changed) {
            changed = false
            for (const candidate of active.sceneGroups) {
              if (
                candidate.parentGroupId !== null
                && descendantIds.has(candidate.parentGroupId)
                && !descendantIds.has(candidate.id)
              ) {
                descendantIds.add(candidate.id)
                changed = true
              }
            }
          }
          const contents = active.spatialEntities.filter((entity) => (
            entity.groupId !== null && descendantIds.has(entity.groupId)
          ))
          const protectedEntity = contents.find(({ removable }) => !removable)
          if (protectedEntity !== undefined) {
            commandFailure(
              'SPATIAL_ENTITY_NOT_REMOVABLE',
              `$.spatialEntities.${protectedEntity.id}.removable`,
              `Spatial Entity ${protectedEntity.id} is not removable.`,
            )
          }
          const contentIds = new Set(contents.map(({ id }) => id))
          return validateCandidate({
            ...active,
            spatialEntities: active.spatialEntities.filter(({ id }) => !contentIds.has(id)),
            sceneGroups: active.sceneGroups.filter(({ id }) => !descendantIds.has(id)),
            opcUa: {
              ...active.opcUa,
              mappings: pruneMappingLeaves(active.opcUa.mappings, (leaf) => (
                (leaf.projectTarget.type === 'entity-frame' || leaf.projectTarget.type === 'entity-status')
                && contentIds.has(leaf.projectTarget.entityId)
              )),
            },
          })
        },
      })
    },
  }

  return Object.freeze(service)
}
