import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ViewOrientationControlV4 } from './ViewOrientationControl.js'

describe('ViewOrientationControlV4', () => {
  it('routes every Standard World view once and returns to its prompt', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ViewOrientationControlV4 onSelect={onSelect} />)
    const control = screen.getByLabelText('View orientation')

    expect(control).toHaveValue('')
    for (const view of ['isometric', 'top', 'front', 'right', 'back', 'left', 'bottom']) {
      await user.selectOptions(control, view)
      expect(onSelect).toHaveBeenLastCalledWith(view)
      expect(control).toHaveValue('')
    }
    expect(onSelect).toHaveBeenCalledTimes(7)
  })

  it('ignores the blank prompt option', async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(<ViewOrientationControlV4 onSelect={onSelect} />)

    await user.selectOptions(screen.getByLabelText('View orientation'), '')
    expect(onSelect).not.toHaveBeenCalled()
  })
})
