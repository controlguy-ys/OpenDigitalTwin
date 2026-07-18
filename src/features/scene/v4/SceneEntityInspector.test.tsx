import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  rpyDegreesToQuaternionV4,
  validateWorkcellProjectV4,
  type RigidTransformV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { projectAtLimit } from '../../../core/project-v4/test-support.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import { createJobRuntimeStoreV4 } from '../../jobs/v4/job-runtime-store.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import { createInteractionStoreV4 } from '../../interaction/v4/interaction-store.js'
import type { ObjectRuntimeStateV4 } from '../../runtime-gateway/v4/object-runtime-state-v4.js'
import type { SceneSelectionV4 } from '../../interaction/v4/scene-selection.js'
import type { SceneCommandServiceV4 } from './scene-command-service.js'
import { selectSceneRuntimeV4 } from './scene-runtime-selector.js'
import { SceneEntityInspectorV4 } from './SceneEntityInspector.js'

function pose(
  x = 0,
  y = 0,
  z = 0,
  rpy: readonly [number, number, number] = [0, 0, 0],
): RigidTransformV4 {
  return { positionM: [x, y, z], quaternion: rpyDegreesToQuaternionV4(rpy) }
}

function inspectorProject(): WorkcellProjectV4 {
  const source = projectAtLimit('robotDefinitions', 2)
  const definitions = source.robotDefinitions.map((definition, index) => ({
    ...definition,
    name: `Definition ${index + 1}`,
    frames: [
      ...definition.frames,
      {
        id: 'GripTool',
        name: `Gripper ${index + 1}`,
        parentFrameId: 'Tool',
        localPose: pose(),
        role: 'gripper' as const,
      },
      {
        id: 'CustomTool',
        name: `Custom ${index + 1}`,
        parentFrameId: 'Tool',
        localPose: pose(),
        role: 'custom' as const,
      },
      {
        id: 'TCP2',
        name: `TCP ${index + 1} Alternate`,
        parentFrameId: 'Tool',
        localPose: pose(0, 0, 0.1),
        role: 'tcp' as const,
      },
    ],
  }))

  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-inspector',
    robotDefinitions: definitions,
    robots: source.robots.map((robot, index) => ({
      ...robot,
      name: `Robot ${index + 1}`,
      jointSource: index === 0 ? 'simulation' as const : 'manual' as const,
      numericStatus: {
        ...robot.numericStatus,
        value: (index + 1) * 10,
        sourceOwnership: index === 1 ? 'manual' as const : 'simulation' as const,
      },
    })),
    scene: {
      frames: [
        ...source.scene.frames,
        {
          id: 'fixture-frame',
          name: 'Fixture Frame',
          parentFrameId: 'mcp',
          localPose: pose(0.5, 0, 0),
          role: 'custom' as const,
        },
      ],
    },
    sceneGroups: [
      { id: 'root-group', name: 'Root Group', parentGroupId: null, visible: false },
      { id: 'child-group', name: 'Child Group', parentGroupId: 'root-group', visible: true },
    ],
    spatialEntities: [
      {
        id: 'platform',
        name: 'Platform',
        geometry: { kind: 'box', dimensionsM: [1, 1, 0.2], color: '#808080' },
        parentFrameId: 'fixture-frame',
        localPose: pose(0.1, 0.2, 0.3, [1, 2, 3]),
        visible: true,
        groupId: 'child-group',
        removable: true,
        transformOwner: 'manual',
        numericStatus: {
          value: 12,
          sourceOwnership: 'manual',
          overlay: { visible: true, frameId: null },
        },
        graspable: true,
        graspFrames: [{ frameId: 'grasp-platform', name: 'Platform Grip', localPose: pose() }],
        movingFrames: [
          {
            frameId: 'carriage',
            name: 'Carriage',
            parentFrameId: 'mcp',
            localPose: pose(0.25, 0, 0),
            sourceOwnership: 'manual',
          },
          {
            frameId: 'live-carriage',
            name: 'Live Carriage',
            parentFrameId: 'world',
            localPose: pose(),
            sourceOwnership: 'simulation',
          },
        ],
      },
      {
        id: 'locked-object',
        name: 'Locked Object',
        geometry: { kind: 'cylinder', radiusM: 0.1, heightM: 0.5, axis: 'z', radialSegments: 32, color: '#808080' },
        parentFrameId: 'world',
        localPose: pose(),
        visible: true,
        groupId: null,
        removable: true,
        transformOwner: 'simulation',
        numericStatus: {
          value: 7,
          sourceOwnership: 'simulation',
          overlay: { visible: false, frameId: null },
        },
        graspable: false,
        graspFrames: [],
        movingFrames: [],
      },
    ],
  })
}

