import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBrowserProjectFileCommandPortV4 } from './project-file-command-port.js'

function selectedFileList(file: File | null): FileList {
  return { item: (index: number) => index === 0 ? file : null } as FileList
}

describe('createBrowserProjectFileCommandPortV4', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.replaceChildren()
  })

  it('owns one temporary JSON input and resolves the selected whole File', async () => {
    const selected = new File(['{}'], 'cell.json', { type: 'application/json' })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      expect(this.type).toBe('file')
      expect(this.accept).toBe('.json,application/json')
      Object.defineProperty(this, 'files', { configurable: true, value: selectedFileList(selected) })
      this.dispatchEvent(new Event('change'))
    })
    const port = createBrowserProjectFileCommandPortV4()
    await expect(port.pickProject()).resolves.toBe(selected)
    expect(click).toHaveBeenCalledOnce()
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('treats empty change and cancel events as cleanup-safe cancellation', async () => {
    const empty = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      Object.defineProperty(this, 'files', { configurable: true, value: selectedFileList(null) })
      this.dispatchEvent(new Event('change'))
    })
    await expect(createBrowserProjectFileCommandPortV4().pickProject()).resolves.toBeNull()
    expect(document.body.children).toHaveLength(0)
    empty.mockRestore()

    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'))
    })
    await expect(createBrowserProjectFileCommandPortV4().pickProject()).resolves.toBeNull()
    expect(document.body.children).toHaveLength(0)
  })

  it('removes temporary picker state when click throws and keeps the same Error', async () => {
    const failure = new Error('picker unavailable')
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => { throw failure })
    await expect(createBrowserProjectFileCommandPortV4().pickProject()).rejects.toBe(failure)
    expect(document.body.children).toHaveLength(0)
  })

  it('sanitizes unsafe names, falls back for blank names, and always removes/revokes downloads', () => {
    const createObjectURL = vi.fn(() => 'blob:test')
    const revokeObjectURL = vi.fn()
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicks.push(this.download)
      expect(this.href).toContain('blob:test')
    })
    const port = createBrowserProjectFileCommandPortV4({
      url: { createObjectURL, revokeObjectURL },
    })
    port.downloadProject(new Blob(['{}']), ' bad\u007f<>:"/\\|?*.json. ')
    port.downloadProject(new Blob(['{}']), ' . ')
    expect(clicks).toEqual(['bad__________.json', 'workcell.json'])
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })

  it('revokes and removes the anchor even if its click throws', () => {
    const failure = new Error('download click failed')
    const createObjectURL = vi.fn(() => 'blob:throw')
    const revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => { throw failure })
    const port = createBrowserProjectFileCommandPortV4({
      url: { createObjectURL, revokeObjectURL },
    })
    expect(() => port.downloadProject(new Blob(['{}']), 'good.json')).toThrow(failure)
    expect(document.querySelector('a')).toBeNull()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:throw')
  })
})
