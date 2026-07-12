import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentStatusOverlay } from './EquipmentStatusOverlay'

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const RECORD = {
  id: 'machine-01',
  name: 'Machine 01',
  kind: 'machine',
  status: 'RUNNING',
  numericStatus: 42.5,
  statusSource: 'manual',
  statusOverlayVisible: true,
  transform: { position: [0, 0, 0], quaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
  graspable: false,
  collisionHalfExtents: [0.14, 0.12, 0.2],
  stackLightAnchor: null,
} satisfies EquipmentRecord

describe('EquipmentStatusOverlay', () => {
  it('shows the finite numeric value and source above visible equipment', () => {
    render(<EquipmentStatusOverlay record={RECORD} />)
    expect(screen.getByText('42.5')).toBeVisible()
    expect(screen.getByText('MANUAL')).toBeVisible()
  })

  it('renders nothing when the per-object overlay is disabled', () => {
    const { container } = render(
      <EquipmentStatusOverlay record={{ ...RECORD, statusOverlayVisible: false }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
