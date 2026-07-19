import { describe, expect, it } from 'vitest'

import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../../core/project-v5/test-support'
import { encodeProjectV5, decodeProjectV5, ProjectV5CodecError } from './project-v5-codec'

describe('Project V5 file codec', () => {
  it('round-trips a canonical V5 Blob', async () => {
    const project = makeMinimalWorkcellProjectV5()
    const encoded = encodeProjectV5(project)

    expect(encoded.type).toBe('application/json;charset=utf-8')
    await expect(decodeProjectV5(encoded)).resolves.toEqual(project)
  })

  it.each([1, 2, 3, 4])('rejects V%i at the V5 decode boundary', async (schemaVersion) => {
    await expect(decodeProjectV5(new TextEncoder().encode(JSON.stringify({ schemaVersion }))))
      .rejects.toMatchObject({ code: 'PROJECT_SCHEMA_UNSUPPORTED', path: '$.schemaVersion' })
  })

  it.each(['quality', 'statusCode', 'sourceTimestamp', 'publishedTimestamp', 'owner'])
    ('rejects persisted logical Signal runtime field %s', async (field) => {
      const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
      ;(project.logicalSignals[0] as unknown as Record<string, unknown>)[field] = 'runtime-only'

      await expect(decodeProjectV5(new TextEncoder().encode(JSON.stringify(project))))
        .rejects.toMatchObject({ code: 'PROJECT_RECORD_NOT_CLOSED', path: '$.logicalSignals[0]' })
    })

  it('rejects invalid sources using a stable codec error', async () => {
    await expect(decodeProjectV5({} as Uint8Array)).rejects.toEqual(
      expect.objectContaining({ code: 'PROJECT_JSON_SOURCE_INVALID' }),
    )
    await expect(decodeProjectV5({} as Uint8Array)).rejects.toBeInstanceOf(ProjectV5CodecError)
  })

  it('rejects malformed UTF-8 and JSON using stable codec errors', async () => {
    await expect(decodeProjectV5(new Uint8Array([0xc3, 0x28])))
      .rejects.toMatchObject({ code: 'PROJECT_JSON_ENCODING_INVALID' })
    await expect(decodeProjectV5(new TextEncoder().encode('{} {}')))
      .rejects.toMatchObject({ code: 'PROJECT_JSON_PARSE_FAILED' })
  })

  it('snapshots ArrayBuffer and Uint8Array inputs before decoding', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(makeMinimalWorkcellProjectV5()))
    const buffer = new Uint8Array(bytes).buffer

    await expect(decodeProjectV5(bytes)).resolves.toEqual(makeMinimalWorkcellProjectV5())
    await expect(decodeProjectV5(buffer)).resolves.toEqual(makeMinimalWorkcellProjectV5())
  })
})
