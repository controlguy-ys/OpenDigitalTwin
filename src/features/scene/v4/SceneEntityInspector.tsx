import type {
  FrameIdV4,
  RobotIdV4,
  SceneGroupIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { JointInspectorV4 } from '../../joints/v4/JointInspector.js'
import {
  sameSceneSelectionV4,
  sceneSelectionKeyV4,
  type SceneSelectionTargetV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { ObjectRuntimeStateV4 } from '../../runtime-gateway/v4/object-runtime-state-v4.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import type {
  SceneRuntimeProjectionV4,
  SceneRuntimeSpatialEntityV4,
} from './scene-runtime-selector.js'
import {
  InspectorPoseFieldsV4,
  RobotBaseInspectorV4,
  useInspectorCommandV4,
} from './RobotBaseInspector.js'
import { MovingFrameInspectorV4 } from './MovingFrameInspector.js'
import { selectSpatialEntityOpcUaBindingV4 } from './spatial-entity-opcua-binding.js'
import {
  rigidTransformFromTransformDraftV4,
  transformDraftFromRigidTransformV4,
  type TransformDraftV4,
} from './transform-draft.js'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export interface SceneEntityInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly selection: SceneSelectionV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly sceneCommands: SceneCommandServiceV4
  readonly commandBindings: AppCommandBindingsV4
  readonly objectRuntime?: ObjectRuntimeStateV4 | null
  readonly onBindOpcUaJoints?: (robotId: RobotIdV4) => Promise<void>
  readonly focusRequest?: SceneEntityInspectorFocusRequestV4 | null
}

/**
 * A presentation-only request from App. It never changes the selected target
 * and is keyed by revision plus a monotonic request id so an identical command
 * can deliberately focus the same editor twice.
 */
export interface SceneEntityInspectorFocusRequestV4 {
  readonly id: number
  readonly projectRevisionId: WorkcellProjectV4['revisionId']
  readonly selection: SceneSelectionTargetV4
  readonly section: 'joints' | 'pose' | 'parent' | 'group' | 'binding' | 'numericStatus'
}

interface RobotInspectorPropsV4 extends Omit<
  SceneEntityInspectorPropsV4,
  'interaction' | 'selection'
> {
  readonly robotId: RobotIdV4
  readonly selection: Extract<NonNullable<SceneSelectionV4>, {
    readonly kind: 'robot' | 'robot-link' | 'robot-frame'
  }>
}

