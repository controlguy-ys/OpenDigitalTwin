import { describe, expect, it, vi } from 'vitest'
import { createLocalHelpControllerV4 } from './local-help-controller.js'

describe('createLocalHelpControllerV4', () => {
  it('opens declared topics and disposal prevents later publication', () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls', 'about'] })
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.open('controls')
    expect(controller.getState()).toEqual({ openTopic: 'controls' })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(() => controller.open('opcUaMapping')).toThrow('Local Help topic is unavailable: opcUaMapping')
    controller.dispose()
    controller.close()
    expect(controller.getState()).toEqual({ openTopic: 'controls' })
    expect(listener).toHaveBeenCalledTimes(1)
  })
})
