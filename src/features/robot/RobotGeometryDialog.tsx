import { useEffect, useMemo, useState } from 'react'
import { Euler, MathUtils, Quaternion } from 'three'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useRobotGeometryStore } from './robot-geometry-store'

interface RobotGeometryDialogProps {
  open: boolean
  onClose(): void
}

interface GeometryDraft {
  positionMm: [number, number, number]
  rotationDeg: [number, number, number]
  scale: [number, number, number]
  visible: boolean
  collisionCenter: [number, number, number]
  collisionHalfExtents: [number, number, number]
}

function toDraft(record: ReturnType<typeof useRobotGeometryStore.getState>['links'][number]): GeometryDraft {
  const euler = new Euler().setFromQuaternion(
    new Quaternion(...record.localTransform.quaternion),
    'ZYX',
  )
  return {
    positionMm: record.localTransform.position.map((value) => value * 1000) as [
      number,
      number,
      number,
    ],
    rotationDeg: [
      MathUtils.radToDeg(euler.x),
      MathUtils.radToDeg(euler.y),
      MathUtils.radToDeg(euler.z),
    ],
    scale: [...record.localTransform.scale],
    visible: record.visible,
    collisionCenter: [...record.collisionCenter],
    collisionHalfExtents: [...record.collisionHalfExtents],
  }
}

function updateTuple(
  tuple: [number, number, number],
  index: number,
  value: number,
): [number, number, number] {
  const next: [number, number, number] = [...tuple]
  next[index] = value
  return next
}

export function RobotGeometryDialog({ open, onClose }: RobotGeometryDialogProps) {
  const links = useRobotGeometryStore((state) => state.links)
  const setLocalTransform = useRobotGeometryStore((state) => state.setLocalTransform)
  const setVisible = useRobotGeometryStore((state) => state.setVisible)
  const setCollision = useRobotGeometryStore((state) => state.setCollision)
  const [selectedLinkId, setSelectedLinkId] = useState<RobotLinkId>('LINK00')
  const selected = useMemo(
    () => links.find(({ linkId }) => linkId === selectedLinkId) ?? links[0],
    [links, selectedLinkId],
  )
  const [draft, setDraft] = useState<GeometryDraft | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selected !== undefined) {
      setSelectedLinkId(selected.linkId)
      setDraft(toDraft(selected))
      setError(null)
    }
  }, [selected])

  if (!open) return null

  const apply = async () => {
    if (selected === undefined || draft === null) return
    const values = [
      ...draft.positionMm,
      ...draft.rotationDeg,
      ...draft.scale,
      ...draft.collisionCenter,
      ...draft.collisionHalfExtents,
    ]
    if (values.some((value) => !Number.isFinite(value))) {
      setError('Geometry values must be finite.')
      return
    }
    if (
      draft.scale.some((value) => value <= 0) ||
      draft.collisionHalfExtents.some((value) => value <= 0)
    ) {
      setError('Scale and collision half extents must be positive.')
      return
    }
    const quaternion = new Quaternion().setFromEuler(
      new Euler(
        MathUtils.degToRad(draft.rotationDeg[0]),
        MathUtils.degToRad(draft.rotationDeg[1]),
        MathUtils.degToRad(draft.rotationDeg[2]),
        'ZYX',
      ),
    )
    try {
      await setLocalTransform(selected.linkId, {
        position: draft.positionMm.map((value) => value / 1000) as [
          number,
          number,
          number,
        ],
        quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
        scale: [...draft.scale],
      })
      await setVisible(selected.linkId, draft.visible)
      await setCollision(
        selected.linkId,
        [...draft.collisionCenter],
        [...draft.collisionHalfExtents],
      )
      setError(null)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Geometry update failed.')
    }
  }

  const vectorFields = (
    label: string,
    values: [number, number, number],
    update: (next: [number, number, number]) => void,
    suffix = '',
  ) => (
    <fieldset>
      <legend>{label}</legend>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            aria-label={`${label} ${axis}${suffix}`}
            onChange={(event) =>
              update(updateTuple(values, index, event.currentTarget.valueAsNumber))
            }
            step="any"
            type="number"
            value={values[index]}
          />
        </label>
      ))}
    </fieldset>
  )

  return (
    <div
      aria-labelledby="robot-geometry-title"
      aria-modal="true"
      className="import-step-backdrop"
      role="dialog"
    >
      <section className="import-step-dialog robot-geometry-dialog">
        <header>
          <div>
            <p>Geometry configuration</p>
            <h2 id="robot-geometry-title">Robot Geometry</h2>
          </div>
          <button aria-label="Close Robot Geometry" onClick={onClose} type="button">
            Close
          </button>
        </header>
        {selected === undefined || draft === null ? (
          <p>Import a complete seven-Link Robot to configure its geometry.</p>
        ) : (
          <form
            className="import-config"
            onSubmit={(event) => {
              event.preventDefault()
              void apply()
            }}
          >
            <label>
              <span>Link</span>
              <select
                aria-label="Geometry Link"
                onChange={(event) =>
                  setSelectedLinkId(event.currentTarget.value as RobotLinkId)
                }
                value={selected.linkId}
              >
                {links.map(({ linkId }) => (
                  <option key={linkId} value={linkId}>{linkId}</option>
                ))}
              </select>
            </label>
            <p>{selected.sourceFileName}</p>
            <p>
              {selected.statistics.vertices.toLocaleString()} vertices ·{' '}
              {selected.statistics.triangles.toLocaleString()} triangles ·{' '}
              {selected.statistics.meshes} meshes · {selected.statistics.materials} materials
            </p>
            {vectorFields('Geometry', draft.positionMm, (positionMm) =>
              setDraft({ ...draft, positionMm }), ' (mm)')}
            {vectorFields('Rotation', draft.rotationDeg, (rotationDeg) =>
              setDraft({ ...draft, rotationDeg }), ' (deg)')}
            {vectorFields('Scale', draft.scale, (scale) => setDraft({ ...draft, scale }))}
            {vectorFields('Collision center', draft.collisionCenter, (collisionCenter) =>
              setDraft({ ...draft, collisionCenter }), ' (m)')}
            {vectorFields(
              'Collision half extent',
              draft.collisionHalfExtents,
              (collisionHalfExtents) => setDraft({ ...draft, collisionHalfExtents }),
              ' (m)',
            )}
            <label>
              <input
                aria-label="Link visible"
                checked={draft.visible}
                onChange={(event) => setDraft({ ...draft, visible: event.currentTarget.checked })}
                type="checkbox"
              />
              <span>Visible</span>
            </label>
            {error === null ? null : <p role="alert">{error}</p>}
            <footer>
              <button onClick={onClose} type="button">Close</button>
              <button type="submit">Apply geometry</button>
            </footer>
          </form>
        )}
      </section>
    </div>
  )
}
