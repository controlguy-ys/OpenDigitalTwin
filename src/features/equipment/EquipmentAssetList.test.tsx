import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentAssetList } from './EquipmentAssetList'
import { BUILT_IN_EQUIPMENT } from './equipment-store'

const IMPORTED: EquipmentRecord = {
  id: 'imported-fixture',
  name: 'Imported Fixture',
  kind: 'imported',
  status: 'OFF',
  transform: {
    position: [0, 0, 1.2],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: false,
  collisionHalfExtents: [0.1, 0.1, 0.1],
  stackLightAnchor: null,
  sourceBytes: new Uint8Array([1]).buffer,
  importMetadata: {
    sourceFileName: 'fixture.step',
    detectedUnit: 'meter',
    selectedSourceUnit: 'meter',
    postImportScale: 1,
    originMode: 'center',
    colliderCenter: [0, 0, 0],
  },
}

describe('EquipmentAssetList', () => {
  it('emits canonical delete ids for same-local-id Equipment and Object rows', async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn(async () => undefined)
    const equipment: EquipmentRecord = {
      ...BUILT_IN_EQUIPMENT[0]!,
      id: 'shared-01',
      name: 'Equipment Shared',
    }
    const object: EquipmentRecord = {
      ...IMPORTED,
      id: 'shared-01',
      assetId: 'asset-01',
      name: 'Object Shared',
    }
    render(
      <EquipmentAssetList
        onRemove={onRemove}
        onSelect={vi.fn()}
        records={[equipment, object]}
        selectedEquipmentId={null}
      />,
    )

    await user.click(
      screen.getByRole('button', { name: 'Delete Equipment Shared' }),
    )
    await user.click(
      screen.getByRole('button', { name: 'Delete Object Shared' }),
    )

    expect(onRemove.mock.calls).toEqual([
      ['equipment:shared-01'],
      ['object:shared-01'],
    ])
  })

  it('selects equipment and exposes deletion for built-in and imported objects', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    const onRemove = vi.fn(async () => undefined)
    render(
      <EquipmentAssetList
        onRemove={onRemove}
        onSelect={onSelect}
        records={[...BUILT_IN_EQUIPMENT, IMPORTED]}
        selectedEquipmentId={IMPORTED.id}
      />,
    )

    expect(screen.getByRole('tree')).toHaveTextContent('Imported Fixture')
    expect(screen.getByRole('treeitem', { name: /Imported Fixture/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Delete Cup 01' })).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'Select Cup 01' }))
    await user.click(screen.getByRole('button', { name: 'Delete Cup 01' }))
    await user.click(screen.getByRole('button', { name: 'Delete Imported Fixture' }))
    expect(onSelect).toHaveBeenCalledWith('cup-01')
    expect(onRemove.mock.calls).toEqual([
      ['equipment:cup-01'],
      [`equipment:${IMPORTED.id}`],
    ])
  })

  it('shows deletion failure, blocks duplicate pending calls, and clears the error on retry', async () => {
    const user = userEvent.setup()
    let rejectFirst: ((error: Error) => void) | undefined
    const firstRemoval = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    })
    const onRemove = vi
      .fn<(id: string) => Promise<void>>()
      .mockReturnValueOnce(firstRemoval)
      .mockResolvedValueOnce(undefined)
    render(
      <EquipmentAssetList
        onRemove={onRemove}
        onSelect={vi.fn()}
        records={[IMPORTED]}
        selectedEquipmentId={null}
      />,
    )
    const deleteButton = screen.getByRole('button', {
      name: 'Delete Imported Fixture',
    })

    await user.click(deleteButton)
    expect(deleteButton).toBeDisabled()
    await user.click(deleteButton)
    expect(onRemove).toHaveBeenCalledTimes(1)

    rejectFirst?.(new Error('IndexedDB delete failed'))
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not delete Imported Fixture/i,
    )
    expect(deleteButton).toBeEnabled()

    await user.click(deleteButton)
    expect(onRemove).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(deleteButton).toBeEnabled()
  })
})
