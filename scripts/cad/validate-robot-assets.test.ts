import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  assertNed2MeshEvidence,
  validateNed2Glb,
  validateNed2Manifest,
  validateRobotAssets,
} from './validate-robot-assets.js'

const temporaryDirectories: string[] = []
const LINK_IDS = ['LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06']
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is not an object`)
  }
  return value
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is not an array`)
  return value
}

async function checkedInManifest(): Promise<unknown> {
  return JSON.parse(await readFile(
    resolve(process.cwd(), 'public', 'models', 'robot', 'ned2', 'manifest.json'),
    'utf8',
  )) as unknown
}

function validGlbDocument() {
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 78 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{}],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
}

function padded(bytes: Buffer, paddingByte: number): Buffer {
  const padding = (4 - (bytes.byteLength % 4)) % 4
  return padding === 0
    ? bytes
    : Buffer.concat([bytes, Buffer.alloc(padding, paddingByte)])
}

function validBinary(): Buffer {
  const binary = Buffer.alloc(80)
  const positions = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]
  const normals = [
    0, 0, 1,
    0, 0, 1,
    0, 0, 1,
  ]
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4))
  normals.forEach((value, index) => binary.writeFloatLE(value, 36 + (index * 4)))
  binary.writeUInt16LE(0, 72)
  binary.writeUInt16LE(1, 74)
  binary.writeUInt16LE(2, 76)
  return binary
}

function stridedNormalizedDocument() {
  return {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 66 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      {
        buffer: 0,
        byteOffset: 36,
        byteLength: 22,
        byteStride: 8,
      },
      { buffer: 0, byteOffset: 60, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      {
        bufferView: 1,
        componentType: 5122,
        count: 3,
        type: 'VEC3',
        normalized: true,
      },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    materials: [{}],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1 },
        indices: 2,
        material: 0,
      }],
    }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }
}

function stridedNormalizedBinary(): Buffer {
  const binary = Buffer.alloc(68)
  const positions = [
    0, 0, 0,
    1, 0, 0,
    0, 1, 0,
  ]
  positions.forEach((value, index) => binary.writeFloatLE(value, index * 4))
  for (let index = 0; index < 3; index += 1) {
    const offset = 36 + (index * 8)
    binary.writeInt16LE(0, offset)
    binary.writeInt16LE(0, offset + 2)
    binary.writeInt16LE(32767, offset + 4)
  }
  binary.writeUInt16LE(0, 60)
  binary.writeUInt16LE(1, 62)
  binary.writeUInt16LE(2, 64)
  return binary
}

function glbFromJsonBytes(
  jsonSource: Buffer,
  binary = validBinary(),
): Buffer {
  const json = padded(jsonSource, 0x20)
  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(json.byteLength, 0)
  jsonHeader.writeUInt32LE(JSON_CHUNK_TYPE, 4)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binary.byteLength, 0)
  binaryHeader.writeUInt32LE(BIN_CHUNK_TYPE, 4)
  const byteLength = 12 + jsonHeader.byteLength + json.byteLength
    + binaryHeader.byteLength + binary.byteLength
  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(byteLength, 8)
  return Buffer.concat([header, jsonHeader, json, binaryHeader, binary])
}

function glb(document: unknown, binary = validBinary()): Buffer {
  return glbFromJsonBytes(
    Buffer.from(JSON.stringify(document), 'utf8'),
    binary,
  )
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => (
    rm(path, { recursive: true, force: true })
  )))
})

