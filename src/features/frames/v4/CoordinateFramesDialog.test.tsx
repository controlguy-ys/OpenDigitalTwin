import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import {
  rpyDegreesToQuaternionV4,
  validateWorkcellProjectV4,
  type RigidTransformV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { projectAtLimit } from '../../../core/project-v4/test-support.js'
import type { SceneSelectionV4 } from '../../interaction/v4/scene-selection.js'
import { createRobotRuntimeRegistryV4 } from '../../robot/v4/robot-runtime-registry.js'
import type { SceneCommandServiceV4 } from '../../scene/v4/scene-command-service.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createCoordinateDisplayStoreV4 } from './coordinate-display-store.js'
import { CoordinateFramesDialogV4 } from './CoordinateFramesDialog.js'

function pose(
  x = 0,
  y = 0,
  z = 0,
  rpy: readonly [number, number, number] = [0, 0, 0],
): RigidTransformV4 {
  return { positionM: [x, y, z], quaternion: rpyDegreesToQuaternionV4(rpy) }
}

function fixtureEntity(): SpatialEntityV4 {
  return {
    id: 'entity-a',
    name: 'Fixture A',
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: pose(0, 3, 0),
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: {
      value: 0,
      sourceOwnership: 'manual',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{
      frameId: 'grasp-a',
      name: 'Grip A',
      localPose: pose(0, 0, 0.1),
    }],
    movingFrames: [
      {
        frameId: 'moving-manual',
        name: 'Manual Carriage',
        parentFrameId: 'mcp',
        localPose: pose(0.1, 0.2, 0.3, [1, 2, 3]),
        sourceOwnership: 'manual',
      },
      {
        frameId: 'moving-live',
        name: 'Live Carriage',
        parentFrameId: 'world',
        localPose: pose(0, 0, 0.4),
        sourceOwnership: 'simulation',
      },
    ],
  }
}

function richProject(): WorkcellProjectV4 {
  const source = projectAtLimit('robots', 2)
  const definition = source.robotDefinitions[0]!
  return validateWorkcellProjectV4({
    ...source,
    revisionId: 'revision-coordinate-dialog',
    scene: {
      frames: [
        ...source.scene.frames.map((frame) => frame.role === 'mcp'
          ? { ...frame, localPose: pose(1, 0, 0) }
          : frame),
        {
          id: 'fixture-frame',
          name: 'Fixture Frame',
          parentFrameId: 'mcp',
          localPose: pose(0.25, 0.5, 0.75, [10, 20, 30]),
          role: 'custom',
        },
      ],
    },
    robotDefinitions: [{
      ...definition,
      frames: definition.frames.map((frame) => frame.id === 'TCP'
        ? { ...frame, localPose: pose(0, 0, 0.1) }
        : frame),
    }],
    robots: source.robots.map((robot, index) => ({
      ...robot,
      localBasePose: pose(index + 1, 0, 0),
    })),
    spatialEntities: [fixtureEntity()],
  })
}

function runtime(project: WorkcellProjectV4) {
  const robots = createRobotRuntimeRegistryV4()
  robots.getState().replaceProject(project)
  return selectSceneRuntimeV4(project, robots.getState())
}

type DialogCommands = Pick<
  SceneCommandServiceV4,
  'setSceneFrameLocalPose' | 'setMovingFrame'
>

function commands(): {
  readonly value: DialogCommands
  readonly setSceneFrameLocalPose: ReturnType<typeof vi.fn>
  readonly setMovingFrame: ReturnType<typeof vi.fn>
} {
  const setSceneFrameLocalPose = vi.fn(async () => undefined)
  const setMovingFrame = vi.fn(async () => undefined)
  return {
    value: { setSceneFrameLocalPose, setMovingFrame },
    setSceneFrameLocalPose,
    setMovingFrame,
  }
}

function optionValue(label: string): string {
  const select = screen.getByLabelText('Coordinate Frame') as HTMLSelectElement
  const option = Array.from(select.options).find(({ text }) => text.includes(label))
  if (option === undefined) throw new Error(`Missing option: ${label}`)
  return option.value
}

function renderDialog(
  project: WorkcellProjectV4,
  selection: SceneSelectionV4,
  commandHarness = commands(),
) {
  const display = createCoordinateDisplayStoreV4()
  display.getState().replaceProject(project)
  const onClose = vi.fn()
  const onOpenRobotBase = vi.fn()
  const result = render(
    <CoordinateFramesDialogV4
      commands={commandHarness.value}
      display={display}
      onClose={onClose}
      onOpenRobotBase={onOpenRobotBase}
      open
      project={project}
      runtime={runtime(project)}
      selection={selection}
    />,
  )
  return { ...result, commandHarness, display, onClose, onOpenRobotBase }
}

describe('CoordinateFramesDialogV4', () => {
  it('is an accessible open/close dialog with explicit units and orientation convention', async () => {
    const project = richProject()
    const harness = commands()
    const display = createCoordinateDisplayStoreV4()
    display.getState().replaceProject(project)
    const onClose = vi.fn()
    const { rerender } = render(
      <CoordinateFramesDialogV4
        commands={harness.value}
        display={display}
        onClose={onClose}
        onOpenRobotBase={vi.fn()}
        open={false}
        project={project}
        runtime={runtime(project)}
        selection={null}
      />,
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    rerender(
      <CoordinateFramesDialogV4
        commands={harness.value}
        display={display}
        onClose={onClose}
        onOpenRobotBase={vi.fn()}
        open
        project={project}
        runtime={runtime(project)}
        selection={null}
      />,
    )
    expect(screen.getByRole('dialog', { name: 'Coordinate Frames' })).toHaveAttribute(
      'aria-modal',
      'true',
    )
    expect(screen.getByText('mm/deg')).toBeVisible()
    expect(screen.getByText('Intrinsic Z-Y-X RPY')).toBeVisible()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Close Coordinate Frames' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows local and World XYZRPY and keeps the World Frame read-only', () => {
    const { commandHarness } = renderDialog(richProject(), null)

    expect(screen.getByLabelText('Local Position X (mm)')).toHaveValue(0)
    expect(screen.getByLabelText('Local Rotation Z (deg)')).toHaveValue(0)
    expect(screen.getByLabelText('World Position X (mm)')).toHaveValue(0)
    expect(screen.getByLabelText('World Rotation Z (deg)')).toHaveValue(0)
    expect(screen.getByLabelText('Local Position X (mm)')).toBeDisabled()
    expect(screen.getByLabelText('World Position X (mm)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()
    expect(commandHarness.setSceneFrameLocalPose).not.toHaveBeenCalled()
    expect(commandHarness.setMovingFrame).not.toHaveBeenCalled()
  })

  it('routes only a non-World Scene Frame local draft and never persists a pose', async () => {
    const user = userEvent.setup()
    const browserStore = (
      window as unknown as Record<string, { setItem(key: string, value: string): void }>
    )['localStor' + 'age']!
    const storageWrite = vi.spyOn(browserStore, 'setItem')
    const { commandHarness, display } = renderDialog(richProject(), null)

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Fixture Frame'),
    )
    expect(screen.getByLabelText('Local Position X (mm)')).toHaveValue(250)
    expect(screen.getByLabelText('World Position X (mm)')).toHaveValue(1250)
    expect(screen.getByLabelText('World Position X (mm)')).toBeDisabled()

    await user.clear(screen.getByLabelText('Local Position X (mm)'))
    await user.type(screen.getByLabelText('Local Position X (mm)'), '125')
    await user.clear(screen.getByLabelText('Local Rotation Z (deg)'))
    await user.type(screen.getByLabelText('Local Rotation Z (deg)'), '45')
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))

    await waitFor(() => expect(commandHarness.setSceneFrameLocalPose).toHaveBeenCalledOnce())
    const [frameId, edited] = commandHarness.setSceneFrameLocalPose.mock.calls[0]!
    expect(frameId).toBe('fixture-frame')
    expect(edited.positionM).toEqual([0.125, 0.5, 0.75])
    rpyDegreesToQuaternionV4([10, 20, 45]).forEach((value, index) => {
      expect(edited.quaternion[index]).toBeCloseTo(value, 12)
    })
    expect(display.getState().poseFrame).toEqual({
      kind: 'scene-frame',
      frameId: 'fixture-frame',
    })
    expect(display.getState().poseFrame).not.toHaveProperty('localPose')
    expect(display.getState().poseFrame).not.toHaveProperty('worldPose')
    expect(storageWrite).not.toHaveBeenCalled()
    storageWrite.mockRestore()
  })

  it('redirects the exact owning Robot Base and keeps all Definition Frames read-only', async () => {
    const user = userEvent.setup()
    const project = richProject()
    const harness = renderDialog(project, { kind: 'robot', robotId: 'robot-1' })

    const firstTcpValue = optionValue('Robot 1 / TCP')
    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Robot 1 / Base'),
    )
    expect(screen.getByLabelText('Local Position X (mm)')).toHaveValue(1000)
    expect(screen.getByLabelText('Local Position X (mm)')).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Open Robot Base Editor' }))
    expect(harness.onOpenRobotBase).toHaveBeenCalledWith('robot-1')

    await user.selectOptions(screen.getByLabelText('Coordinate Frame'), firstTcpValue)
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()
    expect(screen.getByText(/Robot Definition Frames are read-only until P3/i)).toBeVisible()

    harness.rerender(
      <CoordinateFramesDialogV4
        commands={harness.commandHarness.value}
        display={harness.display}
        onClose={harness.onClose}
        onOpenRobotBase={harness.onOpenRobotBase}
        open
        project={project}
        runtime={runtime(project)}
        selection={{ kind: 'robot', robotId: 'robot-2' }}
      />,
    )
    const secondTcpValue = optionValue('Robot 2 / TCP')
    expect(secondTcpValue).not.toBe(firstTcpValue)
    await user.selectOptions(screen.getByLabelText('Coordinate Frame'), secondTcpValue)
    expect(harness.display.getState().poseFrame).toEqual({
      kind: 'robot-frame',
      robotId: 'robot-2',
      frameId: 'TCP',
    })
    expect(harness.commandHarness.setSceneFrameLocalPose).not.toHaveBeenCalled()
    expect(harness.commandHarness.setMovingFrame).not.toHaveBeenCalled()
  })

  it('edits only a manual Moving Frame with its explicit parent and local pose', async () => {
    const user = userEvent.setup()
    const harness = renderDialog(
      richProject(),
      { kind: 'spatial-entity', entityId: 'entity-a' },
    )

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Manual Carriage'),
    )
    expect(screen.getByLabelText('Parent Frame')).toHaveValue('mcp')
    await user.selectOptions(screen.getByLabelText('Parent Frame'), 'world')
    await user.clear(screen.getByLabelText('Local Position X (mm)'))
    await user.type(screen.getByLabelText('Local Position X (mm)'), '75')
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))

    await waitFor(() => expect(harness.commandHarness.setMovingFrame).toHaveBeenCalledOnce())
    const edit = harness.commandHarness.setMovingFrame.mock.calls[0]![0]
    expect(edit).toMatchObject({
      entityId: 'entity-a',
      frameId: 'moving-manual',
      parentFrameId: 'world',
      localPose: {
        positionM: [0.075, 0.2, 0.3],
      },
    })
    rpyDegreesToQuaternionV4([1, 2, 3]).forEach((value, index) => {
      expect(edit.localPose.quaternion[index]).toBeCloseTo(value, 12)
    })

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Grip A'),
    )
    expect(screen.getByLabelText('Local Position X (mm)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()
    expect(screen.getByText(/Grasp Frames are read-only/i)).toBeVisible()

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Live Carriage'),
    )
    expect(screen.getByLabelText('Parent Frame')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()
    expect(screen.getByText(/Moving Frame is owned by simulation/i)).toBeVisible()
    expect(harness.commandHarness.setMovingFrame).toHaveBeenCalledOnce()
  })

  it('reports invalid drafts and rejected commands without closing the dialog', async () => {
    const user = userEvent.setup()
    const harness = commands()
    harness.setSceneFrameLocalPose.mockRejectedValueOnce(new Error('stale revision rejected'))
    renderDialog(richProject(), null, harness)
    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Fixture Frame'),
    )

    await user.clear(screen.getByLabelText('Local Position X (mm)'))
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/finite numbers/i)
    expect(harness.setSceneFrameLocalPose).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Local Position X (mm)'), '100')
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('stale revision rejected')
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeEnabled()
  })

  it('preserves an in-progress local draft across live runtime projection refreshes', async () => {
    const user = userEvent.setup()
    const project = richProject()
    const harness = renderDialog(project, null)
    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Fixture Frame'),
    )
    await user.clear(screen.getByLabelText('Local Position X (mm)'))
    await user.type(screen.getByLabelText('Local Position X (mm)'), '777')

    harness.rerender(
      <CoordinateFramesDialogV4
        commands={harness.commandHarness.value}
        display={harness.display}
        onClose={harness.onClose}
        onOpenRobotBase={harness.onOpenRobotBase}
        open
        project={project}
        runtime={runtime(project)}
        selection={null}
      />,
    )

    expect(screen.getByLabelText('Local Position X (mm)')).toHaveValue(777)
  })

  it('ignores a stale Frame completion after a different editor starts a request', async () => {
    const user = userEvent.setup()
    let rejectFirst!: (reason: unknown) => void
    let resolveSecond!: () => void
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const second = new Promise<void>((resolve) => {
      resolveSecond = resolve
    })
    const harness = commands()
    harness.setSceneFrameLocalPose.mockImplementation((frameId: string) => (
      frameId === 'fixture-frame' ? first : second
    ))
    renderDialog(richProject(), null, harness)

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('Fixture Frame'),
    )
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))
    await waitFor(() => expect(harness.setSceneFrameLocalPose).toHaveBeenCalledTimes(1))

    await user.selectOptions(
      screen.getByLabelText('Coordinate Frame'),
      optionValue('MCP'),
    )
    await user.click(screen.getByRole('button', { name: 'Apply Frame' }))
    await waitFor(() => expect(harness.setSceneFrameLocalPose).toHaveBeenCalledTimes(2))
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()

    await act(async () => {
      rejectFirst(new Error('stale Frame A rejection'))
      await first.catch(() => undefined)
    })
    expect(screen.queryByText('stale Frame A rejection')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply Frame' })).toBeDisabled()

    resolveSecond()
    await waitFor(() => expect(
      screen.getByRole('button', { name: 'Apply Frame' }),
    ).toBeEnabled())
  })
})
