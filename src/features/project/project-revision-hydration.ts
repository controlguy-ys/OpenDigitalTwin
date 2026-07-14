import {
  preflightWorkcellProjectShapeV3,
  type ByteFreeWorkcellProjectProjectionV3,
  type ProjectSourceNamespaceV1,
  type ProjectSourceOwnerKeyV1,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import type {
  ProjectHashService,
  ProjectRevisionIdentityHasher,
} from '../../lib/hash/sha256'
import type {
  ProjectSourceBlobKeyV1,
  StoredProjectRevisionV1,
} from './project-db'
import { createProjectRevisionIdentityBytesV1 } from './project-revision-canonical'
import {
  assertCanonicalProjectRepositorySourceBindingInternalV1,
  type CanonicalProjectRepositorySourceBindingInternalV1,
} from './project-revision-repository'

const HEX_SHA256 = /^[0-9a-f]{64}$/
const ARRAY_BUFFER_BYTE_LENGTH_GETTER = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get
const ARRAY_BUFFER_SLICE = ArrayBuffer.prototype.slice

declare const hydratedProjectRevisionBrand: unique symbol

/**
 * Opaque proof that one stored revision and its complete Blob set passed
 * snapshot-local structural, length, namespace, and cryptographic checks.
 */
export interface HydratedProjectRevisionV1 {
  readonly [hydratedProjectRevisionBrand]: true
}

export interface HydratedProjectSourceOwnerInternalV1 {
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly blobKey: ProjectSourceBlobKeyV1
  readonly byteLength: number
}

/** Fixed-shape, authenticated handoff consumed only by the repository. */
export interface HydratedProjectRevisionRepositoryRecordInternalV1 {
  readonly revisionId: string
  readonly projectId: string
  readonly createdAt: string
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly owners: readonly HydratedProjectSourceOwnerInternalV1[]
  readonly canonicalBuffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>
}

export class ProjectRevisionHydrationError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectRevisionHydrationError'
    this.code = code
  }
}

interface CapturedSourceBlobV1 {
  readonly key: ProjectSourceBlobKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly sourceBytes: ArrayBuffer
  readonly byteLength: number
}

interface ProjectSourceOwnerBindingV1 {
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly namespace: ProjectSourceNamespaceV1
  readonly sha256: string
  readonly blobKey: ProjectSourceBlobKeyV1
}

interface HydratedProjectRevisionStateV1 {
  readonly revisionId: string
  readonly projectId: string
  readonly createdAt: string
  readonly projection: ByteFreeWorkcellProjectProjectionV3
  readonly owners: readonly ProjectSourceOwnerBindingV1[]
  readonly canonicalBuffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>
}

const hydratedProjectRevisionStatesV1 = new WeakMap<
  object,
  HydratedProjectRevisionStateV1
>()
const consumedHydratedProjectRevisionsV1 = new WeakSet<object>()

function fail(code: string, message: string, cause?: unknown): never {
  throw new ProjectRevisionHydrationError(code, message, cause)
}

function assertHydrationActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    return fail(
      'PROJECT_REVISION_HYDRATION_ABORTED',
      'Project revision hydration was aborted.',
    )
  }
}

function arrayBufferByteLength(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    return ARRAY_BUFFER_BYTE_LENGTH_GETTER?.call(value) as number | undefined
  } catch {
    return undefined
  }
}

function exactDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  code: string,
  label: string,
): Record<string, unknown> {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return fail(code, `${label} must be a plain data record.`)
  }
  const ownKeys = Reflect.ownKeys(value)
  if (
    ownKeys.length !== expectedKeys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    return fail(code, `${label} has missing or unknown fields.`)
  }
  const captured: Record<string, unknown> = {}
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return fail(code, `${label}.${key} must be an enumerable data property.`)
    }
    captured[key] = descriptor.value
  }
  return captured
}

function exactArrayElements(value: unknown, code: string, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    return fail(code, `${label} must be a plain dense Array.`)
  }
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
  if (
    lengthDescriptor === undefined ||
    !('value' in lengthDescriptor) ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    return fail(code, `${label}.length is invalid.`)
  }
  const length = lengthDescriptor.value as number
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== length + 1 || !ownKeys.includes('length')) {
    return fail(code, `${label} must not contain holes, symbols, or custom fields.`)
  }
  const result: unknown[] = []
  for (let index = 0; index < length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return fail(code, `${label}[${index}] must be an enumerable data property.`)
    }
    result.push(descriptor.value)
  }
  return result
}

