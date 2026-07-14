export interface PortableCryptoSource {
  readonly randomUUID?: () => string
  readonly getRandomValues?: (target: Uint8Array) => Uint8Array
}

export function createPortableId(
  cryptoSource: PortableCryptoSource | undefined = globalThis.crypto,
): string {
  if (typeof cryptoSource?.randomUUID === 'function') {
    return cryptoSource.randomUUID.call(cryptoSource)
  }

  if (typeof cryptoSource?.getRandomValues !== 'function') {
    throw new Error('PORTABLE_ID_CRYPTO_UNAVAILABLE')
  }

  const bytes = new Uint8Array(16)
  cryptoSource.getRandomValues.call(cryptoSource, bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-')
}
