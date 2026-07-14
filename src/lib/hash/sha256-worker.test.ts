import { describe, expect, it } from 'vitest'
import {
  createIncrementalSha256,
  createSha256WorkerSession,
  type Sha256WorkerResponse,
} from './sha256-worker'

const encoder = new TextEncoder()

describe('incremental SHA-256 Worker', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'The quick brown fox jumps over the lazy dog',
      'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
    ],
  ])('hashes %j incrementally', (source, expected) => {
    const bytes = encoder.encode(source)
    const hash = createIncrementalSha256()
    for (const byte of bytes) hash.update(Uint8Array.of(byte))
    expect(hash.digestHex()).toBe(expected)
  })

  it('accepts only ordered init, chunk, final, and cancel messages', () => {
    const responses: Sha256WorkerResponse[] = []
    const session = createSha256WorkerSession((response) => responses.push(response))

    session.handle({ type: 'init', totalBytes: 3 })
    session.handle({ type: 'chunk', sequence: 0, bytes: encoder.encode('abc').buffer })
    session.handle({ type: 'final' })

    expect(responses).toEqual([
      { type: 'initialized', totalBytes: 3 },
      { type: 'chunk-ack', sequence: 0, receivedBytes: 3 },
      {
        type: 'digest',
        sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        totalBytes: 3,
      },
    ])
  })

  it.each([
    [[{ type: 'chunk', sequence: 0, bytes: new ArrayBuffer(0) }]],
    [[
      { type: 'init', totalBytes: 1 },
      { type: 'chunk', sequence: 1, bytes: Uint8Array.of(1).buffer },
    ]],
    [[
      { type: 'init', totalBytes: 2 },
      { type: 'chunk', sequence: 0, bytes: Uint8Array.of(1).buffer },
      { type: 'final' },
    ]],
    [[
      { type: 'init', totalBytes: 4 * 1024 * 1024 + 1 },
      { type: 'chunk', sequence: 0, bytes: Uint8Array.of(1).buffer },
    ]],
    [[
      { type: 'init', totalBytes: 1 },
      { type: 'chunk', sequence: 0, bytes: new ArrayBuffer(0) },
    ]],
    [[
      { type: 'init', totalBytes: 0 },
      { type: 'chunk', sequence: 0, bytes: new ArrayBuffer(0) },
    ]],
    [[
      { type: 'init', totalBytes: 1 },
      { type: 'chunk', sequence: 0, bytes: Uint8Array.of(1).buffer },
      { type: 'chunk', sequence: 1, bytes: new ArrayBuffer(0) },
    ]],
  ])('fails closed for malformed protocol ordering', (messages) => {
    const responses: Sha256WorkerResponse[] = []
    const session = createSha256WorkerSession((response) => responses.push(response))
    for (const message of messages) session.handle(message)
    expect(responses.at(-1)).toMatchObject({ type: 'error', code: 'PROJECT_HASH_WORKER_FAILED' })
  })

  it('acknowledges cancel once and ignores all later messages', () => {
    const responses: Sha256WorkerResponse[] = []
    const session = createSha256WorkerSession((response) => responses.push(response))
    session.handle({ type: 'init', totalBytes: 1 })
    session.handle({ type: 'cancel' })
    session.handle({ type: 'chunk', sequence: 0, bytes: Uint8Array.of(1).buffer })
    expect(responses).toEqual([
      { type: 'initialized', totalBytes: 1 },
      { type: 'cancelled' },
    ])
  })
})
