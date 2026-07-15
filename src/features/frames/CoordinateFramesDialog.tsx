import { useEffect, useMemo, useState } from 'react'
import { MathUtils } from 'three'
import {
  IDENTITY_POSE,
  matrix4ToPose3D,
  quaternionToRpy,
  rpyToQuaternion,
  serializableTransformToPose3D,
  type Pose3D,
} from '../../domain/frames/pose3d'
import { useRobotStore } from '../joints/robot-store'
import type { RobotRigRegistration } from '../robot/RobotModel'
import { usePublishedSceneRuntime } from '../scene/scene-runtime-selector'
import { useCoordinateFrameStore } from './coordinate-frame-store'

type FrameId = 'world' | 'mcp' | 'base' | 'flange' | 'tcp'
type Vector3Draft = [number, number, number]

interface CoordinateFramesDialogProps {
  open: boolean
  onClose(): void
  rig: RobotRigRegistration | null
}

interface FrameDraft {
  positionMm: Vector3Draft
  rotationDeg: Vector3Draft
}

const FRAME_OPTIONS: readonly { id: FrameId; label: string; reference: string }[] = [
  { id: 'world', label: 'World', reference: 'Root / fixed' },
  { id: 'mcp', label: 'MCP', reference: 'Relative to World' },
  { id: 'base', label: 'Robot Base', reference: 'Relative to MCP' },
  { id: 'flange', label: 'Flange', reference: 'World pose / derived from joints' },
  { id: 'tcp', label: 'TCP', reference: 'Relative to Flange' },
]

function poseToDraft(pose: Pose3D): FrameDraft {
  return {
    positionMm: pose.position.map((value) => value * 1000) as Vector3Draft,
    rotationDeg: quaternionToRpy(pose.quaternion).map(MathUtils.radToDeg) as Vector3Draft,
  }
}

function draftToPose(draft: FrameDraft): Pose3D {
  return {
    position: draft.positionMm.map((value) => value / 1000) as Vector3Draft,
    quaternion: rpyToQuaternion(
      draft.rotationDeg.map(MathUtils.degToRad) as Vector3Draft,
    ),
  }
}

function updateTuple(tuple: Vector3Draft, index: number, value: number): Vector3Draft {
  const next: Vector3Draft = [...tuple]
  next[index] = value
  return next
}

export function CoordinateFramesDialog({ open, onClose, rig }: CoordinateFramesDialogProps) {
  const frames = useCoordinateFrameStore((state) => state.frames)
  const setFramePose = useCoordinateFrameStore((state) => state.setFramePose)
  const sceneRuntime = usePublishedSceneRuntime()
  const anglesDeg = useRobotStore((state) => state.anglesDeg)
  const [selectedFrame, setSelectedFrame] = useState<FrameId>('mcp')
  const [draft, setDraft] = useState<FrameDraft>(() =>
    poseToDraft(serializableTransformToPose3D(frames.mcp)),
  )
  const [error, setError] = useState<string | null>(null)

  const selectedOption = FRAME_OPTIONS.find(({ id }) => id === selectedFrame)!
  const editable = selectedFrame === 'mcp' || selectedFrame === 'tcp'

  const selectedPose = useMemo((): Pose3D => {
    if (selectedFrame === 'world') return IDENTITY_POSE
    if (selectedFrame === 'mcp' || selectedFrame === 'tcp') {
      return serializableTransformToPose3D(frames[selectedFrame])
    }
    if (selectedFrame === 'base') {
      const pose = sceneRuntime.robot?.localPose
      return pose === undefined
        ? IDENTITY_POSE
        : { position: pose.positionM, quaternion: pose.quaternion }
    }
    if (rig === null) return IDENTITY_POSE
    rig.toolFrame.updateWorldMatrix(true, false)
    return matrix4ToPose3D(rig.toolFrame.matrixWorld)
  }, [anglesDeg, frames, rig, sceneRuntime.robot, selectedFrame])

  useEffect(() => {
    if (!open) return
    setDraft(poseToDraft(selectedPose))
    setError(null)
  }, [open, selectedFrame, selectedPose])

  if (!open) return null

  const apply = () => {
    const values = [...draft.positionMm, ...draft.rotationDeg]
    if (values.some((value) => !Number.isFinite(value))) {
      setError('Frame values must be finite.')
      return
    }
    const pose = draftToPose(draft)
    if (selectedFrame === 'mcp' || selectedFrame === 'tcp') {
      setFramePose(selectedFrame, pose)
    }
    setError(null)
  }

  const vectorFields = (
    label: string,
    values: Vector3Draft,
    update: (values: Vector3Draft) => void,
    unit: string,
  ) => (
    <fieldset>
      <legend>{label}</legend>
      {(['X', 'Y', 'Z'] as const).map((axis, index) => (
        <label key={axis}>
          <span>{axis}</span>
          <input
            aria-label={`${label} ${axis} (${unit})`}
            disabled={!editable}
            onChange={(event) => update(updateTuple(values, index, event.currentTarget.valueAsNumber))}
            step="any"
            type="number"
            value={values[index]}
          />
        </label>
      ))}
    </fieldset>
  )

  return (
    <div aria-labelledby="coordinate-frames-title" aria-modal="true" className="import-step-backdrop" role="dialog">
      <section className="import-step-dialog coordinate-frames-dialog">
        <header>
          <div>
            <p>Workcell coordinate system</p>
            <h2 id="coordinate-frames-title">Coordinate Frames</h2>
          </div>
          <button aria-label="Close Coordinate Frames" onClick={onClose} type="button">Close</button>
        </header>
        <form className="import-config" onSubmit={(event) => { event.preventDefault(); apply() }}>
          <label>
            <span>Frame</span>
            <select aria-label="Coordinate frame" onChange={(event) => setSelectedFrame(event.currentTarget.value as FrameId)} value={selectedFrame}>
              {FRAME_OPTIONS.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <p><strong>Reference:</strong> {selectedOption.reference}</p>
          {selectedFrame === 'base' ? <p>Robot Base is edited in the Scene Inspector.</p> : null}
          {selectedFrame === 'flange' && rig === null ? <p>Robot rig is not ready.</p> : null}
          {vectorFields('Position', draft.positionMm, (positionMm) => setDraft({ ...draft, positionMm }), 'mm')}
          {vectorFields('Rotation', draft.rotationDeg, (rotationDeg) => setDraft({ ...draft, rotationDeg }), 'deg')}
          {error === null ? null : <p role="alert">{error}</p>}
          <footer>
            <button onClick={onClose} type="button">Close</button>
            <button disabled={!editable} type="submit">Apply frame</button>
          </footer>
        </form>
      </section>
    </div>
  )
}
