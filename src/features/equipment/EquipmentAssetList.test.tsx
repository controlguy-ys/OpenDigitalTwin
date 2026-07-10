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
  it('selects equipment and exposes delete only for imported assets', async () => {
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
    expect(screen.queryByRole('button', { name: 'Delete Cup 01' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Select Cup 01' }))
    await user.click(screen.getByRole('button', { name: 'Delete Imported Fixture' }))
    expect(onSelect).toHaveBeenCalledWith('cup-01')
    expect(onRemove).toHaveBeenCalledWith(IMPORTED.id)
  })
})
