import Dexie from 'dexie'
import { afterEach, describe, expect, it } from 'vitest'

import {
  canonicalProjectV4Bytes,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { ProjectDatabaseV4 } from './project-v4-db.js'
import {
  decodeProjectV4,
  encodeProjectV4,
  type ProjectV4CodecError,
} from './project-v4-codec.js'

const openDatabases: ProjectDatabaseV4[] = []
const databaseNames = new Set<string>()
let sequence = 0

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function databaseName(): string {
  const name = `project-v4-codec-${++sequence}`
  databaseNames.add(name)
  return name
}

function logicalAssetProject(): WorkcellProjectV4 {
  const project = jsonClone(makeMinimalWorkcellProjectV4())
  return {
    ...project,
    assetReferences: [{
      ...project.assetReferences[0]!,
      uri: 'asset://cell-library/fixture.step',
      sourceFileName: 'fixture.step',
    }],
  }
}

function reverseObjectKeyOrder<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => reverseObjectKeyOrder(item)) as T
  }
  if (value === null || typeof value !== 'object') return value

  const clone: Record<string, unknown> = {}
  for (const key of Object.keys(value).reverse()) {
    clone[key] = reverseObjectKeyOrder((value as Record<string, unknown>)[key])
  }
  return clone as T
}

afterEach(async () => {
  for (const database of openDatabases.splice(0)) database.close()
  for (const name of databaseNames) await Dexie.delete(name)
  databaseNames.clear()
})

describe('Project V4 canonical JSON codec', () => {
  it('exports exact Core canonical bytes with the required JSON MIME type', async () => {
    const project = logicalAssetProject()

    const blob = encodeProjectV4(project)

    expect(blob.type).toBe('application/json;charset=utf-8')
    expect(Array.from(new Uint8Array(await blob.arrayBuffer())))
      .toEqual(Array.from(canonicalProjectV4Bytes(project)))
  })

  it('round-trips a logical STEP Asset without source bytes or fixture physical paths', async () => {
    const project = logicalAssetProject()

    const blob = encodeProjectV4(project)
    const text = await blob.text()

    expect(text).toContain('asset://cell-library/fixture.step')
    expect(text).not.toContain('sourceBytes')
    expect(text).not.toContain('C:\\factory\\fixture.step')
    expect(text).not.toContain('/srv/assets/fixture.step')
    await expect(decodeProjectV4(blob)).resolves.toEqual(project)
  })

  it('decodes Blob, exact Uint8Array subarray, and ArrayBuffer snapshots as deeply frozen Projects', async () => {
    const project = logicalAssetProject()
    const bytes = canonicalProjectV4Bytes(project)
    const framed = new Uint8Array(bytes.byteLength + 4)
    framed.set([1, 2], 0)
    framed.set(bytes, 2)
    framed.set([3, 4], bytes.byteLength + 2)
    const subarray = framed.subarray(2, bytes.byteLength + 2)
    const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    const decoded = await Promise.all([
      decodeProjectV4(new Blob([bytes])),
      decodeProjectV4(subarray),
      decodeProjectV4(arrayBuffer),
    ])

    expect(decoded).toEqual([project, project, project])
    for (const result of decoded) {
      expect(Object.isFrozen(result)).toBe(true)
      expect(Object.isFrozen(result.metadata)).toBe(true)
      expect(Object.isFrozen(result.assetReferences)).toBe(true)
      expect(Object.isFrozen(result.assetReferences[0])).toBe(true)
    }
  })

  it('accepts noncanonical object-key order and re-exports it canonically', async () => {
    const project = logicalAssetProject()
    const noncanonicalText = JSON.stringify(reverseObjectKeyOrder(project))

    const decoded = await decodeProjectV4(new TextEncoder().encode(noncanonicalText))

    expect(Array.from(new Uint8Array(await encodeProjectV4(decoded).arrayBuffer())))
      .toEqual(Array.from(canonicalProjectV4Bytes(project)))
  })

  it('reports stable source, UTF-8, and parse failures before Core validation', async () => {
    await expect(decodeProjectV4('not-bytes' as never)).rejects.toMatchObject({
      name: 'ProjectV4CodecError',
      code: 'PROJECT_JSON_SOURCE_INVALID',
    } satisfies Partial<ProjectV4CodecError>)
    await expect(decodeProjectV4(Uint8Array.of(0xc3, 0x28))).rejects.toMatchObject({
      name: 'ProjectV4CodecError',
      code: 'PROJECT_JSON_ENCODING_INVALID',
    } satisfies Partial<ProjectV4CodecError>)
    await expect(decodeProjectV4(new TextEncoder().encode('{"schemaVersion":4} trailing')))
      .rejects.toMatchObject({
        name: 'ProjectV4CodecError',
        code: 'PROJECT_JSON_PARSE_FAILED',
      } satisfies Partial<ProjectV4CodecError>)
  })

  it('rejects an object that only spoofs the ArrayBuffer tag', async () => {
    const spoof = {
      byteLength: 2,
      slice: () => new ArrayBuffer(0),
      [Symbol.toStringTag]: 'ArrayBuffer',
    }

    await expect(decodeProjectV4(spoof as never)).rejects.toMatchObject({
      name: 'ProjectV4CodecError',
      code: 'PROJECT_JSON_SOURCE_INVALID',
    } satisfies Partial<ProjectV4CodecError>)
  })

  it.each([1, 2, 3])(
    'rejects schema V%i through Core before any V4 database write',
    async (schemaVersion) => {
      const database = new ProjectDatabaseV4(databaseName())
      openDatabases.push(database)
      await database.open()

      await expect(decodeProjectV4(
        new TextEncoder().encode(JSON.stringify({ schemaVersion })),
      )).rejects.toMatchObject({
        code: 'PROJECT_SCHEMA_UNSUPPORTED',
        path: '$.schemaVersion',
      })
      await expect(Promise.all([
        database.projectRevisions.count(),
        database.projectPointers.count(),
        database.projectCommitTokens.count(),
      ])).resolves.toEqual([0, 0, 0])
    },
  )

  it.each(['sourceBytes', 'sourcePath', 'mountPath'] as const)(
    'fails closed when an Asset contains unknown %s',
    async (field) => {
      const project = jsonClone(logicalAssetProject())
      const asset = project.assetReferences[0]! as unknown as Record<string, unknown>
      asset[field] = field === 'sourceBytes' ? [1, 2, 3] : '/srv/assets/fixture.step'

      await expect(decodeProjectV4(
        new TextEncoder().encode(JSON.stringify(project)),
      )).rejects.toMatchObject({ code: 'PROJECT_RECORD_NOT_CLOSED' })
    },
  )

  it('snapshots caller-owned bytes before the caller can mutate them', async () => {
    const project = logicalAssetProject()
    const bytes = canonicalProjectV4Bytes(project)

    const pending = decodeProjectV4(bytes)
    bytes.fill(0)

    await expect(pending).resolves.toEqual(project)
  })
})
