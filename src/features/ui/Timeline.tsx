import { ChevronDown, ChevronUp, Pause, Play, Square, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  simulationJointSource,
  type SimulationJointSource,
} from '../joints/SimulationJointSource'
import {
  getTimelineDurationMs,
  sampleTimeline,
  type RobotKeyframe,
} from '../joints/keyframes'
import { useRobotStore } from '../joints/robot-store'
import { jobCommandService, type JobCommandService } from '../jobs/job-command-service'
import { projectMutationService } from '../project/project-store-browser'

export interface TimelineProps {
  disabled?: boolean
  source?: SimulationJointSource
  activeJobId?: string | null
  commands?: Pick<JobCommandService, 'deletePose' | 'movePose' | 'setPoseSpeed'>
}

function publishedActiveJobId(): string | null {
  return projectMutationService.readPublished()?.snapshot.simulation.activeJobId ?? null
}

function isPlaybackQualityBlocked(quality: string): boolean {
  return quality === 'BAD' || quality === 'STALE'
}

function snapshotKeyframes(
  keyframes: readonly RobotKeyframe[],
): readonly RobotKeyframe[] {
  return keyframes.map((keyframe) => ({
    ...keyframe,
    anglesDeg: [
      keyframe.anglesDeg[0],
      keyframe.anglesDeg[1],
      keyframe.anglesDeg[2],
      keyframe.anglesDeg[3],
      keyframe.anglesDeg[4],
      keyframe.anglesDeg[5],
    ],
  }))
}