function RobotSelectionInspectorV4({
  project,
  runtime,
  selection,
  robotId,
  robots,
  jobs,
  sceneCommands,
  commandBindings,
  onBindOpcUaJoints,
}: RobotInspectorPropsV4): ReactNode {
  const robot = project.robots.find(({ id }) => id === robotId)
  const definition = robot === undefined
    ? undefined
    : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
  const runtimeRobot = runtime.entities.get(robotId)
  const runtimeToolFrameId = runtimeRobot?.kind === 'robot'
    ? runtimeRobot.selectedToolFrameId
    : ''
  const runtimeTcpFrameId = runtimeRobot?.kind === 'robot'
    ? runtimeRobot.selectedTcpFrameId
    : ''
  const statusOwnership = robot?.numericStatus.sourceOwnership ?? 'simulation'
  const statusSource = statusOwnership === 'manual'
    ? robot?.numericStatus.value ?? 0
    : runtimeRobot?.kind === 'robot'
      ? runtimeRobot.numericStatus
      : robot?.numericStatus.value ?? 0
  const overlayVisibleSource = robot?.numericStatus.overlay.visible ?? false
  const [toolFrameId, setToolFrameId] = useState<FrameIdV4>(
    runtimeToolFrameId,
  )
  const [tcpFrameId, setTcpFrameId] = useState<FrameIdV4>(
    runtimeTcpFrameId,
  )
  const [status, setStatus] = useState(String(statusSource))
  const [overlayVisible, setOverlayVisible] = useState(overlayVisibleSource)
  const toolCommand = useInspectorCommandV4(`robot-tool:${robotId}`)
  const statusCommand = useInspectorCommandV4(`robot-status:${robotId}`)

  useEffect(() => {
    setToolFrameId(runtimeToolFrameId)
    setTcpFrameId(runtimeTcpFrameId)
  }, [robotId, runtimeTcpFrameId, runtimeToolFrameId])

  useEffect(() => {
    setStatus(String(statusSource))
  }, [robotId, statusOwnership, statusSource])

  useEffect(() => {
    setOverlayVisible(overlayVisibleSource)
  }, [robotId, overlayVisibleSource])

  if (robot === undefined || definition === undefined || runtimeRobot?.kind !== 'robot') {
    return <p role="status">Selected Robot is unavailable.</p>
  }

  const tcpFrames = definition.frames.filter(({ role }) => role === 'tcp')
  const submitFrames = (): void => {
    if (
      !definition.frames.some(({ id }) => id === toolFrameId)
      || !tcpFrames.some(({ id }) => id === tcpFrameId)
    ) return
    toolCommand.run(() => sceneCommands.setSelectedToolFrames(robotId, toolFrameId, tcpFrameId))
  }
  const statusEditable = robot.numericStatus.sourceOwnership === 'manual'
  const submitStatus = (): void => {
    let statusValue = robot.numericStatus.value
    if (statusEditable) {
      const parsed = Number(status)
      if (status.trim().length === 0 || !Number.isFinite(parsed)) {
        statusCommand.reportError(new Error('Robot Numeric Status must be a finite number.'))
        return
      }
      statusValue = parsed
    }
    const target = { kind: 'robot' as const, robotId }
    const overlayVisibleAtSubmit = overlayVisible
    statusCommand.run(() => {
      const operations: Promise<unknown>[] = []
      if (statusEditable) {
        operations.push(sceneCommands.setNumericStatus(target, statusValue))
      }
      operations.push(sceneCommands.setStatusOverlayVisible(target, overlayVisibleAtSubmit))
      return Promise.all(operations)
    })
  }

  let metadata: ReactNode = null
  if (selection.kind === 'robot-link') {
    const link = definition.links.find(({ id }) => id === selection.linkId)
    metadata = link === undefined
      ? <p role="status">Robot Link is unavailable.</p>
      : <p>Robot Link: {link.name} ({link.id})</p>
  } else if (selection.kind === 'robot-frame') {
    const frame = definition.frames.find(({ id }) => id === selection.frameId)
    metadata = frame === undefined
      ? <p role="status">Robot Frame is unavailable.</p>
      : <p data-inspector-section-v4="pose" tabIndex={-1}>Robot Frame: {frame.name} ({frame.id}), role {frame.role}</p>
  }

  return (
    <div aria-label="Robot inspector" className="scene-entity-inspector-v4">
      <section className="scene-inspector-section-v4" data-inspector-section-v4="numericStatus" tabIndex={-1}>
        <h2>{robot.name}</h2>
        <p>{definition.name}</p>
        <p>Joint source: {runtimeRobot.jointSource}</p>
        <p>Numeric status: {runtimeRobot.numericStatus}</p>
        <p>Status owner: {robot.numericStatus.sourceOwnership}</p>
        {metadata}
        <label>
          <span>Tool Frame</span>
          <select
            aria-label="Tool Frame"
            disabled={toolCommand.pending}
            onChange={(event) => setToolFrameId(event.currentTarget.value)}
            value={toolFrameId}
          >
            {definition.frames.map((frame) => (
              <option key={frame.id} value={frame.id}>{frame.name} ({frame.role})</option>
            ))}
          </select>
        </label>
        <label>
          <span>TCP Frame</span>
          <select
            aria-label="TCP Frame"
            disabled={toolCommand.pending}
            onChange={(event) => setTcpFrameId(event.currentTarget.value)}
            value={tcpFrameId}
          >
            {tcpFrames.map((frame) => (
              <option key={frame.id} value={frame.id}>{frame.name} ({frame.role})</option>
            ))}
          </select>
        </label>
        <button disabled={toolCommand.pending} onClick={submitFrames} type="button">
          Apply Tool / TCP
        </button>
        {toolCommand.error === null ? null : <p role="alert">{toolCommand.error}</p>}
        <label>
          <span>Robot Numeric Status</span>
          <input
            aria-label="Robot Numeric Status"
            disabled={!statusEditable || statusCommand.pending}
            onChange={(event) => setStatus(event.currentTarget.value)}
            step="any"
            type="number"
            value={status}
          />
        </label>
        <label>
          <input
            aria-label="Robot Status Overlay Visible"
            checked={overlayVisible}
            disabled={statusCommand.pending}
            onChange={(event) => setOverlayVisible(event.currentTarget.checked)}
            type="checkbox"
          />
          Robot Status Overlay Visible
        </label>
        <button disabled={statusCommand.pending} onClick={submitStatus} type="button">
          Apply Robot Status
        </button>
        {statusCommand.error === null ? null : <p role="alert">{statusCommand.error}</p>}
      </section>
      <div data-inspector-section-v4={selection.kind === 'robot' ? 'pose' : undefined} tabIndex={selection.kind === 'robot' ? -1 : undefined}>
        <RobotBaseInspectorV4
          commands={sceneCommands}
          key={robotId}
          project={project}
          robotId={robotId}
          runtime={runtime}
        />
      </div>
      <div data-inspector-section-v4="joints" tabIndex={-1}>
      <JointInspectorV4
        commandBindings={commandBindings}
        jobs={jobs}
        project={project}
        robotId={robotId}
        robots={robots}
        {...(onBindOpcUaJoints === undefined ? {} : { onBindOpcUaJoints })}
      />
      </div>
    </div>
  )
}

