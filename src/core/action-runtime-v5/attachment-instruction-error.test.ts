import { describe, expect, it } from 'vitest'

import {
  AttachmentInstructionErrorV1,
  createAttachmentInstructionErrorV1,
  isAttachmentInstructionErrorV1,
} from './attachment-instruction-error.js'

describe('AttachmentInstructionErrorV1', () => {
  it('creates and recognizes only a listed Attachment instruction failure code', () => {
    const error = createAttachmentInstructionErrorV1(
      'OUT_OF_RANGE',
      'Object is outside the grasp range.',
    )

    expect(error).toMatchObject({ name: 'AttachmentInstructionErrorV1', code: 'OUT_OF_RANGE' })
    expect(isAttachmentInstructionErrorV1(error)).toBe(true)
    error.message = ''
    expect(isAttachmentInstructionErrorV1(error)).toBe(false)
    expect(isAttachmentInstructionErrorV1({ code: 'UNLISTED', message: 'spoof' })).toBe(false)
  })

  it('enforces the contract through the public constructor and rejects mutated identity', () => {
    expect(() => new AttachmentInstructionErrorV1('OUT_OF_RANGE', '')).toThrow(TypeError)
    expect(() => new AttachmentInstructionErrorV1('INVALID' as 'OUT_OF_RANGE', 'invalid')).toThrow(TypeError)
    const error = new AttachmentInstructionErrorV1('OUT_OF_RANGE', 'stable')
    error.name = 'Error'
    expect(isAttachmentInstructionErrorV1(error)).toBe(false)
  })
})
