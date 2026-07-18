import { describe, expect, it, vi } from 'vitest'
import { createLocalHelpControllerV4, type LocalHelpTopicV4 } from './local-help-controller.js'

describe('createLocalHelpControllerV4', () => {
  it('uses only copied declared topics and publishes immutable state exactly once per change', () => {
    const declared: LocalHelpTopicV4[] = ['controls', 'stepImport', 'opcUaMapping', 'about']
    const controller = createLocalHelpControllerV4({ availableTopics: declared })
    declared.length = 0
    const listener = vi.fn()
    controller.subscribe(listener)
    for (const topic of ['controls', 'stepImport', 'opcUaMapping', 'about'] as const) {
      expect(controller.hasTopic(topic)).toBe(true)
      controller.open(topic)
      expect(Object.isFrozen(controller.getState())).toBe(true)
    }
    controller.open('about')
    expect(listener).toHaveBeenCalledTimes(4)
    controller.close()
    controller.close()
    expect(listener).toHaveBeenCalledTimes(5)
  })

  it('rejects omitted topics without publishing and handles unsubscribe/disposal', () => {
    const controller = createLocalHelpControllerV4({ availableTopics: ['controls'] })
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    expect(controller.hasTopic('opcUaMapping')).toBe(false)
    expect(() => controller.open('opcUaMapping')).toThrow('Local Help topic is unavailable: opcUaMapping')
    expect(listener).not.toHaveBeenCalled()
    unsubscribe()
    controller.open('controls')
    expect(listener).not.toHaveBeenCalled()
    controller.dispose()
    controller.close()
    expect(controller.getState()).toEqual({ openTopic: 'controls' })
  })
})