function globalFrameLabelV4(project: WorkcellProjectV4, frameId: FrameIdV4): string {
  const scene = project.scene.frames.find(({ id }) => id === frameId)
  if (scene !== undefined) return `${scene.name} (${scene.id})`
  for (const entity of project.spatialEntities) {
    const grasp = entity.graspFrames.find(({ frameId: id }) => id === frameId)
    if (grasp !== undefined) return `${entity.name} / ${grasp.name} (${frameId})`
    const moving = entity.movingFrames.find(({ frameId: id }) => id === frameId)
    if (moving !== undefined) return `${entity.name} / ${moving.name} (${frameId})`
  }
  return frameId
}

interface SpatialInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly entityId: SpatialEntityIdV4
  readonly commands: SceneCommandServiceV4
  readonly objectRuntime?: ObjectRuntimeStateV4 | null
}

function SpatialEntityInspectorV4({
  project,
  runtime,
  entityId,
  commands,
  objectRuntime = null,
}: SpatialInspectorPropsV4): ReactNode {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  const projected = runtime.entities.get(entityId)
  const runtimeEntity: SceneRuntimeSpatialEntityV4 | null = projected?.kind === 'spatial-entity'
    ? projected
    : null
  const hasOpcUaTransformOwner = entity?.transformOwner.startsWith('opcua:') ?? false
  const hasOpcUaStatusOwner = entity?.numericStatus.sourceOwnership.startsWith('opcua:') ?? false
  const [liveHudRevision, setLiveHudRevision] = useState(0)
  useEffect(() => {
    if (objectRuntime === null || (!hasOpcUaTransformOwner && !hasOpcUaStatusOwner)) return
    const interval = window.setInterval(() => {
      setLiveHudRevision((revision) => revision + 1)
    }, 100)
    return () => window.clearInterval(interval)
  }, [entityId, hasOpcUaStatusOwner, hasOpcUaTransformOwner, objectRuntime])
  void liveHudRevision
  const command = useInspectorCommandV4(`spatial-entity:${entityId}`)
  const liveNowMs = Date.now()
  const livePose = !hasOpcUaTransformOwner || objectRuntime === null
    ? null
    : objectRuntime.sampleEntityFrame(entityId, entity?.parentFrameId ?? project.scene.frames[0]!.id, liveNowMs)
  const localPoseSource = entity?.transformOwner === 'manual'
    ? entity.localPose
    : livePose?.pose ?? runtimeEntity?.localPose ?? entity?.localPose ?? project.scene.frames[0]!.localPose
  const localPoseSourceKey = JSON.stringify([
    ...localPoseSource.positionM,
    ...localPoseSource.quaternion,
  ])
  const groupIdSource = entity?.groupId ?? null
  const liveStatus = !hasOpcUaStatusOwner || objectRuntime === null
    ? null
    : objectRuntime.readEntityStatus(entityId, liveNowMs)
  const statusSource = entity?.numericStatus.sourceOwnership === 'manual'
    ? entity.numericStatus.value
    : liveStatus?.value ?? runtimeEntity?.numericStatus ?? entity?.numericStatus.value ?? 0
  const overlayVisibleSource = entity?.numericStatus.overlay.visible ?? false
  const opcUaBinding = selectSpatialEntityOpcUaBindingV4(project, entityId)
  const boundEndpoint = opcUaBinding === null
    ? null
    : project.opcUa.endpoints.find(({ endpointId }) => endpointId === opcUaBinding.endpointId) ?? null
  const [draft, setDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(localPoseSource)
  ))
  const [groupId, setGroupId] = useState<SceneGroupIdV4 | null>(groupIdSource)
  const [status, setStatus] = useState(String(statusSource))
  const [overlayVisible, setOverlayVisible] = useState(overlayVisibleSource)
  const [opcUaEndpointUrl, setOpcUaEndpointUrl] = useState('opc.tcp://127.0.0.1:4840')
  const [opcUaInterval, setOpcUaInterval] = useState('100')
  const [opcUaPositionUnit, setOpcUaPositionUnit] = useState<'m' | 'mm'>('m')
  const [opcUaNodes, setOpcUaNodes] = useState({
    x: '', y: '', z: '', roll: '', pitch: '', yaw: '', status: '',
  })

  const reset = (): void => {
    if (entity === undefined) return
    setDraft(transformDraftFromRigidTransformV4(localPoseSource))
    setGroupId(groupIdSource)
    setStatus(String(statusSource))
    setOverlayVisible(overlayVisibleSource)
  }

  useEffect(() => {
    setDraft(transformDraftFromRigidTransformV4(localPoseSource))
  }, [entityId, entity?.transformOwner, localPoseSourceKey])

  useEffect(() => {
    setGroupId(groupIdSource)
  }, [entityId, groupIdSource])

  useEffect(() => {
    setStatus(String(statusSource))
  }, [entityId, entity?.numericStatus.sourceOwnership, statusSource])

  useEffect(() => {
    setOverlayVisible(overlayVisibleSource)
  }, [entityId, overlayVisibleSource])

  useEffect(() => {
    if (boundEndpoint === null) return
    setOpcUaEndpointUrl(boundEndpoint.endpointUrl)
    setOpcUaInterval(String(boundEndpoint.publishingIntervalMs))
  }, [boundEndpoint?.endpointId, boundEndpoint?.endpointUrl, boundEndpoint?.publishingIntervalMs])

  useEffect(() => {
    if (opcUaBinding === null) return
    const poseMapping = project.opcUa.mappings.find(({ id }) => id === opcUaBinding.poseMappingId)
    const statusMapping = opcUaBinding.statusMappingId === null
      ? null
      : project.opcUa.mappings.find(({ id }) => id === opcUaBinding.statusMappingId) ?? null
    if (poseMapping === undefined) return
    const nodeAt = (root: string, index: number): string => (
      poseMapping.leaves.find((leaf) => (
        leaf.leafPath[0] === root && leaf.leafPath[1] === index
      ))?.nodeId ?? ''
    )
    setOpcUaPositionUnit(poseMapping.leaves[0]?.scale === 0.001 ? 'mm' : 'm')
    setOpcUaNodes({
      x: nodeAt('positionM', 0), y: nodeAt('positionM', 1), z: nodeAt('positionM', 2),
      roll: nodeAt('rpyDegrees', 0), pitch: nodeAt('rpyDegrees', 1), yaw: nodeAt('rpyDegrees', 2),
      status: statusMapping?.leaves[0]?.nodeId ?? '',
    })
  }, [project.revisionId, opcUaBinding?.poseMappingId, opcUaBinding?.statusMappingId])

  if (entity === undefined || runtimeEntity === null) {
    return <p role="status">Spatial Entity is unavailable.</p>
  }

  const poseEditable = entity.transformOwner === 'manual'
  const statusEditable = entity.numericStatus.sourceOwnership === 'manual'
  const setOpcUaNode = (key: keyof typeof opcUaNodes, value: string): void => {
    setOpcUaNodes((current) => ({ ...current, [key]: value }))
  }
  const submitOpcUaBinding = (): void => {
    const publishingIntervalMs = Number(opcUaInterval)
    if (!Number.isSafeInteger(publishingIntervalMs) || publishingIntervalMs < 50) {
      command.reportError(new Error('OPC UA publishing interval must be a whole number of at least 50 ms.'))
      return
    }
    command.run(() => commands.configureSpatialEntityOpcUaBinding({
      entityId,
      endpointUrl: opcUaEndpointUrl,
      publishingIntervalMs,
      positionUnit: opcUaPositionUnit,
      nodeIds: {
        x: opcUaNodes.x,
        y: opcUaNodes.y,
        z: opcUaNodes.z,
        roll: opcUaNodes.roll,
        pitch: opcUaNodes.pitch,
        yaw: opcUaNodes.yaw,
      },
      ...(opcUaNodes.status.trim().length === 0 ? {} : { numericStatusNodeId: opcUaNodes.status }),
    }))
  }
  const submit = (): void => {
    let localPose = entity.localPose
    if (poseEditable) {
      try {
        localPose = rigidTransformFromTransformDraftV4(draft)
      } catch (caught) {
        command.reportError(caught)
        return
      }
    }
    let statusValue = entity.numericStatus.value
    if (statusEditable) {
      const value = Number(status)
      if (status.trim().length === 0 || !Number.isFinite(value)) {
        command.reportError(new Error('Numeric Status must be a finite number.'))
        return
      }
      statusValue = value
    }
    command.run(() => {
      const operations: Promise<unknown>[] = []
      if (poseEditable) {
        operations.push(commands.setSpatialEntityLocalPose(entityId, localPose))
      }
      if (statusEditable) {
        operations.push(commands.setNumericStatus(
          { kind: 'spatial-entity', entityId },
          statusValue,
        ))
      }
      operations.push(commands.setSpatialEntityGroup(entityId, groupId))
      operations.push(commands.setStatusOverlayVisible(
        { kind: 'spatial-entity', entityId },
        overlayVisible,
      ))
      return Promise.all(operations)
    })
  }

  return (
    <section aria-label={`${entity.name} inspector`} className="scene-entity-inspector-v4" data-inspector-section-v4="pose" tabIndex={-1}>
      <h2>{entity.name}</h2>
      <p>Parent Frame: {globalFrameLabelV4(project, entity.parentFrameId)}</p>
      <p>Transform owner: {entity.transformOwner}</p>
      <p>Status owner: {entity.numericStatus.sourceOwnership}</p>
      <InspectorPoseFieldsV4
        disabled={!poseEditable || command.pending}
        draft={draft}
        onChange={setDraft}
        prefix="Entity Local"
      />
      <details className="scene-entity-opcua-binding-v4">
        <summary data-inspector-section-v4="binding">OPC UA Pose Binding</summary>
        {opcUaBinding === null ? null : (
          <p>Bound to {boundEndpoint?.endpointUrl ?? opcUaBinding.endpointId} ({entity.transformOwner}).</p>
        )}
        <p>OPC UA pose overrides manual XYZ/RPY and move gizmo while bound.</p>
        <label>
          <span>Endpoint URL</span>
          <input
            aria-label="OPC UA Endpoint URL"
            disabled={command.pending}
            onChange={(event) => setOpcUaEndpointUrl(event.currentTarget.value)}
            value={opcUaEndpointUrl}
          />
        </label>
        <label>
          <span>Publishing Interval (ms)</span>
          <input
            aria-label="OPC UA Publishing Interval (ms)"
            disabled={command.pending}
            min="50"
            onChange={(event) => setOpcUaInterval(event.currentTarget.value)}
            type="number"
            value={opcUaInterval}
          />
        </label>
        <label>
          <span>Position Unit</span>
          <select
            aria-label="OPC UA Position Unit"
            disabled={command.pending}
            onChange={(event) => setOpcUaPositionUnit(event.currentTarget.value as 'm' | 'mm')}
            value={opcUaPositionUnit}
          >
            <option value="m">m</option>
            <option value="mm">mm</option>
          </select>
        </label>
        {([
          ['x', 'X'], ['y', 'Y'], ['z', 'Z'], ['roll', 'Roll'], ['pitch', 'Pitch'], ['yaw', 'Yaw'],
        ] as const).map(([key, label]) => (
          <label key={key}>
            <span>{label} Node ID</span>
            <input
              aria-label={`OPC UA ${label} Node ID`}
              disabled={command.pending}
              onChange={(event) => setOpcUaNode(key, event.currentTarget.value)}
              value={opcUaNodes[key]}
            />
          </label>
        ))}
        <label>
          <span>Status Node ID</span>
          <input
            aria-label="OPC UA Status Node ID"
            disabled={command.pending}
            onChange={(event) => setOpcUaNode('status', event.currentTarget.value)}
            value={opcUaNodes.status}
          />
        </label>
        <div>
          <button disabled={command.pending} onClick={submitOpcUaBinding} type="button">
            {opcUaBinding === null ? 'Bind OPC UA Pose' : 'Update OPC UA Pose'}
          </button>
          {!hasOpcUaTransformOwner ? null : (
            <button
              disabled={command.pending}
              onClick={() => command.run(() => commands.takeSpatialEntityManualControl(entityId))}
              type="button"
            >
              Take Manual Control
            </button>
          )}
        </div>
      </details>
      <label>
        <span>Group</span>
        <select
          aria-label="Entity Group"
          data-inspector-section-v4="group"
          disabled={command.pending}
          onChange={(event) => setGroupId(
            event.currentTarget.value.length === 0 ? null : event.currentTarget.value,
          )}
          value={groupId ?? ''}
        >
          <option value="">No Group</option>
          {project.sceneGroups.map((group) => (
            <option key={group.id} value={group.id}>{group.name}</option>
          ))}
        </select>
      </label>
      <label>
        <span>Numeric Status</span>
        <input
          aria-label="Numeric Status"
          data-inspector-section-v4="numericStatus"
          disabled={!statusEditable || command.pending}
          onChange={(event) => setStatus(event.currentTarget.value)}
          step="any"
          type="number"
          value={status}
        />
      </label>
      <label>
        <input
          aria-label="Status Overlay Visible"
          checked={overlayVisible}
          disabled={command.pending}
          onChange={(event) => setOverlayVisible(event.currentTarget.checked)}
          type="checkbox"
        />
        Status Overlay Visible
      </label>
      <div>
        <button disabled={command.pending} onClick={reset} type="button">Reset Entity</button>
        <button disabled={command.pending} onClick={submit} type="button">Apply Entity</button>
      </div>
      {command.error === null ? null : <p role="alert">{command.error}</p>}
    </section>
  )
}

