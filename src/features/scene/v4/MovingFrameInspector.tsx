import type {
  FrameIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { sceneSelectionKeyV4 } from '../../interaction/v4/scene-selection.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'
import {
  InspectorPoseFieldsV4,
  useInspectorCommandV4,
} from './RobotBaseInspector.js'
import {
  rigidTransformFromTransformDraftV4,
  transformDraftFromRigidTransformV4,
  type TransformDraftV4,
} from './transform-draft.js'
import { useEffect, useState, type ReactNode } from 'react'

export interface MovingFrameInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly commands: Pick<SceneCommandServiceV4, 'setMovingFrame'>
}

interface MovingParentOptionV4 {
  readonly id: FrameIdV4
  readonly label: string
}

function movingParentOptionsV4(
  project: WorkcellProjectV4,
  excludedFrameId: FrameIdV4,
): readonly MovingParentOptionV4[] {
  const options: MovingParentOptionV4[] = project.scene.frames.map((frame) => ({
    id: frame.id,
    label: `${frame.name} (${frame.role})`,
  }))
  for (const entity of project.spatialEntities) {
    for (const frame of entity.graspFrames) {
      options.push({ id: frame.frameId, label: `${entity.name} / ${frame.name} (Grasp Frame)` })
    }
    for (const frame of entity.movingFrames) {
      if (frame.frameId !== excludedFrameId) {
        options.push({ id: frame.frameId, label: `${entity.name} / ${frame.name} (Moving Frame)` })
      }
    }
  }
  return options
}

export function MovingFrameInspectorV4({
  project,
  runtime,
  entityId,
  frameId,
  commands,
}: MovingFrameInspectorPropsV4): ReactNode {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  const frame = entity?.movingFrames.find(({ frameId: candidate }) => candidate === frameId)
  const runtimeFrame = runtime.globalFrames.get(frameId)
  const displayedLocalPose = frame?.sourceOwnership === 'manual'
    ? frame.localPose
    : runtimeFrame?.localPose ?? frame?.localPose
  const scopeKey = sceneSelectionKeyV4({ kind: 'entity-frame', entityId, frameId })
  const command = useInspectorCommandV4(scopeKey)
  const [parentFrameId, setParentFrameId] = useState<FrameIdV4>(
    frame?.parentFrameId ?? project.scene.frames[0]!.id,
  )
  const [draft, setDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(displayedLocalPose ?? project.scene.frames[0]!.localPose)
  ))

  const reset = (): void => {
    if (frame === undefined || displayedLocalPose === undefined) return
    setParentFrameId(frame.parentFrameId)
    setDraft(transformDraftFromRigidTransformV4(displayedLocalPose))
  }

  useEffect(reset, [displayedLocalPose, frame])

  if (entity === undefined || frame === undefined || runtimeFrame === undefined) {
    return <p role="status">Moving Frame is unavailable.</p>
  }

  const editable = frame.sourceOwnership === 'manual'
  const parentOptions = movingParentOptionsV4(project, frame.frameId)
  const submit = (): void => {
    if (!editable) return
    let localPose
    try {
      localPose = rigidTransformFromTransformDraftV4(draft)
    } catch (caught) {
      command.reportError(caught)
      return
    }
    command.run(() => commands.setMovingFrame({
      entityId,
      frameId,
      parentFrameId,
      localPose,
    }))
  }

  return (
    <section aria-label={`${entity.name} ${frame.name} inspector`} className="scene-inspector-section-v4">
      <h3>Moving Frame</h3>
      <p>{entity.name} / {frame.name} ({frame.frameId})</p>
      <p>Source owner: {frame.sourceOwnership}</p>
      {editable ? null : <p role="status">Moving Frame is owned by {frame.sourceOwnership} and is read-only.</p>}
      <label>
        <span>Parent Frame</span>
        <select
          aria-label="Moving Frame Parent"
          disabled={!editable || command.pending}
          onChange={(event) => setParentFrameId(event.currentTarget.value)}
          value={parentFrameId}
        >
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      <InspectorPoseFieldsV4
        disabled={!editable || command.pending}
        draft={draft}
        onChange={setDraft}
        prefix="Moving Frame Local"
      />
      <p>World X: {(runtimeFrame.worldPose.positionM[0] * 1_000).toFixed(1)} mm</p>
      <div>
        <button disabled={!editable || command.pending} onClick={reset} type="button">
          Reset Moving Frame
        </button>
        <button disabled={!editable || command.pending} onClick={submit} type="button">
          Apply Moving Frame
        </button>
      </div>
      {command.error === null ? null : <p role="alert">{command.error}</p>}
    </section>
  )
}
