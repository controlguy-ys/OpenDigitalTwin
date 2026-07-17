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
  MAX_JOBS_V4,
  type RobotIdV4,
  type RobotJobIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import { robotIdFromSceneSelectionV4 } from '../../interaction/v4/scene-selection.js'
import type { JobCommandServiceV4 } from './job-command-service.js'
import type {
  JobRuntimeStoreV4,
  RobotJobRuntimeStateV4,
} from './job-runtime-store.js'
import type { RobotJobPlaybackControllerV4 } from './simulation-clock.js'

export interface RobotJobListPropsV4 {
  readonly project: WorkcellProjectV4
  readonly selectedRobotId: RobotIdV4 | null
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly commands: JobCommandServiceV4
  readonly playback: RobotJobPlaybackControllerV4
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

export function RobotJobListV4({
  project,
  selectedRobotId,
  interaction,
  jobs,
  commands,
  playback,
}: RobotJobListPropsV4): ReactNode {
  const selectedJobId = useSelectedJobIdV4(interaction, selectedRobotId)
  const runtime = useRobotJobRuntimeV4(jobs, selectedRobotId)
  const robotJobs = project.jobs.filter((job) => job.robotId === selectedRobotId)
  const selectedJob = robotJobs.find((job) => job.id === selectedJobId) ?? null
  const [contextJobId, setContextJobId] = useState<RobotJobIdV4 | null>(null)
  const [focusedJobId, setFocusedJobId] = useState<RobotJobIdV4 | null>(
    selectedJob?.id ?? robotJobs[0]?.id ?? null,
  )
  const [pendingCommand, setPendingCommand] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingCommandTokenRef = useRef<symbol | null>(null)
  const playbackCommandTokenRef = useRef<symbol | null>(null)
  const rowRefs = useRef(new Map<RobotJobIdV4, HTMLButtonElement>())
  const menuItemRefs = useRef<HTMLButtonElement[]>([])
  const menuRef = useRef<HTMLDivElement>(null)
  const contextReturnFocusRef = useRef<HTMLElement | null>(null)
  const restoreFocusAfterRemovalRef = useRef(false)
  const newJobRef = useRef<HTMLButtonElement>(null)

  const running = runtime?.state === 'RUNNING'
  const authoringLocked = running || pendingCommand !== null
  const jobLimitReached = project.jobs.length >= MAX_JOBS_V4
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

  const runPlaybackCommand = (key: string, operation: () => unknown): void => {
    if (playbackCommandTokenRef.current !== null) return
    const token = Symbol(key)
    playbackCommandTokenRef.current = token
    setError(null)
    const release = (): void => {
      if (playbackCommandTokenRef.current === token) {
        playbackCommandTokenRef.current = null
      }
    }
    try {
      void Promise.resolve(operation())
        .catch((caught: unknown) => {
          if (playbackCommandTokenRef.current === token) {
            setError(errorMessage(caught))
          }
        })
        .finally(release)
    } catch (caught) {
      if (playbackCommandTokenRef.current === token) setError(errorMessage(caught))
      release()
    }
  }

  const isCurrentRobotSelection = (robotId: RobotIdV4): boolean => {
    const state = interaction.getState()
    return state.projectRevisionId === project.revisionId
      && robotIdFromSceneSelectionV4(state.selection) === robotId
  }

  const canAuthorRobot = (robotId: RobotIdV4, jobId?: RobotJobIdV4): boolean => {
    const currentRuntime = currentRobotRuntimeV4(jobs, project.revisionId, robotId)
    return isCurrentRobotSelection(robotId)
      && currentRuntime !== null
      && currentRuntime.state !== 'RUNNING'
      && (jobId === undefined || project.jobs.some((job) => (
        job.id === jobId && job.robotId === robotId
      )))
  }

  const runAuthoringCommand = async (
    key: string,
    robotId: RobotIdV4,
    operation: () => Promise<void>,
    jobId?: RobotJobIdV4,
  ): Promise<void> => {
    if (
      pendingCommandTokenRef.current !== null
      || !canAuthorRobot(robotId, jobId)
    ) return
    const token = Symbol(key)
    pendingCommandTokenRef.current = token
    setPendingCommand(key)
    setError(null)
    try {
      await operation()
    } catch (caught) {
      setError(errorMessage(caught))
    } finally {
      if (pendingCommandTokenRef.current === token) {
        pendingCommandTokenRef.current = null
        setPendingCommand(null)
      }
    }
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
          disabled={selectedRobotId === null || authoringLocked || jobLimitReached}
          onClick={() => {
            if (selectedRobotId === null) return
            const name = `Job ${robotJobs.length + 1}`
            void runAuthoringCommand('create', selectedRobotId, async () => {
              const createdJobId = await commands.createJob(selectedRobotId, name)
              interaction.getState().selectJob(selectedRobotId, createdJobId)
            })
          }}
          ref={newJobRef}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          + New Job
        </button>
        <button
          aria-label="Start Job"
          disabled={selectedJob === null || authoringLocked}
          onClick={() => {
            if (
              selectedRobotId === null
              || pendingCommandTokenRef.current !== null
              || !isCurrentRobotSelection(selectedRobotId)
            ) return
            const currentRuntime = currentRobotRuntimeV4(
              jobs,
              project.revisionId,
              selectedRobotId,
            )
            if (currentRuntime === null || currentRuntime.state === 'RUNNING') return
            const currentJobId = interaction.getState()
              .selectedJobIdsByRobotId.get(selectedRobotId) ?? null
            const currentJob = project.jobs.find((job) => (
              job.id === currentJobId && job.robotId === selectedRobotId
            ))
            if (currentJob === undefined) return
            runPlaybackCommand('start', () => playback.startJob(currentJob.id))
          }}
          title="Start Job"
          type="button"
        >
          <Play aria-hidden="true" size={14} />
        </button>
        <button
          aria-label="Cancel Job"
          disabled={selectedRobotId === null || !running}
          onClick={() => {
            if (selectedRobotId === null || !isCurrentRobotSelection(selectedRobotId)) return
            const currentRuntime = currentRobotRuntimeV4(
              jobs,
              project.revisionId,
              selectedRobotId,
            )
            if (currentRuntime?.state !== 'RUNNING') return
            runPlaybackCommand('cancel', () => (
              playback.cancelRobotJob(selectedRobotId, 'Operator cancelled Job.')
            ))
          }}
          title="Cancel Job"
          type="button"
        >
          <Square aria-hidden="true" size={14} />
        </button>
      </header>
      {selectedRobotId === null ? (
        <div className="robot-job-scroll">
          <p>Select a Robot to view its Jobs.</p>
          <div aria-label="Available Robots" className="robot-job-robot-picker">
            {project.robots.map((robot) => (
              <button
                key={robot.id}
                onClick={() => reportSyncFailure(() => {
                  interaction.getState().select({ kind: 'robot', robotId: robot.id })
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
          {pendingCommand === null ? null : <p aria-live="polite">Updating Job…</p>}
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
                    onClick={() => reportSyncFailure(() => {
                      interaction.getState().selectJob(selectedRobotId, job.id)
                    })}
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
        <div
          aria-label={`${contextJob.name} commands`}
          className="robot-job-menu"
          onKeyDown={handleMenuKey}
          ref={menuRef}
          role="menu"
          tabIndex={-1}
        >
          <button
            disabled={authoringLocked}
            onClick={() => {
              void runAuthoringCommand(
                `rename:${contextJob.id}`,
                contextJob.robotId,
                async () => {
                  const name = window.prompt('Job name', contextJob.name)
                  closeContextMenu()
                  if (name !== null) await commands.renameJob(contextJob.id, name)
                },
                contextJob.id,
              )
            }}
            ref={(node) => { if (node !== null) menuItemRefs.current[0] = node }}
            role="menuitem"
            type="button"
          >
            Rename
          </button>
          <button
            disabled={authoringLocked || jobLimitReached}
            onClick={() => {
              closeContextMenu()
              void runAuthoringCommand(
                `duplicate:${contextJob.id}`,
                contextJob.robotId,
                async () => { await commands.duplicateJob(contextJob.id) },
                contextJob.id,
              )
            }}
            ref={(node) => { if (node !== null) menuItemRefs.current[1] = node }}
            role="menuitem"
            type="button"
          >
            Duplicate
          </button>
          <button
            disabled={authoringLocked}
            onClick={() => {
              void runAuthoringCommand(
                `delete:${contextJob.id}`,
                contextJob.robotId,
                async () => {
                  closeContextMenu()
                  if (window.confirm(`Delete Job "${contextJob.name}"?`)) {
                    restoreFocusAfterRemovalRef.current = true
                    try {
                      await commands.deleteJob(contextJob.id)
                    } catch (caught) {
                      restoreFocusAfterRemovalRef.current = false
                      throw caught
                    }
                  } else {
                    restoreFocusAfterRemovalRef.current = false
                  }
                },
                contextJob.id,
              )
            }}
            ref={(node) => { if (node !== null) menuItemRefs.current[2] = node }}
            role="menuitem"
            type="button"
          >
            Delete
          </button>
        </div>
      )}
      {error === null ? null : <p role="alert">{error}</p>}
    </div>
  )
}
