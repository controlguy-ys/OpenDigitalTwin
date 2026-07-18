import { ChevronDown, ChevronUp, Play, Square, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import type {
  RobotIdV4,
  RobotJobIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import type {
  JobRuntimeStoreV4,
  RobotJobRuntimeStateV4,
} from '../../jobs/v4/job-runtime-store.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'

export interface TimelinePropsV4 {
  readonly project: WorkcellProjectV4
  readonly robotId: RobotIdV4 | null
  readonly jobId: RobotJobIdV4 | null
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly commands: JobCommandServiceV4
  readonly commandBindings: AppCommandBindingsV4
  readonly disabled?: boolean
}

function useRobotRuntimeV4(
  jobs: StoreApi<JobRuntimeStoreV4>,
  robotId: RobotIdV4 | null,
): RobotJobRuntimeStateV4 | null {
  return useSyncExternalStore(
    jobs.subscribe,
    () => robotId !== null && Object.hasOwn(jobs.getState().byRobotId, robotId)
      ? jobs.getState().byRobotId[robotId] ?? null
      : null,
    () => robotId !== null && Object.hasOwn(jobs.getState().byRobotId, robotId)
      ? jobs.getState().byRobotId[robotId] ?? null
      : null,
  )
}

function currentRobotRuntimeV4(
  jobs: StoreApi<JobRuntimeStoreV4>,
  projectRevisionId: WorkcellProjectV4['revisionId'],
  robotId: RobotIdV4,
): RobotJobRuntimeStateV4 | null {
  const state = jobs.getState()
  if (
    state.projectRevisionId !== projectRevisionId
    || !Object.hasOwn(state.byRobotId, robotId)
  ) return null
  const runtime = state.byRobotId[robotId]
  return runtime?.robotId === robotId ? runtime : null
}

function messageForError(error: unknown): string {
  return error instanceof Error ? error.message : 'Job operation failed.'
}

export function TimelineV4({
  project,
  robotId,
  jobId,
  jobs,
  commands,
  commandBindings,
  disabled = false,
}: TimelinePropsV4): ReactNode {
  const startJob = useAppCommandV4(commandBindings, 'job.start')
  const cancelJob = useAppCommandV4(commandBindings, 'job.cancel')
  const runtime = useRobotRuntimeV4(jobs, robotId)
  const job = project.jobs.find((candidate) => (
    candidate.id === jobId && candidate.robotId === robotId
  )) ?? null
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingCommandTokenRef = useRef<symbol | null>(null)
  const stepElementsRef = useRef(new Map<number, HTMLLIElement>())
  const running = runtime?.state === 'RUNNING'
  const authoringDisabled = disabled || running || pendingCommand !== null
  const startBlockedByAuthoring = authoringDisabled || pendingCommandTokenRef.current !== null

  const canAuthorCurrentJob = (): boolean => {
    if (disabled || robotId === null || job === null || job.id !== jobId) return false
    const currentRuntime = currentRobotRuntimeV4(jobs, project.revisionId, robotId)
    return currentRuntime !== null && currentRuntime.state !== 'RUNNING'
  }

  const runAuthoringCommand = async (
    key: string,
    operation: () => Promise<void>,
  ): Promise<void> => {
    if (pendingCommandTokenRef.current !== null || !canAuthorCurrentJob()) return
    const token = Symbol(key)
    pendingCommandTokenRef.current = token
    setPendingCommand(key)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(messageForError(caught))
    } finally {
      if (pendingCommandTokenRef.current === token) {
        pendingCommandTokenRef.current = null
        setPendingCommand(null)
      }
    }
  }

  const totalSteps = job?.steps.length ?? 0
  const runtimeStep = runtime !== null
    && runtime.jobId === job?.id
    && runtime.stepIndex !== null
    ? runtime.stepIndex
    : null
  const displayedRuntimeStep = runtimeStep === null || totalSteps === 0
    ? null
    : Math.min(runtimeStep, totalSteps - 1)

  useEffect(() => {
    if (displayedRuntimeStep === null || job === null) return
    const stepElement = stepElementsRef.current.get(displayedRuntimeStep)
    if (typeof stepElement?.scrollIntoView !== 'function') return
    stepElement.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    })
  }, [displayedRuntimeStep, job?.id])

  return (
    <div className="timeline timeline-v4">
      <div className="timeline-header">
        <h2>Timeline</h2>
        <div className="timeline-controls">
          <button
            aria-label="Start Job"
            aria-describedby={startJob.error === null ? undefined : 'timeline-start-error'}
            disabled={startBlockedByAuthoring
              || startJob.command?.visible !== true
              || startJob.command.enabled !== true
              || startJob.pending}
            onClick={() => {
              const currentStart = commandBindings.getRegistry().get('job.start')
              if (
                pendingCommandTokenRef.current !== null
                || !canAuthorCurrentJob()
                || currentStart?.visible !== true
                || currentStart.enabled !== true
                || commandBindings.runtime.getState().pendingCommandIds.has('job.start')
              ) return
              void commandBindings.runtime.invoke('job.start')
            }}
            title="Start Job"
            type="button"
          >
            <Play aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
          {startJob.error === null ? null : <p id="timeline-start-error" role="alert">{startJob.error}</p>}
          <button
            aria-label="Stop Job"
            aria-describedby={cancelJob.error === null ? undefined : 'timeline-cancel-error'}
            disabled={disabled || cancelJob.command?.visible !== true || cancelJob.command.enabled !== true || cancelJob.pending}
            onClick={() => {
              if (disabled || cancelJob.pending || cancelJob.command?.visible !== true || cancelJob.command.enabled !== true) return
              void cancelJob.invoke()
            }}
            title="Stop Job"
            type="button"
          >
            <Square aria-hidden="true" size={16} strokeWidth={1.75} />
          </button>
          {cancelJob.error === null ? null : <p id="timeline-cancel-error" role="alert">{cancelJob.error}</p>}
        </div>
      </div>
      {runtime === null ? null : (
        <p aria-label="Timeline runtime" role="status">
          {runtime.state}
          {displayedRuntimeStep === null
            ? null
            : ` · Step ${displayedRuntimeStep + 1} of ${totalSteps}`}
          {runtime.message.length === 0 ? null : ` · ${runtime.message}`}
        </p>
      )}
      {job === null ? (
        <p>No Job selected for this Robot.</p>
      ) : (
        <div className="timeline-track">
          <ol aria-label="Job steps">
            {job.steps.map((step, index) => {
              const hasLaterJointPose = step.kind === 'joint-pose'
                && job.steps.slice(index + 1).some((candidate) => candidate.kind === 'joint-pose')
              return (
                <li
                  aria-current={displayedRuntimeStep === index ? 'step' : undefined}
                  className="timeline-pose"
                  key={`${job.id}:${index}`}
                  ref={(node) => {
                    if (node === null) stepElementsRef.current.delete(index)
                    else stepElementsRef.current.set(index, node)
                  }}
                >
                  <span>Step {index + 1}</span>
                  {step.kind === 'joint-pose' ? (
                    <>
                      <strong>Joint Pose</strong>
                      <small>{Object.keys(step.jointValues).length} Joints</small>
                      <label>
                        Speed
                        <input
                          aria-label={`Step ${index + 1} speed to next Joint Pose`}
                          disabled={authoringDisabled || !hasLaterJointPose}
                          max={100}
                          min={1}
                          onChange={(event) => {
                            const speed = Number(event.currentTarget.value)
                            void runAuthoringCommand(`speed:${index}`, () => (
                              commands.setJointPoseSpeed(job.id, index, speed)
                            ))
                          }}
                          type="number"
                          value={step.speedPercentToNext}
                        />
                        <small>%</small>
                      </label>
                    </>
                  ) : (
                    <strong>Action {step.actionId}</strong>
                  )}
                  <div className="timeline-pose-actions">
                    <button
                      aria-label={`Move step ${index + 1} up`}
                      disabled={authoringDisabled || index === 0}
                      onClick={() => {
                        void runAuthoringCommand(`move-up:${index}`, () => (
                          commands.moveStep(job.id, index, -1)
                        ))
                      }}
                      type="button"
                    >
                      <ChevronUp aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`Move step ${index + 1} down`}
                      disabled={authoringDisabled || index === job.steps.length - 1}
                      onClick={() => {
                        void runAuthoringCommand(`move-down:${index}`, () => (
                          commands.moveStep(job.id, index, 1)
                        ))
                      }}
                      type="button"
                    >
                      <ChevronDown aria-hidden="true" size={14} />
                    </button>
                    <button
                      aria-label={`Delete step ${index + 1}`}
                      disabled={authoringDisabled}
                      onClick={() => {
                        void runAuthoringCommand(
                          `delete:${index}`,
                          () => commands.deleteStep(job.id, index),
                        )
                      }}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </div>
      )}
      {pendingCommand === null ? null : <p aria-live="polite">Updating Job…</p>}
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  )
}
