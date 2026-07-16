import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ViewCube } from './ViewCube'

describe('ViewCube', () => {
  it('stays World referenced and sends face/corner camera commands without drag affordance', async () => {
    const user = userEvent.setup()
    const setStandardView = vi.fn()
    const { rerender } = render(<ViewCube robotRevision={0} setStandardView={setStandardView} />)
    const cube = screen.getByLabelText('World view cube')
    expect(cube).toHaveAttribute('data-reference', 'world')
    expect(cube).not.toHaveAttribute('draggable')

    rerender(<ViewCube robotRevision={99} setStandardView={setStandardView} />)
    expect(screen.getByLabelText('World view cube')).toHaveAttribute('data-reference', 'world')
    expect(screen.getByRole('button', { name: 'Back view' })).toHaveTextContent('BK')
    expect(screen.getByRole('button', { name: 'Bottom view' })).toHaveTextContent('BTM')
    await user.click(screen.getByRole('button', { name: 'Top view' }))
    await user.click(screen.getByRole('button', { name: 'Isometric view' }))
    expect(setStandardView).toHaveBeenNthCalledWith(1, 'top')
    expect(setStandardView).toHaveBeenNthCalledWith(2, 'isometric')
  })
})
