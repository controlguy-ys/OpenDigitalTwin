import { useEffect, useState, type ReactNode } from 'react'

import {
  quaternionToRpyDegreesV5,
  rpyDegreesToQuaternionV5,
  type OpcUaProjectTargetV5,
  type SpatialEntityV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import { entityCommsDisplayStateV1, updateEntityCommsV1 } from '../../connectivity/v5/entity-comms-model.js'

export interface InspectorMutationPortV6 {
  readPublished(): { readonly project: WorkcellProjectV5; readonly revisionId: string } | null
  mutate(request: { readonly expectedRevisionId: string; readonly description: string; readonly recipe: (project: WorkcellProjectV5) => WorkcellProjectV5 }): Promise<unknown>
}

export interface ObjectInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly entityId: string
  readonly mutations?: InspectorMutationPortV6
  readonly onOpenBinding?: (target: OpcUaProjectTargetV5) => void
}

type PoseDraft = Readonly<{ x: string; y: string; z: string; roll: string; pitch: string; yaw: string }>

function draftFor(entity: SpatialEntityV5): PoseDraft {
  const rpy = quaternionToRpyDegreesV5(entity.localPose.quaternion)
  return Object.freeze({ x: String(entity.localPose.positionM[0]), y: String(entity.localPose.positionM[1]), z: String(entity.localPose.positionM[2]), roll: String(rpy[0]), pitch: String(rpy[1]), yaw: String(rpy[2]) })
}

function samePose(entity: SpatialEntityV5, values: readonly number[]): boolean {
  const rpy = quaternionToRpyDegreesV5(entity.localPose.quaternion)
  return entity.localPose.positionM.every((value, index) => value === values[index]) && rpy.every((value, index) => value === values[index + 3])
}

function ownershipDescription(owner: SpatialEntityV5['transformOwner']): string {
  if (owner === 'manual') return 'Manual ownership allows authoring this Transform.'
  if (owner === 'simulation') return 'Simulation owns this Transform; authoring is read-only.'
  if (owner === 'attachment') return 'Attachment owns this Transform while attached; authoring is read-only.'
  return `OPC UA (${owner.slice('opcua:'.length)}) owns this Transform; authoring is read-only.`
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return <details className="v6-inspector-section" open>
    <summary><button aria-label={title} type="button">{title}</button></summary>
    <div className="v6-inspector-section-body">{children}</div>
  </details>
}

export function ObjectInspectorV6({ project, entityId, mutations, onOpenBinding }: ObjectInspectorV6Props): ReactNode {
  const entity = project.spatialEntities.find((candidate) => candidate.id === entityId)
  const key = `${entityId}:${project.revisionId}`
  const [draft, setDraft] = useState<PoseDraft>(() => entity === undefined ? Object.freeze({ x: '', y: '', z: '', roll: '', pitch: '', yaw: '' }) : draftFor(entity))
  const [draftKey, setDraftKey] = useState(key)
  if (draftKey !== key) {
    setDraftKey(key)
    setDraft(entity === undefined ? Object.freeze({ x: '', y: '', z: '', roll: '', pitch: '', yaw: '' }) : draftFor(entity))
  }
  useEffect(() => undefined, [key])
  if (entity === undefined) return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Object is no longer available.</p></section>
  const manual = entity.transformOwner === 'manual'
  const comms = entityCommsDisplayStateV1(project, entity)
  const update = (patch: Partial<PoseDraft>): void => setDraft((current) => Object.freeze({ ...current, ...patch }))
  const applyTransform = (): void => {
    if (!manual || mutations === undefined) return
    const rawValues = [draft.x, draft.y, draft.z, draft.roll, draft.pitch, draft.yaw]
    if (rawValues.some((value) => value.trim().length === 0)) return
    const values = rawValues.map(Number)
    if (values.some((value) => !Number.isFinite(value)) || samePose(entity, values)) return
    const published = mutations.readPublished()
    if (published === null) return
    void mutations.mutate({
      expectedRevisionId: published.revisionId,
      description: 'Update Object transform',
      recipe: (active) => ({
        ...active,
        spatialEntities: active.spatialEntities.map((candidate) => candidate.id !== entityId
          ? candidate
          : {
              ...candidate,
              localPose: {
                positionM: [values[0]!, values[1]!, values[2]!],
                quaternion: rpyDegreesToQuaternionV5([values[3]!, values[4]!, values[5]!]),
              },
            }),
      }),
    })
  }
  const updateComms = (patch: { readonly enableComms?: boolean; readonly tagName?: string }): void => {
    if (mutations === undefined) return
    const published = mutations.readPublished()
    if (published === null) return
    void mutations.mutate({ expectedRevisionId: published.revisionId, description: 'Update Object communications', recipe: (active) => updateEntityCommsV1(active, entityId, patch) })
  }
  const bindingTarget: OpcUaProjectTargetV5 = entity.movingFrames[0] === undefined
    ? { type: 'entity-status', entityId }
    : { type: 'entity-frame', entityId, frameId: entity.movingFrames[0].frameId }
  return <section className="v6-selection-inspector" aria-label={`${entity.name} inspector`}>
    <header><h2>{entity.name}</h2><p>{ownershipDescription(entity.transformOwner)}</p></header>
    <Section title="Runtime"><dl><div><dt>Owner</dt><dd>{entity.transformOwner}</dd></div><div><dt>Parent frame</dt><dd>{entity.parentFrameId}</dd></div></dl></Section>
    <Section title="Transform"><p>{ownershipDescription(entity.transformOwner)}</p><div className="v6-inspector-grid">{([
      ['x', 'X (m)'], ['y', 'Y (m)'], ['z', 'Z (m)'], ['roll', 'Roll (deg)'], ['pitch', 'Pitch (deg)'], ['yaw', 'Yaw (deg)'],
    ] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={label} disabled={!manual} inputMode="decimal" onChange={(event) => update({ [field]: event.currentTarget.value })} type="number" value={draft[field]} /></label>)}</div>
      <div className="v6-inspector-actions"><button disabled={!manual} onClick={applyTransform} type="button">Apply Transform</button><button onClick={() => setDraft(draftFor(entity))} type="button">Reset</button></div></Section>
    <Section title="Geometry"><dl><div><dt>Kind</dt><dd>{entity.geometry.kind}</dd></div><div><dt>Visible</dt><dd>{entity.visible ? 'Visible' : 'Hidden'}</dd></div></dl></Section>
    <Section title="Status"><dl><div><dt>Value</dt><dd>{entity.numericStatus.value}</dd></div><div><dt>Owner</dt><dd>{entity.numericStatus.sourceOwnership}</dd></div></dl></Section>
    <Section title="Communications"><p>{comms.enabled ? `Enabled · ${comms.mappingCount} mappings` : `Disabled · ${comms.mappingCount} mappings`}</p>
      <label className="v6-switch-field"><input aria-label="Enable Object communications" checked={comms.enabled} onChange={(event) => updateComms({ enableComms: event.currentTarget.checked })} type="checkbox" /><span>Enable communications<span className="v6-switch-field-description">Enabling stores Object metadata only; it creates no OPC UA binding.</span></span></label>
      <label>Display tag<input aria-label="Display tag" onBlur={(event) => { if (event.currentTarget.value !== comms.tagName) updateComms({ tagName: event.currentTarget.value }) }} defaultValue={comms.tagName} /></label>
      <button onClick={() => onOpenBinding?.(bindingTarget)} type="button">Open Binding</button></Section>
  </section>
}
