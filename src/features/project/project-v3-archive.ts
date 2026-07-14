import {
  collectProjectSourceDescriptorsV3,
  validateWorkcellProjectSnapshotV3,
  verifyProjectCryptographicProvenanceV3,
  WORKCELL_PROJECT_SCHEMA_VERSION_V3,
  type BoxObjectAssetRecordV3,
  type ByteFreeWorkcellProjectProjectionV3,
  type CylinderObjectAssetRecordV3,
  type PreparedProjectSourceGroupV1,
  type ProjectArchiveSourcePlanV1,
  type ProjectSourceOwnerKeyV1,
  type ProjectSourceStagingService,
  type StepObjectAssetRecordV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  type ProjectRevisionIdentityHasher,
} from '../../lib/hash/sha256'
import {
  PROJECT_ARCHIVE_TIMEOUT_MS,
  ProjectArchiveCodecWorker,
  ProjectArchiveError,
  type ProjectArchiveReader,
  type ProjectArchiveEncodeEntry,
  type ProjectArchiveWorkerLike,
} from './project-archive-worker'

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })
const HEX_SHA256 = /^[0-9a-f]{64}$/
const V3_JSON_PATHS = Object.freeze([
  'manifest.json',
  'frames.json',
  'robot/configuration.json',
  'robot/sources/index.json',
  'robot/links/index.json',
  'objects/assets.json',
  'objects/instances.json',
  'equipment/built-ins.json',
  'external/entities.json',
  'simulation/jobs.json',
  'opcua/bindings.json',
  'collision/policy.json',
] as const)

const decodedResultServices = new WeakMap<ProjectDecodeResultV3, ProjectSourceStagingService>()
const authenticDecodedResults = new WeakSet<ProjectDecodeResultV3>()

export type ArchivedStepObjectAssetRecordV3 = Omit<
  StepObjectAssetRecordV3,
  'sourceBytes'
> & {
  readonly sourceSha256: string
}

export type ArchivedObjectAssetRecordV3 =
  | ArchivedStepObjectAssetRecordV3
  | BoxObjectAssetRecordV3
  | CylinderObjectAssetRecordV3

export interface ProjectDecodeResultV3 {
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly preparedSourceGroups: readonly PreparedProjectSourceGroupV1[]
  readonly warnings: readonly string[]
}

export interface ProjectArchiveEncodeOptions {
  readonly workerFactory?: (() => ProjectArchiveWorkerLike) | undefined
  readonly projectRevisionIdentityHasher?: ProjectRevisionIdentityHasher | undefined
}

export interface ProjectArchiveDecodeOptions {
  readonly workerFactory?: (() => ProjectArchiveWorkerLike) | undefined
  readonly sourceStaging: ProjectSourceStagingService
  readonly projectRevisionIdentityHasher: ProjectRevisionIdentityHasher
}

interface ArchiveOperationDeadline {
  readonly signal: AbortSignal
  readonly timedOut: () => boolean
  checkpoint(): void
  wait<Result>(promise: Promise<Result>): Promise<Result>
  close(): void
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function deadlineFailure(timedOut: boolean): ProjectArchiveError {
  return timedOut
    ? new ProjectArchiveError('PROJECT_ARCHIVE_TIMEOUT', 'Archive operation exceeded 120,000 ms.')
    : new ProjectArchiveError('PROJECT_ARCHIVE_CANCELLED', 'Archive operation was cancelled.')
}

function createArchiveOperationDeadline(external?: AbortSignal): ArchiveOperationDeadline {
  const controller = new AbortController()
  let expired = false
  let closed = false
  const abortFromCaller = () => controller.abort(external?.reason)
  if (external?.aborted === true) abortFromCaller()
  else external?.addEventListener('abort', abortFromCaller, { once: true })
  const timer = setTimeout(() => {
    expired = true
    controller.abort()
  }, PROJECT_ARCHIVE_TIMEOUT_MS)
  return {
    signal: controller.signal,
    timedOut: () => expired,
    checkpoint() {
      if (controller.signal.aborted) throw deadlineFailure(expired)
    },
    wait<Result>(promise: Promise<Result>): Promise<Result> {
      if (controller.signal.aborted) return Promise.reject(deadlineFailure(expired))
      return new Promise<Result>((resolve, reject) => {
        const onAbort = () => reject(deadlineFailure(expired))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        promise.then(
          (value) => {
            controller.signal.removeEventListener('abort', onAbort)
            resolve(value)
          },
          (error) => {
            controller.signal.removeEventListener('abort', onAbort)
            reject(expired ? deadlineFailure(true) : error)
          },
        )
      })
    },
    close() {
      if (closed) return
      closed = true
      clearTimeout(timer)
      external?.removeEventListener('abort', abortFromCaller)
    },
  }
}

function capturedRevisionHasher(
  value: ProjectRevisionIdentityHasher | undefined,
): ProjectRevisionIdentityHasher {
  const hasher = value ?? createProjectRevisionIdentityHasher(
    createProjectHashService({ subtle: crypto.subtle }),
  )
  return Object.freeze({
    hashRevisionIdentity: hasher.hashRevisionIdentity.bind(hasher),
  })
}

function canonicalJsonValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(canonicalJsonValue)
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INPUT_INVALID',
      'Archive JSON projection cannot contain binary data.',
    )
  }
  const record = value as Record<string, unknown>
  const canonical: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort(codeUnitCompare)) {
    canonical[key] = canonicalJsonValue(record[key])
  }
  return canonical
}

