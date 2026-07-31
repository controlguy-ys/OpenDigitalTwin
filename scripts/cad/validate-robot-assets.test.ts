import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
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

function glbFromJsonBytes(jsonSource: Buffer): Buffer {
  const json = padded(jsonSource, 0x20)
  const binary = Buffer.alloc(80)
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

function glb(document: unknown): Buffer {
  return glbFromJsonBytes(Buffer.from(JSON.stringify(document), 'utf8'))
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
