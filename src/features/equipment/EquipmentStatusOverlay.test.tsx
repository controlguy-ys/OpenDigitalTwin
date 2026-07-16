import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import { EquipmentStatusOverlay } from './EquipmentStatusOverlay'

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({
    children,
    distanceFactor,
    position,
  }: {
    children: React.ReactNode
    distanceFactor?: number
    position?: readonly number[]
  }) => (
    <div
      data-distance-factor={distanceFactor === undefined ? 'none' : distanceFactor}
      data-position={JSON.stringify(position)}
      data-testid="status-overlay-anchor"
    >
      {children}
    </div>
  ),
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
  collisionCenter: [0.02, -0.03, 0.04],
  collisionHalfExtents: [0.14, 0.12, 0.2],
  stackLightAnchor: null,
} satisfies EquipmentRecord

describe('EquipmentStatusOverlay', () => {
  it('shows only the finite numeric value above visible equipment', () => {
    render(<EquipmentStatusOverlay record={RECORD} />)
    expect(screen.getByText('42.5')).toBeVisible()
    expect(screen.queryByText('MANUAL')).not.toBeInTheDocument()
  })

  it('anchors above the collider center without camera-distance scaling', () => {
    render(<EquipmentStatusOverlay record={RECORD} />)
    const anchor = screen.getByTestId('status-overlay-anchor')

    expect(anchor).toHaveAttribute('data-distance-factor', 'none')
    const position = JSON.parse(anchor.getAttribute('data-position') ?? 'null') as number[]
    expect(position[0]).toBeCloseTo(0.02)
    expect(position[1]).toBeCloseTo(-0.03)
    expect(position[2]).toBeCloseTo(0.3)
  })

  it('renders nothing when the per-object overlay is disabled', () => {
    const { container } = render(
      <EquipmentStatusOverlay record={{ ...RECORD, statusOverlayVisible: false }} />,
    )
    expect(container).toBeEmptyDOMElement()
  })
})
