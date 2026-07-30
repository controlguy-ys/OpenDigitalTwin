import {
  GizmoHelper,
  GizmoViewcube,
  Grid,
  Html,
  OrbitControls,
  PerspectiveCamera,
} from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { useRef, type ReactNode } from 'react'
import type { Group } from 'three'
import { useStore } from 'zustand'

import type {
  OpcUaProjectTargetV5,
  RigidTransformV5,
  SpatialEntityV5,
  WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'

export interface V5WorkcellSelection {
  readonly kind: 'robot' | 'entity'
  readonly id: string
}

export interface V5WorkcellWorkspaceProps {
  readonly project: WorkcellProjectV5
  readonly bundle: BrowserRuntimeBundleStateV5 | null
  readonly selection: V5WorkcellSelection | null
  readonly onSelect: (selection: V5WorkcellSelection) => void
  readonly onOpenBinding: (target: OpcUaProjectTargetV5) => void
}

export interface V5WorkcellCanvasProps {
  readonly project: WorkcellProjectV5
  readonly bundle: BrowserRuntimeBundleStateV5 | null
  readonly selection: V5WorkcellSelection | null
  readonly onSelect: (selection: V5WorkcellSelection) => void
}

function transformProps(pose: RigidTransformV5): {
  readonly position: [number, number, number]
  readonly quaternion: [number, number, number, number]
} {
  return {
    position: [...pose.positionM],
    quaternion: [...pose.quaternion],
  }
}

const IDENTITY_POSE: RigidTransformV5 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function WorldPoseGroup({ readPose, children }: {
  readonly readPose: () => RigidTransformV5 | null
  readonly children: ReactNode
}): ReactNode {
  const groupRef = useRef<Group>(null)
  const initialPose = readPose()
  useFrame(() => {
    const pose = readPose()
    const group = groupRef.current
    if (group === null) return
    group.visible = pose !== null
    if (pose === null) return
    group.position.set(...pose.positionM)
    group.quaternion.set(...pose.quaternion)
  })
  return <group ref={groupRef} visible={initialPose !== null} {...transformProps(initialPose ?? IDENTITY_POSE)}>{children}</group>
}

function MappedRobotFrameMarker({ bundle, robotId, robotName, frameId, frameName }: {
  readonly bundle: BrowserRuntimeBundleStateV5
  readonly robotId: string
  readonly robotName: string
  readonly frameId: string
  readonly frameName: string
}): ReactNode {
  const readoutRef = useRef<HTMLSpanElement>(null)
  const readPose = () => bundle.runtimeGraph.world.readRobotFrameWorldPose(robotId, frameId)
  useFrame(() => {
    const pose = readPose()
    if (pose === null || readoutRef.current === null) return
    const [x, y, z] = pose.positionM
    readoutRef.current.textContent = `${robotName} / ${frameName} · X ${x.toFixed(3)} Y ${y.toFixed(3)} Z ${z.toFixed(3)} m`
  })
  return <WorldPoseGroup readPose={readPose}>
    <axesHelper args={[0.16]} />
    <Html center distanceFactor={8} position={[0, 0, 0.12]}>
      <span className="v5-frame-readout" ref={readoutRef}>{robotName} / {frameName}</span>
    </Html>
  </WorldPoseGroup>
}

function ObjectGeometry({ bundle, entity, selected, onSelect }: {
  readonly bundle: BrowserRuntimeBundleStateV5
  readonly entity: SpatialEntityV5
  readonly selected: boolean
  readonly onSelect: () => void
}): ReactNode {
  const color = selected ? '#38bdf8' : entity.geometry.kind === 'asset' ? '#94a3b8' : entity.geometry.color
  if (entity.geometry.kind === 'cylinder') {
    return <WorldPoseGroup readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect() }}>
        <cylinderGeometry args={[entity.geometry.radiusM, entity.geometry.radiusM, entity.geometry.heightM, entity.geometry.radialSegments]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </WorldPoseGroup>
  }
  if (entity.geometry.kind === 'box') {
    return <WorldPoseGroup readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect() }}>
        <boxGeometry args={[...entity.geometry.dimensionsM]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </WorldPoseGroup>
  }
  return <WorldPoseGroup readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)}>
    <group onClick={(event) => { event.stopPropagation(); onSelect() }}>
      {entity.geometry.collisionBoxes.length === 0
        ? <mesh><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color={color} wireframe /></mesh>
        : entity.geometry.collisionBoxes.map((box) => <mesh key={box.id} position={[...box.centerM]} quaternion={[...box.quaternion]}>
          <boxGeometry args={[box.halfExtentsM[0] * 2, box.halfExtentsM[1] * 2, box.halfExtentsM[2] * 2]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} />
        </mesh>)}
    </group>
  </WorldPoseGroup>
}

