import { describe, expect, it, vi } from 'vitest'

import { createBrowserProjectFileCommandPortV5 } from './project-file-command-port-v5.js'

describe('Project V5 browser file command port', () => {
  it('returns explicit cancel without retaining a temporary picker element', async () => {
    const input = document.createElement('input')
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(input)
    const port = createBrowserProjectFileCommandPortV5({ document })
    input.click = () => input.dispatchEvent(new Event('cancel'))

    await expect(port.pickProject()).resolves.toBeNull()
    expect(input.isConnected).toBe(false)
    createElement.mockRestore()
  })

  it('uses a deterministic safe json file name and releases all download resources', () => {
    const anchor = document.createElement('a')
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const url = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }
    const port = createBrowserProjectFileCommandPortV5({ document, url })
    anchor.click = vi.fn(() => { throw new Error('download blocked') })

    expect(() => port.downloadProject(new Blob(['{}']), { name: '  Bad:/ Name. ', projectId: 'project/1' }))
      .toThrow('download blocked')
    expect(anchor.download).toBe('Bad__ Name-project_1.json')
    expect(anchor.isConnected).toBe(false)
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    createElement.mockRestore()
  })

  it('releases the object URL when appending the temporary download element fails', () => {
    const append = vi.spyOn(document.body, 'append').mockImplementation(() => { throw new Error('append blocked') })
    const url = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }
    const port = createBrowserProjectFileCommandPortV5({ document, url })

    expect(() => port.downloadProject(new Blob(['{}']), { name: 'Project', projectId: 'project-1' })).toThrow('append blocked')
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    append.mockRestore()
  })

  it('cleans a partially initialized picker when append or listener setup fails', async () => {
    const input = document.createElement('input')
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(input)
    const remove = vi.spyOn(input, 'remove')
    const append = vi.spyOn(document.body, 'append').mockImplementationOnce(() => { throw new Error('append blocked') })
    const port = createBrowserProjectFileCommandPortV5({ document })

    await expect(port.pickProject()).rejects.toThrow('append blocked')
    expect(remove).toHaveBeenCalledOnce()
    append.mockRestore()

    const nativeAdd = input.addEventListener.bind(input)
    const add = vi.spyOn(input, 'addEventListener').mockImplementation((type, listener, options) => {
      nativeAdd(type, listener, options)
      if (type === 'cancel') throw new Error('listener blocked')
    })
    const removeListener = vi.spyOn(input, 'removeEventListener')
    await expect(port.pickProject()).rejects.toThrow('listener blocked')
    expect(remove).toHaveBeenCalledTimes(2)
    expect(removeListener).toHaveBeenCalledWith('cancel', expect.any(Function))
    add.mockRestore()
    createElement.mockRestore()
  })

  it('revokes the object URL even when temporary anchor removal throws', () => {
    const anchor = document.createElement('a')
    vi.spyOn(anchor, 'remove').mockImplementation(() => { throw new Error('remove blocked') })
    const createElement = vi.spyOn(document, 'createElement').mockReturnValue(anchor)
    const url = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() }
    const port = createBrowserProjectFileCommandPortV5({ document, url })

    expect(() => port.downloadProject(new Blob(['{}']), { name: 'Project', projectId: 'project-1' })).toThrow('remove blocked')
    expect(url.revokeObjectURL).toHaveBeenCalledWith('blob:test')
    createElement.mockRestore()
  })
})
