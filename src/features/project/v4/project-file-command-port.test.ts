import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserProjectFileCommandPortV4 } from './project-file-command-port.js'

describe('createBrowserProjectFileCommandPortV4', () => {
  afterEach(() => document.body.replaceChildren())

  it('owns cleanup for picker cancellation and sanitizes downloaded filenames', async () => {
    const port = createBrowserProjectFileCommandPortV4()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'))
    })
    await expect(port.pickProject()).resolves.toBeNull()
    expect(document.querySelector('input[type=file]')).toBeNull()
    click.mockRestore()

    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    const download = createBrowserProjectFileCommandPortV4({
      url: { createObjectURL, revokeObjectURL },
    })
    const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    download.downloadProject(new Blob(['{}']), ' bad<>name. ')
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test')
    anchorClick.mockRestore()
  })
})
