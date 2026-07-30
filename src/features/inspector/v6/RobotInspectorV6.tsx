import { useState, type ReactNode } from 'react'

import { quaternionToRpyDegreesV5, rpyDegreesToQuaternionV5, type WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { RobotJointRuntimeStoreV5 } from '../../robot/v5/robot-joint-runtime-store.js'
import type { JobRuntimeStoreV5 } from '../../jobs/v5/job-runtime-store.js'
import type { InspectorMutationPortV6 } from './ObjectInspectorV6.js'

export interface RobotInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly robotId: string
  readonly runtime?: { readonly robots: StoreApi<RobotJointRuntimeStoreV5>; readonly jobs?: StoreApi<JobRuntimeStoreV5> }
  readonly mutations?: InspectorMutationPortV6
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }): ReactNode {
  return <details className="v6-inspector-section" open><summary><button aria-label={title} type="button">{title}</button></summary><div className="v6-inspector-section-body">{children}</div></details>
}

export function RobotInspectorV6({ project, robotId, runtime, mutations }: RobotInspectorV6Props): ReactNode {
  const robot = project.robots.find((candidate) => candidate.id === robotId)
  if (robot === undefined) return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Robot is no longer available.</p></section>
  const definition = project.robotDefinitions.find((candidate) => candidate.id === robot.definitionId)
  const robotRuntime = runtime?.robots.getState().readRobot(robotId) ?? null
  const job = runtime?.jobs?.getState().byRobotId[robotId]
  const running = job?.state === 'RUNNING'
  const [baseDraft, setBaseDraft] = useState(() => ({ x: String(robot.localBasePose.positionM[0]), y: String(robot.localBasePose.positionM[1]), z: String(robot.localBasePose.positionM[2]), rpy: quaternionToRpyDegreesV5(robot.localBasePose.quaternion) }))
  const jointOwner = robotRuntime?.jointSource ?? robot.jointSource
  const jointDisabled = runtime === undefined || jointOwner.startsWith('opcua:')
  const jointExplanation = runtime === undefined ? 'Joint controls require an active Runtime Bundle.' : jointOwner.startsWith('opcua:') ? `OPC UA (${jointOwner.slice('opcua:'.length)}) owns Joint controls.` : 'Manual Joint control is active.'
  const applyBase = (): void => {
    if (running || mutations === undefined) return
    const values = [Number(baseDraft.x), Number(baseDraft.y), Number(baseDraft.z)]
    if (values.some((value) => !Number.isFinite(value))) return
    const published = mutations.readPublished()
    if (published === null) return
    void mutations.mutate({ expectedRevisionId: published.revisionId, description: 'Update Robot base transform', recipe: (active) => ({ ...active, robots: active.robots.map((candidate) => candidate.id !== robotId ? candidate : ({ ...candidate, localBasePose: { positionM: [values[0]!, values[1]!, values[2]!], quaternion: rpyDegreesToQuaternionV5(baseDraft.rpy) } })) }) })
  }
  return <section className="v6-selection-inspector" aria-label={`${robot.name} inspector`}>
    <header><h2>{robot.name}</h2><p>{jointExplanation}</p></header>
    <Section title="Runtime"><dl><div><dt>Joint owner</dt><dd>{jointOwner}</dd></div><div><dt>Quality</dt><dd>{robotRuntime?.quality ?? 'Unavailable'}</dd></div><div><dt>Job</dt><dd>{job?.state ?? 'IDLE'}</dd></div></dl></Section>
    <Section title="Base Transform"><p>{running ? 'A running Job owns Robot motion; base authoring is read-only.' : 'Base Transform is authored from the selected Robot only.'}</p><div className="v6-inspector-grid">{(['x', 'y', 'z'] as const).map((axis) => <label key={axis}>{axis.toUpperCase()} (m)<input aria-label={`${axis.toUpperCase()} (m)`} disabled={running} onChange={(event) => setBaseDraft((draft) => ({ ...draft, [axis]: event.currentTarget.value }))} type="number" value={baseDraft[axis]} /></label>)}</div><div className="v6-inspector-actions"><button disabled={running} onClick={applyBase} type="button">Apply Base Transform</button><button onClick={() => setBaseDraft({ x: String(robot.localBasePose.positionM[0]), y: String(robot.localBasePose.positionM[1]), z: String(robot.localBasePose.positionM[2]), rpy: quaternionToRpyDegreesV5(robot.localBasePose.quaternion) })} type="button">Reset</button></div></Section>
    <Section title="Joints"><p>{jointExplanation}</p><div className="v6-robot-joints">{definition?.joints.map((joint) => { const value = robotRuntime?.jointValues[joint.id] ?? robot.initialJointValues[joint.id] ?? joint.home; const unit = joint.type === 'revolute' ? 'deg' : 'm'; return <label key={joint.id}>{joint.id}<input aria-label={joint.id} disabled={jointDisabled} max={joint.max} min={joint.min} onChange={(event) => runtime?.robots.getState().writeJointValues(robotId, { [joint.id]: Number(event.currentTarget.value) }, 'manual')} step={joint.type === 'revolute' ? 1 : 0.001} type="range" value={value} /><output>{value} {unit}</output></label> })}</div></Section>
    <Section title="Tool/TCP"><dl><div><dt>Tool frame</dt><dd>{robot.selectedToolFrameId}</dd></div><div><dt>TCP frame</dt><dd>{robot.selectedTcpFrameId}</dd></div></dl></Section>
    <Section title="Status"><dl><div><dt>Value</dt><dd>{robot.numericStatus.value}</dd></div><div><dt>Owner</dt><dd>{robot.numericStatus.sourceOwnership}</dd></div></dl></Section>
    <Section title="Communications"><p>Robot bindings are read-only in this Inspector. Use Open Binding from the selected target.</p><dl><div><dt>Joint source</dt><dd>{robot.jointSource}</dd></div></dl></Section>
  </section>
}