interface GroupInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly groupId: SceneGroupIdV4
  readonly commands: SceneCommandServiceV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
}

function SceneGroupInspectorV4({
  project,
  runtime,
  groupId,
  commands,
  interaction,
}: GroupInspectorPropsV4): ReactNode {
  const group = project.sceneGroups.find(({ id }) => id === groupId)
  const runtimeGroup = runtime.groups.get(groupId)
  const [name, setName] = useState(group?.name ?? '')
  const [visible, setVisible] = useState(group?.visible ?? false)
  const [parentGroupId, setParentGroupId] = useState<SceneGroupIdV4 | null>(
    group?.parentGroupId ?? null,
  )
  const target = { kind: 'scene-group' as const, groupId }
  const command = useInspectorCommandV4(sceneSelectionKeyV4(target))
  const activeProjectRef = useRef(project)
  activeProjectRef.current = project

  useEffect(() => {
    setName(group?.name ?? '')
    setVisible(group?.visible ?? false)
    setParentGroupId(group?.parentGroupId ?? null)
  }, [group])

  if (group === undefined || runtimeGroup === undefined) {
    return <p role="status">Scene Group is unavailable.</p>
  }
  const parent = group.parentGroupId === null
    ? null
    : project.sceneGroups.find(({ id }) => id === group.parentGroupId)
  const submit = (): void => {
    const interactionRevisionAtSubmit = interaction.getState().projectRevisionId
    if (interactionRevisionAtSubmit !== project.revisionId) {
      command.reportError(new Error('The Group inspector Project revision is stale.'))
      return
    }
    const nameAtSubmit = name
    const visibleAtSubmit = visible
    const parentGroupIdAtSubmit = parentGroupId
    const invocationRevisionId = project.revisionId
    command.run(
      async () => {
        await commands.rename(target, nameAtSubmit)
        await commands.setPersistedVisibility(target, visibleAtSubmit)
        if (parentGroupIdAtSubmit !== group.parentGroupId) {
          await commands.reparentGroup(groupId, parentGroupIdAtSubmit)
        }
      },
      () => {
        if (visibleAtSubmit) return
        const activeProject = activeProjectRef.current
        const committedInActiveProject = (
          activeProject.revisionId === invocationRevisionId
          || activeProject.sceneGroups.find(({ id }) => id === groupId)?.visible === visibleAtSubmit
        )
        if (!committedInActiveProject) return
        const current = interaction.getState()
        if (
          !sameSceneSelectionV4(current.selection, target)
        ) return
        current.clearSelectionForHidden(target)
      },
    )
  }

  return (
    <section aria-label={`${group.name} Group inspector`} className="scene-entity-inspector-v4">
      <h2>{group.name}</h2>
      <p>Parent Group: {parent?.name ?? 'None'}</p>
      <p>Effective visibility: {runtimeGroup.effectiveVisible ? 'Visible' : 'Hidden'}</p>
      <label>
        <span>Group Name</span>
        <input
          aria-label="Group Name"
          disabled={command.pending}
          onChange={(event) => setName(event.currentTarget.value)}
          value={name}
        />
      </label>
      <label>
        <span>Parent Group</span>
        <select
          aria-label="Parent Group"
          data-inspector-section-v4="group"
          disabled={command.pending}
          onChange={(event) => setParentGroupId(
            event.currentTarget.value.length === 0 ? null : event.currentTarget.value,
          )}
          value={parentGroupId ?? ''}
        >
          <option value="">None</option>
          {project.sceneGroups
            .filter((candidate) => candidate.id !== groupId)
            .map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
            ))}
        </select>
      </label>
      <label>
        <input
          aria-label="Group Visible"
          checked={visible}
          disabled={command.pending}
          onChange={(event) => setVisible(event.currentTarget.checked)}
          type="checkbox"
        />
        Group Visible
      </label>
      <button disabled={command.pending} onClick={submit} type="button">Apply Group</button>
      {command.error === null ? null : <p role="alert">{command.error}</p>}
    </section>
  )
}

