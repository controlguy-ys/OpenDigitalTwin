import type {
  FrameIdV4,
  RigidTransformV4,
  RobotIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  sameSceneSelectionV4,
  type CoordinateFrameSelectionV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { SceneCommandServiceV4 } from '../../scene/v4/scene-command-service.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import {
  rigidTransformFromTransformDraftV4,
  transformDraftFromRigidTransformV4,
  type TransformDraftV4,
} from '../../scene/v4/transform-draft.js'
import {
  coordinateFrameOptionsV4,
  type CoordinateFrameOptionV4,
} from '../../viewport/v4/coordinate-pose-readout.js'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'
import type { CoordinateDisplayStoreStateV4 } from './coordinate-display-store.js'

export interface CoordinateFramesDialogPropsV4 {
  readonly open: boolean
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly display: StoreApi<CoordinateDisplayStoreStateV4>
  readonly commands: Pick<
    SceneCommandServiceV4,
    'setSceneFrameLocalPose' | 'setMovingFrame'
  >
  readonly onOpenRobotBase: (robotId: RobotIdV4) => void
  readonly onClose: () => void
}

type FrameEditRouteV4 =
  | { readonly kind: 'world' }
  | { readonly kind: 'scene'; readonly frameId: FrameIdV4 }
  | { readonly kind: 'robot-base'; readonly robotId: RobotIdV4 }
  | { readonly kind: 'robot-definition' }
  | { readonly kind: 'grasp' }
  | {
      readonly kind: 'moving'
      readonly entityId: SpatialEntityIdV4
      readonly frameId: FrameIdV4
      readonly parentFrameId: FrameIdV4
      readonly sourceOwnership: string
    }

interface FrameEditorStateV4 {
  readonly localPose: RigidTransformV4
  readonly route: FrameEditRouteV4
}

interface ParentFrameOptionV4 {
  readonly id: FrameIdV4
  readonly label: string
}

function frameEditorStateV4(
  project: WorkcellProjectV4,
  selection: CoordinateFrameSelectionV4,
): FrameEditorStateV4 {
  if (selection.kind === 'scene-frame') {
    const frame = project.scene.frames.find(({ id }) => id === selection.frameId)
    if (frame === undefined) throw new Error(`Scene Frame ${selection.frameId} is unavailable.`)
    return {
      localPose: frame.localPose,
      route: frame.role === 'world'
        ? { kind: 'world' }
        : { kind: 'scene', frameId: frame.id },
    }
  }

  if (selection.kind === 'robot-frame') {
    const robot = project.robots.find(({ id }) => id === selection.robotId)
    const definition = robot === undefined
      ? undefined
      : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    const frame = definition?.frames.find(({ id }) => id === selection.frameId)
    if (robot === undefined || frame === undefined) {
      throw new Error(`Robot Frame ${selection.robotId}/${selection.frameId} is unavailable.`)
    }
    if (frame.role === 'base') {
      return {
        localPose: robot.localBasePose,
        route: { kind: 'robot-base', robotId: robot.id },
      }
    }
    return { localPose: frame.localPose, route: { kind: 'robot-definition' } }
  }

  const entity = project.spatialEntities.find(({ id }) => id === selection.entityId)
  const grasp = entity?.graspFrames.find(({ frameId }) => frameId === selection.frameId)
  if (grasp !== undefined) {
    return { localPose: grasp.localPose, route: { kind: 'grasp' } }
  }
  const moving = entity?.movingFrames.find(({ frameId }) => frameId === selection.frameId)
  if (entity === undefined || moving === undefined) {
    throw new Error(`Entity Frame ${selection.entityId}/${selection.frameId} is unavailable.`)
  }
  return {
    localPose: moving.localPose,
    route: {
      kind: 'moving',
      entityId: entity.id,
      frameId: moving.frameId,
      parentFrameId: moving.parentFrameId,
      sourceOwnership: moving.sourceOwnership,
    },
  }
}

