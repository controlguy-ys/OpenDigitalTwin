import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SceneEntityInspector } from './SceneEntityInspector'
import { quaternionFromIntrinsicZyxDeg } from './rpy-editor'
import { testSceneRuntime } from './scene-ui-test-fixtures'
import { useEquipmentStore } from '../equipment/equipment-store'
import { useObjectAssetStore } from '../objects/object-asset-store'

const originalEquipmentRecords = useEquipmentStore.getState().records
const originalObjectInstances = useObjectAssetStore.getState().instances

afterEach(() => {
  useEquipmentStore.setState({ records: originalEquipmentRecords })
  useObjectAssetStore.setState({ instances: originalObjectInstances })
})

describe('SceneEntityInspector', () => {
  it('edits Local XYZ/RPY through the project command and displays read-only World pose', async () => {
    const user = userEvent.setup()
    const setLocalPose = vi.fn(async () => undefined)
    render(
      <SceneEntityInspector
        commands={{ setLocalPose }}
        disabled={false}
        entityId="object:cup-1"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Relative to: Fixture Group')).toBeVisible()
    expect(screen.getByLabelText('World X (mm)')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('World X (mm)')).toHaveValue('1100')
    await user.clear(screen.getByLabelText('Local X (mm)'))
    await user.type(screen.getByLabelText('Local X (mm)'), '250')
    await user.clear(screen.getByLabelText('Roll (deg)'))
    await user.type(screen.getByLabelText('Roll (deg)'), '450')
    await user.click(screen.getByRole('button', { name: 'Apply transform' }))

    expect(setLocalPose).toHaveBeenCalledWith('object:cup-1', {
      positionM: [0.25, 0.2, 0.3],
      quaternion: quaternionFromIntrinsicZyxDeg(450, 0, 0),
    })
  })

  it('rejects an invalid draft without partially changing the Entity', async () => {
    const user = userEvent.setup()
    const setLocalPose = vi.fn(async () => undefined)
    render(
      <SceneEntityInspector
        commands={{ setLocalPose }}
        entityId="robot:active"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Relative to: MCP')).toBeVisible()
    await user.clear(screen.getByLabelText('Local Y (mm)'))
    await user.click(screen.getByRole('button', { name: 'Apply transform' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('finite')
    expect(setLocalPose).not.toHaveBeenCalled()
  })

  it('makes OPC UA transform ownership explicit and prevents Manual edits', () => {
    render(
      <SceneEntityInspector
        commands={{ setLocalPose: vi.fn(async () => undefined) }}
        entityId="object:live-part"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Transform source: OPC UA')).toBeVisible()
    expect(screen.getByLabelText('Local X (mm)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply transform' })).toBeDisabled()
  })

  it.each([
    ['object:cup-1', 'updateObjectInstance'],
    ['equipment:workbench', 'updateBuiltInEquipment'],
  ] as const)(
    'preserves status-only editing for %s through the Project V3 command',
    async (entityId, expectedCommand) => {
      const user = userEvent.setup()
      const updateObjectInstance = vi.fn(async () => undefined)
      const updateBuiltInEquipment = vi.fn(async () => undefined)
      render(
        <SceneEntityInspector
          commands={{
            setLocalPose: vi.fn(async () => undefined),
            updateBuiltInEquipment,
            updateObjectInstance,
          }}
          entityId={entityId}
          runtime={testSceneRuntime()}
          status={{
            numericStatus: 7,
            statusOverlayVisible: true,
            statusSource: 'manual',
          }}
        />,
      )

      await user.selectOptions(screen.getByLabelText('Status source'), 'opcua')
      await user.clear(screen.getByLabelText('Numeric status'))
      await user.type(screen.getByLabelText('Numeric status'), '42.5')
      await user.click(screen.getByRole('button', { name: 'Apply numeric status' }))
      await user.click(screen.getByLabelText('Show status overlay'))

      const owner = expectedCommand === 'updateObjectInstance'
        ? updateObjectInstance
        : updateBuiltInEquipment
      expect(owner).toHaveBeenCalledWith(entityId, { statusSource: 'opcua' })
      expect(owner).toHaveBeenCalledWith(entityId, { numericStatus: 42.5 })
      expect(owner).toHaveBeenCalledWith(entityId, { statusOverlayVisible: false })
      expect(updateObjectInstance.mock.calls.length + updateBuiltInEquipment.mock.calls.length)
        .toBe(3)
    },
  )

  it.each([
    ['object:cup-1', 'object', 73.5],
    ['equipment:workbench', 'equipment', 91.25],
  ] as const)(
    'displays the publication-only effective numeric status for %s',
    (entityId, kind, numericStatus) => {
      if (kind === 'object') {
        useObjectAssetStore.setState({
          instances: [{ id: 'cup-1', numericStatus }] as never,
        })
      } else {
        useEquipmentStore.setState({
          records: [{ id: 'workbench', numericStatus }] as never,
        })
      }

      render(
        <SceneEntityInspector
          commands={{ setLocalPose: vi.fn(async () => undefined) }}
          entityId={entityId}
          runtime={testSceneRuntime()}
          status={{
            numericStatus: 7,
            statusOverlayVisible: true,
            statusSource: 'opcua',
          }}
        />,
      )

      expect(screen.getByLabelText('Numeric status')).toHaveValue(numericStatus)
    },
  )
})