interface SceneFrameInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly frameId: FrameIdV4
  readonly commands: SceneCommandServiceV4
}

function SceneFrameInspectorV4({
  project,
  runtime,
  frameId,
  commands,
}: SceneFrameInspectorPropsV4): ReactNode {
  const frame = project.scene.frames.find(({ id }) => id === frameId)
  const runtimeFrame = runtime.globalFrames.get(frameId)
  const command = useInspectorCommandV4(`scene-frame:${frameId}`)
  const [draft, setDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(frame?.localPose ?? project.scene.frames[0]!.localPose)
  ))

  useEffect(() => {
    if (frame !== undefined) setDraft(transformDraftFromRigidTransformV4(frame.localPose))
  }, [frame])

  if (frame === undefined || runtimeFrame === undefined) {
    return <p role="status">Scene Frame is unavailable.</p>
  }
  const editable = frame.role !== 'world'
  const submit = (): void => {
    if (!editable) return
    let localPose
    try {
      localPose = rigidTransformFromTransformDraftV4(draft)
    } catch (caught) {
      command.reportError(caught)
      return
    }
    command.run(() => commands.setSceneFrameLocalPose(frameId, localPose))
  }

  return (
    <section aria-label={`${frame.name} Scene Frame inspector`} className="scene-entity-inspector-v4" data-inspector-section-v4="pose" tabIndex={-1}>
      <h2>{frame.name}</h2>
      <p>Role: {frame.role}</p>
      {editable ? null : <p role="status">World Frame is read-only.</p>}
      <InspectorPoseFieldsV4
        disabled={!editable || command.pending}
        draft={draft}
        onChange={setDraft}
        prefix="Scene Frame Local"
      />
      <InspectorPoseFieldsV4
        disabled
        draft={transformDraftFromRigidTransformV4(runtimeFrame.worldPose)}
        prefix="Scene Frame World"
      />
      <button disabled={!editable || command.pending} onClick={submit} type="button">
        Apply Scene Frame
      </button>
      {command.error === null ? null : <p role="alert">{command.error}</p>}
    </section>
  )
}

