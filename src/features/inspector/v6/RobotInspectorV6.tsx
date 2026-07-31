import { useState, useSyncExternalStore, type ReactNode } from 'react'

import type { OpcUaProjectTargetV5, WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { RobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import type { JobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'
import type { InspectorMutationPortV6 } from './ObjectInspectorV6.js'

export interface RobotInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly robotId: string
  readonly runtime?: { readonly robots: StoreApi<RobotJointRuntimeStoreV5>; readonly jobs?: StoreApi<JobRuntimeStoreV5> }
  readonly mutations?: InspectorMutationPortV6
  readonly onOpenBinding?: (target: OpcUaProjectTargetV5) => void
}

type BaseDraft = Readonly<{ x: string; y: string; z: string }>

const noRuntimeSubscription = () => () => {}
const noRobotRuntimeState = (): RobotJointRuntimeStoreV5 | null => null
const noJobRuntimeState = (): JobRuntimeStoreV5 | null => null

function baseDraftFor(robot: WorkcellProjectV5['robots'][number]): BaseDraft {
  return Object.freeze({ x: String(robot.localBasePose.positionM[0]), y: String(robot.localBasePose.positionM[1]), z: String(robot.localBasePose.positionM[2]) })
}

function sameBase(robot: WorkcellProjectV5['robots'][number], values: readonly [number, number, number]): boolean {
  return robot.localBasePose.positionM[0] === values[0]
    && robot.localBasePose.positionM[1] === values[1]
    && robot.localBasePose.positionM[2] === values[2]
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return <details className="v6-inspector-section" open><summary aria-label={`${title} section`}>{title}</summary><div className="v6-inspector-section-body">{children}</div></details>
}

export function RobotInspectorV6(props: RobotInspectorV6Props): ReactNode {
  const robot = props.project.robots.find((candidate) => candidate.id === props.robotId)
  if (robot === undefined) return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Robot is no longer available.</p></section>
  return <RobotInspectorContent {...props} robot={robot} />
}

function RobotInspectorContent({ project, robotId, runtime, mutations, onOpenBinding, robot }: RobotInspectorV6Props & { readonly robot: WorkcellProjectV5['robots'][number] }): ReactNode {
  const definition = project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  const robotRuntimeState = useSyncExternalStore<RobotJointRuntimeStoreV5 | null>(
    runtime?.robots.subscribe ?? noRuntimeSubscription,
    runtime?.robots.getState ?? noRobotRuntimeState,
    noRobotRuntimeState,
  )
  const jobRuntimeState = useSyncExternalStore<JobRuntimeStoreV5 | null>(
    runtime?.jobs?.subscribe ?? noRuntimeSubscription,
    runtime?.jobs?.getState ?? noJobRuntimeState,
    noJobRuntimeState,
  )
  const robotRuntime = robotRuntimeState?.readRobot(robotId) ?? null
  const job = jobRuntimeState?.byRobotId[robotId]
  const running = job?.state === 'RUNNING'
  const baseKey = `${robotId}:${project.revisionId}`
  const [baseDraft, setBaseDraft] = useState<BaseDraft>(() => baseDraftFor(robot))
  const [baseDraftKey, setBaseDraftKey] = useState(baseKey)
  if (baseDraftKey !== baseKey) {
    setBaseDraftKey(baseKey)
    setBaseDraft(baseDraftFor(robot))
  }
  const jointOwner = robotRuntime?.jointSource ?? robot.jointSource
  const jointControlOwner = jointOwner === 'simulation' || jointOwner === 'manual' ? jointOwner : null
  const jointDisabled = runtime === undefined || jointControlOwner === null
  const jointExplanation = runtime === undefined
    ? 'Joint controls require an active Runtime Bundle.'
    : jointControlOwner === 'simulation'
      ? 'Simulation Joint control is active.'
      : jointControlOwner === 'manual'
        ? 'Manual Joint control is active.'
        : `OPC UA (${jointOwner.slice('opcua:'.length)}) owns Joint controls.`
  const applyBase = (): void => {
    if (running || mutations === undefined) return
    const rawValues = [baseDraft.x, baseDraft.y, baseDraft.z]
    if (rawValues.some((value) => value.trim().length === 0)) return
    const values: readonly [number, number, number] = [Number(rawValues[0]), Number(rawValues[1]), Number(rawValues[2])]
    if (values.some((value) => !Number.isFinite(value)) || sameBase(robot, values)) return
    const published = mutations.readPublished()
    if (published === null) return
    void mutations.mutate({ expectedRevisionId: published.revisionId, description: 'Update Robot base transform', recipe: (active) => ({ ...active, robots: active.robots.map((candidate) => candidate.id !== robotId ? candidate : ({ ...candidate, localBasePose: { positionM: [values[0], values[1], values[2]], quaternion: candidate.localBasePose.quaternion } })) }) })
  }
  return <section className="v6-selection-inspector" aria-label={`${robot.name} inspector`}>
    <header><h2>{robot.name}</h2><p>{jointExplanation}</p></header>
    <Section title="Runtime"><dl><div><dt>Joint owner</dt><dd>{jointOwner}</dd></div><div><dt>Quality</dt><dd>{robotRuntime?.quality ?? 'Unavailable'}</dd></div><div><dt>Job</dt><dd>{job?.state ?? 'IDLE'}</dd></div></dl></Section>
    <Section title="Base Transform"><p>{running ? 'A running Job owns Robot motion; base authoring is read-only.' : 'Base Transform is authored from the selected Robot only.'}</p><div className="v6-inspector-grid">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} (m)<input aria-label={`${axis.toUpperCase()} (m)`} disabled={running} onChange={(event) => setBaseDraft((draft) => Object.freeze({ ...draft, [axis]: event.currentTarget.value }))} type="number" value={baseDraft[axis]} /></label>)}</div><div className="v6-inspector-actions"><button disabled={running} onClick={applyBase} type="button">Apply Base Transform</button><button onClick={() => setBaseDraft(baseDraftFor(robot))} type="button">Reset</button></div></Section>
    <Section title="Joints"><p>{jointExplanation}</p><div className="v6-robot-joints">{definition?.joints.map((joint) => { const value = robotRuntime?.jointValues[joint.id] ?? robot.initialJointValues[joint.id] ?? joint.home; const unit = joint.type === 'revolute' ? 'deg' : 'm'; return <label key={joint.id}>{joint.id}<input aria-label={joint.id} disabled={jointDisabled} max={joint.max} min={joint.min} onChange={(event) => { if (jointControlOwner !== null) runtime?.robots.getState().writeJointValues(robotId, { [joint.id]: Number(event.currentTarget.value) }, jointControlOwner) }} step={joint.type === 'revolute' ? 1 : 0.001} type="range" value={value} /><output>{value} {unit}</output></label> })}</div></Section>
    <Section title="Tool/TCP"><dl><div><dt>Tool frame</dt><dd>{robot.selectedToolFrameId}</dd></div><div><dt>TCP frame</dt><dd>{robot.selectedTcpFrameId}</dd></div></dl></Section>
    <Section title="Status"><dl><div><dt>Value</dt><dd>{robot.numericStatus.value}</dd></div><div><dt>Owner</dt><dd>{robot.numericStatus.sourceOwnership}</dd></div></dl></Section>
    <Section title="Communications"><p>Robot bindings are read-only in this Inspector.</p><dl><div><dt>Joint source</dt><dd>{robot.jointSource}</dd></div></dl><button onClick={() => onOpenBinding?.({ type: 'robot-frame', robotId, frameId: robot.selectedTcpFrameId })} type="button">Open Binding</button></Section>
  </section>
}
