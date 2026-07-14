import { unzipSync, zipSync } from 'fflate'
import type {
  LegacyProjectSnapshotV2 as CurrentProjectSnapshot,
  ObjectAssetRecordV1,
  ObjectAssetRecordV2,
  RobotLinkGeometryRecordV1,
  RobotLinkGeometryRecordV2,
  WorkcellProjectSnapshotV1,
  WorkcellProjectSnapshotV2,
} from '../../domain/project/project'
import {
  MAX_OBJECT_ASSET_BYTES,
  MAX_PROJECT_SOURCE_BYTES,
  MAX_ROBOT_LINK_BYTES,
  validateWorkcellProjectSnapshotV2 as validateWorkcellProjectSnapshot,
  validateWorkcellProjectSnapshotV1,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2 as WORKCELL_PROJECT_SCHEMA_VERSION,
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
} from '../../domain/project/project'
import { migrateV1ToV2 } from '../../domain/project/project-v1-migration'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const MAX_JSON_ENTRY_BYTES = 8 * 1024 * 1024
const MAX_ARCHIVE_ENTRIES = 1024
const MAX_ARCHIVE_BYTES = 300 * 1024 * 1024
const MAX_UNCOMPRESSED_ARCHIVE_BYTES =
  MAX_PROJECT_SOURCE_BYTES + MAX_JSON_ENTRY_BYTES * 8
const FIXED_ZIP_TIME = new Date('1980-01-01T00:00:00.000Z')

interface ArchivedRobotLink extends Omit<RobotLinkGeometryRecordV1, 'sourceBytes'> {
  archivePath: string
}

interface ArchivedObjectAsset extends Omit<ObjectAssetRecordV1, 'sourceBytes'> {
  archivePath: string
}

interface ArchivedRobotLinkV2 extends Omit<RobotLinkGeometryRecordV2, 'sourceBytes'> {
  archivePath: string
}

interface ArchivedObjectAssetV2 extends Omit<ObjectAssetRecordV2, 'sourceBytes'> {
  archivePath: string
}

function json(value: unknown): Uint8Array {
  return encoder.encode(JSON.stringify(value, null, 2))
}

function ownBytes(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer
}

function safeArchivePath(path: string): boolean {
  return (
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.startsWith('\\') &&
    !/^[a-z]:/i.test(path) &&
    !path.includes('\\') &&
    path.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  )
}

function findEndOfCentralDirectory(bytes: Uint8Array): number {
  const minimum = Math.max(0, bytes.length - 65_557)
  for (let offset = bytes.length - 22; offset >= minimum; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset
    }
  }
  throw new Error('Invalid .wdtwin archive: ZIP directory is missing.')
}

function inspectArchive(bytes: Uint8Array): void {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error('Invalid .wdtwin archive: compressed file is too large.')
  }
  const endOffset = findEndOfCentralDirectory(bytes)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)
  if (entryCount > MAX_ARCHIVE_ENTRIES) {
    throw new Error('Invalid .wdtwin archive: too many entries.')
  }
  if (centralOffset + centralSize > endOffset) {
    throw new Error('Invalid .wdtwin archive: ZIP directory is out of bounds.')
  }

  const paths = new Set<string>()
  let offset = centralOffset
  let totalSize = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('Invalid .wdtwin archive: malformed ZIP entry.')
    }
    const flags = view.getUint16(offset + 8, true)
    if ((flags & 0x0001) !== 0) {
      throw new Error('Invalid .wdtwin archive: encrypted entries are unsupported.')
    }
    const uncompressedSize = view.getUint32(offset + 24, true)
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    if (uncompressedSize === 0xffffffff) {
      throw new Error('Invalid .wdtwin archive: ZIP64 entries are unsupported.')
    }
    const nameStart = offset + 46
    const nameEnd = nameStart + nameLength
    if (nameEnd > bytes.byteLength) {
      throw new Error('Invalid .wdtwin archive: entry name is out of bounds.')
    }
    const path = decoder.decode(bytes.subarray(nameStart, nameEnd))
    if (!safeArchivePath(path)) {
      throw new Error(`Invalid .wdtwin archive path: ${path}.`)
    }
    if (paths.has(path)) {
      throw new Error(`Invalid .wdtwin archive: duplicate path ${path}.`)
    }
    paths.add(path)
    const entryLimit = path.endsWith('.step')
      ? path.startsWith('robot/')
        ? MAX_ROBOT_LINK_BYTES
        : MAX_OBJECT_ASSET_BYTES
      : MAX_JSON_ENTRY_BYTES
    if (uncompressedSize > entryLimit) {
      throw new Error(`Invalid .wdtwin archive: ${path} exceeds its size limit.`)
    }
    totalSize += uncompressedSize
    if (totalSize > MAX_UNCOMPRESSED_ARCHIVE_BYTES) {
      throw new Error('Invalid .wdtwin archive: expanded content is too large.')
    }
    offset = nameEnd + extraLength + commentLength
  }
  if (offset !== centralOffset + centralSize) {
    throw new Error('Invalid .wdtwin archive: ZIP directory length is inconsistent.')
  }
}

