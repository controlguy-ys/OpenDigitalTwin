import {
  failProjectV4,
  validateWorkcellProjectV4,
  type FrameIdV4,
  type RevisionIdV4,
  type RobotIdV4,
  type SpatialEntityIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  robotIdFromSceneSelectionV4,
  spatialEntityIdFromSceneSelectionV4,
  type CoordinateFrameSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface CoordinateDisplayCheckpointV4 {
  readonly kind: 'coordinate-display-checkpoint-v4'
}

export interface CoordinateDisplayStoreStateV4 {
  readonly projectRevisionId: RevisionIdV4 | null
  readonly poseFrame: CoordinateFrameSelectionV4 | null
  replaceProject(project: WorkcellProjectV4): void
  reconcileSelection(project: WorkcellProjectV4, selection: SceneSelectionV4): void
  selectPoseFrame(frame: CoordinateFrameSelectionV4): void
  captureCheckpoint(): CoordinateDisplayCheckpointV4
  restoreCheckpoint(checkpoint: CoordinateDisplayCheckpointV4): void
}

interface CoordinateDisplayContextV4 {
  readonly projectRevisionId: RevisionIdV4
  readonly worldFrameId: FrameIdV4
  readonly globalFrameIds: ReadonlySet<FrameIdV4>
  readonly robotFrameIdsByRobotId: ReadonlyMap<RobotIdV4, ReadonlySet<FrameIdV4>>
  readonly entityFrameIdsByEntityId: ReadonlyMap<
    SpatialEntityIdV4,
    ReadonlySet<FrameIdV4>
  >
}

interface CapturedCoordinateDisplayV4 {
  readonly state: CoordinateDisplayStoreStateV4
  readonly context: CoordinateDisplayContextV4 | null
}

function coordinateDisplayFailureV4(
  code: string,
  path: string,
  message: string,
): never {
  failProjectV4(
    code,
    path,
    message,
    'Refresh the published Project coordinate identities and try again.',
  )
}

function buildCoordinateDisplayContextV4(
  project: WorkcellProjectV4,
): CoordinateDisplayContextV4 {
  const worldFrame = project.scene.frames.find(({ role }) => role === 'world')
  if (worldFrame === undefined) {
    coordinateDisplayFailureV4(
      'COORDINATE_WORLD_FRAME_NOT_FOUND',
      '$.scene.frames',
      'The Project does not contain its validated World Frame.',
    )
  }
  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const robotFrameIdsByRobotId = new Map<RobotIdV4, ReadonlySet<FrameIdV4>>()
  for (const robot of project.robots) {
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      coordinateDisplayFailureV4(
        'COORDINATE_ROBOT_DEFINITION_NOT_FOUND',
        `$.robots.${robot.id}.definitionId`,
        `Robot ${robot.id} has no validated Definition.`,
      )
    }
    robotFrameIdsByRobotId.set(robot.id, new Set(definition.frames.map(({ id }) => id)))
  }
  const entityFrameIdsByEntityId = new Map<SpatialEntityIdV4, ReadonlySet<FrameIdV4>>()
  for (const entity of project.spatialEntities) {
    entityFrameIdsByEntityId.set(entity.id, new Set([
      ...entity.graspFrames.map(({ frameId }) => frameId),
      ...entity.movingFrames.map(({ frameId }) => frameId),
    ]))
  }
  return Object.freeze({
    projectRevisionId: project.revisionId,
    worldFrameId: worldFrame.id,
    globalFrameIds: new Set(project.scene.frames.map(({ id }) => id)),
    robotFrameIdsByRobotId,
    entityFrameIdsByEntityId,
  })
}

function frozenCoordinateFrameV4(
  selection: CoordinateFrameSelectionV4,
): CoordinateFrameSelectionV4 {
  switch (selection.kind) {
    case 'scene-frame':
      return Object.freeze({ kind: 'scene-frame', frameId: selection.frameId })
    case 'robot-frame':
      return Object.freeze({
        kind: 'robot-frame',
        robotId: selection.robotId,
        frameId: selection.frameId,
      })
    case 'entity-frame':
      return Object.freeze({
        kind: 'entity-frame',
        entityId: selection.entityId,
        frameId: selection.frameId,
      })
  }
}