describe('NED2 asset validation', () => {
  it('binds every manifest Geometry key to one nested render URI and validates the real GLBs', async () => {
    const bindings = validateNed2Manifest(await checkedInManifest())

    expect(bindings.map((binding) => [
      binding.linkId,
      binding.occurrenceKey,
      binding.renderAssetUri,
    ])).toEqual(LINK_IDS.map((linkId) => [
      linkId,
      `whole-source:${linkId}`,
      `/models/robot/ned2/${linkId}.glb`,
    ]))
    await expect(validateRobotAssets(
      resolve(process.cwd(), 'public', 'models', 'robot', 'ned2'),
    )).resolves.toBeUndefined()
  })

  it('rejects a wrong per-Link manifest Geometry reference', async () => {
    const manifest = await checkedInManifest()
    const definition = record(record(manifest, 'manifest').definition, 'definition')
    const links = array(definition.links, 'links')
    const link03 = record(links[3], 'LINK03')
    const occurrences = array(link03.geometryOccurrences, 'LINK03 occurrences')
    record(occurrences[0], 'LINK03 occurrence').occurrenceKey = 'whole-source:LINK04'

    expect(() => validateNed2Manifest(manifest)).toThrow(
      /LINK03 must map whole-source:LINK03/,
    )
  })

  it('rejects a header-valid GLB whose JSON chunk is malformed', () => {
    const bytes = glbFromJsonBytes(Buffer.from('{"asset":', 'utf8'))

    expect(() => validateNed2Glb(bytes, 'LINK00')).toThrow(
      /JSON chunk is malformed/,
    )
  })

  it('rejects a header-valid GLB with an out-of-range mesh accessor reference', () => {
    const document = validGlbDocument()
    document.meshes[0]!.primitives[0]!.attributes.POSITION = 99

    expect(() => validateNed2Glb(glb(document), 'LINK02')).toThrow(
      /POSITION accessor references missing index 99/,
    )
  })

  it('rejects an out-of-range triangle index decoded from a valid BIN chunk', () => {
    const binary = validBinary()
    binary.writeUInt16LE(3, 76)

    expect(() => validateNed2Glb(
      glb(validGlbDocument(), binary),
      'LINK02',
    )).toThrow(/triangle contains an out-of-range index/)
  })

  it('rejects a non-finite POSITION decoded from a valid BIN chunk', () => {
    const binary = validBinary()
    binary.writeFloatLE(Number.NaN, 0)

    expect(() => validateNed2Glb(
      glb(validGlbDocument(), binary),
      'LINK03',
    )).toThrow(/POSITION accessor contains a non-finite value/)
  })

  it('decodes normalized components through a strided accessor', () => {
    const evidence = validateNed2Glb(
      glb(stridedNormalizedDocument(), stridedNormalizedBinary()),
      'LINK03',
    )

    expect(evidence).toMatchObject({
      triangleCount: 1,
      bounds: { min: [0, 0, 0], max: [1, 1, 0] },
    })
  })

  it('rejects a repeated-index degenerate triangle decoded from BIN', () => {
    const binary = validBinary()
    binary.writeUInt16LE(1, 76)

    expect(() => validateNed2Glb(
      glb(validGlbDocument(), binary),
      'LINK04',
    )).toThrow(/triangle contains repeated indices/)
  })

  it('rejects mesh triangle and bounds evidence that differs from the manifest', () => {
    const evidence = validateNed2Glb(glb(validGlbDocument()), 'LINK05')
    const matchingBounds = evidence.bounds

    expect(() => assertNed2MeshEvidence({
      linkId: 'LINK05',
      expectedTriangles: 2,
      expectedBounds: matchingBounds,
    }, evidence)).toThrow(/has 1 triangles; manifest requires 2/)
    expect(() => assertNed2MeshEvidence({
      linkId: 'LINK05',
      expectedTriangles: 1,
      expectedBounds: {
        min: matchingBounds.min,
        max: [matchingBounds.max[0] + 0.01, matchingBounds.max[1], matchingBounds.max[2]],
      },
    }, evidence)).toThrow(/differs from manifest bounds/)
  })

  it('rejects orphan render GLBs that are not bound by the manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'ned2-glb-validation-'))
    temporaryDirectories.push(directory)
    await writeFile(
      join(directory, 'manifest.json'),
      JSON.stringify(await checkedInManifest()),
    )
    await Promise.all([
      ...LINK_IDS.map((linkId) => (
        writeFile(join(directory, `${linkId}.glb`), glb(validGlbDocument()))
      )),
      writeFile(join(directory, 'ORPHAN.glb'), glb(validGlbDocument())),
    ])

    await expect(validateRobotAssets(directory)).rejects.toThrow(
      /render asset files do not match manifest bindings/,
    )
  })
})