interface EntityFrameInspectorPropsV4 {
  readonly project: WorkcellProjectV4
  readonly runtime: SceneRuntimeProjectionV4
  readonly entityId: SpatialEntityIdV4
  readonly frameId: FrameIdV4
  readonly commands: SceneCommandServiceV4
}

function EntityFrameInspectorV4({
  project,
  runtime,
  entityId,
  frameId,
  commands,
}: EntityFrameInspectorPropsV4): ReactNode {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  const moving = entity?.movingFrames.find(({ frameId: candidate }) => candidate === frameId)
  if (moving !== undefined) {
    return (
      <div data-inspector-section-v4="parent" tabIndex={-1}>
        <MovingFrameInspectorV4
          commands={commands}
          entityId={entityId}
          frameId={frameId}
          project={project}
          runtime={runtime}
        />
      </div>
    )
  }
  const grasp = entity?.graspFrames.find(({ frameId: candidate }) => candidate === frameId)
  const runtimeFrame = runtime.globalFrames.get(frameId)
  if (entity === undefined || grasp === undefined || runtimeFrame === undefined) {
    return <p role="status">Entity Frame is unavailable.</p>
  }
  return (
    <section aria-label={`${entity.name} ${grasp.name} inspector`} className="scene-entity-inspector-v4" data-inspector-section-v4="parent" tabIndex={-1}>
      <h2>Grasp Frame</h2>
      <p>{entity.name} / {grasp.name} ({grasp.frameId})</p>
      <p role="status">Grasp Frame is read-only.</p>
      <InspectorPoseFieldsV4
        disabled
        draft={transformDraftFromRigidTransformV4(grasp.localPose)}
        prefix="Grasp Frame Local"
      />
      <InspectorPoseFieldsV4
        disabled
        draft={transformDraftFromRigidTransformV4(runtimeFrame.worldPose)}
        prefix="Grasp Frame World"
      />
    </section>
  )
}

