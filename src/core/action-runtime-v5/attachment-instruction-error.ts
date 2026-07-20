const attachmentInstructionErrors = new WeakSet<object>()

export const ATTACHMENT_INSTRUCTION_ERROR_CODES_V1 = [
  'SOURCE_OWNERSHIP_CONFLICT',
  'ALREADY_ATTACHED',
  'NOT_ATTACHED',
  'OUT_OF_RANGE',
  'ATTACHMENT_TARGET_NOT_FOUND',
  'ATTACHMENT_FRAME_UNAVAILABLE',
] as const

export type AttachmentInstructionFailureCodeV1 = typeof ATTACHMENT_INSTRUCTION_ERROR_CODES_V1[number]

function isCode(value: unknown): value is AttachmentInstructionFailureCodeV1 {
  return typeof value === 'string'
    && (ATTACHMENT_INSTRUCTION_ERROR_CODES_V1 as readonly string[]).includes(value)
}

export class AttachmentInstructionErrorV1 extends Error {
  readonly code: AttachmentInstructionFailureCodeV1

  constructor(code: AttachmentInstructionFailureCodeV1, message: string) {
    if (!isCode(code)) throw new TypeError('Attachment instruction error code is invalid.')
    if (typeof message !== 'string' || message.length === 0) throw new TypeError('Attachment instruction error message is required.')
    super(message)
    this.name = 'AttachmentInstructionErrorV1'
    this.code = code
    attachmentInstructionErrors.add(this)
  }
}

export function createAttachmentInstructionErrorV1(
  code: AttachmentInstructionFailureCodeV1,
  message: string,
): AttachmentInstructionErrorV1 {
  if (!isCode(code)) throw new TypeError('Attachment instruction error code is invalid.')
  if (typeof message !== 'string' || message.length === 0) {
    throw new TypeError('Attachment instruction error message is required.')
  }
  return new AttachmentInstructionErrorV1(code, message)
}

export function isAttachmentInstructionErrorV1(value: unknown): value is AttachmentInstructionErrorV1 {
  return value instanceof AttachmentInstructionErrorV1
    && attachmentInstructionErrors.has(value)
    && value.name === 'AttachmentInstructionErrorV1'
    && isCode(value.code)
    && typeof value.message === 'string'
    && value.message.length > 0
}