function parentFrameOptionsV4(
  project: WorkcellProjectV4,
  excludedFrameId: FrameIdV4,
): readonly ParentFrameOptionV4[] {
  const options: ParentFrameOptionV4[] = project.scene.frames.map((frame) => ({
    id: frame.id,
    label: `${frame.name} (${frame.role})`,
  }))
  for (const entity of project.spatialEntities) {
    for (const frame of entity.graspFrames) {
      options.push({ id: frame.frameId, label: `${entity.name} / ${frame.name}` })
    }
    for (const frame of entity.movingFrames) {
      if (frame.frameId !== excludedFrameId) {
        options.push({ id: frame.frameId, label: `${entity.name} / ${frame.name}` })
      }
    }
  }
  return options.filter(({ id }) => id !== excludedFrameId)
}

function errorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'The coordinate Frame command was rejected.'
}

function editableRouteV4(route: FrameEditRouteV4): boolean {
  return route.kind === 'scene'
    || (route.kind === 'moving' && route.sourceOwnership === 'manual')
}

function updateDraftFieldV4(
  draft: TransformDraftV4,
  field: keyof TransformDraftV4,
  value: string,
): TransformDraftV4 {
  return { ...draft, [field]: value }
}

interface PoseFieldsPropsV4 {
  readonly disabled: boolean
  readonly draft: TransformDraftV4
  readonly prefix: 'Local' | 'World'
  readonly onChange?: (draft: TransformDraftV4) => void
}

function PoseFieldsV4({ disabled, draft, prefix, onChange }: PoseFieldsPropsV4): ReactNode {
  const fields = [
    ['xMm', 'Position X', 'mm'],
    ['yMm', 'Position Y', 'mm'],
    ['zMm', 'Position Z', 'mm'],
    ['rollDeg', 'Rotation X', 'deg'],
    ['pitchDeg', 'Rotation Y', 'deg'],
    ['yawDeg', 'Rotation Z', 'deg'],
  ] as const

  return (
    <fieldset>
      <legend>{prefix} XYZRPY</legend>
      {fields.map(([field, label, unit]) => (
        <label key={field}>
          <span>{label}</span>
          <input
            aria-label={`${prefix} ${label} (${unit})`}
            disabled={disabled}
            onChange={onChange === undefined
              ? undefined
              : (event) => onChange(updateDraftFieldV4(draft, field, event.currentTarget.value))}
            step="any"
            type="number"
            value={draft[field]}
          />
        </label>
      ))}
    </fieldset>
  )
}

function routeNoticeV4(
  route: FrameEditRouteV4,
  onOpenRobotBase: (robotId: RobotIdV4) => void,
): ReactNode {
  switch (route.kind) {
    case 'world':
      return <p role="status">World Frame is read-only.</p>
    case 'scene':
      return null
    case 'robot-base':
      return (
        <div>
          <p role="status">Robot Base position is edited in the Base editor.</p>
          <button onClick={() => onOpenRobotBase(route.robotId)} type="button">
            Open Robot Base Editor
          </button>
        </div>
      )
    case 'robot-definition':
      return <p role="status">Robot Definition Frames are read-only until P3.</p>
    case 'grasp':
      return <p role="status">Grasp Frames are read-only.</p>
    case 'moving':
      return route.sourceOwnership === 'manual'
        ? null
        : <p role="status">Moving Frame is owned by {route.sourceOwnership} and is read-only.</p>
  }
}