function worldSelectionV4(
  context: CoordinateDisplayContextV4,
): CoordinateFrameSelectionV4 {
  return frozenCoordinateFrameV4({
    kind: 'scene-frame',
    frameId: context.worldFrameId,
  })
}

function coordinateFrameExistsV4(
  context: CoordinateDisplayContextV4,
  selection: CoordinateFrameSelectionV4,
): boolean {
  switch (selection.kind) {
    case 'scene-frame':
      return context.globalFrameIds.has(selection.frameId)
    case 'robot-frame':
      return context.robotFrameIdsByRobotId.get(selection.robotId)?.has(selection.frameId) === true
    case 'entity-frame':
      return context.entityFrameIdsByEntityId.get(selection.entityId)?.has(selection.frameId) === true
  }
}

function requireCoordinateFrameV4(
  context: CoordinateDisplayContextV4 | null,
  selection: CoordinateFrameSelectionV4,
): void {
  if (context === null || !coordinateFrameExistsV4(context, selection)) {
    coordinateDisplayFailureV4(
      'COORDINATE_FRAME_NOT_FOUND',
      '$.poseFrame',
      'The structured coordinate Frame does not exist in the published Project.',
    )
  }
}

function remainsInSelectionScopeV4(
  poseFrame: CoordinateFrameSelectionV4,
  selection: SceneSelectionV4,
): boolean {
  if (poseFrame.kind === 'scene-frame') return true
  if (poseFrame.kind === 'robot-frame') {
    return robotIdFromSceneSelectionV4(selection) === poseFrame.robotId
  }
  return spatialEntityIdFromSceneSelectionV4(selection) === poseFrame.entityId
}

function checkpointFailureV4(): never {
  coordinateDisplayFailureV4(
    'COORDINATE_DISPLAY_CHECKPOINT_INVALID',
    '$.checkpoint',
    'Coordinate display checkpoint is not owned by this store.',
  )
}

export function createCoordinateDisplayStoreV4(
): StoreApi<CoordinateDisplayStoreStateV4> {
  let context: CoordinateDisplayContextV4 | null = null
  const checkpoints = new WeakMap<object, CapturedCoordinateDisplayV4>()

  return createStore<CoordinateDisplayStoreStateV4>()((set, get) => ({
    projectRevisionId: null,
    poseFrame: null,
    replaceProject: (project) => {
      const validated = validateWorkcellProjectV4(project)
      const candidateContext = buildCoordinateDisplayContextV4(validated)
      const current = get()
      const poseFrame = current.poseFrame !== null
        && coordinateFrameExistsV4(candidateContext, current.poseFrame)
        ? current.poseFrame
        : worldSelectionV4(candidateContext)
      const candidateState: CoordinateDisplayStoreStateV4 = {
        ...current,
        projectRevisionId: candidateContext.projectRevisionId,
        poseFrame,
      }
      context = candidateContext
      set(candidateState, true)
    },
    reconcileSelection: (project, selection) => {
      const validated = validateWorkcellProjectV4(project)
      const current = get()
      if (
        context === null
        || current.projectRevisionId === null
        || validated.revisionId !== current.projectRevisionId
        || context.projectRevisionId !== current.projectRevisionId
      ) {
        coordinateDisplayFailureV4(
          'COORDINATE_DISPLAY_PROJECT_REVISION_MISMATCH',
          '$.revisionId',
          'Coordinate selection reconciliation requires the published Project revision.',
        )
      }
      if (
        current.poseFrame !== null
        && !remainsInSelectionScopeV4(current.poseFrame, selection)
      ) {
        set({ ...current, poseFrame: worldSelectionV4(context) }, true)
      }
    },
    selectPoseFrame: (poseFrame) => {
      requireCoordinateFrameV4(context, poseFrame)
      set((state) => ({
        ...state,
        poseFrame: frozenCoordinateFrameV4(poseFrame),
      }), true)
    },
    captureCheckpoint: () => {
      const checkpoint = Object.freeze({
        kind: 'coordinate-display-checkpoint-v4' as const,
      })
      checkpoints.set(checkpoint, { state: get(), context })
      return checkpoint
    },
    restoreCheckpoint: (checkpoint) => {
      if (checkpoint === null || typeof checkpoint !== 'object') checkpointFailureV4()
      const captured = checkpoints.get(checkpoint)
      if (captured === undefined) checkpointFailureV4()
      context = captured.context
      set(captured.state, true)
    },
  }))
}
