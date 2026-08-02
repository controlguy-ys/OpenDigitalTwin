import { useState, type ReactNode } from 'react'

import {
  quaternionToRpyDegreesV5,
  rpyDegreesToQuaternionV5,
  type OpcUaProjectTargetV5,
  type SpatialGeometryV5,
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
type BoxGeometryDraft = Readonly<{ kind: 'box'; width: string; depth: string; height: string }>
type CylinderGeometryDraft = Readonly<{ kind: 'cylinder'; radius: string; height: string }>
type GeometryDraft = BoxGeometryDraft | CylinderGeometryDraft | Readonly<{ kind: 'asset' }>

const EMPTY_GEOMETRY_DRAFT: GeometryDraft = Object.freeze({ kind: 'asset' })

function draftFor(entity: SpatialEntityV5): PoseDraft {
  const rpy = quaternionToRpyDegreesV5(entity.localPose.quaternion)
  return Object.freeze({ x: String(entity.localPose.positionM[0]), y: String(entity.localPose.positionM[1]), z: String(entity.localPose.positionM[2]), roll: String(rpy[0]), pitch: String(rpy[1]), yaw: String(rpy[2]) })
}

function samePose(entity: SpatialEntityV5, values: readonly [number, number, number, number, number, number]): boolean {
  const rpy = quaternionToRpyDegreesV5(entity.localPose.quaternion)
  return entity.localPose.positionM.every((value, index) => value === values[index]) && rpy.every((value, index) => value === values[index + 3])
}

function geometryDraftFor(geometry: SpatialGeometryV5): GeometryDraft {
  if (geometry.kind === 'box') {
    return Object.freeze({ kind: 'box', width: String(geometry.dimensionsM[0]), depth: String(geometry.dimensionsM[1]), height: String(geometry.dimensionsM[2]) })
  }
  if (geometry.kind === 'cylinder') {
    return Object.freeze({ kind: 'cylinder', radius: String(geometry.radiusM), height: String(geometry.heightM) })
  }
  return EMPTY_GEOMETRY_DRAFT
}

function positiveFinite(value: string): number | null {
  if (value.trim().length === 0) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function ownershipDescription(owner: SpatialEntityV5['transformOwner']): string {
  if (owner === 'manual') return 'Manual ownership allows authoring this Transform.'
  if (owner === 'simulation') return 'Simulation owns this Transform; authoring is read-only.'
  if (owner === 'attachment') return 'Attachment owns this Transform while attached; authoring is read-only.'
  return `OPC UA (${owner.slice('opcua:'.length)}) owns this Transform; authoring is read-only.`
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return <details className="v6-inspector-section" open>
    <summary aria-label={`${title} section`}>{title}</summary>
    <div className="v6-inspector-section-body">{children}</div>
  </details>
}

export function ObjectInspectorV6({ project, entityId, mutations, onOpenBinding }: ObjectInspectorV6Props): ReactNode {
  const entity = project.spatialEntities.find((candidate) => candidate.id === entityId)
  const key = `${entityId}:${project.revisionId}`
  const [draft, setDraft] = useState<PoseDraft>(() => entity === undefined ? Object.freeze({ x: '', y: '', z: '', roll: '', pitch: '', yaw: '' }) : draftFor(entity))
  const [draftKey, setDraftKey] = useState(key)
  const geometryKey = `${key}:${entity?.geometry.kind ?? 'missing'}`
  const [geometryDraft, setGeometryDraft] = useState<GeometryDraft>(() => entity === undefined ? EMPTY_GEOMETRY_DRAFT : geometryDraftFor(entity.geometry))
  const [geometryDraftKey, setGeometryDraftKey] = useState(geometryKey)
  if (draftKey !== key) {
    setDraftKey(key)
    setDraft(entity === undefined ? Object.freeze({ x: '', y: '', z: '', roll: '', pitch: '', yaw: '' }) : draftFor(entity))
  }
  if (geometryDraftKey !== geometryKey) {
    setGeometryDraftKey(geometryKey)
    setGeometryDraft(entity === undefined ? EMPTY_GEOMETRY_DRAFT : geometryDraftFor(entity.geometry))
  }
  if (entity === undefined) return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Object is no longer available.</p></section>
  const manual = entity.transformOwner === 'manual'
  const comms = entityCommsDisplayStateV1(project, entity)
  const update = (patch: Partial<PoseDraft>): void => setDraft((current) => Object.freeze({ ...current, ...patch }))
  const updateBoxGeometry = (field: 'width' | 'depth' | 'height', value: string): void => setGeometryDraft((current) => current.kind === 'box' ? Object.freeze({ ...current, [field]: value }) : current)
  const updateCylinderGeometry = (field: 'radius' | 'height', value: string): void => setGeometryDraft((current) => current.kind === 'cylinder' ? Object.freeze({ ...current, [field]: value }) : current)
  const applyTransform = (): void => {
    if (!manual || mutations === undefined) return
    const rawValues = [draft.x, draft.y, draft.z, draft.roll, draft.pitch, draft.yaw]
    if (rawValues.some((value) => value.trim().length === 0)) return
    const values: readonly [number, number, number, number, number, number] = [
      Number(rawValues[0]), Number(rawValues[1]), Number(rawValues[2]),
      Number(rawValues[3]), Number(rawValues[4]), Number(rawValues[5]),
    ]
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
                positionM: [values[0], values[1], values[2]],
                quaternion: rpyDegreesToQuaternionV5([values[3], values[4], values[5]]),
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
  const applyGeometry = (): void => {
    if (mutations === undefined) return
    if (geometryDraft.kind === 'box') {
      if (entity.geometry.kind !== 'box') return
      const width = positiveFinite(geometryDraft.width)
      const depth = positiveFinite(geometryDraft.depth)
      const height = positiveFinite(geometryDraft.height)
      if (width === null || depth === null || height === null) return
      if (entity.geometry.dimensionsM[0] === width && entity.geometry.dimensionsM[1] === depth && entity.geometry.dimensionsM[2] === height) return
      const published = mutations.readPublished()
      if (published === null) return
      void mutations.mutate({
        expectedRevisionId: published.revisionId,
        description: 'Update Object geometry',
        recipe: (active) => ({
          ...active,
          spatialEntities: active.spatialEntities.map((candidate) => candidate.id !== entityId || candidate.geometry.kind !== 'box'
            ? candidate
            : { ...candidate, geometry: { ...candidate.geometry, dimensionsM: [width, depth, height] } }),
        }),
      })
      return
    }
    if (geometryDraft.kind !== 'cylinder' || entity.geometry.kind !== 'cylinder') return
    const radius = positiveFinite(geometryDraft.radius)
    const height = positiveFinite(geometryDraft.height)
    if (radius === null || height === null) return
    if (entity.geometry.radiusM === radius && entity.geometry.heightM === height) return
    const published = mutations.readPublished()
    if (published === null) return
    void mutations.mutate({
      expectedRevisionId: published.revisionId,
      description: 'Update Object geometry',
      recipe: (active) => ({
        ...active,
        spatialEntities: active.spatialEntities.map((candidate) => candidate.id !== entityId || candidate.geometry.kind !== 'cylinder'
          ? candidate
          : { ...candidate, geometry: { ...candidate.geometry, radiusM: radius, heightM: height } }),
      }),
    })
  }
  const movingFrame = entity.movingFrames[0]
  const bindingTarget: OpcUaProjectTargetV5 = movingFrame === undefined
    ? { type: 'entity-status', entityId }
    : { type: 'entity-frame', entityId, frameId: movingFrame.frameId }
  return <section className="v6-selection-inspector" aria-label={`${entity.name} inspector`}>
    <header><h2>{entity.name}</h2><p>{ownershipDescription(entity.transformOwner)}</p></header>
    <Section title="Runtime"><dl><div><dt>Owner</dt><dd>{entity.transformOwner}</dd></div><div><dt>Parent frame</dt><dd>{entity.parentFrameId}</dd></div></dl></Section>
    <Section title="Transform"><p>{ownershipDescription(entity.transformOwner)}</p><div className="v6-inspector-grid">{([
      ['x', 'X (m)'], ['y', 'Y (m)'], ['z', 'Z (m)'], ['roll', 'Roll (deg)'], ['pitch', 'Pitch (deg)'], ['yaw', 'Yaw (deg)'],
    ] as const).map(([field, label]) => <label key={field}>{label}<input aria-label={label} disabled={!manual} inputMode="decimal" onChange={(event) => update({ [field]: event.currentTarget.value })} type="number" value={draft[field]} /></label>)}</div>
      <div className="v6-inspector-actions"><button disabled={!manual} onClick={applyTransform} type="button">Apply Transform</button><button onClick={() => setDraft(draftFor(entity))} type="button">Reset</button></div></Section>
    <Section title="Geometry"><dl><div><dt>Kind</dt><dd>{entity.geometry.kind}</dd></div><div><dt>Visible</dt><dd>{entity.visible ? 'Visible' : 'Hidden'}</dd></div></dl>
      {entity.geometry.kind === 'box' && geometryDraft.kind === 'box' ? <>
        <div className="v6-inspector-grid v6-geometry-editor">
          <label>Width (m)<input aria-label="Width (m)" inputMode="decimal" min="0" onChange={(event) => updateBoxGeometry('width', event.currentTarget.value)} step="any" type="number" value={geometryDraft.width} /></label>
          <label>Depth (m)<input aria-label="Depth (m)" inputMode="decimal" min="0" onChange={(event) => updateBoxGeometry('depth', event.currentTarget.value)} step="any" type="number" value={geometryDraft.depth} /></label>
          <label>Height (m)<input aria-label="Height (m)" inputMode="decimal" min="0" onChange={(event) => updateBoxGeometry('height', event.currentTarget.value)} step="any" type="number" value={geometryDraft.height} /></label>
        </div>
        <div className="v6-inspector-actions"><button onClick={applyGeometry} type="button">Apply Geometry</button><button onClick={() => setGeometryDraft(geometryDraftFor(entity.geometry))} type="button">Reset Geometry</button></div>
      </> : entity.geometry.kind === 'cylinder' && geometryDraft.kind === 'cylinder' ? <>
        <div className="v6-inspector-grid v6-geometry-editor">
          <label>Radius (m)<input aria-label="Radius (m)" inputMode="decimal" min="0" onChange={(event) => updateCylinderGeometry('radius', event.currentTarget.value)} step="any" type="number" value={geometryDraft.radius} /></label>
          <label>Height (m)<input aria-label="Height (m)" inputMode="decimal" min="0" onChange={(event) => updateCylinderGeometry('height', event.currentTarget.value)} step="any" type="number" value={geometryDraft.height} /></label>
        </div>
        <dl><div><dt>Axis</dt><dd>{entity.geometry.axis}</dd></div><div><dt>Radial segments</dt><dd>{entity.geometry.radialSegments}</dd></div></dl>
        <div className="v6-inspector-actions"><button onClick={applyGeometry} type="button">Apply Geometry</button><button onClick={() => setGeometryDraft(geometryDraftFor(entity.geometry))} type="button">Reset Geometry</button></div>
      </> : <p>Asset geometry is read-only.</p>}
    </Section>
    <Section title="Status"><dl><div><dt>Value</dt><dd>{entity.numericStatus.value}</dd></div><div><dt>Owner</dt><dd>{entity.numericStatus.sourceOwnership}</dd></div></dl></Section>
    <Section title="Communications"><p>{comms.enabled ? `Enabled · ${comms.mappingCount} mappings` : `Disabled · ${comms.mappingCount} mappings`}</p>
      <label className="v6-switch-field"><input aria-label="Enable Object communications" checked={comms.enabled} onChange={(event) => updateComms({ enableComms: event.currentTarget.checked })} type="checkbox" /><span>Enable communications<span className="v6-switch-field-description">Enabling stores Object metadata only; it creates no OPC UA binding.</span></span></label>
      <label>Display tag<input aria-label="Display tag" onBlur={(event) => { if (event.currentTarget.value !== comms.tagName) updateComms({ tagName: event.currentTarget.value }) }} defaultValue={comms.tagName} /></label>
      <button onClick={() => onOpenBinding?.(bindingTarget)} type="button">Open Binding</button></Section>
  </section>
}
