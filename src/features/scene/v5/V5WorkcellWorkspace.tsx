import {
  GizmoHelper,
  GizmoViewcube,
  Grid,
  Html,
  OrbitControls,
  PerspectiveCamera,
} from '@react-three/drei'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef, type ReactNode } from 'react'
import { PerspectiveCamera as ThreePerspectiveCamera, type Group } from 'three'
import { useStore } from 'zustand'

import type {
  OpcUaProjectTargetV5,
  RigidTransformV5,
  SpatialEntityV5,
  WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import type { BrowserRuntimeBundleStateV5 } from '../../project/v5/browser-runtime-bundle-store-v5.js'
import {
  reduceWorkcellScenePresentationV5,
  type WorkcellSceneGeometrySampleV5,
  type WorkcellScenePresentationV5,
} from './workcell-scene-presentation-v5.js'

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
  readonly cameraPose?: WorkcellCameraPoseV5
  readonly cameraVersion?: number
  readonly onPresentationChange?: (value: WorkcellScenePresentationV5) => void
}

export interface WorkcellCameraPoseV5 {
  readonly position: readonly [number, number, number]
  readonly target: readonly [number, number, number]
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

function worldCenter(pose: RigidTransformV5, localCenter: readonly [number, number, number]): readonly [number, number, number] {
  const [qx, qy, qz, qw] = pose.quaternion
  const [x, y, z] = localCenter
  const tx = 2 * (qy * z - qz * y)
  const ty = 2 * (qz * x - qx * z)
  const tz = 2 * (qx * y - qy * x)
  const rx = x + qw * tx + (qy * tz - qz * ty)
  const ry = y + qw * ty + (qz * tx - qx * tz)
  const rz = z + qw * tz + (qx * ty - qy * tx)
  return [pose.positionM[0] + rx, pose.positionM[1] + ry, pose.positionM[2] + rz]
}

function presentationEqual(a: WorkcellScenePresentationV5, b: WorkcellScenePresentationV5): boolean {
  if (a.state !== b.state || a.visibleGeometryCount !== b.visibleGeometryCount) return false
  if (a.unresolvedPoseKeys.length !== b.unresolvedPoseKeys.length
    || a.unresolvedPoseKeys.some((key, index) => key !== b.unresolvedPoseKeys[index])) return false
  const equalBounds = (left: typeof a.visibleBounds, right: typeof b.visibleBounds): boolean => {
    if (left === null || right === null) return left === right
    return left.radius === right.radius && left.center.every((value, index) => value === right.center[index])
  }
  return equalBounds(a.visibleBounds, b.visibleBounds) && equalBounds(a.selectionBounds, b.selectionBounds)
}

function geometryRadiusFromCollisionBoxes(boxes: readonly { readonly centerM: readonly [number, number, number]; readonly halfExtentsM: readonly [number, number, number] }[]): number {
  return boxes.reduce((maximum, box) => Math.max(maximum, Math.hypot(...box.centerM) + Math.hypot(...box.halfExtentsM)), 0.06)
}

function expectedVisibleGeometryCount(project: WorkcellProjectV5): number {
  const robots = project.robots.reduce((count, robot) => {
    if (!robot.visible) return count
    const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    return count + (definition?.links.reduce((linkCount, link) => linkCount + Math.max(link.geometryOccurrences.length, 1), 0) ?? 0)
  }, 0)
  return robots + project.spatialEntities.filter(({ visible }) => visible).length
}

const IDENTITY_POSE: RigidTransformV5 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function WorldPoseGroup({ readPose, children, geometryKey, selectionKey = null, localCenter = [0, 0, 0], radius = 0.06, onGeometrySample, proxyKind }: {
  readonly readPose: () => RigidTransformV5 | null
  readonly children: ReactNode
  readonly geometryKey?: string
  readonly selectionKey?: string | null
  readonly localCenter?: readonly [number, number, number]
  readonly radius?: number
  readonly onGeometrySample?: (sample: WorkcellSceneGeometrySampleV5) => void
  readonly proxyKind?: 'collision-box' | 'diagnostic-wireframe' | 'logical-part'
}): ReactNode {
  const groupRef = useRef<Group>(null)
  const initialPose = readPose()
  const publishGeometrySample = useCallback(() => {
    if (geometryKey === undefined || onGeometrySample === undefined) return
    const pose = readPose()
    onGeometrySample({
      key: geometryKey,
      selectionKey,
      worldCenter: pose === null ? null : worldCenter(pose, localCenter),
      radius,
      issue: pose === null ? 'unresolved-world-pose' : null,
    })
  }, [geometryKey, localCenter, onGeometrySample, radius, readPose, selectionKey])
  useEffect(() => {
    publishGeometrySample()
  }, [publishGeometrySample])
  useFrame(() => {
    publishGeometrySample()
    const pose = readPose()
    const group = groupRef.current
    if (group === null) return
    group.visible = pose !== null
    if (pose === null) return
    if (typeof group.position?.set !== 'function' || typeof group.quaternion?.set !== 'function') return
    group.position.set(...pose.positionM)
    group.quaternion.set(...pose.quaternion)
  })
  return <group
    data-proxy-kind={proxyKind}
    data-testid={geometryKey === undefined ? undefined : `v5-geometry-proxy-${geometryKey}`}
    ref={groupRef}
    visible={initialPose !== null}
    {...transformProps(initialPose ?? IDENTITY_POSE)}
  >{children}</group>
}

function CameraPoseSynchronizer({ pose, version, controlsRef }: {
  readonly pose: WorkcellCameraPoseV5
  readonly version: number
  readonly controlsRef: { readonly current: ComponentRef<typeof OrbitControls> | null }
}): ReactNode {
  const camera = useThree((state) => state.camera)
  useEffect(() => {
    if (!(camera instanceof ThreePerspectiveCamera)) return
    camera.position.set(...pose.position)
    camera.up.set(0, 0, 1)
    camera.lookAt(...pose.target)
    camera.updateProjectionMatrix()
    const controls = controlsRef.current
    if (controls === null) return
    controls.target.set(...pose.target)
    controls.update()
  }, [camera, controlsRef, pose, version])
  return null
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

function ObjectGeometry({ bundle, entity, selected, onSelect, onGeometrySample }: {
  readonly bundle: BrowserRuntimeBundleStateV5
  readonly entity: SpatialEntityV5
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onGeometrySample: (sample: WorkcellSceneGeometrySampleV5) => void
}): ReactNode {
  const color = selected ? '#38bdf8' : entity.geometry.kind === 'asset' ? '#94a3b8' : entity.geometry.color
  const geometryKey = `object:${entity.id}`
  const selectionKey = `entity:${entity.id}`
  const radius = entity.geometry.kind === 'asset'
    ? geometryRadiusFromCollisionBoxes(entity.geometry.collisionBoxes)
    : entity.geometry.kind === 'box'
      ? Math.hypot(...entity.geometry.dimensionsM) / 2
      : entity.geometry.kind === 'cylinder'
        ? Math.hypot(entity.geometry.radiusM, entity.geometry.heightM / 2)
        : 0.06
  if (entity.geometry.kind === 'cylinder') {
    return <WorldPoseGroup geometryKey={geometryKey} localCenter={[0, 0, 0]} onGeometrySample={onGeometrySample} proxyKind="logical-part" radius={radius} readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)} selectionKey={selectionKey}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect() }}>
        <cylinderGeometry args={[entity.geometry.radiusM, entity.geometry.radiusM, entity.geometry.heightM, entity.geometry.radialSegments]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </WorldPoseGroup>
  }
  if (entity.geometry.kind === 'box') {
    return <WorldPoseGroup geometryKey={geometryKey} localCenter={[0, 0, 0]} onGeometrySample={onGeometrySample} proxyKind="logical-part" radius={radius} readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)} selectionKey={selectionKey}>
      <mesh onClick={(event) => { event.stopPropagation(); onSelect() }}>
        <boxGeometry args={[...entity.geometry.dimensionsM]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </WorldPoseGroup>
  }
  return <WorldPoseGroup geometryKey={geometryKey} localCenter={[0, 0, 0]} onGeometrySample={onGeometrySample} proxyKind={entity.geometry.collisionBoxes.length === 0 ? 'diagnostic-wireframe' : 'collision-box'} radius={radius} readPose={() => bundle.runtimeGraph.world.readObjectWorldPose(entity.id)} selectionKey={selectionKey}>
    <group onClick={(event) => { event.stopPropagation(); onSelect() }}>
      {entity.geometry.collisionBoxes.length === 0
        ? <><mesh><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color={color} wireframe /></mesh><Html center><span aria-label={`Geometry proxy for ${entity.name}`} role="img">Geometry proxy</span></Html></>
        : entity.geometry.collisionBoxes.map((box) => <mesh key={box.id} position={[...box.centerM]} quaternion={[...box.quaternion]}>
          <boxGeometry args={[box.halfExtentsM[0] * 2, box.halfExtentsM[1] * 2, box.halfExtentsM[2] * 2]} />
          <meshStandardMaterial color={color} transparent opacity={0.7} />
        </mesh>)}
    </group>
  </WorldPoseGroup>
}