function jsonEntry(path: string, value: unknown): ProjectArchiveEncodeEntry {
  const bytes = encoder.encode(JSON.stringify(canonicalJsonValue(value)))
  return { path, bytes: bytes.slice().buffer, compression: 'deflate' }
}

function sameBytes(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left.byteLength !== right.byteLength) return false
  const leftView = new Uint8Array(left)
  const rightView = new Uint8Array(right)
  for (let index = 0; index < leftView.length; index += 1) {
    if (leftView[index] !== rightView[index]) return false
  }
  return true
}

function ownArchiveInput(source: Blob | Uint8Array | ArrayBuffer): Blob | ArrayBuffer {
  if (source instanceof Blob) return source
  if (source instanceof Uint8Array) return source.slice().buffer
  return source.slice(0)
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectArchiveError('PROJECT_ARCHIVE_INVALID', `${label} must be an Object.`)
  }
  return value as Record<string, unknown>
}

function arrayRecord(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value)) {
    throw new ProjectArchiveError('PROJECT_ARCHIVE_INVALID', `${label} must be an Array.`)
  }
  return value.map((item, index) => objectRecord(item, `${label}[${index}]`))
}

async function readJson(
  reader: ProjectArchiveReader,
  path: string,
  deadline: ArchiveOperationDeadline,
): Promise<unknown> {
  try {
    const bytes = await deadline.wait(reader.readEntry(path))
    return JSON.parse(decoder.decode(new Uint8Array(bytes))) as unknown
  } catch (error) {
    if (error instanceof ProjectArchiveError) throw error
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INVALID',
      `${path} is not valid UTF-8 JSON.`,
      error,
    )
  }
}

function assertExactEntrySet(
  reader: ProjectArchiveReader,
  expectedPaths: readonly string[],
): void {
  const actual = new Set(reader.entries.map(({ path }) => path))
  const expected = new Set(expectedPaths)
  if (
    actual.size !== expected.size ||
    [...actual].some((path) => !expected.has(path)) ||
    [...expected].some((path) => !actual.has(path))
  ) {
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_INVALID',
      'Archive contains a missing, unknown, or unreferenced entry.',
    )
  }
}

function revokeGroups(
  service: ProjectSourceStagingService,
  groups: readonly PreparedProjectSourceGroupV1[],
): void {
  for (const { preparedSource } of groups) {
    try {
      service.revoke(preparedSource)
    } catch {
      // Best effort keeps disposal safe after a token was already consumed.
    }
  }
}

function ownDecodeResult(
  projection: ByteFreeWorkcellProjectProjectionV3,
  preparedSourceGroups: readonly PreparedProjectSourceGroupV1[],
  warnings: readonly string[],
  service: ProjectSourceStagingService,
): ProjectDecodeResultV3 {
  const result = Object.freeze({
    projection,
    preparedSourceGroups,
    warnings: Object.freeze([...warnings]),
  })
  authenticDecodedResults.add(result)
  decodedResultServices.set(result, service)
  return result
}

export function revokeProjectDecodeResult(result: ProjectDecodeResultV3): boolean {
  if (!authenticDecodedResults.has(result)) {
    throw new ProjectArchiveError(
      'PROJECT_ARCHIVE_RESULT_INVALID',
      'Decoded Project result is forged or belongs to another operation.',
    )
  }
  const service = decodedResultServices.get(result)
  if (service === undefined) return false
  revokeGroups(service, result.preparedSourceGroups)
  decodedResultServices.delete(result)
  return true
}