function boundInspectorProject(): WorkcellProjectV4 {
  const source = inspectorProject()
  const entityId = 'platform'
  const endpointId = 'endpoint-platform'
  const frameId = 'platform-opcua-frame'
  return validateWorkcellProjectV4({
    ...source,
    spatialEntities: source.spatialEntities.map((candidate) => (
      candidate.id !== entityId ? candidate : {
        ...candidate,
        parentFrameId: frameId,
        localPose: pose(),
        transformOwner: `opcua:${endpointId}` as const,
        numericStatus: { ...candidate.numericStatus, sourceOwnership: `opcua:${endpointId}` as const },
        movingFrames: [...candidate.movingFrames, {
          frameId,
          name: 'Platform OPC UA Frame',
          parentFrameId: 'fixture-frame',
          localPose: pose(0.1, 0.2, 0.3),
          sourceOwnership: `opcua:${endpointId}` as const,
        }],
      }
    )),
    opcUa: {
      mode: 'client',
      endpoints: [{
        endpointId,
        name: 'Platform endpoint',
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
        publishingIntervalMs: 100,
        reconnectDelayMs: 1_000,
      }],
      mappings: [{
        id: 'mapping-platform-pose',
        endpointId,
        direction: 'read',
        coherenceGroupId: 'entity-platform-pose',
        sourceOwnership: `opcua:${endpointId}` as const,
        interpolationMode: 'shortest-quaternion',
        coordinateConvention: 'project-v4-z-up-metres-quaternion-xyzw',
        leaves: ([
          ['positionM', 0], ['positionM', 1], ['positionM', 2],
          ['rpyDegrees', 0], ['rpyDegrees', 1], ['rpyDegrees', 2],
        ] as const).map(([root, index]) => ({
          leafPath: [root, index],
          nodeId: `ns=2;s=Platform.${root}.${index}`,
          projectTarget: { type: 'entity-frame' as const, entityId, frameId },
          opcUaDataType: 'Double' as const,
          projectDataType: 'number' as const,
          scale: 1,
          offset: 0,
          unit: root === 'positionM' ? 'metre' : 'degree',
          required: true,
        })),
      }],
      actionBindings: [],
      bridgeRoutes: [],
    },
  })
}

function sceneCommands(overrides: Partial<SceneCommandServiceV4> = {}): SceneCommandServiceV4 {
  return {
    createBox: vi.fn(async () => 'new-box'),
    createCylinder: vi.fn(async () => 'new-cylinder'),
    createGroup: vi.fn(async () => 'new-group'),
    rename: vi.fn(async () => undefined),
    setPersistedVisibility: vi.fn(async () => undefined),
    setSpatialEntityLocalPose: vi.fn(async () => undefined),
    setSpatialEntityGroup: vi.fn(async () => undefined),
    setRobotBase: vi.fn(async () => undefined),
    setSelectedToolFrames: vi.fn(async () => undefined),
    setSceneFrameLocalPose: vi.fn(async () => undefined),
    setMovingFrame: vi.fn(async () => undefined),
    configureSpatialEntityOpcUaBinding: vi.fn(async () => undefined),
    takeSpatialEntityManualControl: vi.fn(async () => undefined),
    setNumericStatus: vi.fn(async () => undefined),
    setStatusOverlayVisible: vi.fn(async () => undefined),
    reparentGroup: vi.fn(async () => undefined),
    ungroup: vi.fn(async () => undefined),
    deleteSpatialEntity: vi.fn(async () => undefined),
    deleteGroupAndContents: vi.fn(async () => undefined),
    ...overrides,
  }
}

function renderInspector(
  selection: SceneSelectionV4,
  commands = sceneCommands(),
  project = inspectorProject(),
  objectRuntime: ObjectRuntimeStateV4 | null = null,
) {
  const robots = createRobotRuntimeRegistryV4()
  const jobs = createJobRuntimeStoreV4()
  const interaction = createInteractionStoreV4()
  robots.getState().replaceProject(project)
  jobs.getState().replaceProject(project)
  interaction.getState().replaceProject(project)
  interaction.getState().select(selection)
  const commandBindings = createAppCommandBindingsV4(
    createAppCommandRuntimeV4(createAppCommandRegistryV4([])),
  )
  const props = {
    project,
    runtime: selectSceneRuntimeV4(project, robots.getState()),
    selection,
    interaction,
    selectedJobId: project.jobs[0]?.id ?? null,
    robots,
    jobs,
    sceneCommands: commands,
    commandBindings,
    objectRuntime,
  }
  const view = render(<SceneEntityInspectorV4 {...props} />)
  return { ...view, commands, props, project, robots, jobs, interaction }
}

async function replaceNumber(label: string, value: string): Promise<void> {
  const user = userEvent.setup()
  const input = screen.getByLabelText(label)
  await user.clear(input)
  await user.type(input, value)
}

