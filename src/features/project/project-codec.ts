import {
  WORKCELL_PROJECT_SCHEMA_VERSION_V1,
  WORKCELL_PROJECT_SCHEMA_VERSION_V2,
  validateWorkcellProjectSnapshotV1,
  validateWorkcellProjectSnapshotV2,
  type WorkcellProjectSnapshotV1,
  type WorkcellProjectSnapshotV2,
} from '../../domain/project/project'
import { migrateV1ToV2 } from '../../domain/project/project-v1-migration'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import {
  decodeWorkcellProjectV3,
  encodeWorkcellProjectV3,
  type ProjectArchiveDecodeOptions,
  type ProjectArchiveEncodeOptions,
  type ProjectDecodeResultV3,
} from './project-v3-archive'
import {
  ProjectArchiveCodecWorker,
  ProjectArchiveError,
  type ProjectArchiveEncodeEntry,
  type ProjectArchiveReader,
  type ProjectArchiveWorkerLike,
} from './project-archive-worker'

export type {
  ArchivedObjectAssetRecordV3,
  ArchivedStepObjectAssetRecordV3,
  ProjectArchiveDecodeOptions,
  ProjectArchiveEncodeOptions,
  ProjectDecodeResultV3,
} from './project-v3-archive'
export { revokeProjectDecodeResult } from './project-v3-archive'

export function encodeWorkcellProject(
  snapshot: WorkcellProjectSnapshotV3,
  options: ProjectArchiveEncodeOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  return encodeWorkcellProjectV3(snapshot, options, signal)
}

export async function decodeWorkcellProject(
  source: Blob | Uint8Array | ArrayBuffer,
  options: ProjectArchiveDecodeOptions,
  signal?: AbortSignal,
): Promise<ProjectDecodeResultV3> {
  return decodeWorkcellProjectV3(source, options, signal)
}

export interface LegacyRuntimeProjectCodecOptions {
  readonly workerFactory?: (() => ProjectArchiveWorkerLike) | undefined
}

interface ArchivedLegacyRecord {
  readonly archivePath: string
  readonly [key: string]: unknown
}

const legacyEncoder = new TextEncoder()
const legacyDecoder = new TextDecoder('utf-8', { fatal: true })

function legacyJson(path: string, value: unknown): ProjectArchiveEncodeEntry {
  const bytes = legacyEncoder.encode(JSON.stringify(value))
  return { path, bytes: bytes.slice().buffer, compression: 'deflate' }
}

function legacyCodec(options: LegacyRuntimeProjectCodecOptions): ProjectArchiveCodecWorker {
  return options.workerFactory === undefined
    ? new ProjectArchiveCodecWorker()
    : new ProjectArchiveCodecWorker({ workerFactory: options.workerFactory })
}

function legacyPath(value: unknown, prefix: string): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith(prefix) ||
    !value.endsWith('.step') ||
    value.includes('\\') ||
    value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INVALID',
      'Temporary legacy runtime archive contains an invalid source path.',
    )
  }
  return value
}

function legacyRecordArray(value: unknown, path: string): ArchivedLegacyRecord[] {
  if (!Array.isArray(value)) {
    throw new ProjectArchiveError('PROJECT_ARCHIVE_INVALID', `${path} must be an Array.`)
  }
  return value.map((record, index) => {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INVALID',
        `${path}[${index}] must be an Object.`,
      )
    }
    return record as ArchivedLegacyRecord
  })
}

async function legacyReadJson(reader: ProjectArchiveReader, path: string): Promise<unknown> {
  try {
    return JSON.parse(legacyDecoder.decode(new Uint8Array(await reader.readEntry(path)))) as unknown
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INVALID',
      `${path} is not valid UTF-8 JSON.`,
      error,
    )
  }
}

function legacyExactEntries(reader: ProjectArchiveReader, paths: readonly string[]): void {
  const actual = new Set(reader.entries.map(({ path }) => path))
  const expected = new Set(paths)
  if (
    actual.size !== expected.size ||
    [...actual].some((path) => !expected.has(path)) ||
    [...expected].some((path) => !actual.has(path))
  ) {
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INVALID',
      'Temporary legacy runtime archive has a missing, unknown, or unreferenced entry.',
    )
  }
}

/**
 * Temporary browser-runtime lane. Task 4 removes this once the runtime can
 * consume prepared V3 source groups. It is deliberately not a V2 branch in
 * the public V3 encoder.
 */
