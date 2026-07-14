export type Sha256WorkerRequest =
  | { readonly type: 'init'; readonly totalBytes: number }
  | { readonly type: 'chunk'; readonly sequence: number; readonly bytes: ArrayBuffer }
  | { readonly type: 'final' }
  | { readonly type: 'cancel' }

export type Sha256WorkerResponse =
  | { readonly type: 'initialized'; readonly totalBytes: number }
  | { readonly type: 'chunk-ack'; readonly sequence: number; readonly receivedBytes: number }
  | { readonly type: 'digest'; readonly sha256: string; readonly totalBytes: number }
  | { readonly type: 'cancelled' }
  | { readonly type: 'error'; readonly code: 'PROJECT_HASH_WORKER_FAILED'; readonly message: string }

export const SHA256_WORKER_CHUNK_BYTES = 4 * 1024 * 1024

export interface IncrementalSha256 {
  update(bytes: Uint8Array): void
  digestHex(): string
}

export interface Sha256WorkerSession {
  handle(message: unknown): void
}

const INITIAL_STATE = Uint32Array.from([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

const ROUND_CONSTANTS = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

function rotateRight(value: number, amount: number): number {
  return (value >>> amount) | (value << (32 - amount))
}

function processBlock(
  state: Uint32Array,
  bytes: Uint8Array,
  offset: number,
  words: Uint32Array,
): void {
  for (let index = 0; index < 16; index += 1) {
    const byteOffset = offset + index * 4
    words[index] = (
      (bytes[byteOffset]! << 24) |
      (bytes[byteOffset + 1]! << 16) |
      (bytes[byteOffset + 2]! << 8) |
      bytes[byteOffset + 3]!
    ) >>> 0
  }
  for (let index = 16; index < 64; index += 1) {
    const previous15 = words[index - 15]!
    const previous2 = words[index - 2]!
    const sigma0 = rotateRight(previous15, 7) ^ rotateRight(previous15, 18) ^ (previous15 >>> 3)
    const sigma1 = rotateRight(previous2, 17) ^ rotateRight(previous2, 19) ^ (previous2 >>> 10)
    words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0
  }

  let a = state[0]!
  let b = state[1]!
  let c = state[2]!
  let d = state[3]!
  let e = state[4]!
  let f = state[5]!
  let g = state[6]!
  let h = state[7]!

  for (let index = 0; index < 64; index += 1) {
    const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25)
    const choice = (e & f) ^ (~e & g)
    const temporary1 = (h + sum1 + choice + ROUND_CONSTANTS[index]! + words[index]!) >>> 0
    const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22)
    const majority = (a & b) ^ (a & c) ^ (b & c)
    const temporary2 = (sum0 + majority) >>> 0
    h = g
    g = f
    f = e
    e = (d + temporary1) >>> 0
    d = c
    c = b
    b = a
    a = (temporary1 + temporary2) >>> 0
  }

  state[0] = (state[0]! + a) >>> 0
  state[1] = (state[1]! + b) >>> 0
  state[2] = (state[2]! + c) >>> 0
  state[3] = (state[3]! + d) >>> 0
  state[4] = (state[4]! + e) >>> 0
  state[5] = (state[5]! + f) >>> 0
  state[6] = (state[6]! + g) >>> 0
  state[7] = (state[7]! + h) >>> 0
}

export function createIncrementalSha256(): IncrementalSha256 {
  const state = INITIAL_STATE.slice()
  const pending = new Uint8Array(64)
  const words = new Uint32Array(64)
  let pendingLength = 0
  let totalBytes = 0
  let digest: string | undefined

  return {
    update(bytes) {
      if (digest !== undefined) throw new Error('SHA-256 digest is already finalized.')
      if (!(bytes instanceof Uint8Array)) throw new Error('SHA-256 update requires Uint8Array bytes.')
      totalBytes += bytes.byteLength
      if (!Number.isSafeInteger(totalBytes)) throw new Error('SHA-256 input is too large.')
      let offset = 0
      if (pendingLength > 0) {
        const copied = Math.min(64 - pendingLength, bytes.byteLength)
        pending.set(bytes.subarray(0, copied), pendingLength)
        pendingLength += copied
        offset += copied
        if (pendingLength === 64) {
          processBlock(state, pending, 0, words)
          pendingLength = 0
        }
      }
      while (offset + 64 <= bytes.byteLength) {
        processBlock(state, bytes, offset, words)
        offset += 64
      }
      if (offset < bytes.byteLength) {
        pending.set(bytes.subarray(offset), 0)
        pendingLength = bytes.byteLength - offset
      }
    },
    digestHex() {
      if (digest !== undefined) return digest
      const finalBytes = new Uint8Array(pendingLength < 56 ? 64 : 128)
      finalBytes.set(pending.subarray(0, pendingLength))
      finalBytes[pendingLength] = 0x80
      const bitHigh = Math.floor(totalBytes / 0x20000000)
      const bitLow = (totalBytes * 8) >>> 0
      const lengthOffset = finalBytes.byteLength - 8
      finalBytes[lengthOffset] = (bitHigh >>> 24) & 0xff
      finalBytes[lengthOffset + 1] = (bitHigh >>> 16) & 0xff
      finalBytes[lengthOffset + 2] = (bitHigh >>> 8) & 0xff
      finalBytes[lengthOffset + 3] = bitHigh & 0xff
      finalBytes[lengthOffset + 4] = (bitLow >>> 24) & 0xff
      finalBytes[lengthOffset + 5] = (bitLow >>> 16) & 0xff
      finalBytes[lengthOffset + 6] = (bitLow >>> 8) & 0xff
      finalBytes[lengthOffset + 7] = bitLow & 0xff
      for (let offset = 0; offset < finalBytes.byteLength; offset += 64) {
        processBlock(state, finalBytes, offset, words)
      }
      digest = Array.from(state, (word) => word.toString(16).padStart(8, '0')).join('')
      return digest
    },
  }
}

