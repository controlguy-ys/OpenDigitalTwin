import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EquipmentTransformControls } from './EquipmentTransformControls'

vi.mock('@react-three/drei/core/TransformControls.js', () => ({
  TransformControls: ({
    onMouseDown,
    onMouseUp,
    onObjectChange,
  }: {
    onMouseDown?: () => void
    onMouseUp?: () => void
    onObjectChange?: () => void
  }) => (
    <div>
      <button aria-label="begin transform" onClick={onMouseDown} />
      <button aria-label="preview transform" onClick={onObjectChange} />
      <button aria-label="commit transform" onClick={onMouseUp} />
    </div>
  ),
}))

describe('EquipmentTransformControls', () => {
  it('previews every object change, commits once on mouse-up, and coordinates orbit dragging', async () => {
    const objectRef = createRef<Group>()
    objectRef.current = new Group()
    objectRef.current.position.set(1, 2, 3)
    const previewTransform = vi.fn()
    const commitTransform = vi.fn(async () => undefined)
    const onDraggingChange = vi.fn()
    render(
      <EquipmentTransformControls
        commitTransform={commitTransform}
        equipmentId="cup-01"
        objectRef={objectRef}
        onDraggingChange={onDraggingChange}
        previewTransform={previewTransform}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'begin transform' }))
    fireEvent.click(screen.getByRole('button', { name: 'preview transform' }))
    objectRef.current.position.x = 2
    fireEvent.click(screen.getByRole('button', { name: 'preview transform' }))
    objectRef.current.position.x = 3
    fireEvent.click(screen.getByRole('button', { name: 'preview transform' }))

    expect(previewTransform).toHaveBeenCalledTimes(3)
    expect(previewTransform).toHaveBeenLastCalledWith('cup-01', {
      position: [3, 2, 3],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    })
    expect(commitTransform).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'commit transform' }))

    expect(onDraggingChange).toHaveBeenNthCalledWith(1, true)
    expect(onDraggingChange).toHaveBeenLastCalledWith(false)
    expect(commitTransform).toHaveBeenCalledTimes(1)
    expect(commitTransform).toHaveBeenCalledWith('cup-01')
  })
})