export async function encodeWorkcellProjectV3(
  snapshot: WorkcellProjectSnapshotV3,
  options: ProjectArchiveEncodeOptions = {},
  signal?: AbortSignal,
): Promise<Blob> {
  const deadline = createArchiveOperationDeadline(signal)
  try {
    deadline.checkpoint()
    const workerFactory = options.workerFactory
    const revisionHasher = capturedRevisionHasher(options.projectRevisionIdentityHasher)
    const owned = validateWorkcellProjectSnapshotV3(snapshot)
    await deadline.wait(verifyProjectCryptographicProvenanceV3(
      owned,
      revisionHasher,
      deadline.signal,
    ))

    const codec = workerFactory === undefined
      ? new ProjectArchiveCodecWorker()
      : new ProjectArchiveCodecWorker({ workerFactory })
    const descriptors = collectProjectSourceDescriptorsV3(owned)
    const keyByBuffer = new Map<ArrayBuffer, string>()
    const digestInputs = descriptors.flatMap(({ sourceBytes }) => {
      if (keyByBuffer.has(sourceBytes)) return []
      const key = `source-${keyByBuffer.size.toString().padStart(4, '0')}`
      keyByBuffer.set(sourceBytes, key)
      return [{ key, bytes: sourceBytes }]
    })
    const digestByKey = await deadline.wait(codec.digestSources(
      digestInputs,
      deadline.signal,
    ))
    const digestByOwner = new Map<string, string>()
    for (const descriptor of descriptors) {
      const key = keyByBuffer.get(descriptor.sourceBytes)
      const digest = key === undefined ? undefined : digestByKey.get(key)
      if (digest === undefined || !HEX_SHA256.test(digest)) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_WORKER_FAILED',
          `Archive source ${descriptor.ownerKey} has no valid digest.`,
        )
      }
      if (descriptor.namespace === 'robot' && digest !== descriptor.declaredSha256) {
        throw new ProjectArchiveError(
          'PROJECT_SOURCE_DIGEST_MISMATCH',
          `Robot source ${descriptor.ownerKey} does not match its declared digest.`,
        )
      }
      digestByOwner.set(descriptor.ownerKey, digest)
    }

    const sourceEntries = new Map<string, ArrayBuffer>()
    const addSourceEntry = (path: string, bytes: ArrayBuffer): void => {
      const existing = sourceEntries.get(path)
      if (existing !== undefined && !sameBytes(existing, bytes)) {
        throw new ProjectArchiveError(
          'PROJECT_SOURCE_DIGEST_COLLISION',
          `Conflicting source bytes resolve to ${path}.`,
        )
      }
      sourceEntries.set(path, existing ?? bytes)
    }
    for (const descriptor of descriptors) {
      const digest = digestByOwner.get(descriptor.ownerKey)!
      const path = descriptor.namespace === 'robot'
        ? `robot/sources/${digest}.step`
        : `objects/assets/${digest}.step`
      addSourceEntry(path, descriptor.sourceBytes)
    }

    const robotSources = [...owned.robot.sources]
      .sort((left, right) => codeUnitCompare(left.id, right.id))
      .map(({ sourceBytes: _sourceBytes, ...source }) => source)
    const objectAssets: ArchivedObjectAssetRecordV3[] = [...owned.objectAssets]
      .sort((left, right) => codeUnitCompare(left.id, right.id))
      .map((asset) => {
        if (asset.sourceKind !== 'step') return asset
        const sourceSha256 = digestByOwner.get(`object-asset:${asset.id}`)
        if (sourceSha256 === undefined) {
          throw new ProjectArchiveError(
            'PROJECT_ARCHIVE_INPUT_INVALID',
            `Object Asset ${asset.id} has no source digest.`,
          )
        }
        const { sourceBytes: _sourceBytes, ...metadata } = asset
        return { ...metadata, sourceSha256 }
      })

    const fixedEntries: ProjectArchiveEncodeEntry[] = [
      jsonEntry('manifest.json', owned.manifest),
      jsonEntry('frames.json', owned.frames),
      jsonEntry('robot/configuration.json', {
        name: owned.robot.name,
        basePosition: owned.robot.basePosition,
        baseRotationDeg: owned.robot.baseRotationDeg,
        mechanics: owned.robot.mechanics,
        mechanicsProvenance: owned.robot.mechanicsProvenance,
      }),
      jsonEntry('robot/sources/index.json', robotSources),
      jsonEntry('robot/links/index.json', [...owned.robot.links]
        .sort((left, right) => codeUnitCompare(left.linkId, right.linkId))),
      jsonEntry('objects/assets.json', objectAssets),
      jsonEntry('objects/instances.json', [...owned.objectInstances]
        .sort((left, right) => codeUnitCompare(left.id, right.id))),
      jsonEntry('equipment/built-ins.json', [...owned.builtInEquipment]
        .sort((left, right) => codeUnitCompare(left.id, right.id))),
      jsonEntry('external/entities.json', [...owned.externalEntities]
        .sort((left, right) => codeUnitCompare(left.entityId, right.entityId))),
      jsonEntry('simulation/jobs.json', owned.simulation),
      jsonEntry('opcua/bindings.json', {
        endpointUrl: owned.opcUa.endpointUrl,
        samplingIntervalMs: owned.opcUa.samplingIntervalMs,
        joints: [...owned.opcUa.joints]
          .sort((left, right) => codeUnitCompare(left.id, right.id)),
        numericStatusBindings: [...owned.opcUa.numericStatusBindings]
          .sort((left, right) => codeUnitCompare(left.entityId, right.entityId)),
        equipmentTransforms: [...owned.opcUa.equipmentTransforms]
          .sort((left, right) => codeUnitCompare(left.entityId, right.entityId)),
      }),
      jsonEntry('collision/policy.json', owned.collisionPolicy),
    ]
    const entries = [
      ...fixedEntries,
      ...Array.from(sourceEntries, ([path, bytes]) => ({
        path,
        bytes,
        compression: 'store' as const,
      })),
    ].sort((left, right) => codeUnitCompare(left.path, right.path))
    return await deadline.wait(codec.encode(entries, deadline.signal))
  } finally {
    deadline.close()
  }
}