function isPlainClosedRecord(
  value: unknown,
  requiredKeys: readonly string[],
): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== requiredKeys.length ||
    keys.some((key) => typeof key !== 'string' || !requiredKeys.includes(key))
  ) {
    return false
  }
  return requiredKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor
  })
}

function isArrayBuffer(value: unknown): value is ArrayBuffer {
  if (typeof value !== 'object' || value === null) return false
  try {
    return Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get?.call(value) !== undefined
  } catch {
    return false
  }
}

export function createSha256WorkerSession(
  postResponse: (response: Sha256WorkerResponse) => void,
): Sha256WorkerSession {
  let hash: IncrementalSha256 | undefined
  let totalBytes = 0
  let receivedBytes = 0
  let nextSequence = 0
  let closed = false

  const fail = (message: string): void => {
    if (closed) return
    closed = true
    postResponse({ type: 'error', code: 'PROJECT_HASH_WORKER_FAILED', message })
  }

  return {
    handle(message) {
      if (closed) return
      if (isPlainClosedRecord(message, ['type']) && message.type === 'cancel') {
        closed = true
        postResponse({ type: 'cancelled' })
        return
      }
      if (hash === undefined) {
        if (!isPlainClosedRecord(message, ['type', 'totalBytes']) || message.type !== 'init') {
          fail('Expected init as the first SHA-256 Worker message.')
          return
        }
        if (
          typeof message.totalBytes !== 'number' ||
          !Number.isSafeInteger(message.totalBytes) ||
          message.totalBytes < 0
        ) {
          fail('SHA-256 totalBytes must be a non-negative safe integer.')
          return
        }
        totalBytes = message.totalBytes
        hash = createIncrementalSha256()
        postResponse({ type: 'initialized', totalBytes })
        return
      }
      if (isPlainClosedRecord(message, ['type', 'sequence', 'bytes']) && message.type === 'chunk') {
        if (
          typeof message.sequence !== 'number' ||
          !Number.isSafeInteger(message.sequence) ||
          message.sequence !== nextSequence ||
          !isArrayBuffer(message.bytes)
        ) {
          fail('SHA-256 chunk sequence or bytes are invalid.')
          return
        }
        const bytes = new Uint8Array(message.bytes)
        const expectedLength = Math.min(
          SHA256_WORKER_CHUNK_BYTES,
          totalBytes - receivedBytes,
        )
        if (expectedLength === 0 || bytes.byteLength !== expectedLength) {
          fail('SHA-256 chunk length is not the canonical next chunk length.')
          return
        }
        hash.update(bytes)
        receivedBytes += bytes.byteLength
        const sequence = nextSequence
        nextSequence += 1
        postResponse({ type: 'chunk-ack', sequence, receivedBytes })
        return
      }
      if (isPlainClosedRecord(message, ['type']) && message.type === 'final') {
        if (receivedBytes !== totalBytes) {
          fail('SHA-256 final arrived before all declared bytes.')
          return
        }
        const sha256 = hash.digestHex()
        closed = true
        postResponse({ type: 'digest', sha256, totalBytes })
        return
      }
      fail('Unknown or out-of-order SHA-256 Worker message.')
    },
  }
}

interface WorkerGlobalLike {
  readonly document?: unknown
  readonly close?: () => void
  postMessage?: (message: Sha256WorkerResponse) => void
  onmessage?: ((event: MessageEvent<unknown>) => void) | null
}

const workerGlobal = globalThis as unknown as WorkerGlobalLike
if (
  workerGlobal.document === undefined &&
  typeof workerGlobal.close === 'function' &&
  typeof workerGlobal.postMessage === 'function'
) {
  const session = createSha256WorkerSession((response) => workerGlobal.postMessage!(response))
  workerGlobal.onmessage = (event) => session.handle(event.data)
}
