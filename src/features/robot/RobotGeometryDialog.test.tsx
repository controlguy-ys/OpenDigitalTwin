import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import type { RobotLinkGeometryRecordV1 } from '../../domain/project/project'
import { RobotGeometryDialog } from './RobotGeometryDialog'
import { useRobotGeometryStore } from './robot-geometry-store'

const link: RobotLinkGeometryRecordV1 = {
  linkId: 'LINK00',
  sourceFileName: 'LINK00.step',
  sourceBytes: new Uint8Array([1]).buffer,
  localTransform: {
    position: [0, 0, 0],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  visible: true,
  collisionCenter: [0, 0, 0],
  collisionHalfExtents: [0.1, 0.1, 0.1],
  statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
}

afterEach(() => {
  useRobotGeometryStore.setState({ links: [] })
})

it('edits Geometry-local position without changing mechanical Joint origins', async () => {
  const user = userEvent.setup()
  const setLocalTransform = vi.fn(async () => undefined)
  useRobotGeometryStore.setState({
    links: [link],
    setLocalTransform,
    setVisible: vi.fn(async () => undefined),
    setCollision: vi.fn(async () => undefined),
  })
  render(<RobotGeometryDialog onClose={vi.fn()} open />)

  await user.clear(screen.getByLabelText('Geometry X (mm)'))
  await user.type(screen.getByLabelText('Geometry X (mm)'), '10')
  await user.click(screen.getByRole('button', { name: 'Apply geometry' }))

  expect(setLocalTransform).toHaveBeenCalledWith(
    'LINK00',
    expect.objectContaining({ position: [0.01, 0, 0] }),
  )
})