describe('SceneEntityInspectorV4', () => {
  it('renders a concise prompt for an empty selection', () => {
    renderInspector(null)
    expect(screen.getByText('Select a Scene item to inspect.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Robot Base' })).not.toBeInTheDocument()
  })

  it('routes the exact selected Robot, every local Tool role, tcp-only choices, and Joints', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'robot', robotId: 'robot-2' })

    expect(screen.getByRole('heading', { name: 'Robot 2' })).toBeVisible()
    expect(screen.getByText('Definition 2')).toBeVisible()
    expect(screen.getByText('Joint source: manual')).toBeVisible()
    expect(screen.getByText('Numeric status: 20')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Robot Base' })).toBeVisible()
    expect(screen.getByRole('group', { name: 'Robot 2 Joint controls' })).toBeVisible()

    const tool = screen.getByLabelText('Tool Frame') as HTMLSelectElement
    const tcp = screen.getByLabelText('TCP Frame') as HTMLSelectElement
    expect(Array.from(tool.options).map(({ text }) => text)).toEqual([
      'Base (base)',
      'Tool (tool)',
      'TCP (tcp)',
      'Gripper 2 (gripper)',
      'Custom 2 (custom)',
      'TCP 2 Alternate (tcp)',
    ])
    expect(Array.from(tcp.options).map(({ text }) => text)).toEqual([
      'TCP (tcp)',
      'TCP 2 Alternate (tcp)',
    ])
    expect(tool).not.toHaveTextContent('Custom 1')

    await user.selectOptions(tool, 'CustomTool')
    await user.selectOptions(tcp, 'TCP2')
    await user.click(screen.getByRole('button', { name: 'Apply Tool / TCP' }))
    await waitFor(() => expect(harness.commands.setSelectedToolFrames)
      .toHaveBeenCalledWith('robot-2', 'CustomTool', 'TCP2'))
  })

  it('consumes a revision-qualified focus request only for its exact selection and refocuses a repeated section', () => {
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'platform' })
    const request = {
      id: 1,
      projectRevisionId: harness.project.revisionId,
      selection: { kind: 'spatial-entity' as const, entityId: 'platform' },
      section: 'group' as const,
    }
    harness.rerender(<SceneEntityInspectorV4 {...harness.props} focusRequest={request} />)
    expect(screen.getByLabelText('Entity Group')).toHaveFocus()

    harness.rerender(<SceneEntityInspectorV4 {...harness.props} focusRequest={{ ...request, id: 2 }} />)
    expect(screen.getByLabelText('Entity Group')).toHaveFocus()

    const focus = vi.spyOn(HTMLElement.prototype, 'focus')
    harness.rerender(<SceneEntityInspectorV4
      {...harness.props}
      focusRequest={{ ...request, id: 3, selection: { kind: 'robot', robotId: 'robot-1' } }}
    />)
    expect(focus).not.toHaveBeenCalled()
  })

  it('focuses a manual Moving Frame parent editor again for a repeated monotonic request', () => {
    const selection = {
      kind: 'entity-frame' as const,
      entityId: 'platform',
      frameId: 'carriage',
    }
    const harness = renderInspector(selection)
    const target = document.querySelector<HTMLElement>(
      '[data-inspector-section-v4="parent"]',
    )!
    const focus = vi.spyOn(target, 'focus')
    const request = {
      id: 1,
      projectRevisionId: harness.project.revisionId,
      selection,
      section: 'parent' as const,
    }

    harness.rerender(<SceneEntityInspectorV4 {...harness.props} focusRequest={request} />)
    harness.rerender(<SceneEntityInspectorV4
      {...harness.props}
      focusRequest={{ ...request, id: 2 }}
    />)

    expect(focus).toHaveBeenCalledTimes(2)
  })

  it('edits manual Robot numeric Status and overlay through the exact Robot target', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'robot', robotId: 'robot-2' })
    const source = harness.project.robots.find(({ id }) => id === 'robot-2')!

    expect(screen.getByText('Status owner: manual')).toBeVisible()
    expect(screen.getByLabelText('Robot Numeric Status')).toBeEnabled()
    await replaceNumber('Robot Numeric Status', '42')
    await user.click(screen.getByLabelText('Robot Status Overlay Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Robot Status' }))

    await waitFor(() => expect(harness.commands.setNumericStatus).toHaveBeenCalledWith(
      { kind: 'robot', robotId: 'robot-2' },
      42,
    ))
    expect(harness.commands.setStatusOverlayVisible).toHaveBeenCalledWith(
      { kind: 'robot', robotId: 'robot-2' },
      !source.numericStatus.overlay.visible,
    )
  })

  it('shows non-manual Robot Status live/read-only while keeping overlay editable', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'robot', robotId: 'robot-1' })
    const projected = harness.props.runtime.entities.get('robot-1')!
    if (projected.kind !== 'robot') throw new Error('Expected Robot runtime.')
    const entities = new Map(harness.props.runtime.entities)
    entities.set('robot-1', { ...projected, numericStatus: 87 })
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        runtime={{ ...harness.props.runtime, entities }}
      />,
    )

    expect(screen.getByText('Status owner: simulation')).toBeVisible()
    expect(screen.getByLabelText('Robot Numeric Status')).toBeDisabled()
    expect(screen.getByLabelText('Robot Numeric Status')).toHaveValue(87)
    expect(screen.getByLabelText('Robot Status Overlay Visible')).toBeEnabled()
    await user.click(screen.getByLabelText('Robot Status Overlay Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Robot Status' }))

    await waitFor(() => expect(harness.commands.setStatusOverlayVisible).toHaveBeenCalledWith(
      { kind: 'robot', robotId: 'robot-1' },
      expect.any(Boolean),
    ))
    expect(harness.commands.setNumericStatus).not.toHaveBeenCalled()
  })

  it('blocks same-batch duplicate Robot Status commands', async () => {
    let resolveStatus!: () => void
    const pendingStatus = new Promise<void>((resolve) => { resolveStatus = resolve })
    const commands = sceneCommands({ setNumericStatus: vi.fn(() => pendingStatus) })
    renderInspector({ kind: 'robot', robotId: 'robot-2' }, commands)
    const apply = screen.getByRole('button', { name: 'Apply Robot Status' })

    act(() => {
      fireEvent.click(apply)
      fireEvent.click(apply)
    })

    await waitFor(() => expect(commands.setNumericStatus).toHaveBeenCalledTimes(1))
    expect(commands.setStatusOverlayVisible).toHaveBeenCalledTimes(1)
    resolveStatus()
  })

  it('keeps Robot Link and Robot Frame identity scoped to the owning Robot', () => {
    const harness = renderInspector({ kind: 'robot-link', robotId: 'robot-2', linkId: 'L0' })
    expect(screen.getByRole('heading', { name: 'Robot 2' })).toBeVisible()
    expect(screen.getByText('Robot Link: Link 0 (L0)')).toBeVisible()

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        selection={{ kind: 'robot-frame', robotId: 'robot-2', frameId: 'TCP' }}
      />,
    )
    expect(screen.getByText('Robot Frame: TCP (TCP), role tcp')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Robot 2' })).toBeVisible()
  })

  it('preserves dirty Tool and TCP drafts across an equivalent fresh runtime projection', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'robot', robotId: 'robot-2' })
    await user.selectOptions(screen.getByLabelText('Tool Frame'), 'CustomTool')
    await user.selectOptions(screen.getByLabelText('TCP Frame'), 'TCP2')

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        runtime={selectSceneRuntimeV4(harness.project, harness.robots.getState())}
      />,
    )

    expect(screen.getByLabelText('Tool Frame')).toHaveValue('CustomTool')
    expect(screen.getByLabelText('TCP Frame')).toHaveValue('TCP2')
  })

  it('submits Robot Base parent, local pose, and intentional mount atomically', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'robot', robotId: 'robot-1' })
    const parent = screen.getByLabelText('Robot Base Parent Frame') as HTMLSelectElement
    expect(Array.from(parent.options).map(({ text }) => text)).toContain(
      'Platform / Carriage (Moving Frame)',
    )
    expect(parent).not.toHaveTextContent('Platform Grip')

    await user.selectOptions(parent, 'carriage')
    await user.selectOptions(screen.getByLabelText('Intentional Mount Entity'), 'platform')
    await replaceNumber('Robot Base Local Position X (mm)', '125')
    await user.click(screen.getByRole('button', { name: 'Apply Robot Base' }))

    await waitFor(() => expect(harness.commands.setRobotBase).toHaveBeenCalledOnce())
    expect(vi.mocked(harness.commands.setRobotBase).mock.calls[0]![0]).toMatchObject({
      robotId: 'robot-1',
      baseParentFrameId: 'carriage',
      intentionalMountEntityId: 'platform',
      localBasePose: { positionM: [0.125, 0, 0] },
    })
    expect(screen.getByText(/Local pose is relative to Platform \/ Carriage/i)).toBeVisible()
  })

  it('edits a manual Spatial Entity status, overlay, group, and local XYZRPY, then resets', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'platform' })
    expect(screen.getByText('Parent Frame: Fixture Frame (fixture-frame)')).toBeVisible()
    expect(screen.getByText('Transform owner: manual')).toBeVisible()

    await replaceNumber('Entity Local Position X (mm)', '250')
    await user.selectOptions(screen.getByLabelText('Entity Group'), 'root-group')
    await replaceNumber('Numeric Status', '42')
    await user.click(screen.getByLabelText('Status Overlay Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Entity' }))

    await waitFor(() => expect(harness.commands.setSpatialEntityLocalPose).toHaveBeenCalledOnce())
    expect(harness.commands.setSpatialEntityLocalPose).toHaveBeenCalledWith(
      'platform',
      expect.objectContaining({ positionM: [0.25, 0.2, 0.3] }),
    )
    expect(harness.commands.setSpatialEntityGroup).toHaveBeenCalledWith('platform', 'root-group')
    expect(harness.commands.setNumericStatus).toHaveBeenCalledWith(
      { kind: 'spatial-entity', entityId: 'platform' },
      42,
    )
    expect(harness.commands.setStatusOverlayVisible).toHaveBeenCalledWith(
      { kind: 'spatial-entity', entityId: 'platform' },
      false,
    )

    await replaceNumber('Entity Local Position X (mm)', '999')
    await user.click(screen.getByRole('button', { name: 'Reset Entity' }))
    expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(100)
    expect(screen.getByLabelText('Numeric Status')).toHaveValue(12)
  })

  it('keeps non-manual Entity pose and numeric Status read-only', () => {
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'locked-object' })
    const runtimeEntity = harness.props.runtime.entities.get('locked-object')!
    if (runtimeEntity.kind !== 'spatial-entity') throw new Error('Expected Spatial Entity runtime.')
    const entities = new Map(harness.props.runtime.entities)
    entities.set('locked-object', { ...runtimeEntity, localPose: pose(0.321, 0, 0) })
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        runtime={{ ...harness.props.runtime, entities }}
      />,
    )
    expect(screen.getByText('Transform owner: simulation')).toBeVisible()
    expect(screen.getByLabelText('Entity Local Position X (mm)')).toBeDisabled()
    expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(321)
    expect(screen.getByLabelText('Numeric Status')).toBeDisabled()
    expect(screen.getByLabelText('Entity Group')).toBeEnabled()
    expect(screen.getByLabelText('Status Overlay Visible')).toBeEnabled()
  })

  it('authors a compact OPC UA pose binding from the Spatial Entity inspector', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'platform' })

    expect(screen.getByText('OPC UA Pose Binding')).toBeVisible()
    expect(screen.getByLabelText('OPC UA Endpoint URL')).toHaveValue('opc.tcp://127.0.0.1:4840')
    expect(screen.getByLabelText('OPC UA Publishing Interval (ms)')).toHaveValue(100)
    expect(screen.getByLabelText('OPC UA Position Unit')).toHaveValue('m')
    await user.type(screen.getByLabelText('OPC UA X Node ID'), 'ns=2;s=Platform.X')
    await user.type(screen.getByLabelText('OPC UA Y Node ID'), 'ns=2;s=Platform.Y')
    await user.type(screen.getByLabelText('OPC UA Z Node ID'), 'ns=2;s=Platform.Z')
    await user.type(screen.getByLabelText('OPC UA Roll Node ID'), 'ns=2;s=Platform.Roll')
    await user.type(screen.getByLabelText('OPC UA Pitch Node ID'), 'ns=2;s=Platform.Pitch')
    await user.type(screen.getByLabelText('OPC UA Yaw Node ID'), 'ns=2;s=Platform.Yaw')
    await user.type(screen.getByLabelText('OPC UA Status Node ID'), 'ns=2;s=Platform.Status')
    await user.click(screen.getByRole('button', { name: 'Bind OPC UA Pose' }))

    await waitFor(() => expect(harness.commands.configureSpatialEntityOpcUaBinding).toHaveBeenCalledOnce())
    expect(harness.commands.configureSpatialEntityOpcUaBinding).toHaveBeenCalledWith({
      entityId: 'platform',
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      publishingIntervalMs: 100,
      positionUnit: 'm',
      nodeIds: {
        x: 'ns=2;s=Platform.X', y: 'ns=2;s=Platform.Y', z: 'ns=2;s=Platform.Z',
        roll: 'ns=2;s=Platform.Roll', pitch: 'ns=2;s=Platform.Pitch', yaw: 'ns=2;s=Platform.Yaw',
      },
      numericStatusNodeId: 'ns=2;s=Platform.Status',
    })
  })

  it('force-locks bound Entity pose fields and exposes manual takeover', async () => {
    const user = userEvent.setup()
    const harness = renderInspector(
      { kind: 'spatial-entity', entityId: 'platform' },
      sceneCommands(),
      boundInspectorProject(),
    )

    expect(screen.getByLabelText('Entity Local Position X (mm)')).toBeDisabled()
    await user.click(screen.getByText('OPC UA Pose Binding'))
    expect(screen.getByText(/OPC UA pose overrides manual XYZ\/RPY and move gizmo while bound/i)).toBeVisible()
    expect(screen.getByText(/Bound to opc\.tcp:\/\/127\.0\.0\.1:4840/i)).toBeVisible()
    expect(screen.getByLabelText('OPC UA X Node ID')).toHaveValue('ns=2;s=Platform.positionM.0')
    await user.click(screen.getByRole('button', { name: 'Take Manual Control' }))
    await waitFor(() => expect(harness.commands.takeSpatialEntityManualControl)
      .toHaveBeenCalledWith('platform'))
  })

  it('shows live OPC UA Entity pose and status at the bounded operator HUD cadence', () => {
    vi.useFakeTimers()
    try {
      const live = {
        pose: pose(0.456, 0.2, 0.3, [10, 20, 30]),
        status: 42,
      }
      const objectRuntime: ObjectRuntimeStateV4 = {
        ingest: vi.fn(() => false),
        resetGatewaySession: vi.fn(),
        sampleEntityFrame: vi.fn(() => ({
          entityId: 'platform',
          frameId: 'platform-opcua-frame',
          sourceTimestampMs: 5_000,
          pose: live.pose,
          quality: 'BAD' as const,
          statusCode: 'BadNoCommunication',
        })),
        readEntityStatus: vi.fn(() => ({
          entityId: 'platform',
          sourceTimestampMs: 5_000,
          value: live.status,
          quality: 'STALE' as const,
          statusCode: 'BadNoCommunication',
        })),
        bindingKeys: () => [],
      }
      const harness = renderInspector(
        { kind: 'spatial-entity', entityId: 'platform' },
        sceneCommands(),
        boundInspectorProject(),
        objectRuntime,
      )

      expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(456)
      expect(screen.getByLabelText('Numeric Status')).toHaveValue(42)

      live.pose = pose(0.789, 0.2, 0.3, [10, 20, 30])
      live.status = 43
      act(() => { vi.advanceTimersByTime(100) })

      expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(789)
      expect(screen.getByLabelText('Numeric Status')).toHaveValue(43)
      harness.unmount()

      const poseReadsAtUnmount = vi.mocked(objectRuntime.sampleEntityFrame).mock.calls.length
      act(() => { vi.advanceTimersByTime(500) })
      expect(objectRuntime.sampleEntityFrame).toHaveBeenCalledTimes(poseReadsAtUnmount)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not replace a dirty manual Entity draft when an Object runtime is available', () => {
    vi.useFakeTimers()
    try {
      const objectRuntime: ObjectRuntimeStateV4 = {
        ingest: vi.fn(() => false),
        resetGatewaySession: vi.fn(),
        sampleEntityFrame: vi.fn(() => null),
        readEntityStatus: vi.fn(() => null),
        bindingKeys: () => [],
      }
      renderInspector(
        { kind: 'spatial-entity', entityId: 'platform' },
        sceneCommands(),
        inspectorProject(),
        objectRuntime,
      )
      fireEvent.change(screen.getByLabelText('Entity Local Position X (mm)'), {
        target: { value: '777' },
      })
      act(() => { vi.advanceTimersByTime(500) })

      expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(777)
      expect(objectRuntime.sampleEntityFrame).not.toHaveBeenCalled()
      expect(objectRuntime.readEntityStatus).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('exposes manual takeover for a partially authored OPC UA transform binding', async () => {
    const user = userEvent.setup()
    const source = boundInspectorProject()
    const partial = validateWorkcellProjectV4({
      ...source,
      opcUa: {
        ...source.opcUa,
        mappings: source.opcUa.mappings.map((mapping) => ({
          ...mapping,
          leaves: [mapping.leaves[1]!, mapping.leaves[0]!, ...mapping.leaves.slice(2)],
        })),
      },
    })
    renderInspector(
      { kind: 'spatial-entity', entityId: 'platform' },
      sceneCommands(),
      partial,
    )

    await user.click(screen.getByText('OPC UA Pose Binding'))
    expect(screen.getByRole('button', { name: 'Take Manual Control' })).toBeVisible()
  })

  it('preserves dirty Entity drafts across an equivalent fresh runtime projection', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'platform' })
    await replaceNumber('Entity Local Position X (mm)', '777')
    await user.selectOptions(screen.getByLabelText('Entity Group'), 'root-group')
    await replaceNumber('Numeric Status', '42')
    await user.click(screen.getByLabelText('Status Overlay Visible'))

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        runtime={selectSceneRuntimeV4(harness.project, harness.robots.getState())}
      />,
    )

    expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(777)
    expect(screen.getByLabelText('Entity Group')).toHaveValue('root-group')
    expect(screen.getByLabelText('Numeric Status')).toHaveValue(42)
    expect(screen.getByLabelText('Status Overlay Visible')).not.toBeChecked()
  })

  it('adopts live Entity pose and status when a Project revision changes ownership', async () => {
    const harness = renderInspector({ kind: 'spatial-entity', entityId: 'platform' })
    await replaceNumber('Entity Local Position X (mm)', '777')
    await replaceNumber('Numeric Status', '42')

    const nextProject = validateWorkcellProjectV4({
      ...harness.project,
      revisionId: 'revision-inspector-runtime-owned',
      spatialEntities: harness.project.spatialEntities.map((entity) => (
        entity.id === 'platform'
          ? {
              ...entity,
              transformOwner: 'simulation' as const,
              numericStatus: {
                ...entity.numericStatus,
                sourceOwnership: 'simulation' as const,
              },
            }
          : entity
      )),
    })
    harness.robots.getState().replaceProject(nextProject)
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        project={nextProject}
        runtime={selectSceneRuntimeV4(nextProject, harness.robots.getState())}
      />,
    )

    expect(screen.getByText('Transform owner: simulation')).toBeVisible()
    expect(screen.getByText('Status owner: simulation')).toBeVisible()
    expect(screen.getByLabelText('Entity Local Position X (mm)')).toBeDisabled()
    expect(screen.getByLabelText('Entity Local Position X (mm)')).toHaveValue(100)
    expect(screen.getByLabelText('Numeric Status')).toBeDisabled()
    expect(screen.getByLabelText('Numeric Status')).toHaveValue(12)
  })

  it('blocks same-batch duplicate Spatial Entity Apply commands', async () => {
    let resolvePose!: () => void
    const pendingPose = new Promise<void>((resolve) => { resolvePose = resolve })
    const setSpatialEntityLocalPose = vi.fn(() => pendingPose)
    const commands = sceneCommands({ setSpatialEntityLocalPose })
    renderInspector({ kind: 'spatial-entity', entityId: 'platform' }, commands)
    const apply = screen.getByRole('button', { name: 'Apply Entity' })

    act(() => {
      fireEvent.click(apply)
      fireEvent.click(apply)
    })

    await waitFor(() => expect(setSpatialEntityLocalPose).toHaveBeenCalledTimes(1))
    expect(commands.setSpatialEntityGroup).toHaveBeenCalledTimes(1)
    expect(commands.setNumericStatus).toHaveBeenCalledTimes(1)
    expect(commands.setStatusOverlayVisible).toHaveBeenCalledTimes(1)
    resolvePose()
  })

  it('routes a manual Moving Frame and keeps Grasp and live Moving Frames read-only', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({
      kind: 'entity-frame',
      entityId: 'platform',
      frameId: 'carriage',
    })
    expect(screen.getByRole('heading', { name: 'Moving Frame' })).toBeVisible()
    expect(screen.queryByText(/Linear Axis/i)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Moving Frame Parent'), 'fixture-frame')
    await replaceNumber('Moving Frame Local Position X (mm)', '400')
    await user.click(screen.getByRole('button', { name: 'Apply Moving Frame' }))
    await waitFor(() => expect(harness.commands.setMovingFrame).toHaveBeenCalledOnce())
    expect(harness.commands.setMovingFrame).toHaveBeenCalledWith(expect.objectContaining({
      entityId: 'platform',
      frameId: 'carriage',
      parentFrameId: 'fixture-frame',
      localPose: expect.objectContaining({ positionM: [0.4, 0, 0] }),
    }))

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        selection={{ kind: 'entity-frame', entityId: 'platform', frameId: 'grasp-platform' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Grasp Frame' })).toBeVisible()
    expect(screen.getByText(/read-only/i)).toBeVisible()

    const liveRuntimeFrame = harness.props.runtime.globalFrames.get('live-carriage')!
    const globalFrames = new Map(harness.props.runtime.globalFrames)
    globalFrames.set('live-carriage', {
      ...liveRuntimeFrame,
      localPose: pose(0.6, 0, 0),
    })
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        runtime={{ ...harness.props.runtime, globalFrames }}
        selection={{ kind: 'entity-frame', entityId: 'platform', frameId: 'live-carriage' }}
      />,
    )
    expect(screen.getByRole('heading', { name: 'Moving Frame' })).toBeVisible()
    expect(screen.getByText(/owned by simulation/i)).toBeVisible()
    expect(screen.getByLabelText('Moving Frame Local Position X (mm)')).toHaveValue(600)
    expect(screen.getByRole('button', { name: 'Apply Moving Frame' })).toBeDisabled()
  })

  it('keeps delimiter-containing Entity and Frame identities distinct while a command is pending', async () => {
    const base = inspectorProject()
    const template = base.spatialEntities.find(({ id }) => id === 'platform')!
    const project = validateWorkcellProjectV4({
      ...base,
      revisionId: 'revision-delimited-frames',
      spatialEntities: [
        ...base.spatialEntities,
        {
          ...template,
          id: 'entity:a',
          name: 'Delimited A',
          parentFrameId: 'world',
          groupId: null,
          graspFrames: [],
          movingFrames: [{
            frameId: 'b:c',
            name: 'Frame BC',
            parentFrameId: 'world',
            localPose: pose(),
            sourceOwnership: 'manual' as const,
          }],
        },
        {
          ...template,
          id: 'entity:a:b',
          name: 'Delimited AB',
          parentFrameId: 'world',
          groupId: null,
          graspFrames: [],
          movingFrames: [{
            frameId: 'c',
            name: 'Frame C',
            parentFrameId: 'world',
            localPose: pose(),
            sourceOwnership: 'manual' as const,
          }],
        },
      ],
    })
    let resolveFirst!: () => void
    const first = new Promise<void>((resolve) => { resolveFirst = resolve })
    const setMovingFrame = vi.fn(() => first)
    const commands = sceneCommands({ setMovingFrame })
    const harness = renderInspector({
      kind: 'entity-frame',
      entityId: 'entity:a',
      frameId: 'b:c',
    }, commands, project)
    fireEvent.click(screen.getByRole('button', { name: 'Apply Moving Frame' }))
    await waitFor(() => expect(setMovingFrame).toHaveBeenCalledOnce())

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        selection={{ kind: 'entity-frame', entityId: 'entity:a:b', frameId: 'c' }}
      />,
    )
    expect(screen.getByText(/Delimited AB \/ Frame C/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply Moving Frame' })).toBeEnabled()
    resolveFirst()
  })

  it('shows Group ancestry/effective visibility and routes exact rename and visibility', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'scene-group', groupId: 'child-group' })
    expect(screen.getByText('Parent Group: Root Group')).toBeVisible()
    expect(screen.getByText('Effective visibility: Hidden')).toBeVisible()
    await user.selectOptions(screen.getByLabelText('Parent Group'), '')
    await user.clear(screen.getByLabelText('Group Name'))
    await user.type(screen.getByLabelText('Group Name'), 'Renamed Child')
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))

    await waitFor(() => expect(harness.commands.rename).toHaveBeenCalledWith(
      { kind: 'scene-group', groupId: 'child-group' },
      'Renamed Child',
    ))
    expect(harness.commands.setPersistedVisibility).toHaveBeenCalledWith(
      { kind: 'scene-group', groupId: 'child-group' },
      false,
    )
    expect(harness.commands.reparentGroup).toHaveBeenCalledWith('child-group', null)
  })

  it('keeps a selected Group until its deferred hide commits successfully', async () => {
    const user = userEvent.setup()
    let resolveHide!: () => void
    const hide = new Promise<void>((resolve) => { resolveHide = resolve })
    const commands = sceneCommands({ setPersistedVisibility: vi.fn(() => hide) })
    const harness = renderInspector(
      { kind: 'scene-group', groupId: 'child-group' },
      commands,
    )
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))

    await waitFor(() => expect(commands.setPersistedVisibility).toHaveBeenCalledWith(
      { kind: 'scene-group', groupId: 'child-group' },
      false,
    ))
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'scene-group',
      groupId: 'child-group',
    })

    resolveHide()
    await waitFor(() => expect(harness.interaction.getState().selection).toBeNull())
  })

  it('preserves selected Group when its hide command fails', async () => {
    const user = userEvent.setup()
    let rejectHide!: (reason: unknown) => void
    const hide = new Promise<void>((_resolve, reject) => { rejectHide = reject })
    const commands = sceneCommands({ setPersistedVisibility: vi.fn(() => hide) })
    const harness = renderInspector(
      { kind: 'scene-group', groupId: 'child-group' },
      commands,
    )
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))
    await waitFor(() => expect(commands.setPersistedVisibility).toHaveBeenCalledOnce())

    await act(async () => {
      rejectHide(new Error('Group hide failed'))
      await hide.catch(() => undefined)
    })

    expect(harness.interaction.getState().selection).toEqual({
      kind: 'scene-group',
      groupId: 'child-group',
    })
    expect(await screen.findByRole('alert')).toHaveTextContent('Group hide failed')
  })

  it('does not clear Group selection after a hide completion from a stale Project revision', async () => {
    const user = userEvent.setup()
    let resolveHide!: () => void
    const hide = new Promise<void>((resolve) => { resolveHide = resolve })
    const commands = sceneCommands({ setPersistedVisibility: vi.fn(() => hide) })
    const harness = renderInspector(
      { kind: 'scene-group', groupId: 'child-group' },
      commands,
    )
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))
    await waitFor(() => expect(commands.setPersistedVisibility).toHaveBeenCalledOnce())

    const nextProject = validateWorkcellProjectV4({
      ...harness.project,
      revisionId: 'revision-inspector-newer-group',
    })
    harness.robots.getState().replaceProject(nextProject)
    harness.interaction.getState().replaceProject(nextProject)
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        project={nextProject}
        runtime={selectSceneRuntimeV4(nextProject, harness.robots.getState())}
      />,
    )

    resolveHide()
    await act(async () => { await hide })
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'scene-group',
      groupId: 'child-group',
    })
  })

  it('clears Group selection after a newer Project publication confirms the committed hide', async () => {
    const user = userEvent.setup()
    let resolveHide!: () => void
    const hide = new Promise<void>((resolve) => { resolveHide = resolve })
    const commands = sceneCommands({ setPersistedVisibility: vi.fn(() => hide) })
    const harness = renderInspector(
      { kind: 'scene-group', groupId: 'child-group' },
      commands,
    )
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))
    await waitFor(() => expect(commands.setPersistedVisibility).toHaveBeenCalledOnce())

    const committedProject = validateWorkcellProjectV4({
      ...harness.project,
      revisionId: 'revision-inspector-committed-group-hide',
      sceneGroups: harness.project.sceneGroups.map((group) => (
        group.id === 'child-group' ? { ...group, visible: false } : group
      )),
    })
    harness.robots.getState().replaceProject(committedProject)
    harness.interaction.getState().replaceProject(committedProject)
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        project={committedProject}
        runtime={selectSceneRuntimeV4(committedProject, harness.robots.getState())}
      />,
    )
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'scene-group',
      groupId: 'child-group',
    })

    resolveHide()
    await act(async () => { await hide })
    await waitFor(() => expect(harness.interaction.getState().selection).toBeNull())
  })

  it('does not clear a newer unrelated selection when the committed Group hide completes', async () => {
    const user = userEvent.setup()
    let resolveHide!: () => void
    const hide = new Promise<void>((resolve) => { resolveHide = resolve })
    const commands = sceneCommands({ setPersistedVisibility: vi.fn(() => hide) })
    const harness = renderInspector(
      { kind: 'scene-group', groupId: 'child-group' },
      commands,
    )
    await user.click(screen.getByLabelText('Group Visible'))
    await user.click(screen.getByRole('button', { name: 'Apply Group' }))
    await waitFor(() => expect(commands.setPersistedVisibility).toHaveBeenCalledOnce())

    const committedProject = validateWorkcellProjectV4({
      ...harness.project,
      revisionId: 'revision-inspector-committed-group-hide-with-new-selection',
      sceneGroups: harness.project.sceneGroups.map((group) => (
        group.id === 'child-group' ? { ...group, visible: false } : group
      )),
    })
    harness.robots.getState().replaceProject(committedProject)
    harness.interaction.getState().replaceProject(committedProject)
    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        project={committedProject}
        runtime={selectSceneRuntimeV4(committedProject, harness.robots.getState())}
      />,
    )
    harness.interaction.getState().select({ kind: 'robot', robotId: 'robot-1' })

    resolveHide()
    await act(async () => { await hide })
    expect(harness.interaction.getState().selection).toEqual({
      kind: 'robot',
      robotId: 'robot-1',
    })
  })

  it('shows Scene Frame local/world poses, publishes non-World, and locks World', async () => {
    const user = userEvent.setup()
    const harness = renderInspector({ kind: 'scene-frame', frameId: 'fixture-frame' })
    expect(screen.getByLabelText('Scene Frame Local Position X (mm)')).toHaveValue(500)
    expect(screen.getByLabelText('Scene Frame World Position X (mm)')).toHaveValue(500)
    await replaceNumber('Scene Frame Local Position X (mm)', '750')
    await user.click(screen.getByRole('button', { name: 'Apply Scene Frame' }))
    await waitFor(() => expect(harness.commands.setSceneFrameLocalPose).toHaveBeenCalledWith(
      'fixture-frame',
      expect.objectContaining({ positionM: [0.75, 0, 0] }),
    ))

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        selection={{ kind: 'scene-frame', frameId: 'world' }}
      />,
    )
    expect(screen.getByText('World Frame is read-only.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply Scene Frame' })).toBeDisabled()
  })

  it('blocks same-batch duplicate submits and ignores completion from a stale Scene Frame editor', async () => {
    let rejectFirst!: (reason: unknown) => void
    let resolveSecond!: () => void
    const first = new Promise<void>((_resolve, reject) => { rejectFirst = reject })
    const second = new Promise<void>((resolve) => { resolveSecond = resolve })
    const setSceneFrameLocalPose = vi.fn((frameId: string) => (
      frameId === 'fixture-frame' ? first : second
    ))
    const commands = sceneCommands({ setSceneFrameLocalPose })
    const harness = renderInspector({ kind: 'scene-frame', frameId: 'fixture-frame' }, commands)
    const firstApply = screen.getByRole('button', { name: 'Apply Scene Frame' })

    act(() => {
      fireEvent.click(firstApply)
      fireEvent.click(firstApply)
    })
    await waitFor(() => expect(setSceneFrameLocalPose).toHaveBeenCalledTimes(1))

    harness.rerender(
      <SceneEntityInspectorV4
        {...harness.props}
        selection={{ kind: 'scene-frame', frameId: 'mcp' }}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Apply Scene Frame' }))
    await waitFor(() => expect(setSceneFrameLocalPose).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Apply Scene Frame' })).toBeDisabled()

    await act(async () => {
      rejectFirst(new Error('stale fixture rejection'))
      await first.catch(() => undefined)
    })
    expect(screen.queryByText('stale fixture rejection')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply Scene Frame' })).toBeDisabled()

    resolveSecond()
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Apply Scene Frame' }),
    ).toBeEnabled())
  })
})
