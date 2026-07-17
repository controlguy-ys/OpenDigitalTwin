import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type {
  RobotDefinitionV4,
  RobotIdV4,
  RobotJointDefinitionV4,
  RobotJobIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import type {
  JobRuntimeStoreV4,
  RobotJobRuntimeStateV4,
} from '../../jobs/v4/job-runtime-store.js'
import type {
  RobotJointWriterV4,
  RobotRuntimeRegistryV4,
  RobotRuntimeStateV4,
} from '../../robot/v4/robot-runtime-registry.js'
import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

export interface JointInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly robotId: RobotIdV4
  readonly selectedJobId: RobotJobIdV4 | null
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly commands: JobCommandServiceV4
}

type JointDraftsV4 = Record<string, string>

function createOwnRecordV4<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>
}

function defineOwnValueV4<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  })
}

function createJointValueRecordV4(
  joints: readonly RobotJointDefinitionV4[],
  readValue: (joint: RobotJointDefinitionV4) => number,
): Readonly<Record<string, number>> {
  const values = createOwnRecordV4<number>()
  for (const joint of joints) {
    defineOwnValueV4(values, joint.id, readValue(joint))
  }
  return values
}

function createPartialJointValueV4(
  jointId: string,
  value: number,
): Readonly<Record<string, number>> {
  const values = createOwnRecordV4<number>()
  defineOwnValueV4(values, jointId, value)
  return values
}

function liveJointValueV4(runtime: RobotRuntimeStateV4 | null, jointId: string): number {
  if (runtime === null || !Object.hasOwn(runtime.jointValues, jointId)) {
    return 0
  }
  return runtime.jointValues[jointId]!
}

function createJointDraftsV4(
  definition: RobotDefinitionV4 | null,
  runtime: RobotRuntimeStateV4 | null,
  current: JointDraftsV4 | null = null,
  retainedJointId: string | null = null,
): JointDraftsV4 {
  const drafts = createOwnRecordV4<string>()
  if (definition === null) return drafts

  for (const joint of definition.joints) {
    const retain = retainedJointId === joint.id
      && current !== null
      && Object.hasOwn(current, joint.id)
    defineOwnValueV4(
      drafts,
      joint.id,
      retain ? current[joint.id]! : String(liveJointValueV4(runtime, joint.id)),
    )
  }
  return drafts
}

function selectedRuntimeV4(
  state: RobotRuntimeRegistryV4,
  robotId: RobotIdV4,
): RobotRuntimeStateV4 | null {
  return Object.hasOwn(state.robots, robotId) ? state.robots[robotId]! : null
}

function selectedJobRuntimeV4(
  state: JobRuntimeStoreV4,
  robotId: RobotIdV4,
): RobotJobRuntimeStateV4 | null {
  return Object.hasOwn(state.byRobotId, robotId) ? state.byRobotId[robotId]! : null
}

function allowedWriterAtActionV4(
  robots: StoreApi<RobotRuntimeRegistryV4>,
  jobs: StoreApi<JobRuntimeStoreV4>,
  robotId: RobotIdV4,
): RobotJointWriterV4 | null {
  const runtime = selectedRuntimeV4(robots.getState(), robotId)
  const writer = runtime?.jointSource ?? null
  if (writer === 'manual') return 'manual'
  const running = selectedJobRuntimeV4(jobs.getState(), robotId)?.state === 'RUNNING'
  return writer === 'simulation' && !running ? 'simulation' : null
}

function writerLabelV4(writer: RobotJointWriterV4 | null): string {
  if (writer === null) return 'Source: unavailable'
  if (writer.startsWith('opcua:')) {
    return `Source: OPC UA (${writer.slice('opcua:'.length)})`
  }
  return `Source: ${writer}`
}

function displayStepV4(joint: RobotJointDefinitionV4): number {
  return joint.type === 'prismatic' ? 0.001 : 1
}

function displayUnitV4(joint: RobotJointDefinitionV4): 'm' | 'deg' {
  return joint.type === 'prismatic' ? 'm' : 'deg'
}

function errorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'The Robot command was rejected.'
}

