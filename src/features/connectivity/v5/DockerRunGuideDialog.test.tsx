import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { DockerRunGuideDialogV1 } from './DockerRunGuideDialog.js'

function Harness({ writeText, onClose = vi.fn() }: {
  readonly writeText: (value: string) => Promise<void>
  readonly onClose?: () => void
}) {
  const trigger = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(true)
  return <>
    <button ref={trigger}>Guide trigger</button>
    {open ? <DockerRunGuideDialogV1
      clipboard={{ writeText }}
      onClose={() => {
        onClose()
        setOpen(false)
      }}
      status={null}
      triggerRef={trigger}
    /> : null}
  </>
}

describe('DockerRunGuideDialogV1', () => {
  it('offers one copy operation, no daemon actions, and reports clipboard success', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn(async () => undefined)
    render(<Harness writeText={writeText} />)
    const dialog = screen.getByRole('dialog', { name: 'Docker Run Guide' })
    expect(dialog).toHaveTextContent('host.docker.internal:4840')
    expect(screen.queryByRole('button', { name: /Start|Stop|Restart/i })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Copy PowerShell commands' }))
    expect(writeText).toHaveBeenCalledOnce()
    expect(await screen.findByRole('status')).toHaveTextContent('Copied')
  })

  it('keeps clipboard failure visible and restores focus after Escape', async () => {
    const onClose = vi.fn()
    const writeText = vi.fn(async () => { throw new Error('clipboard blocked') })
    render(<Harness onClose={onClose} writeText={writeText} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy PowerShell commands' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('clipboard blocked')
    const trigger = screen.getByRole('button', { name: 'Guide trigger' })
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps the command block usable when the Clipboard API is unavailable', async () => {
    render(<DockerRunGuideDialogV1 clipboard={null} onClose={() => undefined} status={null} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy PowerShell commands' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Select and copy the command block manually')
    expect(screen.getByText(/docker compose up -d --build --wait/)).toBeInTheDocument()
  })

  it('keeps Close keyboard-accessible while a clipboard request is pending', async () => {
    let resolveCopy!: () => void
    const writeText = vi.fn(() => new Promise<void>((resolve) => { resolveCopy = resolve }))
    const onClose = vi.fn()
    render(<Harness onClose={onClose} writeText={writeText} />)
    await userEvent.click(screen.getByRole('button', { name: 'Copy PowerShell commands' }))
    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toBeEnabled()
    await userEvent.click(close)
    expect(onClose).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Guide trigger' })).toHaveFocus()
    resolveCopy()
  })
})