function RobotGeometry({ project, bundle, robotId, selected, onSelect }: {
  readonly project: WorkcellProjectV5
  readonly bundle: BrowserRuntimeBundleStateV5
  readonly robotId: string
  readonly selected: boolean
  readonly onSelect: () => void
}): ReactNode {
  const robot = project.robots.find(({ id }) => id === robotId)
  const definition = project.robotDefinitions.find(({ id }) => id === robot?.definitionId)
  useStore(bundle.runtimeGraph.robots, (state) => state.byRobotId[robotId])
  if (robot === undefined || definition === undefined || !robot.visible) return null
  const linkColor = selected ? '#38bdf8' : '#d7dce2'
  return <group onClick={(event) => { event.stopPropagation(); onSelect() }}>
    {definition.links.flatMap((link) => {
      if (link.geometryOccurrences.length === 0) {
        return [<WorldPoseGroup key={link.id} readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)}>
          <mesh>
            <sphereGeometry args={[0.045, 16, 12]} />
            <meshStandardMaterial color={linkColor} />
          </mesh>
        </WorldPoseGroup>]
      }
      return link.geometryOccurrences.flatMap((occurrence) => {
        if (occurrence.collisionBoxes.length === 0) {
          return [<WorldPoseGroup key={`${link.id}:${occurrence.occurrenceKey}`} readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)}>
            <group {...transformProps(occurrence.linkLocalPose)}>
              <mesh>
                <sphereGeometry args={[0.045, 16, 12]} />
                <meshStandardMaterial color={linkColor} />
              </mesh>
            </group>
          </WorldPoseGroup>]
        }
        return [<WorldPoseGroup
          key={`${link.id}:${occurrence.occurrenceKey}`}
          readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)}
        >
          <group {...transformProps(occurrence.linkLocalPose)}>
            {occurrence.collisionBoxes.map((box) => <mesh key={box.id} position={[...box.centerM]} quaternion={[...box.quaternion]}>
              <boxGeometry args={[box.halfExtentsM[0] * 2, box.halfExtentsM[1] * 2, box.halfExtentsM[2] * 2]} />
              <meshStandardMaterial color={linkColor} />
            </mesh>)}
          </group>
        </WorldPoseGroup>]
      })
    })}
  </group>
}

function selectionTarget(project: WorkcellProjectV5, selection: V5WorkcellSelection): OpcUaProjectTargetV5 | null {
  if (selection.kind === 'entity') {
    const entity = project.spatialEntities.find(({ id }) => id === selection.id)
    const frame = entity?.movingFrames[0]
    return frame === undefined
      ? entity === undefined ? null : { type: 'entity-status', entityId: entity.id }
      : { type: 'entity-frame', entityId: entity!.id, frameId: frame.frameId }
  }
  const robot = project.robots.find(({ id }) => id === selection.id)
  if (robot === undefined) return null
  return { type: 'robot-frame', robotId: robot.id, frameId: robot.selectedTcpFrameId }
}

export function V5WorkcellWorkspace({
  project,
  bundle,
  selection,
  onSelect,
  onOpenBinding,
}: V5WorkcellWorkspaceProps): ReactNode {
  const target = selection === null ? null : selectionTarget(project, selection)
  return <main aria-busy={bundle === null} aria-label="3D viewport" className="v5-workcell">
    <div className="v5-scene-toolbar">
      <span>{project.robots.length} Robots</span>
      <span>{project.spatialEntities.length} Objects</span>
      <button disabled={target === null} onClick={() => { if (target !== null) onOpenBinding(target) }} type="button">Open Binding…</button>
    </div>
    <V5WorkcellCanvas bundle={bundle} onSelect={onSelect} project={project} selection={selection} />
  </main>
}

export function V5WorkcellCanvas({
  project,
  bundle,
  selection,
  onSelect,
}: V5WorkcellCanvasProps): ReactNode {
  return <div className="v5-scene-canvas" data-testid="scene-canvas-surface">
      {bundle === null
        ? <div className="v5-empty-state">Project runtime is not active.</div>
        : <Canvas onPointerMissed={() => undefined} shadows>
          <color attach="background" args={['#09121d']} />
          <ambientLight intensity={1.4} />
          <directionalLight castShadow intensity={2.2} position={[4, -3, 6]} />
          <PerspectiveCamera makeDefault position={[3.2, -4.2, 2.8]} up={[0, 0, 1]} />
          <OrbitControls makeDefault />
          <GizmoHelper alignment="top-right" margin={[58, 58]}>
            <GizmoViewcube
              color="#d9e2e8"
              faces={['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']}
              hoverColor="#38bdf8"
              strokeColor="#526674"
              textColor="#17232d"
            />
          </GizmoHelper>
          <Grid args={[20, 20]} cellColor="#284158" cellSize={0.25} fadeDistance={18} infiniteGrid sectionColor="#3f647e" sectionSize={1} />
          <axesHelper args={[0.5]} />
          {project.robots.map((robot) => <RobotGeometry
            bundle={bundle}
            key={robot.id}
            onSelect={() => onSelect({ kind: 'robot', id: robot.id })}
            project={project}
            robotId={robot.id}
            selected={selection?.kind === 'robot' && selection.id === robot.id}
          />)}
          {project.robots.flatMap((robot) => {
            const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
            if (definition === undefined) return []
            return definition.frames
              .filter((frame) => frame.role !== 'base' && robot.frameSources[frame.id]?.startsWith('opcua:'))
              .map((frame) => <MappedRobotFrameMarker
                bundle={bundle}
                frameId={frame.id}
                frameName={frame.name}
                key={`${robot.id}:${frame.id}`}
                robotId={robot.id}
                robotName={robot.name}
              />)
          })}
          {project.spatialEntities.filter(({ visible }) => visible).map((entity) => <ObjectGeometry
            bundle={bundle}
            entity={entity}
            key={entity.id}
            onSelect={() => onSelect({ kind: 'entity', id: entity.id })}
            selected={selection?.kind === 'entity' && selection.id === entity.id}
          />)}
        </Canvas>}
    </div>
}