function captureByteFreeData(
  value: unknown,
  label: string,
  visiting = new WeakSet<object>(),
  captured = new WeakMap<object, object>(),
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return value
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('PROJECT_STORED_REVISION_INVALID', `${label} contains a non-finite number.`)
    }
    return value
  }
  if (typeof value !== 'object') {
    return fail('PROJECT_STORED_REVISION_INVALID', `${label} contains a non-data value.`)
  }
  if (arrayBufferByteLength(value) !== undefined || ArrayBuffer.isView(value)) {
    return fail('PROJECT_STORED_REVISION_INVALID', `${label} must be byte-free.`)
  }
  if (visiting.has(value)) {
    return fail('PROJECT_STORED_REVISION_INVALID', `${label} contains a cycle.`)
  }
  const existing = captured.get(value)
  if (existing !== undefined) return existing

  visiting.add(value)
  if (Array.isArray(value)) {
    const entries = exactArrayElements(
      value,
      'PROJECT_STORED_REVISION_INVALID',
      label,
    )
    const result: unknown[] = []
    captured.set(value, result)
    entries.forEach((entry, index) => {
      result.push(captureByteFreeData(entry, `${label}[${index}]`, visiting, captured))
    })
    visiting.delete(value)
    return result
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    return fail('PROJECT_STORED_REVISION_INVALID', `${label} must contain only plain records.`)
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key !== 'string')) {
    return fail('PROJECT_STORED_REVISION_INVALID', `${label} contains a symbol field.`)
  }
  const result: Record<string, unknown> = {}
  captured.set(value, result)
  for (const key of ownKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !descriptor.enumerable) {
      return fail(
        'PROJECT_STORED_REVISION_INVALID',
        `${label}.${key} must be an enumerable data property.`,
      )
    }
    result[key] = captureByteFreeData(descriptor.value, `${label}.${key}`, visiting, captured)
  }
  visiting.delete(value)
  return result
}

function captureStoredRevision(value: unknown): StoredProjectRevisionV1 {
  const record = exactDataRecord(
    value,
    ['revisionId', 'projectId', 'createdAt', 'snapshot'],
    'PROJECT_STORED_REVISION_INVALID',
    'Stored Project revision',
  )
  if (typeof record.revisionId !== 'string' || !HEX_SHA256.test(record.revisionId)) {
    return fail('PROJECT_STORED_REVISION_INVALID', 'Stored Project revisionId is invalid.')
  }
  if (typeof record.projectId !== 'string' || record.projectId.length === 0) {
    return fail('PROJECT_STORED_REVISION_INVALID', 'Stored Project projectId is invalid.')
  }
  if (
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt))
  ) {
    return fail('PROJECT_STORED_REVISION_INVALID', 'Stored Project createdAt is invalid.')
  }
  const snapshot = captureByteFreeData(
    record.snapshot,
    'Stored Project revision.snapshot',
  ) as ByteFreeWorkcellProjectProjectionV3
  const snapshotRecord = snapshot as unknown as Record<string, unknown>
  const manifest = snapshotRecord.manifest
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    (manifest as Record<string, unknown>).projectId !== record.projectId
  ) {
    return fail(
      'PROJECT_STORED_REVISION_INVALID',
      'Stored Project projectId does not match its projection manifest.',
    )
  }
  return {
    revisionId: record.revisionId,
    projectId: record.projectId,
    createdAt: record.createdAt,
    snapshot,
  }
}

function captureSourceBlob(value: unknown, index: number): CapturedSourceBlobV1 {
  const label = `Stored Project source Blob[${index}]`
  const record = exactDataRecord(
    value,
    ['key', 'namespace', 'sha256', 'sourceBytes', 'byteLength'],
    'PROJECT_REVISION_SOURCE_BLOB_INVALID',
    label,
  )
  if (record.namespace !== 'robot' && record.namespace !== 'object') {
    return fail('PROJECT_REVISION_SOURCE_BLOB_INVALID', `${label}.namespace is invalid.`)
  }
  if (typeof record.sha256 !== 'string' || !HEX_SHA256.test(record.sha256)) {
    return fail('PROJECT_REVISION_SOURCE_BLOB_INVALID', `${label}.sha256 is invalid.`)
  }
  const expectedKey = `${record.namespace}:${record.sha256}` as ProjectSourceBlobKeyV1
  if (record.key !== expectedKey) {
    return fail(
      'PROJECT_REVISION_SOURCE_BLOB_INVALID',
      `${label}.key does not match its namespace and digest.`,
    )
  }
  if (
    !Number.isSafeInteger(record.byteLength) ||
    (record.byteLength as number) <= 0
  ) {
    return fail('PROJECT_REVISION_SOURCE_BLOB_INVALID', `${label}.byteLength is invalid.`)
  }
  const actualByteLength = arrayBufferByteLength(record.sourceBytes)
  if (actualByteLength === undefined || Reflect.ownKeys(record.sourceBytes as object).length !== 0) {
    return fail('PROJECT_REVISION_SOURCE_BLOB_INVALID', `${label}.sourceBytes is invalid.`)
  }
  if (actualByteLength !== record.byteLength) {
    return fail(
      'PROJECT_REVISION_SOURCE_LENGTH_MISMATCH',
      `${label}.byteLength does not match its ArrayBuffer.`,
    )
  }
  let sourceBytes: ArrayBuffer
  try {
    sourceBytes = ARRAY_BUFFER_SLICE.call(record.sourceBytes, 0) as ArrayBuffer
  } catch (error) {
    return fail('PROJECT_REVISION_SOURCE_BLOB_INVALID', `${label}.sourceBytes could not be captured.`, error)
  }
  return {
    key: expectedKey,
    namespace: record.namespace,
    sha256: record.sha256,
    sourceBytes,
    byteLength: record.byteLength as number,
  }
}

