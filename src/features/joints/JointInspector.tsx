import { Grip, Home as HomeIcon, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  clampJointAngles,
  ZERO_JOINT_ANGLES,
} from '../../domain/robot/joint-frame'
import {
  simulationJointSource,
  type SimulationJointSource,
} from './SimulationJointSource'
import { jointAngleSelectors, useRobotStore } from './robot-store'
import {
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from '../robot/robot-configuration-store'

export interface JointInspectorProps {
  disabled?: boolean
  source?: SimulationJointSource
  onReset?: () => void | Promise<void>
  canSavePose?: boolean
  onSavePose?: () => void | Promise<void>
}

export function JointInspector({
  disabled = false,
  source = simulationJointSource,
  onReset,
  canSavePose = true,
  onSavePose,
}: JointInspectorProps) {
  const j1 = useRobotStore(jointAngleSelectors[0])
  const j2 = useRobotStore(jointAngleSelectors[1])
  const j3 = useRobotStore(jointAngleSelectors[2])
  const j4 = useRobotStore(jointAngleSelectors[3])
  const j5 = useRobotStore(jointAngleSelectors[4])
  const j6 = useRobotStore(jointAngleSelectors[5])
  const stopPlayback = useRobotStore((state) => state.stopPlayback)
  const savePose = useRobotStore((state) => state.savePose)
  const setGripperOpen = useRobotStore((state) => state.setGripperOpen)
  const anglesDeg = [j1, j2, j3, j4, j5, j6] as const
  const [drafts, setDrafts] = useState(() => anglesDeg.map(String))
  const [focusedDraftIndex, setFocusedDraftIndex] = useState<number | null>(null)
  const [dirtyDraftIndex, setDirtyDraftIndex] = useState<number | null>(null)
  const configuration = useRobotConfigurationStore((state) => state.configuration)
  const definition = useMemo(
    () => robotConfigurationToDefinition(configuration),
    [configuration],
  )

  useEffect(() => {
    setDrafts((current) =>
      anglesDeg.map((angleDeg, jointIndex) =>
        jointIndex === dirtyDraftIndex
          ? (current[jointIndex] ?? String(angleDeg))
          : String(angleDeg),
      ),
    )
  }, [dirtyDraftIndex, j1, j2, j3, j4, j5, j6])

  const applyJoint = (
    jointIndex: number,
    angleDeg: number,
    shouldStopPlayback = true,
  ): number => {
    if (shouldStopPlayback) {
      stopPlayback()
    }
    const currentAngles = useRobotStore.getState().anglesDeg
    const nextAngles: [number, number, number, number, number, number] = [
      currentAngles[0],
      currentAngles[1],
      currentAngles[2],
      currentAngles[3],
      currentAngles[4],
      currentAngles[5],
    ]
    nextAngles[jointIndex] = angleDeg
    const clampedAngles = clampJointAngles(nextAngles, definition)
    source.setAngles(clampedAngles)
    return clampedAngles[jointIndex] ?? currentAngles[jointIndex] ?? 0
  }

  const resyncDraft = (jointIndex: number) => {
    const committedAngle = useRobotStore.getState().anglesDeg[jointIndex]
    if (committedAngle === undefined) {
      return
    }

    setDrafts((current) => {
      const next = [...current]
      next[jointIndex] = String(committedAngle)
      return next
    })
  }

  const commitDraft = (jointIndex: number) => {
    const draft = drafts[jointIndex]
    const angleDeg = Number(draft)
    if (draft !== undefined && draft.trim() !== '' && Number.isFinite(angleDeg)) {
      const committedAngle = applyJoint(jointIndex, angleDeg, false)
      setDrafts((current) => {
        const next = [...current]
        next[jointIndex] = String(committedAngle)
        return next
      })
      return
    }

    resyncDraft(jointIndex)
  }

  return (
    <div className="joint-inspector">
      <h2>Inspector</h2>
      <div className="joint-controls">
        {definition.joints.map((joint, jointIndex) => (
          <div className="joint-control" key={joint.id}>
            <label htmlFor={`${joint.id}-range`}>{joint.id}</label>
            <input
              disabled={disabled}
              id={`${joint.id}-range`}
              max={joint.maxDeg}
              min={joint.minDeg}
              onChange={(event) => {
                applyJoint(jointIndex, Number(event.currentTarget.value))
              }}
              step="1"
              type="range"
              value={anglesDeg[jointIndex]}
            />
            <input
              aria-label={joint.id}
              disabled={disabled}
              max={joint.maxDeg}
              min={joint.minDeg}
              onBlur={() => {
                if (
                  focusedDraftIndex === jointIndex &&
                  dirtyDraftIndex === jointIndex
                ) {
                  commitDraft(jointIndex)
                } else {
                  resyncDraft(jointIndex)
                }
                setFocusedDraftIndex(null)
                setDirtyDraftIndex(null)
              }}
              onChange={(event) => {
                const value = event.currentTarget.value
                setDirtyDraftIndex(jointIndex)
                setDrafts((current) => {
                  const next = [...current]
                  next[jointIndex] = value
                  return next
                })
              }}
              onFocus={() => {
                stopPlayback()
                setFocusedDraftIndex(jointIndex)
                setDirtyDraftIndex(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
              step="1"
              type="number"
              value={drafts[jointIndex] ?? ''}
            />
          </div>
        ))}
      </div>
      <div className="inspector-actions">
        <button
          disabled={disabled}
          onClick={() => {
            stopPlayback()
            source.setAngles(ZERO_JOINT_ANGLES)
          }}
          type="button"
        >
          <HomeIcon aria-hidden="true" size={16} strokeWidth={1.75} />
          Home
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            stopPlayback()
            const finishReset = () => {
              setGripperOpen(true)
              source.setAngles(ZERO_JOINT_ANGLES)
            }
            const interactionReset = onReset?.()
            if (interactionReset instanceof Promise) {
              void interactionReset.then(finishReset)
            } else {
              finishReset()
            }
          }}
          type="button"
        >
          <RotateCcw aria-hidden="true" size={16} strokeWidth={1.75} />
          Reset
        </button>
        <button
          disabled={disabled || !canSavePose}
          onClick={() => {
            const result = onSavePose?.()
            if (onSavePose === undefined) savePose()
            else if (result instanceof Promise) void result.catch(() => undefined)
          }}
          type="button"
        >
          <Save aria-hidden="true" size={16} strokeWidth={1.75} />
          Save Pose
        </button>
        {canSavePose ? null : (
          <p className="save-pose-hint">Create a Job in Robot Jobs to save a Pose.</p>
        )}
        <button
          disabled={disabled}
          onClick={() => {
            setGripperOpen(true)
          }}
          type="button"
        >
          <Grip aria-hidden="true" size={16} strokeWidth={1.75} />
          Open Gripper
        </button>
        <button
          disabled={disabled}
          onClick={() => {
            setGripperOpen(false)
          }}
          type="button"
        >
          <Grip aria-hidden="true" size={16} strokeWidth={1.75} />
          Close Gripper
        </button>
      </div>
    </div>
  )
}
