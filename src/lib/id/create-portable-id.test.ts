import { describe, expect, it } from 'vitest'
import { createPortableId } from './create-portable-id'

describe('createPortableId', () => {
  it('prefers randomUUID and supports the getRandomValues-only trusted-LAN path', () => {
    expect(createPortableId({
      randomUUID: () => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      getRandomValues: () => {
        throw new Error('fallback must not run')
      },
    })).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')

    const bytes = Uint8Array.from([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff,
    ])
    expect(createPortableId({
      getRandomValues: (target) => {
        target.set(bytes)
        return target
      },
    })).toBe('00112233-4455-4677-8899-aabbccddeeff')
  })

  it('fails explicitly instead of using Math.random when cryptographic IDs are unavailable', () => {
    expect(() => createPortableId({})).toThrow(
      /PORTABLE_ID_CRYPTO_UNAVAILABLE/,
    )
  })

  it('creates unique RFC 4122 version-4-shaped IDs with the runtime crypto source', () => {
    const ids = Array.from({ length: 10_000 }, () => createPortableId())

    expect(new Set(ids)).toHaveLength(ids.length)
    for (const id of ids) {
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
    }
  })
})