function collectExpectedOwners(
  projection: ByteFreeWorkcellProjectProjectionV3,
): readonly ProjectSourceOwnerBindingV1[] {
  const projectionRecord = projection as unknown as Record<string, unknown>
  const robot = projectionRecord.robot as Record<string, unknown> | undefined
  const robotSources = robot?.sources
  const objectAssets = projectionRecord.objectAssets
  if (!Array.isArray(robotSources) || !Array.isArray(objectAssets)) {
    return fail(
      'PROJECT_STORED_REVISION_INVALID',
      'Stored Project projection source collections are malformed.',
    )
  }
  const owners: ProjectSourceOwnerBindingV1[] = []
  const ownerKeys = new Set<ProjectSourceOwnerKeyV1>()
  const addOwner = (owner: ProjectSourceOwnerBindingV1): void => {
    if (ownerKeys.has(owner.ownerKey)) {
      return fail(
        'PROJECT_STORED_REVISION_INVALID',
        `Stored Project projection repeats source owner ${owner.ownerKey}.`,
      )
    }
    ownerKeys.add(owner.ownerKey)
    owners.push(Object.freeze(owner))
  }

  for (const sourceValue of robotSources) {
    const source = sourceValue as Record<string, unknown>
    if (
      typeof source?.id !== 'string' ||
      typeof source.sha256 !== 'string' ||
      source.id !== source.sha256 ||
      !HEX_SHA256.test(source.sha256)
    ) {
      return fail(
        'PROJECT_STORED_REVISION_INVALID',
        'Stored Robot source ID and digest are invalid.',
      )
    }
    addOwner({
      ownerKey: `robot-source:${source.id}`,
      namespace: 'robot',
      sha256: source.sha256,
      blobKey: `robot:${source.sha256}`,
    })
  }
  for (const assetValue of objectAssets) {
    const asset = assetValue as Record<string, unknown>
    if (asset?.sourceKind !== 'step') continue
    if (
      typeof asset.id !== 'string' ||
      typeof asset.sourceSha256 !== 'string' ||
      !HEX_SHA256.test(asset.sourceSha256)
    ) {
      return fail(
        'PROJECT_STORED_REVISION_INVALID',
        'Stored STEP Object Asset source identity is invalid.',
      )
    }
    addOwner({
      ownerKey: `object-asset:${asset.id}`,
      namespace: 'object',
      sha256: asset.sourceSha256,
      blobKey: `object:${asset.sourceSha256}`,
    })
  }
  return Object.freeze(owners)
}