function required(entries: Record<string, Uint8Array>, path: string): Uint8Array {
  const value = entries[path]
  if (value === undefined) {
    throw new Error(`Invalid .wdtwin archive: missing ${path}.`)
  }
  return value
}

function parseJson<T>(entries: Record<string, Uint8Array>, path: string): T {
  try {
    return JSON.parse(decoder.decode(required(entries, path))) as T
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Invalid .wdtwin')) {
      throw error
    }
    throw new Error(`Invalid .wdtwin archive: ${path} is not valid JSON.`)
  }
}

export async function encodeWorkcellProject(
  snapshot: CurrentProjectSnapshot,
): Promise<Uint8Array> {
  const normalized = validateWorkcellProjectSnapshot(snapshot)
  const entries: Record<string, Uint8Array> = {}
  entries['manifest.json'] = json(normalized.manifest)
  entries['robot/configuration.json'] = json({
    name: normalized.robot.name,
    basePosition: normalized.robot.basePosition,
    baseRotationDeg: normalized.robot.baseRotationDeg,
    joints: normalized.robot.joints,
  })
  entries['frames.json'] = json(normalized.frames)

  const robotLinks: ArchivedRobotLinkV2[] = [...normalized.robot.links]
    .sort((left, right) => left.linkId.localeCompare(right.linkId))
    .map(({ sourceBytes, ...link }) => {
      const archivePath = `robot/links/${link.linkId}.step`
      entries[archivePath] = new Uint8Array(sourceBytes).slice()
      return { ...link, archivePath }
    })
  entries['robot/links/index.json'] = json(robotLinks)

  const objectAssets: ArchivedObjectAssetV2[] = [...normalized.objectAssets]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ sourceBytes, ...asset }, index) => {
      const archivePath = `objects/assets/${index.toString().padStart(4, '0')}.step`
      entries[archivePath] = new Uint8Array(sourceBytes).slice()
      return { ...asset, archivePath }
    })
  entries['objects/assets.json'] = json(objectAssets)
  entries['objects/instances.json'] = json(normalized.objectInstances)
  entries['poses/sequences.json'] = json(normalized.poses)
  entries['opcua/bindings.json'] = json(normalized.opcUa)
  entries['collision/policy.json'] = json(normalized.collisionPolicy)

  const orderedEntries = Object.fromEntries(
    Object.entries(entries).sort(([left], [right]) => left.localeCompare(right)),
  )
  return zipSync(orderedEntries, { level: 6, mtime: FIXED_ZIP_TIME })
}

