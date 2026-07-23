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
})