function RobotGeometry({ project, bundle, robotId, selected, onSelect, onGeometrySample }: {
  readonly project: WorkcellProjectV5
  readonly bundle: BrowserRuntimeBundleStateV5
  readonly robotId: string
  readonly selected: boolean
  readonly onSelect: () => void
  readonly onGeometrySample: (sample: WorkcellSceneGeometrySampleV5) => void
}): ReactNode {
  const robot = project.robots.find(({ id }) => id === robotId)
  const definition = project.robotDefinitions.find(({ id }) => id === robot?.definitionId)
  useStore(bundle.runtimeGraph.robots, (state) => state.byRobotId[robotId])
  if (robot === undefined || definition === undefined || !robot.visible) return null
  const linkColor = selected ? '#38bdf8' : '#d7dce2'
  return <group onClick={(event) => { event.stopPropagation(); onSelect() }}>
    {definition.links.flatMap((link) => {
      if (link.geometryOccurrences.length === 0) {
        const geometryKey = `robot:${robotId}:link:${link.id}:geometry:${link.id}-fallback`
        return [<WorldPoseGroup geometryKey={geometryKey} key={link.id} onGeometrySample={onGeometrySample} proxyKind="diagnostic-wireframe" radius={0.06} readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)} selectionKey={`robot:${robotId}`}>
          <mesh><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color={linkColor} wireframe /></mesh>
          <Html center><span aria-label={`Geometry proxy for ${link.name}`} role="img">Geometry proxy</span></Html>
        </WorldPoseGroup>]
      }
      return link.geometryOccurrences.flatMap((occurrence) => {
        const geometryKey = `robot:${robotId}:link:${link.id}:geometry:${occurrence.occurrenceKey}`
        const radius = geometryRadiusFromCollisionBoxes(occurrence.collisionBoxes)
        if (occurrence.collisionBoxes.length === 0) {
          return [<WorldPoseGroup geometryKey={geometryKey} key={`${link.id}:${occurrence.occurrenceKey}`} localCenter={occurrence.linkLocalPose.positionM} onGeometrySample={onGeometrySample} proxyKind="diagnostic-wireframe" radius={radius} readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)} selectionKey={`robot:${robotId}`}>
            <group {...transformProps(occurrence.linkLocalPose)}>
              <mesh><boxGeometry args={[0.12, 0.12, 0.12]} /><meshStandardMaterial color={linkColor} wireframe /></mesh>
              <Html center><span aria-label={`Geometry proxy for ${occurrence.occurrenceKey}`} role="img">Geometry proxy</span></Html>
            </group>
          </WorldPoseGroup>]
        }
        return [<WorldPoseGroup
          geometryKey={geometryKey}
          key={`${link.id}:${occurrence.occurrenceKey}`}
          localCenter={occurrence.linkLocalPose.positionM}
          onGeometrySample={onGeometrySample}
          proxyKind="collision-box"
          radius={radius}
          readPose={() => bundle.runtimeGraph.world.readRobotLinkWorldPose(robotId, link.id)}
          selectionKey={`robot:${robotId}`}
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
  cameraPose,
  cameraVersion,
  onPresentationChange,
}: V5WorkcellCanvasProps): ReactNode {
  const expectedCount = useMemo(() => expectedVisibleGeometryCount(project), [project])
  const selectedKey = selection === null ? null : `${selection.kind}:${selection.id}`
  const samplesRef = useRef(new Map<string, WorkcellSceneGeometrySampleV5>())
  const sceneIdentityRef = useRef<string | null>(null)
  const initialPresentation = useMemo(() => reduceWorkcellScenePresentationV5([], expectedCount, selectedKey), [expectedCount, selectedKey])
  const presentationRef = useRef(initialPresentation)
  const [presentation, setPresentation] = useState(initialPresentation)
  const sceneIdentity = `${bundle?.runtimeEpoch ?? 'inactive'}:${project.revisionId}:${expectedCount}:${selectedKey ?? 'none'}`
  if (sceneIdentityRef.current === null) {
    sceneIdentityRef.current = sceneIdentity
  } else if (sceneIdentityRef.current !== sceneIdentity) {
    sceneIdentityRef.current = sceneIdentity
    samplesRef.current.clear()
    const next = reduceWorkcellScenePresentationV5([], expectedCount, selectedKey)
    presentationRef.current = next
    setPresentation(next)
  }
  const publishPresentation = useCallback((sample: WorkcellSceneGeometrySampleV5): void => {
    samplesRef.current.set(sample.key, sample)
    const next = reduceWorkcellScenePresentationV5([...samplesRef.current.values()], expectedCount, selectedKey)
    if (presentationEqual(presentationRef.current, next)) return
    presentationRef.current = next
    setPresentation(next)
    onPresentationChange?.(next)
  }, [expectedCount, onPresentationChange, selectedKey])
  const controlsRef = useRef<ComponentRef<typeof OrbitControls>>(null)
  const appliedPose = cameraPose ?? { position: [3.2, -4.2, 2.8] as const, target: [0, 0, 0] as const }
  const positionText = JSON.stringify(appliedPose.position)
  const targetText = JSON.stringify(appliedPose.target)
  const firstUnresolvedKey = presentation.unresolvedPoseKeys[0]
  return <div className="v5-scene-canvas" data-camera-position={positionText} data-camera-target={targetText} data-testid="scene-canvas-surface">
      {bundle === null
        ? <div className="v5-empty-state">Project runtime is not active.</div>
        : <Canvas onPointerMissed={() => undefined} shadows>
          <color attach="background" args={['#09121d']} />
          <ambientLight intensity={1.4} />
          <directionalLight castShadow intensity={2.2} position={[4, -3, 6]} />
          <PerspectiveCamera makeDefault position={[3.2, -4.2, 2.8]} up={[0, 0, 1]} />
          <OrbitControls makeDefault ref={controlsRef} />
          {cameraPose !== undefined && cameraVersion !== undefined
            ? <CameraPoseSynchronizer controlsRef={controlsRef} pose={cameraPose} version={cameraVersion} />
            : null}
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
            onGeometrySample={publishPresentation}
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
            onGeometrySample={publishPresentation}
            selected={selection?.kind === 'entity' && selection.id === entity.id}
          />)}
        </Canvas>}
      <div aria-live="polite" className="v5-scene-presentation" data-state={presentation.state} data-testid="v5-scene-presentation">
        <span>{presentation.visibleGeometryCount} visible geometry</span>
        {firstUnresolvedKey === undefined
          ? null
          : <span>World pose unavailable for {firstUnresolvedKey}. Geometry is hidden until runtime pose data recovers.</span>}
      </div>
    </div>
}