interface V3ArchiveSourcePlan {
  readonly namespace: 'robot' | 'object'
  readonly path: string
  readonly sha256: string
  readonly ownerKeys: ProjectSourceOwnerKeyV1[]
}

function planV3Sources(
  robotSources: readonly Record<string, unknown>[],
  objectAssets: readonly Record<string, unknown>[],
): readonly V3ArchiveSourcePlan[] {
  const plans = new Map<string, V3ArchiveSourcePlan>()
  const add = (
    namespace: 'robot' | 'object',
    sha256: unknown,
    ownerKey: ProjectSourceOwnerKeyV1,
  ): void => {
    if (typeof sha256 !== 'string' || !HEX_SHA256.test(sha256)) {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INVALID',
        `Archive source ${ownerKey} has an invalid digest.`,
      )
    }
    const key = `${namespace}:${sha256}`
    const existing = plans.get(key)
    if (existing === undefined) {
      plans.set(key, {
        namespace,
        path: namespace === 'robot'
          ? `robot/sources/${sha256}.step`
          : `objects/assets/${sha256}.step`,
        sha256,
        ownerKeys: [ownerKey],
      })
    } else {
      existing.ownerKeys.push(ownerKey)
    }
  }
  for (const source of robotSources) {
    if (source.id !== source.sha256 || typeof source.id !== 'string') {
      throw new ProjectArchiveError(
        'PROJECT_ARCHIVE_INVALID',
        'Archive Robot source ID must equal its SHA-256 digest.',
      )
    }
    add('robot', source.sha256, `robot-source:${source.id}`)
  }
  for (const asset of objectAssets) {
    if (asset.sourceKind !== 'step') continue
    if (typeof asset.id !== 'string') {
      throw new ProjectArchiveError('PROJECT_ARCHIVE_INVALID', 'Archive Object Asset ID is invalid.')
    }
    add('object', asset.sourceSha256, `object-asset:${asset.id}`)
  }
  return Object.freeze([...plans.values()]
    .map((plan) => ({ ...plan, ownerKeys: plan.ownerKeys.sort(codeUnitCompare) }))
    .sort((left, right) => codeUnitCompare(left.path, right.path)))
}