export function Timeline({
  disabled = false,
  source = simulationJointSource,
  activeJobId: activeJobIdOverride,
  commands = jobCommandService,
}: TimelineProps) {
  const keyframes = useRobotStore((state) => state.keyframes)
  const playing = useRobotStore((state) => state.playing)
  const sourceQuality = useRobotStore((state) => state.sourceQuality)
  const playbackResetRevision = useRobotStore(
    (state) => state.playbackResetRevision,
  )
  const setPlaying = useRobotStore((state) => state.setPlaying)
  const stopPlayback = useRobotStore((state) => state.stopPlayback)
  const publishedJobId = useSyncExternalStore(
    projectMutationService.subscribe,
    publishedActiveJobId,
    publishedActiveJobId,
  )
  const activeJobId = activeJobIdOverride === undefined
    ? publishedJobId
    : activeJobIdOverride
  const frameIdRef = useRef<number | null>(null)
  const generationRef = useRef(0)
  const elapsedMsRef = useRef(0)
  const snapshotRef = useRef<readonly RobotKeyframe[]>([])
  const [positionMs, setPositionMs] = useState(0)

  const cancelScheduledFrame = useCallback(() => {
    generationRef.current += 1
    if (frameIdRef.current !== null) {
      cancelAnimationFrame(frameIdRef.current)
      frameIdRef.current = null
    }
  }, [])

  useEffect(() => {
    cancelScheduledFrame()
    elapsedMsRef.current = 0
    setPositionMs(0)
  }, [cancelScheduledFrame, playbackResetRevision])

  useEffect(() => {
    if (keyframes.length !== 0 || playing) {
      return
    }

    cancelScheduledFrame()
    elapsedMsRef.current = 0
    setPositionMs(0)
  }, [cancelScheduledFrame, keyframes.length, playing])

  useEffect(() => {
    const pauseWhenHidden = () => {
      if (document.hidden) {
        cancelScheduledFrame()
        useRobotStore.getState().setPlaying(false)
      }
    }

    document.addEventListener('visibilitychange', pauseWhenHidden)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
    }
  }, [cancelScheduledFrame])

  useEffect(() => {
    if (!playing) {
      return
    }

    const snapshot = snapshotRef.current
    if (
      disabled ||
      snapshot.length < 2 ||
      isPlaybackQualityBlocked(sourceQuality)
    ) {
      setPlaying(false)
      return
    }

    const durationMs = getTimelineDurationMs(snapshot)
    const startElapsedMs = Math.min(elapsedMsRef.current, durationMs)
    let startTimestampMs: number | null = null
    cancelScheduledFrame()
    const generation = generationRef.current

    const tick = (timestampMs: number) => {
      if (generation !== generationRef.current) {
        return
      }

      const stateBeforeSample = useRobotStore.getState()
      if (
        !stateBeforeSample.playing ||
        isPlaybackQualityBlocked(stateBeforeSample.sourceQuality) ||
        document.hidden
      ) {
        cancelScheduledFrame()
        if (document.hidden && stateBeforeSample.playing) {
          stateBeforeSample.setPlaying(false)
        }
        return
      }

      startTimestampMs ??= timestampMs
      const frameElapsedMs = Math.min(
        startElapsedMs + Math.max(0, timestampMs - startTimestampMs),
        durationMs,
      )
      const sample = sampleTimeline(snapshot, frameElapsedMs)
      const stateBeforePublish = useRobotStore.getState()
      if (
        sample === null ||
        !stateBeforePublish.playing ||
        isPlaybackQualityBlocked(stateBeforePublish.sourceQuality)
      ) {
        cancelScheduledFrame()
        return
      }

      source.setAngles(sample.anglesDeg)
      elapsedMsRef.current = frameElapsedMs
      setPositionMs(frameElapsedMs)

      if (frameElapsedMs >= durationMs) {
        frameIdRef.current = null
        generationRef.current += 1
        useRobotStore.getState().setPlaying(false)
        return
      }

      frameIdRef.current = requestAnimationFrame(tick)
    }

    frameIdRef.current = requestAnimationFrame(tick)
    return cancelScheduledFrame
  }, [cancelScheduledFrame, disabled, playing, setPlaying, source, sourceQuality])

  const qualityBlocked = isPlaybackQualityBlocked(sourceQuality)
  const playDisabled =
    disabled || playing || qualityBlocked || keyframes.length < 2

  const handlePlay = () => {
    if (playDisabled) {
      return
    }

    const snapshot = snapshotKeyframes(keyframes)
    const durationMs = getTimelineDurationMs(snapshot)
    if (elapsedMsRef.current >= durationMs) {
      elapsedMsRef.current = 0
      setPositionMs(0)
    }
    snapshotRef.current = snapshot
    setPlaying(true)
  }

  const handlePause = () => {
    cancelScheduledFrame()
    setPlaying(false)
  }

  const handleStop = () => {
    cancelScheduledFrame()
    stopPlayback()
    elapsedMsRef.current = 0
    setPositionMs(0)
  }

  return (
    <div className="timeline">
      <div className="timeline-header">
        <h2>Timeline</h2>
        <div className="timeline-controls">
          <button
            aria-label="Play"
            disabled={playDisabled}
            onClick={handlePlay}
            title="Play"
            type="button"
          >
            <Play aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
          <button
            aria-label="Pause"
            disabled={disabled || !playing}
            onClick={handlePause}
            title="Pause"
            type="button"
          >
            <Pause aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
          <button
            aria-label="Stop"
            disabled={disabled}
            onClick={handleStop}
            title="Stop"
            type="button"
          >
            <Square aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
        </div>
      </div>
      <div className="timeline-track" data-position-ms={positionMs}>
        <ol aria-label="Timeline">
          {keyframes.map((keyframe, index) => (
            <li className="timeline-pose" key={keyframe.id}>
              <span>{keyframe.name}</span>
              <label>
                Speed
                <input
                  aria-label={`${keyframe.name} speed to next pose`}
                  disabled={disabled || playing || index === keyframes.length - 1}
                  max={100}
                  min={1}
                  onChange={(event) => {
                    if (activeJobId !== null) {
                      void commands.setPoseSpeed(
                        activeJobId,
                        keyframe.id,
                        Number(event.currentTarget.value),
                      )
                    }
                  }}
                  type="number"
                  value={keyframe.speedPercentToNext ?? 100}
                />
                <small>%</small>
              </label>
              <div className="timeline-pose-actions">
                <button
                  aria-label={`Move ${keyframe.name} up`}
                  disabled={disabled || playing || index === 0}
                  onClick={() => {
                    if (activeJobId !== null) {
                      void commands.movePose(activeJobId, keyframe.id, index - 1)
                    }
                  }}
                  type="button"
                >
                  <ChevronUp aria-hidden="true" size={14} />
                </button>
                <button
                  aria-label={`Move ${keyframe.name} down`}
                  disabled={disabled || playing || index === keyframes.length - 1}
                  onClick={() => {
                    if (activeJobId !== null) {
                      void commands.movePose(activeJobId, keyframe.id, index + 1)
                    }
                  }}
                  type="button"
                >
                  <ChevronDown aria-hidden="true" size={14} />
                </button>
                <button
                  aria-label={`Delete ${keyframe.name}`}
                  disabled={disabled || playing}
                  onClick={() => {
                    if (activeJobId !== null) {
                      void commands.deletePose(activeJobId, keyframe.id)
                    }
                  }}
                  type="button"
                >
                  <Trash2 aria-hidden="true" size={14} />
                </button>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
