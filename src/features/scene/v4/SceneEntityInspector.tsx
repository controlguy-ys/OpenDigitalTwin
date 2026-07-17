import type {
  FrameIdV4,
  RobotIdV4,
  RobotJobIdV4,
  SceneGroupIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import type { StoreApi } from 'zustand/vanilla'
import type { JobCommandServiceV4 } from '../../jobs/v4/job-command-service.js'
import type { JobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { JointInspectorV4 } from '../../joints/v4/JointInspector.js'
import {
  sameSceneSelectionV4,
  sceneSelectionKeyV4,
  type SceneSelectionV4,
} from '../../interaction/v4/scene-selection.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import type { RobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
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
  readonly selectedJobId: RobotJobIdV4 | null
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly sceneCommands: SceneCommandServiceV4
  readonly jobCommands: JobCommandServiceV4
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
  selectedJobId,
  robots,
  jobs,
  sceneCommands,
  jobCommands,
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
      : <p>Robot Frame: {frame.name} ({frame.id}), role {frame.role}</p>
  }

  return (
    <div aria-label="Robot inspector" className="scene-entity-inspector-v4">
      <section className="scene-inspector-section-v4">
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
      <RobotBaseInspectorV4
        commands={sceneCommands}
        key={robotId}
        project={project}
        robotId={robotId}
        runtime={runtime}
      />
      <JointInspectorV4
        commands={jobCommands}
        jobs={jobs}
        project={project}
        robotId={robotId}
        robots={robots}
        selectedJobId={selectedJobId}
      />
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
}

function SpatialEntityInspectorV4({
  project,
  runtime,
  entityId,
  commands,
}: SpatialInspectorPropsV4): ReactNode {
  const entity = project.spatialEntities.find(({ id }) => id === entityId)
  const projected = runtime.entities.get(entityId)
  const runtimeEntity: SceneRuntimeSpatialEntityV4 | null = projected?.kind === 'spatial-entity'
    ? projected
    : null
  const command = useInspectorCommandV4(`spatial-entity:${entityId}`)
  const localPoseSource = entity?.transformOwner === 'manual'
    ? entity.localPose
    : runtimeEntity?.localPose ?? entity?.localPose ?? project.scene.frames[0]!.localPose
  const localPoseSourceKey = JSON.stringify([
    ...localPoseSource.positionM,
    ...localPoseSource.quaternion,
  ])
  const groupIdSource = entity?.groupId ?? null
  const statusSource = entity?.numericStatus.sourceOwnership === 'manual'
    ? entity.numericStatus.value
    : runtimeEntity?.numericStatus ?? entity?.numericStatus.value ?? 0
  const overlayVisibleSource = entity?.numericStatus.overlay.visible ?? false
  const [draft, setDraft] = useState<TransformDraftV4>(() => (
    transformDraftFromRigidTransformV4(localPoseSource)
  ))
  const [groupId, setGroupId] = useState<SceneGroupIdV4 | null>(groupIdSource)
  const [status, setStatus] = useState(String(statusSource))
  const [overlayVisible, setOverlayVisible] = useState(overlayVisibleSource)

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

  if (entity === undefined || runtimeEntity === null) {
    return <p role="status">Spatial Entity is unavailable.</p>
  }

  const poseEditable = entity.transformOwner === 'manual'
  const statusEditable = entity.numericStatus.sourceOwnership === 'manual'
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
    <section aria-label={`${entity.name} inspector`} className="scene-entity-inspector-v4">
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
      <label>
        <span>Group</span>
        <select
          aria-label="Entity Group"
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
  const target = { kind: 'scene-group' as const, groupId }
  const command = useInspectorCommandV4(sceneSelectionKeyV4(target))
  const activeProjectRef = useRef(project)
  activeProjectRef.current = project

  useEffect(() => {
    setName(group?.name ?? '')
    setVisible(group?.visible ?? false)
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
    const invocationRevisionId = project.revisionId
    command.run(
      async () => {
        await commands.rename(target, nameAtSubmit)
        await commands.setPersistedVisibility(target, visibleAtSubmit)
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
    <section aria-label={`${frame.name} Scene Frame inspector`} className="scene-entity-inspector-v4">
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
      <MovingFrameInspectorV4
        commands={commands}
        entityId={entityId}
        frameId={frameId}
        project={project}
        runtime={runtime}
      />
    )
  }
  const grasp = entity?.graspFrames.find(({ frameId: candidate }) => candidate === frameId)
  const runtimeFrame = runtime.globalFrames.get(frameId)
  if (entity === undefined || grasp === undefined || runtimeFrame === undefined) {
    return <p role="status">Entity Frame is unavailable.</p>
  }
  return (
    <section aria-label={`${entity.name} ${grasp.name} inspector`} className="scene-entity-inspector-v4">
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
  selectedJobId,
  robots,
  jobs,
  interaction,
  sceneCommands,
  jobCommands,
}: SceneEntityInspectorPropsV4): ReactNode {
  if (selection === null) return <p>Select a Scene item to inspect.</p>

  switch (selection.kind) {
    case 'robot':
    case 'robot-link':
    case 'robot-frame':
      return (
        <RobotSelectionInspectorV4
          jobCommands={jobCommands}
          jobs={jobs}
          key={selection.robotId}
          project={project}
          robotId={selection.robotId}
          robots={robots}
          runtime={runtime}
          sceneCommands={sceneCommands}
          selectedJobId={selectedJobId}
          selection={selection}
        />
      )
    case 'spatial-entity':
      return (
        <SpatialEntityInspectorV4
          commands={sceneCommands}
          entityId={selection.entityId}
          key={selection.entityId}
          project={project}
          runtime={runtime}
        />
      )
    case 'entity-frame':
      return (
        <EntityFrameInspectorV4
          commands={sceneCommands}
          entityId={selection.entityId}
          frameId={selection.frameId}
          key={sceneSelectionKeyV4(selection)}
          project={project}
          runtime={runtime}
        />
      )
    case 'scene-group':
      return (
        <SceneGroupInspectorV4
          commands={sceneCommands}
          groupId={selection.groupId}
          interaction={interaction}
          key={selection.groupId}
          project={project}
          runtime={runtime}
        />
      )
    case 'scene-frame':
      return (
        <SceneFrameInspectorV4
          commands={sceneCommands}
          frameId={selection.frameId}
          key={selection.frameId}
          project={project}
          runtime={runtime}
        />
      )
  }
}
