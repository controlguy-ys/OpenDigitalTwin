// @vitest-environment node

import { expect, it } from 'vitest'

import { canonicalProjectV4Bytes, configRevisionForProjectV4 } from './canonical-json'
import { makeMinimalWorkcellProjectV4 } from './test-support'

it('matches an independently digested canonical fixture in Node 22', async () => {
  const project = makeMinimalWorkcellProjectV4()
  const bytes = canonicalProjectV4Bytes(project)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const expected = Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')

  await expect(configRevisionForProjectV4(project)).resolves.toBe(expected)
})
