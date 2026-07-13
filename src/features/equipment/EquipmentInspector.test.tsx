import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentInspector } from './EquipmentInspector'

const RECORD: EquipmentRecord = {
  id: 'fixture-01',
  name: 'Fixture 01',
  kind: 'machine',
  status: 'RUNNING',
  numericStatus: 7,
  statusSource: 'manual',
  statusOverlayVisible: true,
  transform: {
    position: [1, 0.2, 1.1],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: false,
  collisionHalfExtents: [0.1, 0.1, 0.1],
  stackLightAnchor: null,
}

describe('EquipmentInspector', () => {
  it('previews and applies XYZ/RPY values in canonical units', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(
      <EquipmentInspector
        onApply={onApply}
        onCancel={vi.fn()}
        onDelete={vi.fn()}
        onNumericStatus={vi.fn()}
        onStatusSource={vi.fn()}
        onOverlayVisible={vi.fn()}
        onPreview={onPreview}
        record={RECORD}
      />,
    )

    expect(screen.getByText('Coordinates relative to MCP')).toBeVisible()

    await user.clear(screen.getByLabelText('X (mm)'))
    await user.type(screen.getByLabelText('X (mm)'), '1250')
    await user.clear(screen.getByLabelText('Roll (deg)'))
    await user.type(screen.getByLabelText('Roll (deg)'), '90')
    await user.click(screen.getByRole('button', { name: 'Preview transform' }))

    expect(onPreview).toHaveBeenLastCalledWith('equipment:fixture-01', {
      position: [1.25, 0.2, 1.1],
      quaternion: [expect.closeTo(Math.SQRT1_2, 6), 0, 0, expect.closeTo(Math.SQRT1_2, 6)],
      scale: [1, 1, 1],
    })

    await user.click(screen.getByRole('button', { name: 'Apply transform' }))
    expect(onApply).toHaveBeenCalledWith('equipment:fixture-01')
  })

  it('cancels, updates numeric status/overlay, and confirms deletion', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onNumericStatus = vi.fn().mockResolvedValue(undefined)
    const onOverlayVisible = vi.fn().mockResolvedValue(undefined)
    const onStatusSource = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <EquipmentInspector
        onApply={vi.fn()}
        onCancel={onCancel}
        onDelete={onDelete}
        onNumericStatus={onNumericStatus}
        onStatusSource={onStatusSource}
        onOverlayVisible={onOverlayVisible}
        onPreview={vi.fn()}
        record={RECORD}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Cancel transform' }))
    expect(onCancel).toHaveBeenCalledWith('equipment:fixture-01')

    await user.clear(screen.getByLabelText('Numeric status'))
    await user.type(screen.getByLabelText('Numeric status'), '42.5')
    await user.click(screen.getByRole('button', { name: 'Apply numeric status' }))
    expect(onNumericStatus).toHaveBeenCalledWith('equipment:fixture-01', 42.5)

    await user.selectOptions(screen.getByLabelText('Status source'), 'opcua')
    expect(onStatusSource).toHaveBeenCalledWith('equipment:fixture-01', 'opcua')

    await user.click(screen.getByLabelText('Show status overlay'))
    expect(onOverlayVisible).toHaveBeenCalledWith('equipment:fixture-01', false)

    await user.click(screen.getByRole('button', { name: 'Delete Fixture 01' }))
    expect(window.confirm).toHaveBeenCalledWith('Delete Fixture 01?')
    expect(onDelete).toHaveBeenCalledWith('equipment:fixture-01')
  })

  it('routes imported Object mutations through its canonical owner', async () => {
    const user = userEvent.setup()
    const onPreview = vi.fn()
    const onApply = vi.fn().mockResolvedValue(undefined)
    const onCancel = vi.fn()
    const onDelete = vi.fn().mockResolvedValue(undefined)
    const onNumericStatus = vi.fn().mockResolvedValue(undefined)
    const onStatusSource = vi.fn().mockResolvedValue(undefined)
    const onOverlayVisible = vi.fn().mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <EquipmentInspector
        onApply={onApply}
        onCancel={onCancel}
        onDelete={onDelete}
        onNumericStatus={onNumericStatus}
        onStatusSource={onStatusSource}
        onOverlayVisible={onOverlayVisible}
        onPreview={onPreview}
        record={{ ...RECORD, assetId: 'asset-01', name: 'Object Shared' }}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Preview transform' }))
    await user.click(screen.getByRole('button', { name: 'Apply transform' }))
    await user.click(screen.getByRole('button', { name: 'Cancel transform' }))
    await user.clear(screen.getByLabelText('Numeric status'))
    await user.type(screen.getByLabelText('Numeric status'), '42.5')
    await user.click(screen.getByRole('button', { name: 'Apply numeric status' }))
    await user.selectOptions(screen.getByLabelText('Status source'), 'opcua')
    await user.click(screen.getByLabelText('Show status overlay'))
    await user.click(screen.getByRole('button', { name: 'Delete Object Shared' }))

    expect(onPreview).toHaveBeenCalledWith(
      'object:fixture-01',
      expect.any(Object),
    )
    expect(onApply).toHaveBeenCalledWith('object:fixture-01')
    expect(onCancel).toHaveBeenCalledWith('object:fixture-01')
    expect(onNumericStatus).toHaveBeenCalledWith('object:fixture-01', 42.5)
    expect(onStatusSource).toHaveBeenCalledWith('object:fixture-01', 'opcua')
    expect(onOverlayVisible).toHaveBeenCalledWith('object:fixture-01', false)
    expect(onDelete).toHaveBeenCalledWith('object:fixture-01')
  })
})
