import { describe, expect, it, vi } from 'vitest'

import { createTransformSessionV6, type TransformPoseV6 } from './transform-session-v6.js'

const original = { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const }
const drafted = { positionM: [1, 2, 3] as const, quaternion: [0, 0, 0, 1] as const }

describe('TransformSessionV6', () => {
  it('keeps drag motion local and publishes one mutation only on a successful drag end', async () => {
    const applyDraft = vi.fn()
    const mutate = vi.fn().mockResolvedValue(undefined)
    const subject = createTransformSessionV6({ owner: 'manual', initialPose: original, applyDraft, mutate })
    expect(subject.begin()).toEqual({ accepted: true })
    subject.update(drafted)
    expect(mutate).not.toHaveBeenCalled()
    await subject.commit()
    expect(mutate).toHaveBeenCalledOnce()
    expect(mutate).toHaveBeenCalledWith(drafted)
  })

  it('restores the snapshot for Escape and mutation rejection', async () => {
    const applyDraft = vi.fn()
    const restore = vi.fn()
    const rejected = createTransformSessionV6({ owner: 'manual', initialPose: original, applyDraft, restore, mutate: vi.fn().mockRejectedValue(new Error('stale')) })
    rejected.begin(); rejected.update(drafted); rejected.cancel()
    expect(restore).toHaveBeenCalledWith(original)
    rejected.begin(); rejected.update(drafted)
    await expect(rejected.commit()).rejects.toThrow('stale')
    expect(restore).toHaveBeenLastCalledWith(original)
  })

  it('captures and validates the current V5 pose at drag start before publishing', async () => {
    let currentPose: TransformPoseV6 = original
    const applyDraft = vi.fn()
    const mutate = vi.fn().mockResolvedValue(undefined)
    const restore = vi.fn()
    const subject = createTransformSessionV6({
      owner: 'manual',
      initialPose: original,
      readCurrentPose: () => currentPose,
      applyDraft,
      mutate,
      restore,
    })

    currentPose = drafted
    expect(subject.begin()).toEqual({ accepted: true })
    subject.update({ positionM: [Number.NaN, 0, 0], quaternion: [0, 0, 0, 1] })
    expect(applyDraft).not.toHaveBeenCalled()
    await subject.commit()
    expect(mutate).not.toHaveBeenCalled()
    subject.cancel()
    expect(restore).toHaveBeenLastCalledWith(drafted)
  })

  it('rejects OPC UA, simulation, and attachment owners before temporary motion', () => {
    for (const owner of ['opcua:plc', 'simulation', 'attachment'] as const) {
      const applyDraft = vi.fn()
      const subject = createTransformSessionV6({ owner, initialPose: original, applyDraft, mutate: vi.fn() })
      expect(subject.begin()).toEqual({ accepted: false, reason: expect.stringContaining(owner) })
      subject.update(drafted)
      expect(applyDraft).not.toHaveBeenCalled()
    }
  })
})
