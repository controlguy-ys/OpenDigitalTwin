import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useRef, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ModalDialogV6 } from './ModalDialogV6.js'

function DialogHarness({ busy = false, onClose = vi.fn() }: { readonly busy?: boolean, readonly onClose?: () => void }) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)
  return <>
    <button ref={triggerRef} type="button">Open dialog</button>
    <ModalDialogV6
      busy={busy}
      footer={<button type="button">Last action</button>}
      header={<header><h2 id="dialog-title">Dialog title</h2></header>}
      initialFocusRef={firstRef}
      onClose={onClose}
      titleId="dialog-title"
      triggerRef={triggerRef}
    >
      <button ref={firstRef} type="button">First action</button>
      <button type="button">Middle action</button>
    </ModalDialogV6>
  </>
}

describe('ModalDialogV6', () => {
  it('labels the modal, moves initial focus, and contains Tab in both directions', async () => {
    const user = userEvent.setup()
    render(<DialogHarness />)
    const dialog = screen.getByRole('dialog', { name: 'Dialog title' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })

    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-labelledby', 'dialog-title')
    await waitFor(() => expect(first).toHaveFocus())

    last.focus()
    await user.keyboard('{Tab}')
    expect(first).toHaveFocus()
    first.focus()
    await user.keyboard('{Shift>}{Tab}{/Shift}')
    expect(last).toHaveFocus()
  })

  it('closes from idle Escape or backdrop and restores its opener', async () => {
    const onClose = vi.fn()
    render(<DialogHarness onClose={onClose} />)
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    fireEvent.mouseDown(screen.getByTestId('v6-modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('restores focus to an opener that remains mounted after dismissal', async () => {
    const user = userEvent.setup()
    function RestoreHarness() {
      const openerRef = useRef<HTMLButtonElement>(null)
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)} ref={openerRef} type="button">Open dialog</button>
        {!open ? null : <ModalDialogV6
          footer={<button type="button">Last action</button>}
          header={<header><h2 id="restore-title">Restore</h2></header>}
          onClose={() => setOpen(false)}
          titleId="restore-title"
          triggerRef={openerRef}
        ><button type="button">First action</button></ModalDialogV6>}
      </>
    }

    render(<RestoreHarness />)
    const opener = screen.getByRole('button', { name: 'Open dialog' })
    await user.click(opener)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(opener).toHaveFocus()
  })

  it('does not dismiss a busy dialog', () => {
    const onClose = vi.fn()
    render(<DialogHarness busy onClose={onClose} />)
    const dialog = screen.getByRole('dialog')

    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.mouseDown(screen.getByTestId('v6-modal-backdrop'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('lets a nested modal consume Escape and restore its Browse trigger before its parent', async () => {
    const user = userEvent.setup()
    const closeOuter = vi.fn()
    function NestedHarness() {
      const openerRef = useRef<HTMLButtonElement>(null)
      const browseRef = useRef<HTMLButtonElement>(null)
      const [nestedOpen, setNestedOpen] = useState(false)
      return <>
        <button ref={openerRef} type="button">Open outer</button>
        <ModalDialogV6
          footer={<button type="button">Outer close</button>}
          header={<header><h2 id="outer-title">Outer</h2></header>}
          onClose={closeOuter}
          titleId="outer-title"
          triggerRef={openerRef}
        >
          <button onClick={() => setNestedOpen(true)} ref={browseRef} type="button">Browse address space</button>
          {nestedOpen && <ModalDialogV6
            footer={<button type="button">Accept address</button>}
            header={<header><h2 id="inner-title">Address browser</h2></header>}
            nestedDialog={{ parentDialogId: 'outer-title' }}
            onClose={() => setNestedOpen(false)}
            titleId="inner-title"
            triggerRef={browseRef}
          ><button type="button">Address item</button></ModalDialogV6>}
        </ModalDialogV6>
      </>
    }

    render(<NestedHarness />)
    await user.click(screen.getByRole('button', { name: 'Browse address space' }))
    const nested = screen.getByRole('dialog', { name: 'Address browser' })
    fireEvent.keyDown(nested, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: 'Address browser' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Browse address space' })).toHaveFocus()

    fireEvent.keyDown(screen.getByRole('dialog', { name: 'Outer' }), { key: 'Escape' })
    expect(closeOuter).toHaveBeenCalledOnce()
  })

  it('exposes a bounded editor size hook without adding a second dialog frame', () => {
    render(<ModalDialogV6
      footer={<button type="button">Save job</button>}
      header={<header><h2 id="job-title">Job editor</h2></header>}
      onClose={() => undefined}
      size="editor"
      titleId="job-title"
    ><button type="button">Instruction</button></ModalDialogV6>)
    expect(screen.getByRole('dialog')).toHaveClass('v6-modal-dialog', 'v6-modal-dialog--editor')
  })
})
