import { describe, expect, it } from 'vitest'

import { canonicalProjectV5Bytes } from '../../../core/project-v5/canonical-json'
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
      expect.objectContaining({
        name: 'ProjectV5CodecError',
        code: 'PROJECT_JSON_SOURCE_INVALID',
      }),
    )
    await expect(decodeProjectV5({} as Uint8Array)).rejects.toBeInstanceOf(ProjectV5CodecError)
  })

  it('rejects malformed UTF-8 and non-whitespace JSON suffixes using stable codec errors', async () => {
    await expect(decodeProjectV5(new Uint8Array([0xc3, 0x28])))
      .rejects.toMatchObject({ code: 'PROJECT_JSON_ENCODING_INVALID' })
    await expect(decodeProjectV5(new TextEncoder().encode('{} {}')))
      .rejects.toMatchObject({ code: 'PROJECT_JSON_PARSE_FAILED' })
  })

  it('accepts trailing JSON whitespace but rejects a non-whitespace suffix', async () => {
    const json = JSON.stringify(makeMinimalWorkcellProjectV5())

    await expect(decodeProjectV5(new TextEncoder().encode(`${json} \n\t`)))
      .resolves.toEqual(makeMinimalWorkcellProjectV5())
    await expect(decodeProjectV5(new TextEncoder().encode(`${json} trailing`)))
      .rejects.toMatchObject({ name: 'ProjectV5CodecError', code: 'PROJECT_JSON_PARSE_FAILED' })
  })

  it('snapshots Uint8Array and ArrayBuffer bytes at invocation time', async () => {
    const project = makeMinimalWorkcellProjectV5()
    const bytes = canonicalProjectV5Bytes(project)
    const arrayBuffer = new Uint8Array(bytes).buffer

    const decodedBytes = decodeProjectV5(bytes)
    bytes.fill(0)
    const decodedBuffer = decodeProjectV5(arrayBuffer)
    new Uint8Array(arrayBuffer).fill(0)

    await expect(Promise.all([decodedBytes, decodedBuffer])).resolves.toEqual([project, project])
  })

  it('accepts genuine Uint8Array and ArrayBuffer subclasses without accessing Symbol.species', async () => {
    class ThrowingSpeciesUint8Array extends Uint8Array {
      static get [Symbol.species](): Uint8ArrayConstructor {
        throw new Error('Uint8Array species must not be read')
      }
    }
    class ThrowingSpeciesArrayBuffer extends ArrayBuffer {
      static get [Symbol.species](): ArrayBufferConstructor {
        throw new Error('ArrayBuffer species must not be read')
      }
    }
    const project = makeMinimalWorkcellProjectV5()
    const canonical = canonicalProjectV5Bytes(project)
    const bytes = new ThrowingSpeciesUint8Array(canonical)
    const buffer = new ThrowingSpeciesArrayBuffer(canonical.byteLength)
    new Uint8Array(buffer).set(canonical)

    await expect(Promise.all([decodeProjectV5(bytes), decodeProjectV5(buffer)]))
      .resolves.toEqual([project, project])
  })

  it('accepts genuine cross-realm sources and rejects spoofed, proxied, and DataView inputs', async () => {
    const project = makeMinimalWorkcellProjectV5()
    const canonical = canonicalProjectV5Bytes(project)
    const frame = document.createElement('iframe')
    document.body.append(frame)
    try {
      const foreign = frame.contentWindow as unknown as typeof globalThis
      const foreignBytes = new foreign.Uint8Array(canonical)
      const foreignBuffer = foreignBytes.buffer.slice(0)
      const foreignBlob = new foreign.Blob([foreignBytes])
      const spoof = { [Symbol.toStringTag]: 'ArrayBuffer' }
      const proxiedBytes = new Proxy(canonical, {})
      const dataView = new DataView(new ArrayBuffer(8))

      await expect(Promise.all([
        decodeProjectV5(foreignBlob as never),
        decodeProjectV5(foreignBytes as never),
        decodeProjectV5(foreignBuffer as never),
      ])).resolves.toEqual([project, project, project])
      for (const source of [spoof, proxiedBytes, dataView]) {
        await expect(decodeProjectV5(source as never)).rejects.toMatchObject({
          name: 'ProjectV5CodecError',
          code: 'PROJECT_JSON_SOURCE_INVALID',
        })
      }
    } finally {
      frame.remove()
    }
  })

  it('rejects detached and out-of-bounds sources when the runtime supports them', async () => {
    const transfer = (ArrayBuffer.prototype as { transfer?: (newLength?: number) => ArrayBuffer }).transfer
    if (transfer === undefined) return

    const detached = canonicalProjectV5Bytes(makeMinimalWorkcellProjectV5())
    transfer.call(detached.buffer)
    await expect(decodeProjectV5(detached)).rejects.toMatchObject({
      name: 'ProjectV5CodecError',
      code: 'PROJECT_JSON_SOURCE_INVALID',
    })

    const ResizableArrayBuffer = ArrayBuffer as unknown as {
      new (byteLength: number, options: { maxByteLength: number }): ArrayBuffer & {
        resize?: (length: number) => void
      }
    }
    const resizable = new ResizableArrayBuffer(16, { maxByteLength: 16 })
    const outOfBounds = new Uint8Array(resizable, 8, 8)
    const resize = resizable.resize
    if (resize === undefined) return
    resize.call(resizable, 4)
    await expect(decodeProjectV5(outOfBounds)).rejects.toMatchObject({
      name: 'ProjectV5CodecError',
      code: 'PROJECT_JSON_SOURCE_INVALID',
    })
  })
})
