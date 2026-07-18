import { MoreHorizontal, Play, Plus, Square } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import {
  type RobotIdV4,
  type RobotJobIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type {
  JobRuntimeStoreV4,
  RobotJobRuntimeStateV4,
} from './job-runtime-store.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'

export interface RobotJobListPropsV4 {
  readonly project: WorkcellProjectV4
  readonly selectedRobotId: RobotIdV4 | null
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly commandBindings: AppCommandBindingsV4
  /** Called only after an explicit user row/action selected this exact Job. */
  readonly onExplicitJobSelection?: (robotId: RobotIdV4, jobId: RobotJobIdV4) => void
}

function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

function jobLabel(job: WorkcellProjectV4['jobs'][number]): string {
  const jointPoseCount = job.steps.filter((step) => step.kind === 'joint-pose').length
  return `${job.name}, ${countLabel(job.steps.length, 'step', 'steps')}, ${countLabel(
    jointPoseCount,
    'Joint Pose',
    'Joint Poses',
  )}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Job operation failed.'
}

function useSelectedJobIdV4(
  interaction: StoreApi<InteractionStoreStateV4>,
  robotId: RobotIdV4 | null,
): RobotJobIdV4 | null {
  return useSyncExternalStore(
    interaction.subscribe,
    () => robotId === null
      ? null
      : interaction.getState().selectedJobIdsByRobotId.get(robotId) ?? null,
    () => robotId === null
      ? null
      : interaction.getState().selectedJobIdsByRobotId.get(robotId) ?? null,
  )
}

function useRobotJobRuntimeV4(
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

function canAuthorExactJobV4(
  project: WorkcellProjectV4,
  jobs: StoreApi<JobRuntimeStoreV4>,
  interaction: StoreApi<InteractionStoreStateV4>,
  robotId: RobotIdV4,
  jobId: RobotJobIdV4,
): boolean {
  const interactionState = interaction.getState()
  const runtime = currentRobotRuntimeV4(jobs, project.revisionId, robotId)
  return interactionState.projectRevisionId === project.revisionId
    && interactionState.activeRobotId === robotId
    && runtime !== null
    && runtime.state !== 'RUNNING'
    && project.jobs.some((job) => job.id === jobId && job.robotId === robotId)
}

function canAuthorExactRobotV4(
  project: WorkcellProjectV4,
  jobs: StoreApi<JobRuntimeStoreV4>,
  interaction: StoreApi<InteractionStoreStateV4>,
  robotId: RobotIdV4,
): boolean {
  const interactionState = interaction.getState()
  const runtime = currentRobotRuntimeV4(jobs, project.revisionId, robotId)
  return interactionState.projectRevisionId === project.revisionId
    && interactionState.activeRobotId === robotId
    && runtime !== null
    && runtime.state !== 'RUNNING'
    && project.robots.some((robot) => robot.id === robotId)
}

function canStartExactJobV4(
  project: WorkcellProjectV4,
  jobs: StoreApi<JobRuntimeStoreV4>,
  interaction: StoreApi<InteractionStoreStateV4>,
  robotId: RobotIdV4,
  jobId: RobotJobIdV4 | null,
): jobId is RobotJobIdV4 {
  if (jobId === null || !canAuthorExactJobV4(project, jobs, interaction, robotId, jobId)) return false
  return project.robots.some((robot) => robot.id === robotId && robot.jointSource === 'simulation')
}

function ContextJobCommandV4({
  commandBindings,
  commandId,
  job,
  canInvoke,
  onInvokeTarget,
  onCompleted,
  buttonRef,
  onBeforeInvoke,
  onOutcome,
}: {
  readonly commandBindings: AppCommandBindingsV4
  readonly commandId: 'job.rename' | 'job.duplicate' | 'job.delete'
  readonly job: WorkcellProjectV4['jobs'][number]
  readonly canInvoke: () => boolean
  readonly onInvokeTarget: (robotId: RobotIdV4, jobId: RobotJobIdV4) => void
  readonly onCompleted: () => void
  readonly buttonRef?: (node: HTMLButtonElement | null) => void
  readonly onBeforeInvoke?: () => void
  readonly onOutcome?: (outcome: 'completed' | 'cancelled' | 'ignored' | 'failed') => void
}): ReactNode {
  const bound = useAppCommandV4(commandBindings, commandId)
  const canInvokeNow = (): boolean => {
    const command = commandBindings.getRegistry().get(commandId)
    return canInvoke()
      && command?.visible === true
      && command.enabled === true
      && !commandBindings.runtime.getState().pendingCommandIds.has(commandId)
  }
  const disabled = bound.command?.visible !== true
    || bound.command.enabled !== true
    || bound.pending
    || !canInvoke()
  return (
    <button
      disabled={disabled}
      onClick={() => {
        // The menu can remain mounted while another surface retargets the
        // Interaction store. Re-evaluate every ownership constraint before
        // this row is allowed to select or mutate its captured Job.
        if (!canInvokeNow()) return
        onBeforeInvoke?.()
        onInvokeTarget(job.robotId, job.id)
        void bound.invoke().then((outcome) => {
          onOutcome?.(outcome)
          if (outcome === 'completed') onCompleted()
        })
      }}
      role="menuitem"
      ref={buttonRef}
      type="button"
    >{bound.command?.label ?? commandId}</button>
  )
}

function ContextJobErrorsV4({
  commandBindings,
}: {
  readonly commandBindings: AppCommandBindingsV4
}): ReactNode {
  const rename = useAppCommandV4(commandBindings, 'job.rename')
  const duplicate = useAppCommandV4(commandBindings, 'job.duplicate')
  const remove = useAppCommandV4(commandBindings, 'job.delete')
  const errors = [rename.error, duplicate.error, remove.error].filter(
    (error): error is string => error !== null,
  )
  return errors.length === 0 ? null : <>
    {errors.map((message, index) => (
      <p key={`${index}:${message}`} role="alert">{message}</p>
    ))}
  </>
}

export function RobotJobListV4({
  project,
  selectedRobotId,
  interaction,
  jobs,
  commandBindings,
  onExplicitJobSelection,
}: RobotJobListPropsV4): ReactNode {
  const newJob = useAppCommandV4(commandBindings, 'job.new')
  const startJob = useAppCommandV4(commandBindings, 'job.start')
  const cancelJob = useAppCommandV4(commandBindings, 'job.cancel')
  const selectedJobId = useSelectedJobIdV4(interaction, selectedRobotId)
  const runtime = useRobotJobRuntimeV4(jobs, selectedRobotId)
  const robotJobs = project.jobs.filter((job) => job.robotId === selectedRobotId)
  const selectedJob = robotJobs.find((job) => job.id === selectedJobId) ?? null
  const [contextJobId, setContextJobId] = useState<RobotJobIdV4 | null>(null)
  const [focusedJobId, setFocusedJobId] = useState<RobotJobIdV4 | null>(
    selectedJob?.id ?? robotJobs[0]?.id ?? null,
  )
  const [error, setError] = useState<string | null>(null)
  const rowRefs = useRef(new Map<RobotJobIdV4, HTMLButtonElement>())
  const menuItemRefs = useRef<HTMLButtonElement[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const contextReturnFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterRemovalRef = useRef(false)
  const newJobRef = useRef<HTMLButtonElement>(null)

  const contextJob = robotJobs.find((job) => job.id === contextJobId)
  const reconciledFocusedJobId = robotJobs.some((job) => job.id === focusedJobId)
    ? focusedJobId
    : robotJobs.some((job) => job.id === selectedJobId)
      ? selectedJobId
      : robotJobs[0]?.id ?? null

  const reportSyncFailure = (operation: () => void): void => {
    setError(null)
    try {
      operation()
    } catch (caught) {
      setError(errorMessage(caught))
    }
  }

  const selectExplicitJob = (robotId: RobotIdV4, jobId: RobotJobIdV4): void => {
    reportSyncFailure(() => {
      interaction.getState().selectJob(robotId, jobId)
      onExplicitJobSelection?.(robotId, jobId)
    })
  }

  useEffect(() => {
    if (contextJob === undefined) return
    const firstEnabledItem = menuItemRefs.current.find((item) => (
      item.isConnected && !item.disabled
    ))
    if (firstEnabledItem === undefined) menuRef.current?.focus()
    else firstEnabledItem.focus()
  }, [contextJob])

  useEffect(() => {
    const focusedJobDisappeared = focusedJobId !== null
      && !robotJobs.some((job) => job.id === focusedJobId)
    if (focusedJobId !== reconciledFocusedJobId) {
      setFocusedJobId(reconciledFocusedJobId)
    }
    const contextLauncherWasRemoved = contextReturnFocusRef.current !== null
      && !contextReturnFocusRef.current.isConnected
    if (
      !focusedJobDisappeared
      && !(restoreFocusAfterRemovalRef.current && contextLauncherWasRemoved)
    ) return

    if (reconciledFocusedJobId === null) newJobRef.current?.focus()
    else rowRefs.current.get(reconciledFocusedJobId)?.focus()
    restoreFocusAfterRemovalRef.current = false
  }, [focusedJobId, project.revisionId, reconciledFocusedJobId, robotJobs])

  const openContextMenu = (jobId: RobotJobIdV4, returnFocus: HTMLElement): void => {
    const job = robotJobs.find((candidate) => candidate.id === jobId)
    if (job === undefined) return
    selectExplicitJob(job.robotId, job.id)
    contextReturnFocusRef.current = returnFocus
    setContextJobId(jobId)
  }

  const closeContextMenu = (): void => {
    setContextJobId(null)
    contextReturnFocusRef.current?.focus()
  }

  const focusJobAt = (index: number): void => {
    const job = robotJobs[index]
    if (job === undefined) return
    setFocusedJobId(job.id)
    rowRefs.current.get(job.id)?.focus()
  }

  const handleTreeKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, robotJobs.length - 1)
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = robotJobs.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      focusJobAt(nextIndex)
      return
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      const job = robotJobs[index]
      if (job !== undefined) openContextMenu(job.id, event.currentTarget)
    }
  }

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeContextMenu()
      return
    }
    const enabled = menuItemRefs.current.filter((item) => item.isConnected && !item.disabled)
    if (enabled.length === 0) return
    const currentIndex = enabled.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % enabled.length
    else if (event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + enabled.length) % enabled.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = enabled.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    enabled[nextIndex]?.focus()
  }

  return (
    <div className="robot-job-list robot-job-list-v4">
      <header>
        <h2>Robot Jobs</h2>
        <button
          aria-describedby={newJob.error === null ? undefined : 'robot-job-new-error'}
          disabled={selectedRobotId === null
            || newJob.command?.visible !== true
            || newJob.command.enabled !== true
            || newJob.pending
            || !canAuthorExactRobotV4(project, jobs, interaction, selectedRobotId)}
          onClick={() => {
            if (
              selectedRobotId === null
              || newJob.pending
              || newJob.command?.visible !== true
              || newJob.command.enabled !== true
              || !canAuthorExactRobotV4(project, jobs, interaction, selectedRobotId)
            ) return
            void newJob.invoke().then((outcome) => {
              if (outcome !== 'completed') return
              const current = interaction.getState()
              const jobId = current.selectedJobIdsByRobotId.get(selectedRobotId) ?? null
              if (current.activeRobotId === selectedRobotId && jobId !== null) {
                onExplicitJobSelection?.(selectedRobotId, jobId)
              }
            })
          }}
          ref={newJobRef}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          + New Job
        </button>
        {newJob.error === null ? null : <p id="robot-job-new-error" role="alert">{newJob.error}</p>}
        <button
          aria-label="Start Job"
          aria-describedby={startJob.error === null ? undefined : 'robot-job-start-error'}
          disabled={selectedRobotId === null || startJob.command?.visible !== true || startJob.command.enabled !== true || startJob.pending || !canStartExactJobV4(project, jobs, interaction, selectedRobotId, selectedJobId)}
          onClick={() => {
            const currentStart = commandBindings.getRegistry().get('job.start')
            if (
              selectedRobotId === null
              || currentStart?.visible !== true
              || currentStart.enabled !== true
              || commandBindings.runtime.getState().pendingCommandIds.has('job.start')
            ) return
            const jobId = interaction.getState().selectedJobIdsByRobotId.get(selectedRobotId) ?? null
            if (!canStartExactJobV4(project, jobs, interaction, selectedRobotId, jobId)) return
            selectExplicitJob(selectedRobotId, jobId)
            void commandBindings.runtime.invoke('job.start')
          }}
          title="Start Job"
          type="button"
        >
          <Play aria-hidden="true" size={14} />
        </button>
        {startJob.error === null ? null : <p id="robot-job-start-error" role="alert">{startJob.error}</p>}
        <button
          aria-label="Cancel Job"
          aria-describedby={cancelJob.error === null ? undefined : 'robot-job-cancel-error'}
          disabled={selectedRobotId === null || cancelJob.command?.visible !== true || cancelJob.command.enabled !== true || cancelJob.pending}
          onClick={() => {
            if (selectedRobotId === null || cancelJob.pending || cancelJob.command?.visible !== true || cancelJob.command.enabled !== true) return
            void cancelJob.invoke()
          }}
          title="Cancel Job"
          type="button"
        >
          <Square aria-hidden="true" size={14} />
        </button>
        {cancelJob.error === null ? null : <p id="robot-job-cancel-error" role="alert">{cancelJob.error}</p>}
      </header>
      {selectedRobotId === null ? (
        <div className="robot-job-scroll">
          <p>Select a Robot to view its Jobs.</p>
          <div aria-label="Available Robots" className="robot-job-robot-picker">
            {project.robots.map((robot) => (
              <button
                key={robot.id}
                onClick={() => reportSyncFailure(() => {
                  interaction.getState().activateRobot(robot.id)
                })}
                type="button"
              >
                Control {robot.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="robot-job-scroll">
          {runtime === null ? null : (
            <p aria-label="Robot Job state" role="status">
              {runtime.state}
              {runtime.message.length === 0 ? null : ` — ${runtime.message}`}
            </p>
          )}
          {robotJobs.length === 0 ? (
            <p>No Jobs for the selected Robot.</p>
          ) : (
            <ul aria-label="Robot Jobs" role="tree">
              {robotJobs.map((job, index) => (
                <li key={job.id} role="none">
                  <button
                    aria-label={jobLabel(job)}
                    aria-selected={selectedJobId === job.id}
                    className="robot-job-row"
                    onClick={() => selectExplicitJob(selectedRobotId, job.id)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openContextMenu(job.id, event.currentTarget)
                    }}
                    onFocus={() => setFocusedJobId(job.id)}
                    onKeyDown={(event) => handleTreeKey(event, index)}
                    ref={(node) => {
                      if (node === null) rowRefs.current.delete(job.id)
                      else rowRefs.current.set(job.id, node)
                    }}
                    role="treeitem"
                    tabIndex={reconciledFocusedJobId === job.id ? 0 : -1}
                    type="button"
                  >
                    <span>{job.name}</span>
                    <small>{countLabel(job.steps.length, 'step', 'steps')}</small>
                    <small>
                      {countLabel(
                        job.steps.filter((step) => step.kind === 'joint-pose').length,
                        'Joint Pose',
                        'Joint Poses',
                      )}
                    </small>
                  </button>
                  <button
                    aria-label={`${job.name} commands`}
                    className="robot-job-command"
                    onClick={(event) => openContextMenu(job.id, event.currentTarget)}
                    type="button"
                  >
                    <MoreHorizontal aria-hidden="true" size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {contextJob === undefined ? null : (
        <>
          <div
            aria-label={`${contextJob.name} commands`}
            className="robot-job-menu"
            onKeyDown={handleMenuKey}
            ref={menuRef}
            role="menu"
            tabIndex={-1}
          >
            <ContextJobCommandV4
              canInvoke={() => canAuthorExactJobV4(project, jobs, interaction, contextJob.robotId, contextJob.id)}
              commandBindings={commandBindings}
              commandId="job.rename"
              job={contextJob}
              onCompleted={closeContextMenu}
              onInvokeTarget={selectExplicitJob}
              buttonRef={(node) => { if (node !== null) menuItemRefs.current[0] = node }}
            />
            <ContextJobCommandV4
              canInvoke={() => canAuthorExactJobV4(project, jobs, interaction, contextJob.robotId, contextJob.id)}
              commandBindings={commandBindings}
              commandId="job.duplicate"
              job={contextJob}
              onCompleted={closeContextMenu}
              onInvokeTarget={selectExplicitJob}
              buttonRef={(node) => { if (node !== null) menuItemRefs.current[1] = node }}
            />
            <ContextJobCommandV4
              canInvoke={() => canAuthorExactJobV4(project, jobs, interaction, contextJob.robotId, contextJob.id)}
              commandBindings={commandBindings}
              commandId="job.delete"
              job={contextJob}
              onCompleted={closeContextMenu}
              onInvokeTarget={selectExplicitJob}
              onBeforeInvoke={() => { restoreFocusAfterRemovalRef.current = true }}
              onOutcome={(outcome) => {
                if (outcome !== 'completed') restoreFocusAfterRemovalRef.current = false
              }}
              buttonRef={(node) => { if (node !== null) menuItemRefs.current[2] = node }}
            />
          </div>
          <ContextJobErrorsV4 commandBindings={commandBindings} />
        </>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  )
}
