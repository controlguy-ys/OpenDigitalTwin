import type {
  FrameIdV4,
  RobotIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import {
  rigidTransformFromTransformDraftV4,
  transformDraftFromRigidTransformV4,
  type TransformDraftV4,
} from './transform-draft.js'
import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface RobotBaseInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly robotId: RobotIdV4
  readonly commands: Pick<SceneCommandServiceV4, 'setRobotBase'>
}

interface InspectorCommandStateV4 {
  readonly pending: boolean
  readonly error: string | null
  readonly run: (
    operation: () => Promise<unknown> | unknown,
    onCommitted?: () => void,
  ) => void
  readonly reportError: (error: unknown) => void
}

function inspectorErrorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'The Scene command was rejected.'
}

export function useInspectorCommandV4(scopeKey: string): InspectorCommandStateV4 {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef(false)
  const generationRef = useRef(0)
  const scopeRef = useRef(scopeKey)

  if (scopeRef.current !== scopeKey) {
    scopeRef.current = scopeKey
    generationRef.current += 1
    pendingRef.current = false
  }

  useEffect(() => {
    setPending(false)
    setError(null)
  }, [scopeKey])

  const reportError = (caught: unknown): void => {
    setError(inspectorErrorMessageV4(caught))
  }

  const run = (
    operation: () => Promise<unknown> | unknown,
    onCommitted?: () => void,
  ): void => {
    if (scopeRef.current !== scopeKey || pendingRef.current) return
    const generation = generationRef.current + 1
    generationRef.current = generation
    pendingRef.current = true
    setPending(true)
    setError(null)
    void Promise.resolve()
      .then(operation)
      .then(() => {
        if (
          onCommitted !== undefined
          && scopeRef.current === scopeKey
          && generationRef.current === generation
        ) {
          onCommitted()
        }
      })
      .catch((caught: unknown) => {
        if (scopeRef.current === scopeKey && generationRef.current === generation) {
          setError(inspectorErrorMessageV4(caught))
        }
      })
      .finally(() => {
        if (scopeRef.current !== scopeKey || generationRef.current !== generation) return
        pendingRef.current = false
        setPending(false)
      })
  }

  return { pending, error, run, reportError }
}

interface InspectorPoseFieldsPropsV4 {
  readonly disabled: boolean
  readonly draft: TransformDraftV4
  readonly prefix: string
  readonly onChange?: (draft: TransformDraftV4) => void
}

export function InspectorPoseFieldsV4({
  disabled,
  draft,
  prefix,
  onChange,
}: InspectorPoseFieldsPropsV4): ReactNode {
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
              : (event) => onChange({ ...draft, [field]: event.currentTarget.value })}
            step="any"
            type="number"
            value={draft[field]}
          />
        </label>
      ))}
    </fieldset>
  )
}

interface BaseParentOptionV4 {
  readonly id: FrameIdV4
  readonly label: string
  readonly ownerEntityId: SpatialEntityIdV4 | null
}

function robotBaseParentOptionsV4(project: WorkcellProjectV4): readonly BaseParentOptionV4[] {
  const options: BaseParentOptionV4[] = project.scene.frames.map((frame) => ({
    id: frame.id,
    label: `${frame.name} (${frame.role})`,
    ownerEntityId: null,
  }))
  for (const entity of project.spatialEntities) {
    for (const frame of entity.movingFrames) {
      options.push({
        id: frame.frameId,
        label: `${entity.name} / ${frame.name} (Moving Frame)`,
        ownerEntityId: entity.id,
      })
    }
  }
  return options
}

export function RobotBaseInspectorV4({
  project,
  runtime,
  robotId,
  commands,
}: RobotBaseInspectorPropsV4): ReactNode {
  const robot = project.robots.find(({ id }) => id === robotId)
  const runtimeRobot = runtime.entities.get(robotId)
  const parentOptions = robotBaseParentOptionsV4(project)
  const scopeKey = `robot-base:${robotId}`
  const command = useInspectorCommandV4(scopeKey)
  const [parentFrameId, setParentFrameId] = useState<FrameIdV4>(
    robot?.baseParentFrameId ?? project.scene.frames[0]!.id,
  )
  const [mountEntityId, setMountEntityId] = useState<SpatialEntityIdV4 | null>(
    robot?.intentionalMountEntityId ?? null,
  )
  const [draft, setDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(robot?.localBasePose ?? project.scene.frames[0]!.localPose)
  ))

  const reset = (): void => {
    if (robot === undefined) return
    setParentFrameId(robot.baseParentFrameId)
    setMountEntityId(robot.intentionalMountEntityId)
    setDraft(transformDraftFromRigidTransformV4(robot.localBasePose))
  }

  useEffect(reset, [robot])

  if (robot === undefined || runtimeRobot?.kind !== 'robot') {
    return <p role="status">Robot Base is unavailable.</p>
  }

  const parentLabel = parentOptions.find(({ id }) => id === parentFrameId)?.label ?? parentFrameId
  const submit = (): void => {
    let localBasePose
    try {
      localBasePose = rigidTransformFromTransformDraftV4(draft)
    } catch (caught) {
      command.reportError(caught)
      return
    }
    command.run(() => commands.setRobotBase({
      robotId,
      baseParentFrameId: parentFrameId,
      localBasePose,
      intentionalMountEntityId: mountEntityId,
    }))
  }

  return (
    <section aria-label={`${robot.name} Robot Base inspector`} className="scene-inspector-section-v4">
      <h3>Robot Base</h3>
      <label>
        <span>Parent Frame</span>
        <select
          aria-label="Robot Base Parent Frame"
          disabled={command.pending}
          onChange={(event) => setParentFrameId(event.currentTarget.value)}
          value={parentFrameId}
        >
          {parentOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Intentional Mount Entity</span>
        <select
          aria-label="Intentional Mount Entity"
          disabled={command.pending}
          onChange={(event) => setMountEntityId(
            event.currentTarget.value.length === 0 ? null : event.currentTarget.value,
          )}
          value={mountEntityId ?? ''}
        >
          <option value="">None</option>
          {project.spatialEntities.map((entity) => (
            <option key={entity.id} value={entity.id}>{entity.name}</option>
          ))}
        </select>
      </label>
      <p>Local pose is relative to {parentLabel}.</p>
      <InspectorPoseFieldsV4
        disabled={command.pending}
        draft={draft}
        onChange={setDraft}
        prefix="Robot Base Local"
      />
      <p>World Base X: {(runtimeRobot.worldBasePose.positionM[0] * 1_000).toFixed(1)} mm</p>
      <div>
        <button disabled={command.pending} onClick={reset} type="button">Reset Robot Base</button>
        <button disabled={command.pending} onClick={submit} type="button">Apply Robot Base</button>
      </div>
      {command.error === null ? null : <p role="alert">{command.error}</p>}
    </section>
  )
}