export async function encodeLegacyRuntimeProjectV2(
  snapshot: WorkcellProjectSnapshotV2,
  options: LegacyRuntimeProjectCodecOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  const owned = validateWorkcellProjectSnapshotV2(snapshot)
  const entries: ProjectArchiveEncodeEntry[] = [
    legacyJson('manifest.json', owned.manifest),
    legacyJson('frames.json', owned.frames),
    legacyJson('robot/configuration.json', {
      name: owned.robot.name,
      basePosition: owned.robot.basePosition,
      baseRotationDeg: owned.robot.baseRotationDeg,
      joints: owned.robot.joints,
    }),
    legacyJson('robot/links/index.json', owned.robot.links.map(({ sourceBytes: _sourceBytes, ...link }) => ({
      ...link,
      archivePath: `robot/links/${link.linkId}.step`,
    }))),
    legacyJson('objects/assets.json', owned.objectAssets.map(({ sourceBytes: _sourceBytes, ...asset }, index) => ({
      ...asset,
      archivePath: `objects/assets/${index.toString().padStart(4, '0')}.step`,
    }))),
    legacyJson('objects/instances.json', owned.objectInstances),
    legacyJson('poses/sequences.json', owned.poses),
    legacyJson('opcua/bindings.json', owned.opcUa),
    legacyJson('collision/policy.json', owned.collisionPolicy),
    ...owned.robot.links.map(({ linkId, sourceBytes }) => ({
      path: `robot/links/${linkId}.step`,
      bytes: sourceBytes,
      compression: 'store' as const,
    })),
    ...owned.objectAssets.map(({ sourceBytes }, index) => ({
      path: `objects/assets/${index.toString().padStart(4, '0')}.step`,
      bytes: sourceBytes,
      compression: 'store' as const,
    })),
  ]
  entries.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  return legacyCodec(options).encode(entries, signal)
}

/** Temporary counterpart to encodeLegacyRuntimeProjectV2; see its comment. */
export async function decodeLegacyRuntimeProjectV2(
  source: Blob | Uint8Array | ArrayBuffer,
  options: LegacyRuntimeProjectCodecOptions = {},
  signal?: AbortSignal,
): Promise<WorkcellProjectSnapshotV2> {
  const ownedSource = source instanceof Blob
    ? source
    : source instanceof Uint8Array
      ? source.slice().buffer
      : source.slice(0)
  const reader = await legacyCodec(options).open(ownedSource, signal)
  try {
    const manifest = await legacyReadJson(reader, 'manifest.json') as
      WorkcellProjectSnapshotV1['manifest'] | WorkcellProjectSnapshotV2['manifest']
    const version = manifest.schemaVersion
    if (version !== WORKCELL_PROJECT_SCHEMA_VERSION_V1 && version !== WORKCELL_PROJECT_SCHEMA_VERSION_V2) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_SCHEMA_UNSUPPORTED',
        'Temporary legacy runtime accepts only Project schema V1 or V2.',
      )
    }
    const frames = await legacyReadJson(reader, 'frames.json')
    const robotConfiguration = await legacyReadJson(reader, 'robot/configuration.json') as Record<string, unknown>
    const archivedLinks = legacyRecordArray(
      await legacyReadJson(reader, 'robot/links/index.json'),
      'robot/links/index.json',
    )
    const archivedAssets = legacyRecordArray(
      await legacyReadJson(reader, 'objects/assets.json'),
      'objects/assets.json',
    )
    const objectInstances = await legacyReadJson(reader, 'objects/instances.json')
    const poses = await legacyReadJson(reader, 'poses/sequences.json')
    const opcUa = await legacyReadJson(reader, 'opcua/bindings.json')
    const collisionPolicy = version === WORKCELL_PROJECT_SCHEMA_VERSION_V2
      ? await legacyReadJson(reader, 'collision/policy.json')
      : undefined
    const sourcePaths = new Set<string>()
    for (const link of archivedLinks) sourcePaths.add(legacyPath(link.archivePath, 'robot/links/'))
    for (const asset of archivedAssets) sourcePaths.add(legacyPath(asset.archivePath, 'objects/assets/'))
    legacyExactEntries(reader, [
      'manifest.json',
      'frames.json',
      'robot/configuration.json',
      'robot/links/index.json',
      'objects/assets.json',
      'objects/instances.json',
      'poses/sequences.json',
      'opcua/bindings.json',
      ...(version === WORKCELL_PROJECT_SCHEMA_VERSION_V2 ? ['collision/policy.json'] : []),
      ...sourcePaths,
    ])
    const bytesByPath = new Map<string, ArrayBuffer>()
    for (const path of [...sourcePaths].sort()) bytesByPath.set(path, await reader.readEntry(path))
    reader.finish()
    const robotLinks = archivedLinks.map((link) => {
      const path = legacyPath(link.archivePath, 'robot/links/')
      const { archivePath: _archivePath, ...metadata } = link
      return { ...metadata, sourceBytes: bytesByPath.get(path)! }
    })
    const objectAssets = archivedAssets.map((asset) => {
      const path = legacyPath(asset.archivePath, 'objects/assets/')
      const { archivePath: _archivePath, ...metadata } = asset
      return { ...metadata, sourceBytes: bytesByPath.get(path)! }
    })
    const candidate = {
      manifest,
      robot: { ...robotConfiguration, links: robotLinks },
      frames,
      objectAssets,
      objectInstances,
      poses,
      opcUa,
      ...(version === WORKCELL_PROJECT_SCHEMA_VERSION_V2 ? { collisionPolicy } : {}),
    }
    if (version === WORKCELL_PROJECT_SCHEMA_VERSION_V1) {
      return migrateV1ToV2(validateWorkcellProjectSnapshotV1(candidate))
    }
    return validateWorkcellProjectSnapshotV2(candidate)
  } finally {
    reader.close()
  }
}