export async function decodeWorkcellProject(
  source: Uint8Array | ArrayBuffer,
): Promise<CurrentProjectSnapshot> {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source)
  inspectArchive(bytes)
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new Error('Invalid .wdtwin archive: ZIP data cannot be expanded.')
  }

  const manifest = parseJson<
    WorkcellProjectSnapshotV1['manifest'] | WorkcellProjectSnapshotV2['manifest']
  >(
    entries,
    'manifest.json',
  )
  if (
    manifest.schemaVersion !== WORKCELL_PROJECT_SCHEMA_VERSION_V1 &&
    manifest.schemaVersion !== WORKCELL_PROJECT_SCHEMA_VERSION
  ) {
    throw new Error('Invalid .wdtwin archive: unsupported project schema version.')
  }

  if (manifest.schemaVersion === WORKCELL_PROJECT_SCHEMA_VERSION_V1) {
    const robotConfiguration = parseJson<
      Omit<WorkcellProjectSnapshotV1['robot'], 'links'>
    >(entries, 'robot/configuration.json')
    const archivedLinks = parseJson<ArchivedRobotLink[]>(
      entries,
      'robot/links/index.json',
    )
    const robotLinks: RobotLinkGeometryRecordV1[] = archivedLinks.map(
      ({ archivePath, ...link }) => {
        if (!safeArchivePath(archivePath) || !archivePath.startsWith('robot/links/')) {
          throw new Error(`Invalid .wdtwin archive path: ${archivePath}.`)
        }
        return { ...link, sourceBytes: ownBytes(required(entries, archivePath)) }
      },
    )
    const archivedAssets = parseJson<ArchivedObjectAsset[]>(
      entries,
      'objects/assets.json',
    )
    const objectAssets: ObjectAssetRecordV1[] = archivedAssets.map(
      ({ archivePath, ...asset }) => {
        if (!safeArchivePath(archivePath) || !archivePath.startsWith('objects/assets/')) {
          throw new Error(`Invalid .wdtwin archive path: ${archivePath}.`)
        }
        return { ...asset, sourceBytes: ownBytes(required(entries, archivePath)) }
      },
    )
    const snapshot = validateWorkcellProjectSnapshotV1({
      manifest,
      robot: { ...robotConfiguration, links: robotLinks },
      frames: parseJson(entries, 'frames.json'),
      objectAssets,
      objectInstances: parseJson(entries, 'objects/instances.json'),
      poses: parseJson(entries, 'poses/sequences.json'),
      opcUa: parseJson(entries, 'opcua/bindings.json'),
    })
    return migrateV1ToV2(snapshot)
  }

  const robotConfiguration = parseJson<
    Omit<WorkcellProjectSnapshotV2['robot'], 'links'>
  >(entries, 'robot/configuration.json')
  const archivedLinks = parseJson<ArchivedRobotLinkV2[]>(
    entries,
    'robot/links/index.json',
  )
  const robotLinks: RobotLinkGeometryRecordV2[] = archivedLinks.map(
    ({ archivePath, ...link }) => {
      if (!safeArchivePath(archivePath) || !archivePath.startsWith('robot/links/')) {
        throw new Error(`Invalid .wdtwin archive path: ${archivePath}.`)
      }
      return { ...link, sourceBytes: ownBytes(required(entries, archivePath)) }
    },
  )
  const archivedAssets = parseJson<ArchivedObjectAssetV2[]>(
    entries,
    'objects/assets.json',
  )
  const objectAssets: ObjectAssetRecordV2[] = archivedAssets.map(
    ({ archivePath, ...asset }) => {
      if (!safeArchivePath(archivePath) || !archivePath.startsWith('objects/assets/')) {
        throw new Error(`Invalid .wdtwin archive path: ${archivePath}.`)
      }
      return { ...asset, sourceBytes: ownBytes(required(entries, archivePath)) }
    },
  )
  return validateWorkcellProjectSnapshot({
    manifest,
    robot: { ...robotConfiguration, links: robotLinks },
    frames: parseJson(entries, 'frames.json'),
    objectAssets,
    objectInstances: parseJson(entries, 'objects/instances.json'),
    poses: parseJson(entries, 'poses/sequences.json'),
    opcUa: parseJson(entries, 'opcua/bindings.json'),
    collisionPolicy: parseJson(entries, 'collision/policy.json'),
  })
}
