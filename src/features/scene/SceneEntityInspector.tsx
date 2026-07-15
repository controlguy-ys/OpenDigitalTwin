import { useEffect, useState } from 'react'
import type { SceneEntityIdV1, ScenePoseV1 } from '../../domain/project/scene-state-v1'
import { sceneCommandService } from '../project/project-store-browser'
import type { SceneCommandService } from './scene-command-service'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'
import {
  intrinsicZyxDegFromQuaternion,
  quaternionFromIntrinsicZyxDeg,
} from './rpy-editor'

interface TransformDraft {
  readonly xMm: string
  readonly yMm: string
  readonly zMm: string
  readonly rollDeg: string
  readonly pitchDeg: string
  readonly yawDeg: string
}

export interface SceneEntityInspectorProps {
  readonly entityId: SceneEntityIdV1
  readonly runtime?: SceneRuntimeProjectionV1
  readonly commands?: Pick<SceneCommandService, 'setLocalPose'>
  readonly disabled?: boolean
}

function displayNumber(value: number): string {
  const clean = Math.round(value * 1e12) / 1e12
  return String(Object.is(clean, -0) ? 0 : clean)
}

function draftFromPose(pose: ScenePoseV1): TransformDraft {
  const rpy = intrinsicZyxDegFromQuaternion(pose.quaternion)
  return {
    xMm: displayNumber(pose.positionM[0] * 1_000),
    yMm: displayNumber(pose.positionM[1] * 1_000),
    zMm: displayNumber(pose.positionM[2] * 1_000),
    rollDeg: displayNumber(rpy.rollDeg),
    pitchDeg: displayNumber(rpy.pitchDeg),
    yawDeg: displayNumber(rpy.yawDeg),
  }
}

function finiteDraft(value: string, label: string): number {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number.`)
  }
  return parsed
}

function poseFromDraft(draft: TransformDraft): ScenePoseV1 {
  const rollDeg = finiteDraft(draft.rollDeg, 'Roll')
  const pitchDeg = finiteDraft(draft.pitchDeg, 'Pitch')
  const yawDeg = finiteDraft(draft.yawDeg, 'Yaw')
  return {
    positionM: [
      finiteDraft(draft.xMm, 'X') / 1_000,
      finiteDraft(draft.yMm, 'Y') / 1_000,
      finiteDraft(draft.zMm, 'Z') / 1_000,
    ],
    quaternion: quaternionFromIntrinsicZyxDeg(rollDeg, pitchDeg, yawDeg),
  }
}

const LOCAL_FIELDS: readonly [keyof TransformDraft, string][] = [
  ['xMm', 'Local X (mm)'],
  ['yMm', 'Local Y (mm)'],
  ['zMm', 'Local Z (mm)'],
  ['rollDeg', 'Roll (deg)'],
  ['pitchDeg', 'Pitch (deg)'],
  ['yawDeg', 'Yaw (deg)'],
]

export function SceneEntityInspector({
  entityId,
  runtime: runtimeOverride,
  commands = sceneCommandService,
  disabled = false,
}: SceneEntityInspectorProps) {
  const publishedRuntime = usePublishedSceneRuntime()
  const runtime = runtimeOverride ?? publishedRuntime
  const entity = runtime.byId.get(entityId)
  const [draft, setDraft] = useState<TransformDraft>(() => draftFromPose(
    entity?.localPose ?? { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] },
  ))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (entity === undefined) return
    setDraft(draftFromPose(entity.localPose))
    setError(null)
  }, [entity])

  if (entity === undefined) {
    return <section className="scene-entity-inspector"><h2>Inspector</h2><p>Scene Entity unavailable.</p></section>
  }

  const parentName = entity.parentId === null
    ? 'MCP'
    : runtime.byId.get(entity.parentId)?.name ?? entity.parentId
  const opcUaOwned = entity.source.kind === 'object' && entity.source.transformSource === 'opcua'
  const localDisabled = disabled || opcUaOwned
  const worldDraft = draftFromPose(entity.worldPose)

  return (
    <section className="scene-entity-inspector">
      <h2>Inspector</h2>
      <header>
        <strong>{entity.name}</strong>
        <small>{entity.kind}</small>
      </header>
      <p>Relative to: {parentName}</p>
      {entity.source.kind === 'object' ? (
        <p>Transform source: {entity.source.transformSource === 'opcua' ? 'OPC UA' : 'Manual'}</p>
      ) : null}
      <fieldset disabled={localDisabled}>
        <legend>Local transform</legend>
        <div className="scene-transform-grid">
          {LOCAL_FIELDS.map(([key, label]) => (
            <label key={key}>
              <span>{label}</span>
              <input
                aria-label={label}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  setDraft((current) => ({ ...current, [key]: value }))
                }}
                step="any"
                type="number"
                value={draft[key]}
              />
            </label>
          ))}
        </div>
        <button
          disabled={localDisabled}
          onClick={() => {
            try {
              const pose = poseFromDraft(draft)
              setError(null)
              void commands.setLocalPose(entityId, pose).catch((nextError: unknown) => {
                setError(nextError instanceof Error ? nextError.message : 'Transform update failed.')
              })
            } catch (nextError) {
              setError(nextError instanceof Error ? nextError.message : 'Invalid transform.')
            }
          }}
          type="button"
        >
          Apply transform
        </button>
      </fieldset>
      <fieldset>
        <legend>World transform (read-only)</legend>
        <div className="scene-transform-grid">
          {([
            ['World X (mm)', worldDraft.xMm],
            ['World Y (mm)', worldDraft.yMm],
            ['World Z (mm)', worldDraft.zMm],
            ['World Roll (deg)', worldDraft.rollDeg],
            ['World Pitch (deg)', worldDraft.pitchDeg],
            ['World Yaw (deg)', worldDraft.yawDeg],
          ] as const).map(([label, value]) => (
            <label key={label}>
              <span>{label}</span>
              <input aria-label={label} readOnly value={value} />
            </label>
          ))}
        </div>
      </fieldset>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  )
}