export function SceneEntityInspectorV4({
  project,
  runtime,
  selection,
  robots,
  jobs,
  interaction,
  sceneCommands,
  commandBindings,
  objectRuntime = null,
  onBindOpcUaJoints,
  focusRequest = null,
}: SceneEntityInspectorPropsV4): ReactNode {
  const rootRef = useRef<HTMLDivElement>(null)
  const consumedFocusRequestKey = useRef<string | null>(null)
  useEffect(() => {
    if (
      focusRequest === null
      || focusRequest.projectRevisionId !== project.revisionId
      || selection === null
      || !sameSceneSelectionV4(selection, focusRequest.selection)
    ) return
    const requestKey = `${focusRequest.projectRevisionId}:${focusRequest.id}`
    if (consumedFocusRequestKey.current === requestKey) return
    const target = rootRef.current?.querySelector<HTMLElement>(
      `[data-inspector-section-v4="${focusRequest.section}"]`,
    )
    if (target === undefined || target === null) return
    const disclosure = target.closest<HTMLDetailsElement>('details')
    if (disclosure !== null) disclosure.open = true
    target.scrollIntoView?.({ block: 'nearest' })
    target.focus({ preventScroll: true })
    consumedFocusRequestKey.current = requestKey
  }, [focusRequest, project.revisionId, runtime, selection])

  let content: ReactNode = null
  if (selection === null) {
    content = <p>Select a Scene item to inspect.</p>
  } else switch (selection.kind) {
    case 'robot':
    case 'robot-link':
    case 'robot-frame':
      content = (
        <RobotSelectionInspectorV4
          commandBindings={commandBindings}
          jobs={jobs}
          key={selection.robotId}
          project={project}
          robotId={selection.robotId}
          robots={robots}
          runtime={runtime}
          sceneCommands={sceneCommands}
          selection={selection}
          {...(onBindOpcUaJoints === undefined ? {} : { onBindOpcUaJoints })}
        />
      )
      break
    case 'spatial-entity':
      content = (
        <SpatialEntityInspectorV4
          commands={sceneCommands}
          entityId={selection.entityId}
          key={selection.entityId}
          project={project}
          runtime={runtime}
          objectRuntime={objectRuntime}
        />
      )
      break
    case 'entity-frame':
      content = (
        <EntityFrameInspectorV4
          commands={sceneCommands}
          entityId={selection.entityId}
          frameId={selection.frameId}
          key={sceneSelectionKeyV4(selection)}
          project={project}
          runtime={runtime}
        />
      )
      break
    case 'scene-group':
      content = (
        <SceneGroupInspectorV4
          commands={sceneCommands}
          groupId={selection.groupId}
          interaction={interaction}
          key={selection.groupId}
          project={project}
          runtime={runtime}
        />
      )
      break
    case 'scene-frame':
      content = (
        <SceneFrameInspectorV4
          commands={sceneCommands}
          frameId={selection.frameId}
          key={selection.frameId}
          project={project}
          runtime={runtime}
        />
      )
      break
  }
  return <div className="scene-entity-inspector-focus-root-v4" ref={rootRef}>{content}</div>
}