function materializeProjection(
  projection: ByteFreeWorkcellProjectProjectionV3,
  buffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>,
): WorkcellProjectSnapshotV3 {
  const candidate = structuredClone(projection) as unknown as Record<string, unknown>
  const robot = candidate.robot as Record<string, unknown>
  const sources = robot.sources as Record<string, unknown>[]
  const assets = candidate.objectAssets as Record<string, unknown>[]
  for (const source of sources) {
    const key = `robot:${String(source.sha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = buffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_REVISION_SOURCE_BLOB_MISSING', `Missing source Blob ${key}.`)
    }
    source.sourceBytes = sourceBytes
  }
  for (const asset of assets) {
    if (asset.sourceKind !== 'step') continue
    const key = `object:${String(asset.sourceSha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = buffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_REVISION_SOURCE_BLOB_MISSING', `Missing source Blob ${key}.`)
    }
    delete asset.sourceSha256
    asset.sourceBytes = sourceBytes
  }
  return candidate as unknown as WorkcellProjectSnapshotV3
}

function deepFreezeMetadata(value: unknown, seen = new WeakSet<object>()): void {
  if (
    typeof value !== 'object' ||
    value === null ||
    arrayBufferByteLength(value) !== undefined ||
    seen.has(value)
  ) {
    return
  }
  seen.add(value)
  for (const nested of Object.values(value)) deepFreezeMetadata(nested, seen)
  Object.freeze(value)
}

function hydrationState(
  hydrated: HydratedProjectRevisionV1,
): HydratedProjectRevisionStateV1 {
  const isObject = typeof hydrated === 'object' && hydrated !== null
  const state = isObject ? hydratedProjectRevisionStatesV1.get(hydrated) : undefined
  if (state === undefined) {
    return fail(
      'PROJECT_REVISION_HYDRATION_CAPABILITY_INVALID',
      'Hydrated Project revision capability is forged or foreign.',
    )
  }
  return state
}

/**
 * One-shot fixed handoff to an authenticated canonical repository. Binding
 * authentication deliberately precedes every capability lookup or mutation.
 * No caller callback, visitor, or raw-buffer getter participates in adoption.
 */
export function consumeHydratedProjectRevisionForRepositoryInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  hydrated: HydratedProjectRevisionV1,
  expectedRevisionId: string,
): HydratedProjectRevisionRepositoryRecordInternalV1 {
  assertCanonicalProjectRepositorySourceBindingInternalV1(binding)
  const state = hydrationState(hydrated)
  if (consumedHydratedProjectRevisionsV1.has(hydrated)) {
    return fail(
      'PROJECT_REVISION_HYDRATION_CAPABILITY_CONSUMED',
      'Hydrated Project revision capability was already adopted.',
    )
  }
  if (!HEX_SHA256.test(expectedRevisionId) || state.revisionId !== expectedRevisionId) {
    return fail(
      'PROJECT_REVISION_HYDRATION_IDENTITY_MISMATCH',
      'Hydrated Project revision does not match the repository stable revision.',
    )
  }
  const owners = Object.freeze(state.owners.map((owner) => {
    const canonical = state.canonicalBuffers.get(owner.blobKey)
    if (canonical === undefined) {
      return fail(
        'PROJECT_REVISION_SOURCE_BLOB_MISSING',
        `Hydrated source Blob ${owner.blobKey} is missing.`,
      )
    }
    return Object.freeze({
      ...owner,
      byteLength: canonical.byteLength,
    })
  }))
  const record = Object.freeze({
    revisionId: state.revisionId,
    projectId: state.projectId,
    createdAt: state.createdAt,
    projection: state.projection,
    owners,
    canonicalBuffers: new Map(state.canonicalBuffers),
  })
  consumedHydratedProjectRevisionsV1.add(hydrated)
  return record
}

/** Closed, side-effect-free source-key extraction for repository DB reads. */
export function collectStoredProjectRevisionBlobKeysInternalV1(
  storedRevision: unknown,
): readonly ProjectSourceBlobKeyV1[] {
  const revision = captureStoredRevision(storedRevision)
  return Object.freeze([
    ...new Set(collectExpectedOwners(revision.snapshot).map(({ blobKey }) => blobKey)),
  ].sort())
}

