import { describe, expect, it, vi } from 'vitest'
import { createBrowserUserPromptPortV4 } from './user-prompt-port.js'

describe('createBrowserUserPromptPortV4', () => {
  it('calls the browser prompt once and preserves a nonblank response verbatim', async () => {
    const prompt = vi.fn(() => '  named exactly  ')
    const port = createBrowserUserPromptPortV4({ prompt })
    await expect(port.requestText({ title: 'Job name', initialValue: 'Old', required: true }))
      .resolves.toBe('  named exactly  ')
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(prompt).toHaveBeenCalledWith('Job name', 'Old')
  })

  it('makes cancellation non-error, rejects required blank text, and permits optional blank text', async () => {
    await expect(createBrowserUserPromptPortV4({ prompt: () => null })
      .requestText({ title: 'Job name', initialValue: '', required: true })).resolves.toBeNull()
    await expect(createBrowserUserPromptPortV4({ prompt: () => ' \t ' })
      .requestText({ title: 'Job name', initialValue: '', required: true }))
      .rejects.toThrow('Job name is required.')
    await expect(createBrowserUserPromptPortV4({ prompt: () => '  ' })
      .requestText({ title: 'Optional', initialValue: '', required: false })).resolves.toBe('  ')
  })

  it('preserves a thrown browser prompt Error', async () => {
    const failure = new Error('prompt unavailable')
    const port = createBrowserUserPromptPortV4({ prompt: () => { throw failure } })
    await expect(port.requestText({ title: 'Job name', initialValue: '', required: true })).rejects.toBe(failure)
  })
})
