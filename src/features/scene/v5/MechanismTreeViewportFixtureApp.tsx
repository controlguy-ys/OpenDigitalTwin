import { Canvas } from '@react-three/fiber'
import { useMemo, useState, type ReactNode } from 'react'

import cncFixture from '../../../core/mechanism-runtime-v1/fixtures/cnc-xyz.mechanism-v1.json' with { type: 'json' }
import humanoidFixture from '../../../core/mechanism-runtime-v1/fixtures/branched-humanoid.mechanism-v1.json' with { type: 'json' }
import { createDefaultApplicationKinematicsServiceV1 } from '../../../core/mechanism-runtime-v1/application-kinematics-service.js'
import type { MechanismDefinitionV1, RigidTransformV1 } from '../../../core/mechanism-runtime-v1/types.js'
import { MechanismPoseLayerV1, type MechanismBodyVisualV1 } from './MechanismPoseLayerV1.js'

export type MechanismTreeViewportFixtureKind = 'humanoid' | 'cnc'

export interface MechanismTreeViewportFixtureAppProps {
  readonly mechanismFixture: MechanismTreeViewportFixtureKind
}

const identity: RigidTransformV1 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const humanoidDefinition = humanoidFixture as unknown as MechanismDefinitionV1
const cncDefinition = cncFixture as unknown as MechanismDefinitionV1
const service = createDefaultApplicationKinematicsServiceV1()

const humanoidProgram = Object.freeze({
  compiled: service.compile(humanoidDefinition),
  initialCoordinates: Object.freeze({
    'head-yaw': 0,
    'left-shoulder': 0,
    'left-elbow': 0,
    'right-shoulder': 0,
    'right-elbow': 0,
    'left-hip': 0,
    'left-knee': 0,
    'right-hip': 0,
    'right-knee': 0,
  }),
  movedCoordinates: Object.freeze({
    'head-yaw': 0,
    'left-shoulder': 1.5707963267948966,
    'left-elbow': 0,
    'right-shoulder': 0,
    'right-elbow': 0,
    'left-hip': 0,
    'left-knee': 0,
    'right-hip': 0,
    'right-knee': 0,
  }),
  visuals: Object.freeze(visualsFor(humanoidDefinition)),
})

const cncProgram = Object.freeze({
  compiled: service.compile(cncDefinition),
  initialCoordinates: Object.freeze({ 'axis-x': 0, 'axis-y': 0, 'axis-z': 0 }),
  movedCoordinates: Object.freeze({ 'axis-x': 0.125, 'axis-y': 0.5, 'axis-z': 0.875 }),
  visuals: Object.freeze(visualsFor(cncDefinition)),
})

function visualsFor(definition: MechanismDefinitionV1): readonly MechanismBodyVisualV1[] {
  const colors = ['#2563eb', '#0891b2', '#16a34a', '#ca8a04', '#dc2626', '#9333ea']
  return definition.bodies.map(({ bodyId }, index) => ({
    bodyId,
    sizeM: [0.18, 0.18, 0.18],
    color: colors[index % colors.length]!,
  }))
}

function poseText(pose: RigidTransformV1): string {
  return `${pose.positionM.join(',')}|${pose.quaternion.join(',')}`
}

function PoseEvidence({ label, poses, testIdPrefix }: {
  readonly label: string
  readonly poses: Readonly<Record<string, RigidTransformV1>>
  readonly testIdPrefix: string
}): ReactNode {
  return <section aria-label={`${label} poses`}>
    {Object.keys(poses).sort().map((id) => <output data-testid={`${testIdPrefix}:${id}`} key={id}>{poseText(poses[id]!)}</output>)}
  </section>
}

export function MechanismTreeViewportFixtureApp({ mechanismFixture }: MechanismTreeViewportFixtureAppProps): ReactNode {
  const program = mechanismFixture === 'humanoid' ? humanoidProgram : cncProgram
  const [coordinates, setCoordinates] = useState<Readonly<Record<string, number>>>(program.initialCoordinates)
  const snapshot = useMemo(() => program.compiled.evaluateForward({
    rootWorldPose: identity,
    coordinatesByStableId: coordinates,
  }), [coordinates, program])

  return <main aria-label="Mechanism fixture viewport">
    <h1>{mechanismFixture === 'humanoid' ? 'Humanoid mechanism fixture' : 'CNC mechanism fixture'}</h1>
    {mechanismFixture === 'humanoid'
      ? <>
        <button onClick={() => setCoordinates(humanoidProgram.movedCoordinates)} type="button">Move left arm</button>
        <button onClick={() => setCoordinates(humanoidProgram.initialCoordinates)} type="button">Reset humanoid</button>
      </>
      : <>
        <button onClick={() => setCoordinates(cncProgram.movedCoordinates)} type="button">Move CNC</button>
        <button onClick={() => setCoordinates(cncProgram.initialCoordinates)} type="button">Reset CNC</button>
      </>}
    <div style={{ height: 480 }}>
      <Canvas aria-label="Mechanism fixture 3D viewport" camera={{ position: [2, 2, 2], fov: 50 }}>
        <ambientLight intensity={1} />
        <MechanismPoseLayerV1 bodyWorldPoses={snapshot.bodyWorldPoses} visuals={program.visuals} />
      </Canvas>
    </div>
    <PoseEvidence label="Body" poses={snapshot.bodyWorldPoses} testIdPrefix="mechanism-body-pose" />
    <PoseEvidence label="Frame" poses={snapshot.frameWorldPoses} testIdPrefix="mechanism-frame-pose" />
  </main>
}