export async function hydrateStoredProjectRevisionV1(
  storedRevision: unknown,
  sourceRows: readonly unknown[],
  hashService: Pick<ProjectHashService, 'sha256'>,
  revisionIdentityHasher: ProjectRevisionIdentityHasher,
  signal?: AbortSignal,
): Promise<HydratedProjectRevisionV1> {
  const revision = captureStoredRevision(storedRevision)
  const rows = exactArrayElements(
    sourceRows,
    'PROJECT_REVISION_SOURCE_BLOB_INVALID',
    'Stored Project source Blobs',
  )
  const blobs = new Map<ProjectSourceBlobKeyV1, CapturedSourceBlobV1>()
  rows.forEach((row, index) => {
    const blob = captureSourceBlob(row, index)
    if (blobs.has(blob.key)) {
      return fail(
        'PROJECT_REVISION_SOURCE_BLOB_INVALID',
        `Stored Project source Blob ${blob.key} is duplicated.`,
      )
    }
    blobs.set(blob.key, blob)
  })
  const owners = collectExpectedOwners(revision.snapshot)
  const requiredKeys = new Set(owners.map(({ blobKey }) => blobKey))

  for (const owner of owners) {
    if (blobs.has(owner.blobKey)) continue
    const crossNamespace = [...blobs.values()].some(
      ({ namespace, sha256 }) => namespace !== owner.namespace && sha256 === owner.sha256,
    )
    return fail(
      crossNamespace
        ? 'PROJECT_REVISION_SOURCE_NAMESPACE_MISMATCH'
        : 'PROJECT_REVISION_SOURCE_BLOB_MISSING',
      crossNamespace
        ? `Source digest ${owner.sha256} exists only in the wrong namespace.`
        : `Missing source Blob ${owner.blobKey}.`,
    )
  }
  if (blobs.size !== requiredKeys.size || [...blobs.keys()].some((key) => !requiredKeys.has(key))) {
    return fail(
      'PROJECT_REVISION_SOURCE_BLOB_INVALID',
      'Stored Project source Blob set contains an unreferenced row.',
    )
  }

  assertHydrationActive(signal)
  let hashRevisionIdentity: ProjectRevisionIdentityHasher['hashRevisionIdentity']
  try {
    hashRevisionIdentity = revisionIdentityHasher.hashRevisionIdentity.bind(
      revisionIdentityHasher,
    )
  } catch (error) {
    return fail(
      'PROJECT_REVISION_IDENTITY_FAILED',
      'Project revision identity verifier is invalid.',
      error,
    )
  }
  let actualRevisionId: string
  try {
    actualRevisionId = await hashRevisionIdentity(
      createProjectRevisionIdentityBytesV1(revision.projectId, revision.snapshot),
      signal,
    )
  } catch (error) {
    return fail(
      'PROJECT_REVISION_IDENTITY_FAILED',
      'Stored Project revision identity could not be verified.',
      error,
    )
  }
  assertHydrationActive(signal)
  if (actualRevisionId !== revision.revisionId) {
    return fail(
      'PROJECT_REVISION_IDENTITY_MISMATCH',
      'Stored Project revisionId does not match its canonical identity.',
    )
  }

  let sha256: ProjectHashService['sha256']
  try {
    sha256 = hashService.sha256.bind(hashService)
  } catch (error) {
    return fail(
      'PROJECT_REVISION_SOURCE_DIGEST_FAILED',
      'Project source digest verifier is invalid.',
      error,
    )
  }
  for (const key of requiredKeys) {
    assertHydrationActive(signal)
    const blob = blobs.get(key)!
    let actualDigest: string
    try {
      actualDigest = await sha256(blob.sourceBytes, signal)
    } catch (error) {
      return fail(
        'PROJECT_REVISION_SOURCE_DIGEST_FAILED',
        `Source Blob ${key} could not be verified.`,
        error,
      )
    }
    assertHydrationActive(signal)
    if (actualDigest !== blob.sha256) {
      return fail(
        'PROJECT_REVISION_SOURCE_DIGEST_MISMATCH',
        `Source Blob ${key} does not match its declared digest.`,
      )
    }
  }

  const canonicalBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
  for (const key of requiredKeys) canonicalBuffers.set(key, blobs.get(key)!.sourceBytes)
  const canonicalSnapshot = materializeProjection(revision.snapshot, canonicalBuffers)
  try {
    preflightWorkcellProjectShapeV3(canonicalSnapshot)
  } catch (error) {
    return fail(
      'PROJECT_STORED_REVISION_INVALID',
      'Stored Project projection could not be reconstituted.',
      error,
    )
  }
  assertHydrationActive(signal)
  deepFreezeMetadata(revision.snapshot)

  const facade = Object.freeze({}) as HydratedProjectRevisionV1
  hydratedProjectRevisionStatesV1.set(facade, Object.freeze({
    revisionId: revision.revisionId,
    projectId: revision.projectId,
    createdAt: revision.createdAt,
    projection: revision.snapshot,
    owners,
    canonicalBuffers,
  }))
  return facade
}

/**
 * Creates one caller-owned snapshot. Each unique namespace:digest key is
 * cloned once for this call and that clone is shared only by same-key owners.
 * This public clone must never seed the repository canonical resident registry
 * or verified handles; authenticated canonical adoption is a separate
 * repository-owned operation over the opaque hydration capability.
 */
export function materializeHydratedProjectSnapshotV1(
  hydrated: HydratedProjectRevisionV1,
): WorkcellProjectSnapshotV3 {
  const state = hydrationState(hydrated)
  const publicBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
  for (const [key, canonical] of state.canonicalBuffers) {
    publicBuffers.set(key, ARRAY_BUFFER_SLICE.call(canonical, 0) as ArrayBuffer)
  }
  const snapshot = materializeProjection(state.projection, publicBuffers)
  deepFreezeMetadata(snapshot)
  return snapshot
}