export async function decodeWorkcellProjectV3(
  source: Blob | Uint8Array | ArrayBuffer,
  options: ProjectArchiveDecodeOptions,
  signal?: AbortSignal,
): Promise<ProjectDecodeResultV3> {
  const deadline = createArchiveOperationDeadline(signal)
  let ownedSource!: Blob | ArrayBuffer
  let workerFactory: (() => ProjectArchiveWorkerLike) | undefined
  let sourceStaging!: ProjectSourceStagingService
  let revisionHasher!: ProjectRevisionIdentityHasher
  try {
    deadline.checkpoint()
    workerFactory = options.workerFactory
    sourceStaging = options.sourceStaging
    revisionHasher = capturedRevisionHasher(options.projectRevisionIdentityHasher)
    deadline.checkpoint()
    ownedSource = ownArchiveInput(source)
  } catch (error) {
    deadline.close()
    throw error
  }
  const codec = workerFactory === undefined
    ? new ProjectArchiveCodecWorker()
    : new ProjectArchiveCodecWorker({ workerFactory })
  let reader: ProjectArchiveReader | undefined
  let preparedGroups: readonly PreparedProjectSourceGroupV1[] | undefined
  let published = false
  try {
    reader = await deadline.wait(codec.open(ownedSource, deadline.signal))
    const manifest = objectRecord(
      await readJson(reader, 'manifest.json', deadline),
      'manifest.json',
    )
    if (manifest.schemaVersion !== WORKCELL_PROJECT_SCHEMA_VERSION_V3) {
      throw new ProjectArchiveError(
        'PROJECT_SCHEMA_UNSUPPORTED',
        'Only Project schema V3 archives are supported.',
      )
    }

    const json = new Map<string, unknown>([['manifest.json', manifest]])
    for (const path of V3_JSON_PATHS) {
      if (path === 'manifest.json') continue
      json.set(path, await readJson(reader, path, deadline))
    }
    const robotConfiguration = objectRecord(
      json.get('robot/configuration.json'),
      'robot/configuration.json',
    )
    const robotSources = arrayRecord(
      json.get('robot/sources/index.json'),
      'robot/sources/index.json',
    )
    const objectAssets = arrayRecord(
      json.get('objects/assets.json'),
      'objects/assets.json',
    )
    const projection = {
      manifest,
      frames: json.get('frames.json'),
      robot: {
        ...robotConfiguration,
        sources: robotSources,
        links: json.get('robot/links/index.json'),
      },
      simulation: json.get('simulation/jobs.json'),
      objectAssets,
      objectInstances: json.get('objects/instances.json'),
      builtInEquipment: json.get('equipment/built-ins.json'),
      externalEntities: json.get('external/entities.json'),
      opcUa: json.get('opcua/bindings.json'),
      collisionPolicy: json.get('collision/policy.json'),
    } as unknown as ByteFreeWorkcellProjectProjectionV3
    const sourcePlans = planV3Sources(robotSources, objectAssets)
    assertExactEntrySet(reader, [
      ...V3_JSON_PATHS,
      ...sourcePlans.map(({ path }) => path),
    ])

    const entriesByPath = new Map(reader.entries.map((entry) => [entry.path, entry]))
    const sourceInputs: ProjectArchiveSourcePlanV1[] = sourcePlans.map((plan) => {
      const entry = entriesByPath.get(plan.path)
      if (entry === undefined) {
        throw new ProjectArchiveError(
          'PROJECT_ARCHIVE_INVALID',
          `Archive source ${plan.path} has no validated central-directory entry.`,
        )
      }
      return {
        namespace: plan.namespace,
        entryPath: plan.path,
        sha256: plan.sha256,
        ownerKeys: plan.ownerKeys,
        byteLength: entry.uncompressedSize,
      }
    })
    const readSource = (plan: ProjectArchiveSourcePlanV1): Promise<ArrayBuffer> =>
      reader!.readEntry(plan.entryPath)
    const prepared = await deadline.wait(sourceStaging.prepareArchiveProject(
      projection,
      sourceInputs,
      readSource,
      deadline.signal,
    ))
    preparedGroups = prepared.preparedSourceGroups
    reader.finish()
    reader = undefined
    await deadline.wait(verifyProjectCryptographicProvenanceV3(
      prepared.projection,
      revisionHasher,
      deadline.signal,
    ))
    const result = ownDecodeResult(
      prepared.projection,
      prepared.preparedSourceGroups,
      [],
      sourceStaging,
    )
    published = true
    return result
  } finally {
    if (!published && preparedGroups !== undefined) revokeGroups(sourceStaging, preparedGroups)
    reader?.close()
    deadline.close()
  }
}
