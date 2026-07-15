import { MoreHorizontal, Plus } from 'lucide-react'
import { useState, useSyncExternalStore } from 'react'
import type { ProjectSimulationStateV3 } from '../../domain/project/simulation-job-v1'
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

  const run = (operation: () => Promise<unknown>) => {
    setError(null)
    void operation().catch((nextError: unknown) => {
      setError(nextError instanceof Error ? nextError.message : 'Job command failed.')
    })
  }

  const contextJob = simulation.jobs.find(({ id }) => id === contextJobId)

  return (
    <div className="robot-job-list">
      <header>
        <h2>Robot Jobs</h2>
        <button
          onClick={() => run(() => commands.createJob(`Job ${simulation.jobs.length + 1}`))}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />
          + New Job
        </button>
      </header>
      <div className="robot-job-scroll">
        {simulation.jobs.length === 0 ? (
          <p>No Jobs. Create one to save Robot Poses.</p>
        ) : (
          <ul aria-label="Robot Jobs" role="tree">
            {simulation.jobs.map((job) => {
              const count = job.poses.length
              const label = `${job.name}, ${poseCountLabel(count)}`
              return (
                <li key={job.id} role="none">
                  <button
                    aria-label={label}
                    aria-selected={simulation.activeJobId === job.id}
                    className="robot-job-row"
                    onClick={() => run(() => commands.setActiveJob(job.id))}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      setContextJobId(job.id)
                    }}
                    role="treeitem"
                    type="button"
                  >
                    <span>{job.name}</span>
                    <small>{poseCountLabel(count)}</small>
                    {simulation.activeJobId === job.id ? <strong>Active</strong> : null}
                  </button>
                  <button
                    aria-label={`${job.name} commands`}
                    className="robot-job-command"
                    onClick={() => setContextJobId(job.id)}
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
        <div aria-label={`${contextJob.name} commands`} className="robot-job-menu" role="menu">
          <button
            onClick={() => {
              const name = window.prompt('Job name', contextJob.name)
              setContextJobId(null)
              if (name !== null) run(() => commands.renameJob(contextJob.id, name))
            }}
            role="menuitem"
            type="button"
          >
            Rename
          </button>
          <button
            onClick={() => {
              setContextJobId(null)
              run(() => commands.duplicateJob(contextJob.id))
            }}
            role="menuitem"
            type="button"
          >
            Duplicate
          </button>
          <button
            onClick={() => {
              setContextJobId(null)
              if (window.confirm(`Delete Job "${contextJob.name}"?`)) {
                run(() => commands.deleteJob(contextJob.id))
              }
            }}
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
