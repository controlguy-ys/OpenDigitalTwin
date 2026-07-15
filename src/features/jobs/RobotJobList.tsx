import { MoreHorizontal, Plus } from 'lucide-react'
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import {
  MAX_JOBS,
  type ProjectSimulationStateV3,
} from '../../domain/project/simulation-job-v1'
import { projectMutationService } from '../project/project-store-browser'
import { jobCommandService, type JobCommandService } from './job-command-service'

const EMPTY_SIMULATION: ProjectSimulationStateV3 = Object.freeze({
  activeJobId: null,
  jobs: Object.freeze([]),
})

export interface RobotJobListProps {
  readonly commands?: JobCommandService
  readonly simulation?: ProjectSimulationStateV3
}

function publishedSimulation(): ProjectSimulationStateV3 {
  return projectMutationService.readPublished()?.snapshot.simulation ?? EMPTY_SIMULATION
}

function poseCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'Pose' : 'Poses'}`
}

export function RobotJobList({
  commands = jobCommandService,
  simulation: simulationOverride,
}: RobotJobListProps) {
  const published = useSyncExternalStore(
    projectMutationService.subscribe,
    publishedSimulation,
    publishedSimulation,
  )
  const simulation = simulationOverride ?? published
  const [contextJobId, setContextJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [focusedJobId, setFocusedJobId] = useState<string | null>(
    simulation.activeJobId ?? simulation.jobs[0]?.id ?? null,
  )
  const rowRefs = useRef(new Map<string, HTMLButtonElement>())
  const menuItemRefs = useRef<HTMLButtonElement[]>([])
  const contextReturnFocusRef = useRef<HTMLElement | null>(null)
  const newJobRef = useRef<HTMLButtonElement>(null)
  const restoreFocusAfterRemovalRef = useRef(false)

  const run = (operation: () => Promise<unknown>) => {
    setError(null)
    void operation().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : 'Job command failed.')
    })
  }

  const contextJob = simulation.jobs.find(({ id }) => id === contextJobId)
  const jobLimitReached = simulation.jobs.length >= MAX_JOBS
  const reconciledFocusedJobId = simulation.jobs.some(({ id }) => id === focusedJobId)
    ? focusedJobId
    : simulation.jobs.some(({ id }) => id === simulation.activeJobId)
      ? simulation.activeJobId
      : simulation.jobs[0]?.id ?? null

  useEffect(() => {
    if (contextJob === undefined) return
    menuItemRefs.current[0]?.focus()
  }, [contextJob])

  useEffect(() => {
    const focusedJobDisappeared = focusedJobId !== null &&
      !simulation.jobs.some(({ id }) => id === focusedJobId)
    if (focusedJobId !== reconciledFocusedJobId) {
      setFocusedJobId(reconciledFocusedJobId)
    }

    const returnTargetWasRemoved = contextReturnFocusRef.current !== null &&
      !contextReturnFocusRef.current.isConnected
    if (!focusedJobDisappeared &&
      !(restoreFocusAfterRemovalRef.current && returnTargetWasRemoved)) return

    if (reconciledFocusedJobId === null) newJobRef.current?.focus()
    else rowRefs.current.get(reconciledFocusedJobId)?.focus()
    restoreFocusAfterRemovalRef.current = false
  }, [focusedJobId, reconciledFocusedJobId, simulation.jobs])

  const openContextMenu = (jobId: string, returnFocus: HTMLElement) => {
    contextReturnFocusRef.current = returnFocus
    setContextJobId(jobId)
  }

  const closeContextMenu = () => {
    setContextJobId(null)
    contextReturnFocusRef.current?.focus()
  }

  const focusJobAt = (index: number) => {
    const job = simulation.jobs[index]
    if (job === undefined) return
    setFocusedJobId(job.id)
    rowRefs.current.get(job.id)?.focus()
  }

  const handleTreeKey = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = Math.min(index + 1, simulation.jobs.length - 1)
    else if (event.key === 'ArrowUp') nextIndex = Math.max(index - 1, 0)
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = simulation.jobs.length - 1
    if (nextIndex !== null) {
      event.preventDefault()
      focusJobAt(nextIndex)
      return
    }
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault()
      openContextMenu(simulation.jobs[index]!.id, event.currentTarget)
    }
  }

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      closeContextMenu()
      return
    }
    const enabledItems = menuItemRefs.current.filter((item) =>
      item.isConnected && !item.disabled)
    if (enabledItems.length === 0) return
    const currentIndex = enabledItems.indexOf(document.activeElement as HTMLButtonElement)
    let nextIndex: number | null = null
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % enabledItems.length
    else if (event.key === 'ArrowUp') {
      nextIndex = (currentIndex - 1 + enabledItems.length) % enabledItems.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = enabledItems.length - 1
    if (nextIndex === null) return
    event.preventDefault()
    enabledItems[nextIndex]?.focus()
  }

  return (
    <div className="robot-job-list">
      <header>
        <h2>Robot Jobs</h2>
        <button
          disabled={jobLimitReached}
          onClick={() => run(() => commands.createJob(`Job ${simulation.jobs.length + 1}`))}
          ref={newJobRef}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          + New Job
        </button>
        {jobLimitReached ? <p>Project reached the {MAX_JOBS} Job limit.</p> : null}
      </header>
      <div className="robot-job-scroll">
        {simulation.jobs.length === 0 ? (
          <p>No Jobs. Create one to save Robot Poses.</p>
        ) : (
          <ul aria-label="Robot Jobs" role="tree">
            {simulation.jobs.map((job, index) => {
              const count = job.poses.length
              const label = `${job.name}, ${poseCountLabel(count)}`
              return (
                <li key={job.id} role="none">
                  <button
                    aria-label={label}
                    aria-selected={simulation.activeJobId === job.id}
                    className="robot-job-row"
                    onFocus={() => setFocusedJobId(job.id)}
                    onKeyDown={(event) => handleTreeKey(event, index)}
                    onClick={() => run(() => commands.setActiveJob(job.id))}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      openContextMenu(job.id, event.currentTarget)
                    }}
                    ref={(node) => {
                      if (node === null) rowRefs.current.delete(job.id)
                      else rowRefs.current.set(job.id, node)
                    }}
                    role="treeitem"
                    tabIndex={reconciledFocusedJobId === job.id ? 0 : -1}
                    type="button"
                  >
                    <span>{job.name}</span>
                    <small>{poseCountLabel(count)}</small>
                    {simulation.activeJobId === job.id ? <strong>Active</strong> : null}
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
              )
            })}
          </ul>
        )}
      </div>
      {contextJob === undefined ? null : (
        <div
          aria-label={`${contextJob.name} commands`}
          className="robot-job-menu"
          onKeyDown={handleMenuKey}
          role="menu"
        >
          <button
            onClick={() => {
              const name = window.prompt('Job name', contextJob.name)
              closeContextMenu()
              if (name !== null) run(() => commands.renameJob(contextJob.id, name))
            }}
            role="menuitem"
            ref={(node) => {
              if (node !== null) menuItemRefs.current[0] = node
            }}
            type="button"
          >
            Rename
          </button>
          <button
            disabled={jobLimitReached}
            onClick={() => {
              closeContextMenu()
              run(() => commands.duplicateJob(contextJob.id))
            }}
            role="menuitem"
            ref={(node) => {
              if (node !== null) menuItemRefs.current[1] = node
            }}
            type="button"
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              restoreFocusAfterRemovalRef.current = true
              closeContextMenu()
              if (window.confirm(`Delete Job "${contextJob.name}"?`)) {
                run(async () => {
                  try {
                    await commands.deleteJob(contextJob.id)
                  } catch (error) {
                    restoreFocusAfterRemovalRef.current = false
                    throw error
                  }
                })
              } else {
                restoreFocusAfterRemovalRef.current = false
              }
            }}
            role="menuitem"
            ref={(node) => {
              if (node !== null) menuItemRefs.current[2] = node
            }}
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
