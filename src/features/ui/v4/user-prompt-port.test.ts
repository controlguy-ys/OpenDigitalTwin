import { describe, expect, it, vi } from 'vitest'
import { createBrowserUserPromptPortV4 } from './user-prompt-port.js'

describe('createBrowserUserPromptPortV4', () => {
  it('returns cancellation and rejects a required blank response before feature code runs', async () => {
    const cancel = createBrowserUserPromptPortV4({ prompt: vi.fn(() => null) })
    await expect(cancel.requestText({ title: 'Job name', initialValue: 'A', required: true }))
      .resolves.toBeNull()
    const blank = createBrowserUserPromptPortV4({ prompt: vi.fn(() => '  ') })
    await expect(blank.requestText({ title: 'Job name', initialValue: 'A', required: true }))
      .rejects.toThrow('Job name is required.')
  })
})