export function CoordinateFramesDialogV4({
  open,
  project,
  runtime,
  selection,
  display,
  commands,
  onOpenRobotBase,
  onClose,
}: CoordinateFramesDialogPropsV4): ReactNode {
  const poseFrame = useStore(display, (state) => state.poseFrame)
  const options = useMemo(
    () => coordinateFrameOptionsV4(project, runtime, selection),
    [project, runtime, selection],
  )
  const matchingOption = options.find((option) => (
    poseFrame !== null && sameSceneSelectionV4(option.selection, poseFrame)
  ))
  const fallbackSelection = useMemo<CoordinateFrameSelectionV4>(() => ({
    kind: 'scene-frame',
    frameId: project.scene.frames.find(({ role }) => role === 'world')!.id,
  }), [project])
  const activeSelection = matchingOption !== undefined && poseFrame !== null
    ? poseFrame
    : fallbackSelection
  const activeOption: CoordinateFrameOptionV4 = matchingOption
    ?? options.find((option) => sameSceneSelectionV4(option.selection, fallbackSelection))
    ?? options[0]!
  const editor = useMemo(
    () => frameEditorStateV4(project, activeSelection),
    [activeSelection, project],
  )
  const [localDraft, setLocalDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(editor.localPose)
  ))
  const worldDraft = useMemo(
    () => transformDraftFromRigidTransformV4(activeOption.worldPose),
    [activeOption.worldPose],
  )
  const [parentFrameId, setParentFrameId] = useState<FrameIdV4>(() => (
    editor.route.kind === 'moving' ? editor.route.parentFrameId : project.scene.frames[0]!.id
  ))
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const pendingRequest = useRef(false)
  const requestGeneration = useRef(0)
  const editable = editableRouteV4(editor.route)
  const parentOptions = editor.route.kind === 'moving'
    ? parentFrameOptionsV4(project, editor.route.frameId)
    : []

  useEffect(() => {
    requestGeneration.current += 1
    pendingRequest.current = false
    setLocalDraft(transformDraftFromRigidTransformV4(editor.localPose))
    if (editor.route.kind === 'moving') setParentFrameId(editor.route.parentFrameId)
    setError(null)
    setPending(false)
  }, [activeOption.key, editor])

  if (!open) return null

  const submit = (): void => {
    if (!editable || pendingRequest.current) return
    let localPose: RigidTransformV4
    try {
      localPose = rigidTransformFromTransformDraftV4(localDraft)
    } catch (caught) {
      setError(errorMessageV4(caught))
      return
    }

    const route = editor.route
    const generation = requestGeneration.current + 1
    requestGeneration.current = generation
    pendingRequest.current = true
    setPending(true)
    setError(null)
    void Promise.resolve()
      .then(() => {
        if (route.kind === 'scene') {
          return commands.setSceneFrameLocalPose(route.frameId, localPose)
        }
        if (route.kind === 'moving' && route.sourceOwnership === 'manual') {
          return commands.setMovingFrame({
            entityId: route.entityId,
            frameId: route.frameId,
            parentFrameId,
            localPose,
          })
        }
        return undefined
      })
      .catch((caught: unknown) => {
        if (requestGeneration.current === generation) {
          setError(errorMessageV4(caught))
        }
      })
      .finally(() => {
        if (requestGeneration.current !== generation) return
        pendingRequest.current = false
        setPending(false)
      })
  }

  return (
    <div
      aria-labelledby="coordinate-frames-v4-title"
      aria-modal="true"
      className="import-step-backdrop"
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
      }}
      role="dialog"
    >
      <section className="import-step-dialog coordinate-frames-dialog">
        <header>
          <div>
            <p>Project coordinate system</p>
            <h2 id="coordinate-frames-v4-title">Coordinate Frames</h2>
          </div>
          <button aria-label="Close Coordinate Frames" onClick={onClose} type="button">
            Close
          </button>
        </header>

        <form
          className="import-config"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <label>
            <span>Frame</span>
            <select
              aria-label="Coordinate Frame"
              onChange={(event) => {
                const option = options.find(({ key }) => key === event.currentTarget.value)
                if (option === undefined) return
                try {
                  display.getState().selectPoseFrame(option.selection)
                } catch (caught) {
                  setError(errorMessageV4(caught))
                }
              }}
              value={activeOption.key}
            >
              {options.map((option) => (
                <option key={option.key} value={option.key}>{option.label}</option>
              ))}
            </select>
          </label>

          <p><strong>Units:</strong> mm/deg</p>
          <p><strong>Orientation:</strong> Intrinsic Z-Y-X RPY</p>

          {editor.route.kind === 'moving' ? (
            <label>
              <span>Parent Frame</span>
              <select
                aria-label="Parent Frame"
                disabled={!editable || pending}
                onChange={(event) => setParentFrameId(event.currentTarget.value)}
                value={parentFrameId}
              >
                {parentOptions.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </select>
            </label>
          ) : null}

          {routeNoticeV4(editor.route, onOpenRobotBase)}
          <PoseFieldsV4
            disabled={!editable || pending}
            draft={localDraft}
            onChange={setLocalDraft}
            prefix="Local"
          />
          <PoseFieldsV4 disabled draft={worldDraft} prefix="World" />

          {error === null ? null : <p role="alert">{error}</p>}
          <footer>
            <button onClick={onClose} type="button">Close</button>
            <button disabled={!editable || pending} type="submit">Apply Frame</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