export function JointInspectorV4({
  project,
  robotId,
  selectedJobId,
  robots,
  jobs,
  commands,
}: JointInspectorPropsV4): ReactNode {
  const runtimeSelector = useCallback(
    (state: RobotRuntimeRegistryV4) => selectedRuntimeV4(state, robotId),
    [robotId],
  )
  const selectedRuntime = useStore(robots, runtimeSelector)
  const selectedJobRuntime = useStore(
    jobs,
    useCallback(
      (state: JobRuntimeStoreV4) => (
        selectedJobRuntimeV4(state, robotId)
      ),
      [robotId],
    ),
  )
  const robot = useMemo(
    () => project.robots.find((candidate) => candidate.id === robotId) ?? null,
    [project, robotId],
  )
  const definition = useMemo(
    () => robot === null
      ? null
      : project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId) ?? null,
    [project, robot],
  )
  const selectedJob = useMemo(
    () => selectedJobId === null
      ? null
      : project.jobs.find((candidate) => candidate.id === selectedJobId) ?? null,
    [project, selectedJobId],
  )
  const [drafts, setDrafts] = useState<JointDraftsV4>(() => (
    createJointDraftsV4(definition, selectedRuntime)
  ))
  const dirtyJointId = useRef<string | null>(null)
  const draftRobotId = useRef(robotId)
  const [commandError, setCommandError] = useState<string | null>(null)
  const [savePending, setSavePending] = useState(false)
  const savePendingRef = useRef(false)
  const selectedRobotRunning = selectedJobRuntime?.state === 'RUNNING'
  const liveWriter = selectedRuntime?.jointSource ?? null
  const allowedWriter: RobotJointWriterV4 | null = liveWriter === 'manual'
    ? 'manual'
    : liveWriter === 'simulation' && !selectedRobotRunning
      ? 'simulation'
      : null

  useEffect(() => {
    const sameRobot = draftRobotId.current === robotId
    if (!sameRobot) {
      draftRobotId.current = robotId
      dirtyJointId.current = null
      setCommandError(null)
    }
    setDrafts((current) => createJointDraftsV4(
      definition,
      selectedRuntime,
      sameRobot ? current : null,
      sameRobot ? dirtyJointId.current : null,
    ))
  }, [definition, robotId, selectedRuntime])

  const resyncDraft = (jointId: string): void => {
    const latest = selectedRuntimeV4(robots.getState(), robotId)
    setDrafts((current) => {
      const next = createOwnRecordV4<string>()
      for (const key of Reflect.ownKeys(current)) {
        if (typeof key === 'string') defineOwnValueV4(next, key, current[key]!)
      }
      defineOwnValueV4(next, jointId, String(liveJointValueV4(latest, jointId)))
      return next
    })
  }

  const writeJoint = (jointId: string, value: number): void => {
    const actionWriter = allowedWriterAtActionV4(robots, jobs, robotId)
    if (actionWriter === null) return
    setCommandError(null)
    try {
      robots.getState().writeJointValues(
        robotId,
        createPartialJointValueV4(jointId, value),
        actionWriter,
      )
    } catch (error) {
      setCommandError(errorMessageV4(error))
    } finally {
      dirtyJointId.current = null
      resyncDraft(jointId)
    }
  }

  const commitDraft = (jointId: string): void => {
    const draft = Object.hasOwn(drafts, jointId) ? drafts[jointId]! : ''
    const value = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(value)) {
      dirtyJointId.current = null
      setCommandError('Joint value must be a finite number.')
      resyncDraft(jointId)
      return
    }
    writeJoint(jointId, value)
  }

  const writeHome = (): void => {
    const actionWriter = allowedWriterAtActionV4(robots, jobs, robotId)
    if (actionWriter === null || definition === null) return
    setCommandError(null)
    try {
      robots.getState().writeJointValues(
        robotId,
        createJointValueRecordV4(definition.joints, (joint) => joint.home),
        actionWriter,
      )
    } catch (error) {
      setCommandError(errorMessageV4(error))
    }
  }

  const setGripper = (state: 'OPEN' | 'CLOSED'): void => {
    setCommandError(null)
    try {
      robots.getState().setGripperState(robotId, state)
    } catch (error) {
      setCommandError(errorMessageV4(error))
    }
  }

  const saveAllowed = selectedRuntime !== null
    && definition !== null
    && selectedJob !== null
    && selectedJob.robotId === robotId
    && !selectedRobotRunning
    && !savePending

  const savePose = (): void => {
    const latestSelectedJob = selectedJobId === null
      ? null
      : project.jobs.find((candidate) => candidate.id === selectedJobId) ?? null
    const selectedRunning = selectedJobRuntimeV4(jobs.getState(), robotId)?.state === 'RUNNING'
    if (
      savePendingRef.current
      || definition === null
      || latestSelectedJob === null
      || latestSelectedJob.robotId !== robotId
      || selectedRunning
    ) return
    const latest = selectedRuntimeV4(robots.getState(), robotId)
    if (latest === null) return
    const values = createJointValueRecordV4(
      definition.joints,
      (joint) => liveJointValueV4(latest, joint.id),
    )
    savePendingRef.current = true
    setSavePending(true)
    setCommandError(null)
    void Promise.resolve()
      .then(() => commands.saveJointPose(latestSelectedJob.id, values, 100))
      .catch((error: unknown) => setCommandError(errorMessageV4(error)))
      .finally(() => {
        savePendingRef.current = false
        setSavePending(false)
      })
  }

  const robotLabel = robot?.name ?? robotId

  return (
    <section className="joint-inspector-v4" aria-label={`${robotLabel} Joint inspector`}>
      <header>
        <h3>Joints</h3>
        <p>{writerLabelV4(liveWriter)}</p>
        {liveWriter === 'simulation' && selectedRobotRunning ? (
          <p role="status">Running Job owns Robot {robotId}; Jog is read-only.</p>
        ) : null}
      </header>

      {definition === null || selectedRuntime === null ? (
        <p role="status">Robot runtime is unavailable.</p>
      ) : (
        <div aria-label={`${robotLabel} Joint controls`} role="group">
          {definition.joints.map((joint) => (
            <div className="joint-control-v4" data-joint-id={joint.id} key={joint.id}>
              <label>{joint.id}</label>
              <span aria-hidden="true">{displayUnitV4(joint)}</span>
              <input
                aria-label={joint.id}
                disabled={allowedWriter === null}
                max={joint.max}
                min={joint.min}
                onChange={(event) => writeJoint(joint.id, Number(event.currentTarget.value))}
                step={displayStepV4(joint)}
                type="range"
                value={liveJointValueV4(selectedRuntime, joint.id)}
              />
              <input
                aria-label={joint.id}
                disabled={allowedWriter === null}
                max={joint.max}
                min={joint.min}
                onBlur={() => {
                  if (dirtyJointId.current === joint.id) commitDraft(joint.id)
                  else resyncDraft(joint.id)
                }}
                onChange={(event) => {
                  const value = event.currentTarget.value
                  dirtyJointId.current = joint.id
                  setDrafts((current) => {
                    const next = createOwnRecordV4<string>()
                    for (const key of Reflect.ownKeys(current)) {
                      if (typeof key === 'string') defineOwnValueV4(next, key, current[key]!)
                    }
                    defineOwnValueV4(next, joint.id, value)
                    return next
                  })
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    event.currentTarget.blur()
                  }
                }}
                step={displayStepV4(joint)}
                type="number"
                value={Object.hasOwn(drafts, joint.id) ? drafts[joint.id] : ''}
              />
            </div>
          ))}
        </div>
      )}

      <div className="inspector-actions-v4">
        <button disabled={allowedWriter === null} onClick={writeHome} type="button">
          Robot Home
        </button>
        <button disabled={selectedRuntime === null} onClick={() => setGripper('OPEN')} type="button">
          Open Gripper
        </button>
        <button disabled={selectedRuntime === null} onClick={() => setGripper('CLOSED')} type="button">
          Close Gripper
        </button>
        <button disabled={!saveAllowed} onClick={savePose} type="button">
          {savePending ? 'Saving Pose' : 'Save Pose'}
        </button>
      </div>

      {commandError === null ? null : <p role="alert">{commandError}</p>}
    </section>
  )
}
