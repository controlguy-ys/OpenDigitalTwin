import { useEffect, useState, type ReactNode } from 'react'

import { quaternionToRpyDegreesV5, rpyDegreesToQuaternionV5, type FrameDefinitionV5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { SceneCommandServiceV6 } from '../../scene/v6/scene-command-service-v6.js'

export interface FrameInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly frameId: string
  readonly sceneCommands?: Pick<SceneCommandServiceV6, 'updateSceneFrame'>
}

type PoseDraft = Readonly<{ x: string; y: string; z: string; roll: string; pitch: string; yaw: string }>

function draftFor(frame: FrameDefinitionV5): PoseDraft {
  const rpy = quaternionToRpyDegreesV5(frame.localPose.quaternion)
  return { x: String(frame.localPose.positionM[0]), y: String(frame.localPose.positionM[1]), z: String(frame.localPose.positionM[2]), roll: String(rpy[0]), pitch: String(rpy[1]), yaw: String(rpy[2]) }
}

function parentName(project: WorkcellProjectV5, frame: FrameDefinitionV5): string {
  if (frame.parentFrameId === null) return 'None'
  return project.scene.frames.find((candidate) => candidate.id === frame.parentFrameId)?.name ?? frame.parentFrameId
}

export function FrameInspectorV6({ project, frameId, sceneCommands }: FrameInspectorV6Props): ReactNode {
  const frame = project.scene.frames.find((candidate) => candidate.id === frameId)
  const [draft, setDraft] = useState<PoseDraft>(() => frame === undefined ? { x: '', y: '', z: '', roll: '', pitch: '', yaw: '' } : draftFor(frame))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (frame !== undefined) setDraft(draftFor(frame))
    setError(null)
  }, [frame?.id, frame?.localPose, frameId, project.revisionId])

  if (frame === undefined) {
    return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Scene Frame is no longer available.</p></section>
  }

  const editable = frame.role !== 'world' && sceneCommands !== undefined
  const update = (field: keyof PoseDraft, value: string): void => setDraft((current) => ({ ...current, [field]: value }))
  const apply = (): void => {
    if (!editable || pending) return
    const raw = [draft.x, draft.y, draft.z, draft.roll, draft.pitch, draft.yaw]
    if (raw.some((value) => value.trim().length === 0)) return
    const values = raw.map((value) => Number(value))
    if (values.some((value) => !Number.isFinite(value))) return
    const localPose = { positionM: [values[0]!, values[1]!, values[2]!] as [number, number, number], quaternion: rpyDegreesToQuaternionV5([values[3]!, values[4]!, values[5]!]) }
    setPending(true)
    setError(null)
    void sceneCommands?.updateSceneFrame(frameId, localPose).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    }).finally(() => setPending(false))
  }

  return <section aria-label={`${frame.name} Scene Frame inspector`} className="v6-selection-inspector">
    <header><h2>{frame.name}</h2><p>Scene Frame inspection.</p></header>
    <details className="v6-inspector-section" open>
      <summary aria-label="Scene Frame section">Scene Frame</summary>
      <div className="v6-inspector-section-body">
        <dl><div><dt>Role</dt><dd>Role: {frame.role}</dd></div><div><dt>Parent Frame</dt><dd>Parent Frame: {parentName(project, frame)}</dd></div></dl>
        {frame.role === 'world' && <p role="status">World Frame is read-only.</p>}
        <div className="v6-inspector-grid">
          {([['x', 'Scene Frame Local X (m)'], ['y', 'Scene Frame Local Y (m)'], ['z', 'Scene Frame Local Z (m)'], ['roll', 'Scene Frame Local Roll (deg)'], ['pitch', 'Scene Frame Local Pitch (deg)'], ['yaw', 'Scene Frame Local Yaw (deg)']] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={label} disabled={!editable || pending} inputMode="decimal" onChange={(event) => update(field, event.currentTarget.value)} type="number" value={draft[field]} /></label>)}
        </div>
        <div className="v6-inspector-actions"><button disabled={!editable || pending} onClick={apply} type="button">Apply Scene Frame</button><button disabled={pending} onClick={() => setDraft(draftFor(frame))} type="button">Reset Scene Frame</button></div>
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
    </details>
  </section>
}
