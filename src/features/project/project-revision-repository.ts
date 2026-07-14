import type {
  ProjectHashService,
  ProjectRevisionIdentityHasher,
} from '../../lib/hash/sha256'
import {
  createProjectSourceStagingService,
  installProjectSourcePublicationRepositoryBindingInternalV1,
  preflightWorkcellProjectShapeV3,
  type PreparedProjectSourceGroupV1,
  type ProjectSourceOwnerKeyV1,
  type ProjectSourceStagingService,
  type ProjectSourceStagingServiceOptionsV1,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import {
  type ProjectDatabase,
  type ProjectSourceBlobKeyV1,
  type StoredProjectPointerV1,
  type StoredProjectRevisionV1,
  type StoredWorkcellProjectSnapshotProjectionV3,
} from './project-db'
import {
  createProjectRevisionIdentityBytesV1,
  createProjectRevisionIdentityProjectionV3,
  projectRevisionProjectionsEqualV1,
} from './project-revision-canonical'
import {
  garbageCollectProjectRevisionStorageV1,
  preflightProjectRevisionStorageQuotaV1,
  rethrowProjectRevisionStorageWriteErrorV1,
  type ProjectStorageEstimateV1,
} from './project-revision-storage'
import {
  collectStoredProjectRevisionBlobKeysInternalV1,
  consumeHydratedProjectRevisionForRepositoryInternalV1,
  hydrateStoredProjectRevisionV1,
  type HydratedProjectRevisionV1,
  type HydratedProjectRevisionRepositoryRecordInternalV1,
} from './project-revision-hydration'

const arrayBufferByteLengthGetter = Object.getOwnPropertyDescriptor(
  ArrayBuffer.prototype,
  'byteLength',
)?.get

declare const canonicalProjectRepositorySourceBindingBrand: unique symbol
declare const projectRevisionCandidateBrand: unique symbol
declare const verifiedProjectSourceBrand: unique symbol

/** Opaque identity created and retained only inside createProjectRevisionRepository(). */
export interface CanonicalProjectRepositorySourceBindingInternalV1 {
  readonly [canonicalProjectRepositorySourceBindingBrand]: true
}

export interface VerifiedProjectSourceHandleV1 {
  readonly [verifiedProjectSourceBrand]: true
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly blobKey: ProjectSourceBlobKeyV1
  readonly sha256: string
  readonly byteLength: number
}

export interface CanonicalProjectSourceAssignmentInternalV1 {
  readonly namespace: 'robot' | 'object'
  readonly sha256: string
  readonly byteLength: number
  readonly ownerKeys: readonly ProjectSourceOwnerKeyV1[]
  readonly sourceBytes: ArrayBuffer
}

export interface CanonicalProjectSourceOperationsInternalV1 {
  attest(groups: readonly PreparedProjectSourceGroupV1[]): object
  lease(prepared: object, attestation: object): void
  additionalUniqueBlobBytes(prepared: object): number
  assignments(prepared: object): readonly CanonicalProjectSourceAssignmentInternalV1[]
  commit(prepared: object): Promise<void>
  promote(prepared: object, proof: object): void
  rollback(prepared: object): void
}

export class ProjectRevisionRepositoryError extends Error {
  readonly code: string

  constructor(code: string, message: string, cause?: unknown) {
    super(`${code}: ${message}`, cause === undefined ? undefined : { cause })
    this.name = 'ProjectRevisionRepositoryError'
    this.code = code
  }
}

export interface ProjectRevisionCandidateInputV1 {
  readonly projection: StoredWorkcellProjectSnapshotProjectionV3
  readonly preparedSourceGroups?: readonly PreparedProjectSourceGroupV1[] | undefined
}

/** Opaque, repository-bound result of exact byte-free V3 candidate validation. */
export interface ProjectRevisionCandidateV1 {
  readonly [projectRevisionCandidateBrand]: true
}

export interface PreparedProjectRevisionRecordV1 {
  readonly storedRevision: StoredProjectRevisionV1
}

export interface ActiveProjectRevisionContextV1 {
  readonly revisionId: string
  readonly commitToken: string
  readonly projection: StoredWorkcellProjectSnapshotProjectionV3
  readonly snapshot: WorkcellProjectSnapshotV3
  readonly sourceHandles: readonly VerifiedProjectSourceHandleV1[]
}

export interface ProjectRevisionRepository {
  createCandidate(input: ProjectRevisionCandidateInputV1): ProjectRevisionCandidateV1
  prepareRevision(candidate: ProjectRevisionCandidateV1): Promise<PreparedProjectRevisionRecordV1>
  materializePreparedRuntime(
    prepared: PreparedProjectRevisionRecordV1,
  ): WorkcellProjectSnapshotV3
  discardPreparedRevision(prepared: PreparedProjectRevisionRecordV1): void
  commitPreparedRevision(
    expectedRevisionId: string | null,
    prepared: PreparedProjectRevisionRecordV1,
    commitToken: string,
  ): Promise<void>
  finalizePublication(commitToken: string): Promise<void>
  compensatePublication(commitToken: string): Promise<void>
  activatePreparedSources(
    prepared: PreparedProjectRevisionRecordV1,
    commitToken: string,
  ): Promise<void>
  readRevision(revisionId: string): Promise<HydratedProjectRevisionV1 | null>
  adoptHydratedRevision(
    hydrated: HydratedProjectRevisionV1,
  ): Promise<ActiveProjectRevisionContextV1>
  readPointer(): Promise<StoredProjectPointerV1 | null>
  garbageCollect(): Promise<void>
}

export interface ProjectRevisionRepositoryOptions {
  readonly database: ProjectDatabase
  readonly revisionIdentityHasher: ProjectRevisionIdentityHasher
  readonly sourceHashService?: Pick<ProjectHashService, 'sha256'> | undefined
  readonly storageEstimate?: (() => Promise<ProjectStorageEstimateV1>) | undefined
  readonly now?: (() => string) | undefined
}

export interface ProjectRevisionFoundationOptionsV1 extends ProjectRevisionRepositoryOptions {
  readonly sourceStagingOptions: ProjectSourceStagingServiceOptionsV1
}

export interface ProjectRevisionFoundationV1 {
  readonly sourceStaging: ProjectSourceStagingService
  readonly repository: ProjectRevisionRepository
}

interface PreparedRevisionStateV1 {
  readonly authority: object
  readonly storedRevision: StoredProjectRevisionV1
  readonly sourcePreparedKey?: object | undefined
  commitToken?: string | undefined
  status: 'prepared' | 'committed' | 'activated' | 'discarded' | 'failed'
}

interface ProjectRevisionCandidateStateV1 {
  readonly authority: object
  readonly projection: StoredWorkcellProjectSnapshotProjectionV3
  readonly expectedOwners: ReadonlyMap<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>
  readonly sourceGroups: readonly PreparedProjectSourceGroupV1[]
  readonly sourceAttestation?: object | undefined
  consumed: boolean
}

interface RepositoryHydratedRevisionStateV1 {
  readonly authority: object
  readonly revisionId: string
  readonly commitToken: string
  readonly storedRevision: StoredProjectRevisionV1
  consumed: boolean
}

interface CanonicalSourcePreparedStateV1 {
  revisionId: string | undefined
  commitToken?: string | undefined
  readonly expectedOwners: ReadonlyMap<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>
  readonly stagedBlobByteLengths: ReadonlyMap<ProjectSourceBlobKeyV1, number>
  status: 'preparing' | 'leased' | 'committed' | 'activated' | 'revoked'
  pendingPromotion?: {
    readonly nextRegistry: CanonicalResidentSourceRegistryV1
    readonly duplicateBuffers: readonly ArrayBuffer[]
    readonly proof: object
  } | undefined
}

interface CanonicalResidentSourceRegistryV1 {
  readonly buffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>
  readonly owners: ReadonlyMap<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>
  readonly handles: ReadonlyMap<ProjectSourceOwnerKeyV1, VerifiedProjectSourceHandleV1>
}

interface VerifiedProjectSourceStateV1 {
  readonly binding: CanonicalProjectRepositorySourceBindingInternalV1
  readonly ownerKey: ProjectSourceOwnerKeyV1
  readonly blobKey: ProjectSourceBlobKeyV1
  readonly sha256: string
  readonly byteLength: number
  readonly sourceBytes: ArrayBuffer
}

interface CanonicalStableProofStateV1 {
  readonly prepared: object
  readonly revisionId: string
  readonly commitToken: string
  used: boolean
}

interface CanonicalProjectRepositorySourceBindingStateV1 {
  readonly database: ProjectDatabase
  readonly prepared: WeakMap<object, CanonicalSourcePreparedStateV1>
  readonly stableProofs: WeakMap<object, CanonicalStableProofStateV1>
  operations: CanonicalProjectSourceOperationsInternalV1 | undefined
  activeRegistry: CanonicalResidentSourceRegistryV1
}

const canonicalSourceBindingStatesV1 = new WeakMap<
  object,
  CanonicalProjectRepositorySourceBindingStateV1
>()
const verifiedProjectSourceStatesV1 = new WeakMap<object, VerifiedProjectSourceStateV1>()

function exactArrayBufferByteLength(value: object): number | undefined {
  try {
    return arrayBufferByteLengthGetter?.call(value) as number | undefined
  } catch {
    return undefined
  }
}

function exactArrayBufferBytesEqual(left: ArrayBuffer, right: ArrayBuffer): boolean {
  if (left === right) return true
  const leftLength = exactArrayBufferByteLength(left)
  const rightLength = exactArrayBufferByteLength(right)
  if (leftLength === undefined || rightLength === undefined || leftLength !== rightLength) {
    return false
  }
  const leftBytes = new Uint8Array(left)
  const rightBytes = new Uint8Array(right)
  for (let index = 0; index < leftLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return false
  }
  return true
}

function mintVerifiedProjectSourceHandle(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  ownerKey: ProjectSourceOwnerKeyV1,
  blobKey: ProjectSourceBlobKeyV1,
  sourceBytes: ArrayBuffer,
): VerifiedProjectSourceHandleV1 {
  const separator = blobKey.indexOf(':')
  const sha256 = blobKey.slice(separator + 1)
  const byteLength = exactArrayBufferByteLength(sourceBytes)
  if (separator <= 0 || !/^[0-9a-f]{64}$/.test(sha256) || byteLength === undefined) {
    return fail('PROJECT_SOURCE_HANDLE_INVALID', 'Verified source handle input is malformed.')
  }
  const handle = Object.freeze({
    ownerKey,
    blobKey,
    sha256,
    byteLength,
  }) as VerifiedProjectSourceHandleV1
  verifiedProjectSourceStatesV1.set(handle, {
    binding,
    ownerKey,
    blobKey,
    sha256,
    byteLength,
    sourceBytes,
  })
  return handle
}

function expectedSourceOwners(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
): ReadonlyMap<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1> {
  const owners = new Map<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>()
  for (const source of projection.robot.sources) {
    owners.set(
      `robot-source:${source.id}`,
      `robot:${source.sha256}`,
    )
  }
  for (const asset of projection.objectAssets) {
    if (asset.sourceKind !== 'step') continue
    owners.set(
      `object-asset:${asset.id}`,
      `object:${asset.sourceSha256}`,
    )
  }
  return owners
}

function sourceBindingState(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
): CanonicalProjectRepositorySourceBindingStateV1 {
  const state = typeof binding === 'object' && binding !== null
    ? canonicalSourceBindingStatesV1.get(binding)
    : undefined
  if (state === undefined) {
    return fail(
      'PROJECT_SOURCE_REPOSITORY_BINDING_INVALID',
      'Project source repository binding is forged or unauthenticated.',
    )
  }
  return state
}

function sourcePreparedState(
  state: CanonicalProjectRepositorySourceBindingStateV1,
  prepared: object,
): CanonicalSourcePreparedStateV1 {
  const preparedState = typeof prepared === 'object' && prepared !== null
    ? state.prepared.get(prepared)
    : undefined
  if (preparedState === undefined) {
    return fail(
      'PROJECT_SOURCE_PREPARED_INVALID',
      'Prepared source publication identity is forged or foreign.',
    )
  }
  return preparedState
}

export function assertCanonicalProjectRepositorySourceBindingInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
): void {
  sourceBindingState(binding)
}

export function installCanonicalProjectSourceOperationsInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  operations: CanonicalProjectSourceOperationsInternalV1,
): void {
  const state = sourceBindingState(binding)
  if (state.operations !== undefined) {
    return fail(
      'PROJECT_SOURCE_REPOSITORY_BINDING_CONSUMED',
      'Project source repository binding already owns a staging service.',
    )
  }
  state.operations = Object.freeze(operations)
}

export function assertCanonicalProjectSourcePreparedInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
): void {
  sourcePreparedState(sourceBindingState(binding), prepared)
}

export async function commitCanonicalProjectSourcesInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
  assignments: readonly CanonicalProjectSourceAssignmentInternalV1[],
): Promise<void> {
  const state = sourceBindingState(binding)
  const preparedState = sourcePreparedState(state, prepared)
  if (preparedState.status !== 'leased') {
    return fail('PROJECT_SOURCE_PREPARED_CONSUMED', 'Prepared source publication is not leased.')
  }
  const keys = new Set<string>()
  const owners = new Set<ProjectSourceOwnerKeyV1>()
  for (const assignment of assignments) {
    const key = `${assignment.namespace}:${assignment.sha256}` as ProjectSourceBlobKeyV1
    const sourceByteLength = exactArrayBufferByteLength(assignment.sourceBytes)
    if (
      keys.has(key) ||
      !/^[0-9a-f]{64}$/.test(assignment.sha256) ||
      sourceByteLength === undefined ||
      sourceByteLength !== assignment.byteLength
    ) {
      return fail('PROJECT_SOURCE_ASSIGNMENT_INVALID', 'Canonical source assignment is malformed.')
    }
    keys.add(key)
    for (const ownerKey of assignment.ownerKeys) {
      if (owners.has(ownerKey) || preparedState.expectedOwners.get(ownerKey) !== key) {
        return fail(
          'PROJECT_SOURCE_ASSIGNMENT_INVALID',
          `Canonical source assignment does not match revision owner ${ownerKey}.`,
        )
      }
      owners.add(ownerKey)
    }
  }
  for (const [ownerKey, key] of preparedState.expectedOwners) {
    if (owners.has(ownerKey)) continue
    if (
      state.activeRegistry.owners.get(ownerKey) !== key ||
      state.activeRegistry.handles.get(ownerKey) === undefined ||
      state.activeRegistry.buffers.get(key) === undefined
    ) {
      return fail(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Revision owner ${ownerKey} is neither staged nor retained as verified.`,
      )
    }
  }
  const assignmentsByKey = new Map<ProjectSourceBlobKeyV1, CanonicalProjectSourceAssignmentInternalV1>()
  for (const assignment of assignments) {
    assignmentsByKey.set(
      `${assignment.namespace}:${assignment.sha256}` as ProjectSourceBlobKeyV1,
      assignment,
    )
  }
  for (const key of new Set(preparedState.expectedOwners.values())) {
    const existing = await state.database.projectSourceBlobs.get(key)
    const verifiedBuffer = state.activeRegistry.buffers.get(key)
    const assignment = assignmentsByKey.get(key)
    if (
      assignment !== undefined &&
      verifiedBuffer !== undefined &&
      !exactArrayBufferBytesEqual(assignment.sourceBytes, verifiedBuffer)
    ) {
      return fail(
        'PROJECT_SOURCE_DIGEST_COLLISION',
        `Staged source Blob ${key} does not match the resident verified bytes.`,
      )
    }
    if (
      existing !== undefined &&
      verifiedBuffer !== undefined &&
      existing.key === key &&
      `${existing.namespace}:${existing.sha256}` === key &&
      existing.byteLength === verifiedBuffer.byteLength &&
      exactArrayBufferBytesEqual(existing.sourceBytes, verifiedBuffer)
    ) {
      continue
    }
    const sourceBytes = assignment?.sourceBytes ?? verifiedBuffer
    const byteLength = exactArrayBufferByteLength(sourceBytes as object)
    const separator = key.indexOf(':')
    const namespace = key.slice(0, separator)
    const sha256 = key.slice(separator + 1)
    if (
      sourceBytes === undefined ||
      byteLength === undefined ||
      (namespace !== 'robot' && namespace !== 'object') ||
      !/^[0-9a-f]{64}$/.test(sha256)
    ) {
      return fail('PROJECT_SOURCE_ASSIGNMENT_INVALID', `Source Blob ${key} has no owned bytes.`)
    }
    await state.database.projectSourceBlobs.put({
      key,
      namespace,
      sha256,
      sourceBytes,
      byteLength,
    })
  }
}

export function assertCanonicalProjectStableProofInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
  proof: object,
): void {
  const state = sourceBindingState(binding)
  const preparedState = sourcePreparedState(state, prepared)
  const proofState = typeof proof === 'object' && proof !== null
    ? state.stableProofs.get(proof)
    : undefined
  if (
    proofState === undefined ||
    proofState.used ||
    proofState.prepared !== prepared ||
    preparedState.status !== 'committed' ||
    proofState.revisionId !== preparedState.revisionId ||
    proofState.commitToken !== preparedState.commitToken
  ) {
    return fail(
      'PROJECT_SOURCE_STABLE_PROOF_INVALID',
      'Stable Project source proof is forged, foreign, stale, or replayed.',
    )
  }
}

export function prepareCanonicalProjectSourcePromotionInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
  assignments: readonly CanonicalProjectSourceAssignmentInternalV1[],
  proof: object,
): void {
  const state = sourceBindingState(binding)
  const preparedState = sourcePreparedState(state, prepared)
  assertCanonicalProjectStableProofInternalV1(binding, prepared, proof)
  const assignedBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
  const assignedOwners = new Set<ProjectSourceOwnerKeyV1>()
  const duplicateBuffers: ArrayBuffer[] = []
  for (const assignment of assignments) {
    const key = `${assignment.namespace}:${assignment.sha256}` as ProjectSourceBlobKeyV1
    if (assignedBuffers.has(key)) {
      return fail(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        'Canonical source promotion contains a duplicate Blob key.',
      )
    }
    for (const ownerKey of assignment.ownerKeys) {
      if (preparedState.expectedOwners.get(ownerKey) !== key) {
        return fail(
          'PROJECT_SOURCE_ASSIGNMENT_INVALID',
          `Prepared source does not match the complete revision owner ${ownerKey}.`,
        )
      }
      assignedOwners.add(ownerKey)
    }
    assignedBuffers.set(key, assignment.sourceBytes)
  }
  const nextBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
  const nextOwners = new Map<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>()
  const nextHandles = new Map<ProjectSourceOwnerKeyV1, VerifiedProjectSourceHandleV1>()
  for (const [ownerKey, key] of preparedState.expectedOwners) {
    const existing = state.activeRegistry.buffers.get(key)
    const assigned = assignedBuffers.get(key)
    if (
      existing !== undefined &&
      assigned !== undefined &&
      !exactArrayBufferBytesEqual(existing, assigned)
    ) {
      return fail(
        'PROJECT_SOURCE_DIGEST_COLLISION',
        `Prepared source Blob ${key} does not match the resident verified bytes.`,
      )
    }
    const retained = state.activeRegistry.owners.get(ownerKey) === key
    const sourceBytes = retained ? existing : assignedOwners.has(ownerKey) ? assigned : undefined
    if (sourceBytes === undefined) {
      return fail(
        'PROJECT_SOURCE_PROMOTION_SOURCE_MISSING',
        `No resident or newly prepared source exists for ${ownerKey}.`,
      )
    }
    nextBuffers.set(key, sourceBytes)
    nextOwners.set(ownerKey, key)
    const retainedHandle = retained ? state.activeRegistry.handles.get(ownerKey) : undefined
    nextHandles.set(
      ownerKey,
      retainedHandle ?? mintVerifiedProjectSourceHandle(binding, ownerKey, key, sourceBytes),
    )
    if (existing !== undefined && assigned !== undefined && existing !== assigned) {
      duplicateBuffers.push(assigned)
    }
  }
  for (const key of assignedBuffers.keys()) {
    if (!nextBuffers.has(key)) {
      return fail(
        'PROJECT_SOURCE_ASSIGNMENT_INVALID',
        `Prepared source ${key} is not referenced by the complete revision.`,
      )
    }
  }
  preparedState.pendingPromotion = {
    nextRegistry: Object.freeze({ buffers: nextBuffers, owners: nextOwners, handles: nextHandles }),
    duplicateBuffers: Object.freeze(duplicateBuffers),
    proof,
  }
}

export function publishCanonicalProjectSourcePromotionInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
  proof: object,
): void {
  const state = sourceBindingState(binding)
  const preparedState = sourcePreparedState(state, prepared)
  const pending = preparedState.pendingPromotion
  const proofState = state.stableProofs.get(proof)
  if (
    pending === undefined ||
    pending.proof !== proof ||
    proofState === undefined ||
    proofState.used ||
    proofState.prepared !== prepared ||
    preparedState.status !== 'committed' ||
    proofState.revisionId !== preparedState.revisionId ||
    proofState.commitToken !== preparedState.commitToken
  ) {
    return fail('PROJECT_SOURCE_PROMOTION_INVALID', 'Project source promotion was not prepared.')
  }
  // The terminal publication is one local pointer assignment. Everything
  // after it is best-effort/no-throw and cannot roll back the registry.
  state.activeRegistry = pending.nextRegistry
  proofState.used = true
  preparedState.pendingPromotion = undefined
  preparedState.status = 'activated'
  for (const duplicate of pending.duplicateBuffers) {
    try {
      structuredClone(duplicate, { transfer: [duplicate] })
    } catch {
      // Duplicate staged ownership is already non-authoritative.
    }
  }
}

export function discardCanonicalProjectSourcePromotionInternalV1(
  binding: CanonicalProjectRepositorySourceBindingInternalV1,
  prepared: object,
): void {
  sourcePreparedState(sourceBindingState(binding), prepared).pendingPromotion = undefined
}

function fail(code: string, message: string, cause?: unknown): never {
  throw new ProjectRevisionRepositoryError(code, message, cause)
}

function deepFreezeData(value: unknown): void {
  if (typeof value !== 'object' || value === null || value instanceof ArrayBuffer) return
  for (const nested of Object.values(value)) deepFreezeData(nested)
  Object.freeze(value)
}

function cloneFrozen<T>(value: T): T {
  const clone = structuredClone(value)
  deepFreezeData(clone)
  return clone
}

function captureCandidateInput(
  input: ProjectRevisionCandidateInputV1,
): {
  readonly projection: StoredWorkcellProjectSnapshotProjectionV3
  readonly sourceGroups: readonly PreparedProjectSourceGroupV1[]
} {
  if (
    typeof input !== 'object' ||
    input === null ||
    Array.isArray(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  ) {
    return fail(
      'PROJECT_REVISION_CANDIDATE_INVALID',
      'Project revision candidate input must be a plain data record.',
    )
  }
  const descriptors = Object.getOwnPropertyDescriptors(input)
  const keys = Reflect.ownKeys(descriptors)
  if (
    !keys.includes('projection') ||
    keys.some((key) => key !== 'projection' && key !== 'preparedSourceGroups') ||
    !('value' in descriptors.projection!) ||
    (descriptors.preparedSourceGroups !== undefined &&
      !('value' in descriptors.preparedSourceGroups))
  ) {
    return fail(
      'PROJECT_REVISION_CANDIDATE_INVALID',
      'Project revision candidate input must contain only data projection and preparedSourceGroups fields.',
    )
  }
  const groups = descriptors.preparedSourceGroups === undefined
    ? []
    : descriptors.preparedSourceGroups.value
  if (!Array.isArray(groups) || Object.getPrototypeOf(groups) !== Array.prototype) {
    return fail(
      'PROJECT_REVISION_CANDIDATE_INVALID',
      'Project revision prepared source groups must be a plain Array.',
    )
  }
  return {
    projection: descriptors.projection.value as StoredWorkcellProjectSnapshotProjectionV3,
    sourceGroups: groups as readonly PreparedProjectSourceGroupV1[],
  }
}

function validateByteFreeProjectProjectionV3(
  value: StoredWorkcellProjectSnapshotProjectionV3,
): StoredWorkcellProjectSnapshotProjectionV3 {
  try {
    // First enforce the closed byte-free data graph without adopting the
    // canonical sort order as storage order: fixed Mechanics and OPC UA Joint
    // tuples are domain ordered and must remain reopenable.
    createProjectRevisionIdentityProjectionV3(value)
    const projection = structuredClone(value)
    const hydrated = structuredClone(projection) as unknown as Record<string, unknown>
    const robot = hydrated.robot
    if (typeof robot === 'object' && robot !== null && !Array.isArray(robot)) {
      const sources = (robot as Record<string, unknown>).sources
      if (Array.isArray(sources)) {
        for (const source of sources) {
          if (typeof source === 'object' && source !== null && !Array.isArray(source)) {
            ;(source as Record<string, unknown>).sourceBytes = Uint8Array.of(0).buffer
          }
        }
      }
    }
    if (Array.isArray(hydrated.objectAssets)) {
      for (const asset of hydrated.objectAssets) {
        if (
          typeof asset === 'object' &&
          asset !== null &&
          !Array.isArray(asset) &&
          (asset as Record<string, unknown>).sourceKind === 'step'
        ) {
          delete (asset as Record<string, unknown>).sourceSha256
          ;(asset as Record<string, unknown>).sourceBytes = Uint8Array.of(0).buffer
        }
      }
    }
    preflightWorkcellProjectShapeV3(hydrated)
    deepFreezeData(projection)
    return projection
  } catch (error) {
    return fail(
      'PROJECT_REVISION_CANDIDATE_INVALID',
      'Project revision candidate is not one complete byte-free V3 projection.',
      error,
    )
  }
}

function materializeRepositoryProjectionV3(
  projection: StoredWorkcellProjectSnapshotProjectionV3,
  buffers: ReadonlyMap<ProjectSourceBlobKeyV1, ArrayBuffer>,
): WorkcellProjectSnapshotV3 {
  const snapshot = structuredClone(projection) as unknown as Record<string, unknown>
  const robot = snapshot.robot as Record<string, unknown>
  for (const source of robot.sources as Record<string, unknown>[]) {
    const key = `robot:${String(source.sha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = buffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_REVISION_SOURCE_BLOB_MISSING', `Hydrated source Blob ${key} is missing.`)
    }
    source.sourceBytes = sourceBytes
  }
  for (const asset of snapshot.objectAssets as Record<string, unknown>[]) {
    if (asset.sourceKind !== 'step') continue
    const key = `object:${String(asset.sourceSha256)}` as ProjectSourceBlobKeyV1
    const sourceBytes = buffers.get(key)
    if (sourceBytes === undefined) {
      return fail('PROJECT_REVISION_SOURCE_BLOB_MISSING', `Hydrated source Blob ${key} is missing.`)
    }
    delete asset.sourceSha256
    asset.sourceBytes = sourceBytes
  }
  preflightWorkcellProjectShapeV3(snapshot)
  deepFreezeData(snapshot)
  return snapshot as unknown as WorkcellProjectSnapshotV3
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const keys = Reflect.ownKeys(value)
  return keys.length === expected.length &&
    keys.every((key) => typeof key === 'string' && expected.includes(key))
}

function validatePointer(value: unknown): StoredProjectPointerV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return fail('PROJECT_POINTER_INVALID', 'Stored Project pointer is malformed.')
  }
  const record = value as Record<string, unknown>
  if (record.key !== 'active' || (record.state !== 'stable' && record.state !== 'publishing')) {
    return fail('PROJECT_POINTER_INVALID', 'Stored Project pointer is malformed.')
  }
  if (typeof record.revisionId !== 'string' || typeof record.commitToken !== 'string') {
    return fail('PROJECT_POINTER_INVALID', 'Stored Project pointer identity is malformed.')
  }
  if (record.state === 'stable') {
    if (!exactKeys(record, ['key', 'state', 'revisionId', 'commitToken'])) {
      return fail('PROJECT_POINTER_INVALID', 'Stable Project pointer has unknown fields.')
    }
    return record as unknown as StoredProjectPointerV1
  }
  if (
    !exactKeys(record, [
      'key',
      'state',
      'revisionId',
      'previousRevisionId',
      'previousCommitToken',
      'commitToken',
    ]) ||
    (record.previousRevisionId !== null && typeof record.previousRevisionId !== 'string') ||
    (record.previousCommitToken !== null && typeof record.previousCommitToken !== 'string') ||
    ((record.previousRevisionId === null) !== (record.previousCommitToken === null))
  ) {
    return fail('PROJECT_POINTER_INVALID', 'Publishing Project pointer is malformed.')
  }
  return record as unknown as StoredProjectPointerV1
}

function validateCommitToken(commitToken: string): void {
  if (typeof commitToken !== 'string' || commitToken.length === 0) {
    return fail('PROJECT_COMMIT_TOKEN_INVALID', 'Project commit token must be non-empty.')
  }
}

function validateRevisionId(revisionId: string): void {
  if (typeof revisionId !== 'string' || !/^[0-9a-f]{64}$/.test(revisionId)) {
    return fail(
      'PROJECT_REVISION_ID_INVALID',
      'Revision identity hasher must return lowercase SHA-256 hex.',
    )
  }
}

function createProjectRevisionRepositoryInternal(
  options: ProjectRevisionRepositoryOptions,
  sourceStaging?: ProjectSourceStagingService,
): ProjectRevisionRepository {
  const database = options.database
  const revisionIdentityHasher = options.revisionIdentityHasher
  const sourceHashService = options.sourceHashService
  const storageEstimate = options.storageEstimate
  const authority = Object.freeze({})
  const candidateStates = new WeakMap<object, ProjectRevisionCandidateStateV1>()
  const hydratedRevisionStates = new WeakMap<object, RepositoryHydratedRevisionStateV1>()
  const preparedStates = new WeakMap<object, PreparedRevisionStateV1>()
  const committedPreparedByToken = new Map<string, PreparedRevisionStateV1>()
  const now = options.now ?? (() => new Date().toISOString())
  const sourceBinding = sourceStaging === undefined
    ? undefined
    : Object.freeze({}) as CanonicalProjectRepositorySourceBindingInternalV1
  const boundSourceState: CanonicalProjectRepositorySourceBindingStateV1 | undefined =
    sourceBinding === undefined
    ? undefined
    : {
        database,
        prepared: new WeakMap<object, CanonicalSourcePreparedStateV1>(),
        stableProofs: new WeakMap<object, CanonicalStableProofStateV1>(),
        operations: undefined,
        activeRegistry: Object.freeze({
          buffers: new Map<ProjectSourceBlobKeyV1, ArrayBuffer>(),
          owners: new Map<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>(),
          handles: new Map<ProjectSourceOwnerKeyV1, VerifiedProjectSourceHandleV1>(),
        }),
      }
  let sourceOperations: CanonicalProjectSourceOperationsInternalV1 | undefined
  if (sourceBinding !== undefined && boundSourceState !== undefined) {
    canonicalSourceBindingStatesV1.set(sourceBinding, boundSourceState)
    installProjectSourcePublicationRepositoryBindingInternalV1(
      sourceStaging!,
      sourceBinding,
    )
    sourceOperations = boundSourceState.operations
    if (sourceOperations === undefined) {
      return fail(
        'PROJECT_SOURCE_REPOSITORY_BINDING_INVALID',
        'Canonical staging service did not install repository source operations.',
      )
    }
  }

  const preparedState = (
    prepared: PreparedProjectRevisionRecordV1,
    requiredStatus: PreparedRevisionStateV1['status'] = 'prepared',
  ): PreparedRevisionStateV1 => {
    const state = typeof prepared === 'object' && prepared !== null
      ? preparedStates.get(prepared)
      : undefined
    if (state === undefined || state.authority !== authority) {
      return fail('PROJECT_PREPARED_REVISION_INVALID', 'Prepared revision is forged or belongs to another repository.')
    }
    if (state.status === 'discarded') {
      return fail(
        'PROJECT_PREPARED_REVISION_DISCARDED',
        'Prepared revision was discarded before publication.',
      )
    }
    if (state.status !== requiredStatus) {
      return fail('PROJECT_PREPARED_REVISION_CONSUMED', 'Prepared revision is no longer available for this operation.')
    }
    return state
  }

  const candidateState = (
    candidate: ProjectRevisionCandidateV1,
  ): ProjectRevisionCandidateStateV1 => {
    const state = typeof candidate === 'object' && candidate !== null
      ? candidateStates.get(candidate)
      : undefined
    if (state === undefined || state.authority !== authority) {
      return fail(
        'PROJECT_REVISION_CANDIDATE_INVALID',
        'Project revision candidate is forged or belongs to another repository.',
      )
    }
    if (state.consumed) {
      return fail(
        'PROJECT_REVISION_CANDIDATE_CONSUMED',
        'Project revision candidate was already prepared.',
      )
    }
    return state
  }

  const validateSourceCoverage = (candidate: ProjectRevisionCandidateStateV1): void => {
    if (boundSourceState === undefined) {
      if (candidate.expectedOwners.size !== 0 || candidate.sourceGroups.length !== 0) {
        return fail(
          'PROJECT_SOURCE_REPOSITORY_BINDING_REQUIRED',
          'Project sources require a repository-bound staging service.',
        )
      }
      return
    }
    const stagedOwners = new Set<ProjectSourceOwnerKeyV1>()
    for (const group of candidate.sourceGroups) {
      const key = `${group.preparedSource.namespace}:${group.preparedSource.sha256}` as ProjectSourceBlobKeyV1
      for (const ownerKey of group.ownerKeys) {
        if (candidate.expectedOwners.get(ownerKey) !== key || stagedOwners.has(ownerKey)) {
          return fail(
            'PROJECT_SOURCE_ASSIGNMENT_INVALID',
            `Prepared source does not exactly match revision owner ${ownerKey}.`,
          )
        }
        stagedOwners.add(ownerKey)
      }
    }
    for (const [ownerKey, key] of candidate.expectedOwners) {
      if (stagedOwners.has(ownerKey)) continue
      if (
        boundSourceState.activeRegistry.owners.get(ownerKey) !== key ||
        boundSourceState.activeRegistry.handles.get(ownerKey) === undefined ||
        boundSourceState.activeRegistry.buffers.get(key) === undefined
      ) {
        return fail(
          'PROJECT_SOURCE_ASSIGNMENT_INVALID',
          `Revision owner ${ownerKey} has neither a staged source nor an active verified handle.`,
        )
      }
    }
  }

  const adoptHydratedRecord = (
    record: HydratedProjectRevisionRepositoryRecordInternalV1,
    commitToken: string,
  ): ActiveProjectRevisionContextV1 => {
    if (boundSourceState === undefined || sourceBinding === undefined) {
      return fail(
        'PROJECT_SOURCE_REPOSITORY_BINDING_REQUIRED',
        'Hydrated Project adoption requires a repository-bound staging service.',
      )
    }
    const nextBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
    const nextOwners = new Map<ProjectSourceOwnerKeyV1, ProjectSourceBlobKeyV1>()
    const nextHandles = new Map<ProjectSourceOwnerKeyV1, VerifiedProjectSourceHandleV1>()
    for (const owner of record.owners) {
      const hydratedBuffer = record.canonicalBuffers.get(owner.blobKey)
      if (hydratedBuffer === undefined || hydratedBuffer.byteLength !== owner.byteLength) {
        return fail(
          'PROJECT_REVISION_SOURCE_BLOB_MISSING',
          `Hydrated source Blob ${owner.blobKey} is missing or changed.`,
        )
      }
      const existingBuffer = boundSourceState.activeRegistry.buffers.get(owner.blobKey)
      const canonicalBuffer = existingBuffer ?? hydratedBuffer
      nextBuffers.set(owner.blobKey, canonicalBuffer)
      nextOwners.set(owner.ownerKey, owner.blobKey)
      const retainedHandle = boundSourceState.activeRegistry.owners.get(owner.ownerKey) === owner.blobKey
        ? boundSourceState.activeRegistry.handles.get(owner.ownerKey)
        : undefined
      nextHandles.set(
        owner.ownerKey,
        retainedHandle ?? mintVerifiedProjectSourceHandle(
          sourceBinding,
          owner.ownerKey,
          owner.blobKey,
          canonicalBuffer,
        ),
      )
    }
    const nextRegistry = Object.freeze({
      buffers: nextBuffers,
      owners: nextOwners,
      handles: nextHandles,
    })
    const snapshot = materializeRepositoryProjectionV3(record.projection, nextBuffers)
    const context = Object.freeze({
      revisionId: record.revisionId,
      commitToken,
      projection: record.projection,
      snapshot,
      sourceHandles: Object.freeze([...nextHandles.values()].sort((left, right) =>
        left.ownerKey < right.ownerKey ? -1 : left.ownerKey > right.ownerKey ? 1 : 0)),
    })
    boundSourceState.activeRegistry = nextRegistry
    return context
  }

  const additionalBlobBytesForPrepared = async (
    preparedKey: object | undefined,
  ): Promise<number> => {
    if (preparedKey === undefined || boundSourceState === undefined) return 0
    const sourceState = sourcePreparedState(boundSourceState, preparedKey)
    let total = 0
    for (const key of new Set(sourceState.expectedOwners.values())) {
      const stored = await database.projectSourceBlobs.get(key)
      if (stored !== undefined && boundSourceState.activeRegistry.buffers.has(key)) continue
      const byteLength = sourceState.stagedBlobByteLengths.get(key) ??
        boundSourceState.activeRegistry.buffers.get(key)?.byteLength
      if (
        byteLength === undefined ||
        !Number.isSafeInteger(byteLength) ||
        byteLength <= 0 ||
        total > Number.MAX_SAFE_INTEGER - byteLength
      ) {
        return fail(
          'PROJECT_STORAGE_QUOTA_INPUT_INVALID',
          `Project source Blob ${key} has no exact quota length.`,
        )
      }
      total += byteLength
    }
    return total
  }

  const repository: ProjectRevisionRepository = {
    createCandidate(input) {
      const captured = captureCandidateInput(input)
      const projection = validateByteFreeProjectProjectionV3(captured.projection)
      const expectedOwners = expectedSourceOwners(projection)
      if (
        (expectedOwners.size > 0 || captured.sourceGroups.length > 0) &&
        (boundSourceState === undefined || sourceOperations === undefined)
      ) {
        return fail(
          'PROJECT_SOURCE_REPOSITORY_BINDING_REQUIRED',
          'Project sources require a repository-bound staging service.',
        )
      }
      const sourceAttestation = sourceOperations?.attest(captured.sourceGroups)
      const candidate = Object.freeze({}) as ProjectRevisionCandidateV1
      candidateStates.set(candidate, {
        authority,
        projection,
        expectedOwners,
        sourceGroups: captured.sourceGroups,
        sourceAttestation,
        consumed: false,
      })
      return candidate
    },

    async prepareRevision(candidate) {
      const candidateData = candidateState(candidate)
      candidateData.consumed = true
      const projection = candidateData.projection
      const expectedOwners = candidateData.expectedOwners
      const sourcePreparedKey = boundSourceState === undefined ||
        (expectedOwners.size === 0 && candidateData.sourceGroups.length === 0)
        ? undefined
        : Object.freeze({})
      if (
        sourcePreparedKey !== undefined &&
        boundSourceState !== undefined &&
        sourceOperations !== undefined
      ) {
        const stagedBlobByteLengths = new Map<ProjectSourceBlobKeyV1, number>()
        boundSourceState.prepared.set(sourcePreparedKey, {
          revisionId: undefined,
          expectedOwners,
          stagedBlobByteLengths,
          status: 'preparing',
        })
        sourceOperations.lease(sourcePreparedKey, candidateData.sourceAttestation!)
        boundSourceState.prepared.get(sourcePreparedKey)!.status = 'leased'
        try {
          validateSourceCoverage(candidateData)
          for (const group of candidateData.sourceGroups) {
            stagedBlobByteLengths.set(
              `${group.preparedSource.namespace}:${group.preparedSource.sha256}` as ProjectSourceBlobKeyV1,
              group.preparedSource.byteLength,
            )
          }
        } catch (error) {
          try {
            sourceOperations.rollback(sourcePreparedKey)
          } finally {
            boundSourceState.prepared.get(sourcePreparedKey)!.status = 'revoked'
          }
          throw error
        }
      }
      const projectId = projection.manifest.projectId
      try {
        const revisionId = await revisionIdentityHasher.hashRevisionIdentity(
          createProjectRevisionIdentityBytesV1(projectId, projection),
        )
        validateRevisionId(revisionId)
        const privateRevision = cloneFrozen({
          revisionId,
          projectId,
          createdAt: now(),
          snapshot: projection,
        } satisfies StoredProjectRevisionV1)
        const prepared = Object.freeze({
          storedRevision: cloneFrozen(privateRevision),
        })
        preparedStates.set(prepared, {
          authority,
          storedRevision: privateRevision,
          sourcePreparedKey,
          status: 'prepared',
        })
        if (sourcePreparedKey !== undefined) {
          boundSourceState!.prepared.get(sourcePreparedKey)!.revisionId = revisionId
        }
        return prepared
      } catch (error) {
        if (sourcePreparedKey !== undefined) {
          try {
            sourceOperations!.rollback(sourcePreparedKey)
          } finally {
            boundSourceState!.prepared.get(sourcePreparedKey)!.status = 'revoked'
          }
        }
        throw error
      }
    },

    materializePreparedRuntime(prepared) {
      const state = preparedState(prepared)
      const stagedBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
      if (state.sourcePreparedKey !== undefined) {
        for (const assignment of sourceOperations!.assignments(state.sourcePreparedKey)) {
          const key = `${assignment.namespace}:${assignment.sha256}` as ProjectSourceBlobKeyV1
          stagedBuffers.set(key, assignment.sourceBytes)
        }
      }
      const callerOwnedBuffers = new Map<ProjectSourceBlobKeyV1, ArrayBuffer>()
      for (const key of new Set(expectedSourceOwners(state.storedRevision.snapshot).values())) {
        const sourceBytes = stagedBuffers.get(key) ?? boundSourceState?.activeRegistry.buffers.get(key)
        if (sourceBytes === undefined) {
          return fail(
            'PROJECT_REVISION_SOURCE_BLOB_MISSING',
            `Prepared runtime source Blob ${key} is missing.`,
          )
        }
        callerOwnedBuffers.set(key, sourceBytes.slice(0))
      }
      return materializeRepositoryProjectionV3(
        state.storedRevision.snapshot,
        callerOwnedBuffers,
      )
    },

    discardPreparedRevision(prepared) {
      const state = typeof prepared === 'object' && prepared !== null
        ? preparedStates.get(prepared)
        : undefined
      if (state === undefined || state.authority !== authority) {
        return fail(
          'PROJECT_PREPARED_REVISION_INVALID',
          'Prepared revision is forged or belongs to another repository.',
        )
      }
      if (state.status === 'discarded') return
      if (state.status !== 'prepared') {
        return fail(
          'PROJECT_PREPARED_REVISION_CONSUMED',
          'Only an uncommitted prepared revision can be discarded.',
        )
      }
      if (state.sourcePreparedKey !== undefined) {
        sourceOperations!.rollback(state.sourcePreparedKey)
        boundSourceState!.prepared.get(state.sourcePreparedKey)!.status = 'revoked'
      }
      state.status = 'discarded'
    },

    async commitPreparedRevision(expectedRevisionId, prepared, commitToken) {
      validateCommitToken(commitToken)
      const state = preparedState(prepared)
      try {
        const additionalUniqueBlobBytes = await additionalBlobBytesForPrepared(
          state.sourcePreparedKey,
        )
        await preflightProjectRevisionStorageQuotaV1({
          additionalUniqueBlobBytes,
          estimate: storageEstimate,
        })
        await database.transaction(
          'rw',
          database.projectSourceBlobs,
          database.projectRevisions,
          database.projectPointers,
          database.projectCommitTokens,
          async () => {
            const rawPointer = await database.projectPointers.get('active')
            const pointer = rawPointer === undefined ? null : validatePointer(rawPointer)
            if (await database.projectCommitTokens.get(commitToken) !== undefined) {
              return fail(
                'PROJECT_COMMIT_TOKEN_REUSED',
                'Project commit token is durably reserved by an earlier publication.',
              )
            }
            if (
              pointer?.commitToken === commitToken ||
              (pointer?.state === 'publishing' && pointer.previousCommitToken === commitToken)
            ) {
              return fail(
                'PROJECT_COMMIT_TOKEN_REUSED',
                'Project commit token is already retained by the active pointer.',
              )
            }
            if (pointer?.state === 'publishing') {
              return fail('PROJECT_PUBLICATION_IN_PROGRESS', 'Another Project publication is in progress.')
            }
            const actualRevisionId = pointer?.revisionId ?? null
            if (actualRevisionId !== expectedRevisionId) {
              return fail('PROJECT_ACTIVE_REVISION_CHANGED', 'The active Project revision changed before commit.')
            }
            await database.projectCommitTokens.add({
              commitToken,
              revisionId: state.storedRevision.revisionId,
              createdAt: state.storedRevision.createdAt,
            })
            if (state.sourcePreparedKey !== undefined) {
              await sourceOperations!.commit(state.sourcePreparedKey)
            }
            const existing = await database.projectRevisions.get(state.storedRevision.revisionId)
            if (existing === undefined) {
              await database.projectRevisions.add(state.storedRevision)
            } else if (
              existing.projectId !== state.storedRevision.projectId ||
              !projectRevisionProjectionsEqualV1(
                existing.snapshot,
                state.storedRevision.snapshot,
              )
            ) {
              return fail('PROJECT_REVISION_ID_COLLISION', 'An immutable Project revision has conflicting content.')
            }
            await database.projectPointers.put({
              key: 'active',
              state: 'publishing',
              revisionId: state.storedRevision.revisionId,
              previousRevisionId: pointer?.revisionId ?? null,
              previousCommitToken: pointer?.commitToken ?? null,
              commitToken,
            })
          },
        )
        state.status = 'committed'
        state.commitToken = commitToken
        committedPreparedByToken.set(commitToken, state)
        if (state.sourcePreparedKey !== undefined) {
          const sourceState = boundSourceState!.prepared.get(state.sourcePreparedKey)!
          sourceState.status = 'committed'
          sourceState.commitToken = commitToken
        }
      } catch (error) {
        if (state.sourcePreparedKey !== undefined) {
          try {
            sourceOperations!.rollback(state.sourcePreparedKey)
          } catch {
            // The original commit failure stays authoritative.
          }
          boundSourceState!.prepared.get(state.sourcePreparedKey)!.status = 'revoked'
        }
        state.status = 'failed'
        rethrowProjectRevisionStorageWriteErrorV1(error)
      }
    },

    async finalizePublication(commitToken) {
      validateCommitToken(commitToken)
      await database.transaction('rw', database.projectPointers, async () => {
        const rawPointer = await database.projectPointers.get('active')
        if (rawPointer === undefined) {
          return fail('PROJECT_PUBLICATION_NOT_FOUND', 'No Project publication exists.')
        }
        const pointer = validatePointer(rawPointer)
        if (pointer.state === 'stable') {
          if (pointer.commitToken === commitToken) return
          return fail('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Stable Project publication has another token.')
        }
        if (pointer.commitToken !== commitToken) {
          return fail('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Publishing Project publication has another token.')
        }
        await database.projectPointers.put({
          key: 'active',
          state: 'stable',
          revisionId: pointer.revisionId,
          commitToken: pointer.commitToken,
        })
      })
    },

    async compensatePublication(commitToken) {
      validateCommitToken(commitToken)
      let compensated = false
      await database.transaction(
        'rw',
        database.projectRevisions,
        database.projectPointers,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) {
            return fail('PROJECT_PUBLICATION_NOT_FOUND', 'No Project publication exists.')
          }
          const pointer = validatePointer(rawPointer)
          if (pointer.state === 'stable') {
            if (pointer.commitToken === commitToken) {
              return fail('PROJECT_PUBLICATION_ALREADY_FINALIZED', 'A stable Project publication cannot be compensated.')
            }
            return fail('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Stable Project publication has another token.')
          }
          if (pointer.commitToken !== commitToken) {
            return fail('PROJECT_PUBLICATION_TOKEN_MISMATCH', 'Publishing Project publication has another token.')
          }
          if (pointer.previousRevisionId === null) {
            await database.projectPointers.delete('active')
            compensated = true
            return
          }
          const previousRevision = await database.projectRevisions.get(pointer.previousRevisionId)
          if (previousRevision === undefined || pointer.previousCommitToken === null) {
            return fail('PROJECT_PREVIOUS_REVISION_MISSING', 'The previous stable Project revision cannot be restored.')
          }
          await database.projectPointers.put({
            key: 'active',
            state: 'stable',
            revisionId: pointer.previousRevisionId,
            commitToken: pointer.previousCommitToken,
          })
          compensated = true
        },
      )
      if (compensated) {
        const committed = committedPreparedByToken.get(commitToken)
        if (committed?.sourcePreparedKey !== undefined) {
          sourceOperations!.rollback(committed.sourcePreparedKey)
          boundSourceState!.prepared.get(committed.sourcePreparedKey)!.status = 'revoked'
        }
        committedPreparedByToken.delete(commitToken)
      }
    },

    async activatePreparedSources(prepared, commitToken) {
      validateCommitToken(commitToken)
      const state = preparedState(prepared, 'committed')
      if (state.commitToken !== commitToken) {
        return fail(
          'PROJECT_PUBLICATION_TOKEN_MISMATCH',
          'Prepared revision was committed with another token.',
        )
      }
      if (state.sourcePreparedKey === undefined) {
        state.status = 'activated'
        return
      }
      await database.transaction(
        'rw',
        database.projectRevisions,
        database.projectPointers,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) {
            return fail('PROJECT_PUBLICATION_NOT_STABLE', 'Project publication is not stable.')
          }
          const pointer = validatePointer(rawPointer)
          if (
            pointer.state !== 'stable' ||
            pointer.revisionId !== state.storedRevision.revisionId ||
            pointer.commitToken !== commitToken
          ) {
            return fail(
              'PROJECT_PUBLICATION_NOT_STABLE',
              'Exact Project revision and token are not stable.',
            )
          }
          if (await database.projectRevisions.get(pointer.revisionId) === undefined) {
            return fail('PROJECT_REVISION_MISSING', 'Stable Project revision is missing.')
          }
          const proof = Object.freeze({})
          boundSourceState!.stableProofs.set(proof, {
            prepared: state.sourcePreparedKey!,
            revisionId: pointer.revisionId,
            commitToken: pointer.commitToken,
            used: false,
          })
          // The proof is minted and synchronously consumed while the pointer
          // transaction still owns its cross-tab lock.
          sourceOperations!.promote(state.sourcePreparedKey!, proof)
        },
      )
      state.status = 'activated'
      committedPreparedByToken.delete(commitToken)
    },

    async readRevision(revisionId) {
      validateRevisionId(revisionId)
      if (sourceHashService === undefined) {
        return fail(
          'PROJECT_SOURCE_HASH_SERVICE_REQUIRED',
          'Project revision hydration requires a source hash service.',
        )
      }
      const rawPointer = await database.projectPointers.get('active')
      if (rawPointer === undefined) return null
      const pointer = validatePointer(rawPointer)
      if (pointer.revisionId !== revisionId) {
        return fail(
          'PROJECT_REVISION_NOT_ACTIVE',
          'Only the exact stable or publishing Project revision can be integrity-hydrated.',
        )
      }
      const storedRevision = await database.projectRevisions.get(revisionId)
      if (storedRevision === undefined) {
        return fail('PROJECT_REVISION_MISSING', 'Stable Project revision is missing.')
      }
      const blobKeys = collectStoredProjectRevisionBlobKeysInternalV1(storedRevision)
      const sourceRows = (await database.projectSourceBlobs.bulkGet([...blobKeys])).filter(
        (row) => row !== undefined,
      )
      const hydrated = await hydrateStoredProjectRevisionV1(
        storedRevision,
        sourceRows,
        sourceHashService,
        revisionIdentityHasher,
      )
      hydratedRevisionStates.set(hydrated, {
        authority,
        revisionId,
        commitToken: pointer.commitToken,
        storedRevision: cloneFrozen(storedRevision),
        consumed: false,
      })
      return hydrated
    },

    async adoptHydratedRevision(hydrated) {
      const readState = typeof hydrated === 'object' && hydrated !== null
        ? hydratedRevisionStates.get(hydrated)
        : undefined
      if (readState === undefined || readState.authority !== authority) {
        return fail(
          'PROJECT_REVISION_HYDRATION_CAPABILITY_INVALID',
          'Hydrated Project revision was not read by this repository.',
        )
      }
      if (readState.consumed) {
        return fail(
          'PROJECT_REVISION_HYDRATION_CAPABILITY_CONSUMED',
          'Hydrated Project revision was already adopted.',
        )
      }
      if (sourceBinding === undefined || boundSourceState === undefined) {
        return fail(
          'PROJECT_SOURCE_REPOSITORY_BINDING_REQUIRED',
          'Hydrated Project adoption requires a repository-bound staging service.',
        )
      }
      let active!: ActiveProjectRevisionContextV1
      await database.transaction(
        'rw',
        database.projectRevisions,
        database.projectPointers,
        async () => {
          const rawPointer = await database.projectPointers.get('active')
          if (rawPointer === undefined) {
            return fail('PROJECT_REVISION_HYDRATION_STALE', 'Stable Project pointer disappeared.')
          }
          const pointer = validatePointer(rawPointer)
          if (
            pointer.state !== 'stable' ||
            pointer.revisionId !== readState.revisionId ||
            pointer.commitToken !== readState.commitToken
          ) {
            return fail(
              'PROJECT_REVISION_HYDRATION_STALE',
              'Stable Project pointer changed after hydration.',
            )
          }
          const storedRevision = await database.projectRevisions.get(readState.revisionId)
          if (
            storedRevision === undefined ||
            storedRevision.projectId !== readState.storedRevision.projectId ||
            storedRevision.createdAt !== readState.storedRevision.createdAt ||
            !projectRevisionProjectionsEqualV1(
              storedRevision.snapshot,
              readState.storedRevision.snapshot,
            )
          ) {
            return fail(
              'PROJECT_REVISION_HYDRATION_STALE',
              'Stable Project revision changed after hydration.',
            )
          }
          const record = consumeHydratedProjectRevisionForRepositoryInternalV1(
            sourceBinding,
            hydrated,
            readState.revisionId,
          )
          if (
            record.projectId !== storedRevision.projectId ||
            record.createdAt !== storedRevision.createdAt ||
            !projectRevisionProjectionsEqualV1(record.projection, storedRevision.snapshot)
          ) {
            return fail(
              'PROJECT_REVISION_HYDRATION_STALE',
              'Hydrated Project revision proof does not match stable storage.',
            )
          }
          active = adoptHydratedRecord(record, pointer.commitToken)
          readState.consumed = true
        },
      )
      return active
    },

    async readPointer() {
      const rawPointer = await database.projectPointers.get('active')
      return rawPointer === undefined ? null : cloneFrozen(validatePointer(rawPointer))
    },

    async garbageCollect() {
      await garbageCollectProjectRevisionStorageV1(database)
    },
  }
  return Object.freeze(repository)
}

/** Metadata-only repository. It deliberately cannot claim an external staging service. */
export function createProjectRevisionRepository(
  options: ProjectRevisionRepositoryOptions,
): ProjectRevisionRepository {
  return createProjectRevisionRepositoryInternal(options)
}

/**
 * Creates and binds the source staging service before either half is exposed,
 * eliminating a public first-bind window around raw Project sources.
 */
export function createProjectRevisionFoundation(
  options: ProjectRevisionFoundationOptionsV1,
): ProjectRevisionFoundationV1 {
  const sourceStaging = createProjectSourceStagingService(options.sourceStagingOptions)
  const repository = createProjectRevisionRepositoryInternal(
    {
      database: options.database,
      revisionIdentityHasher: options.revisionIdentityHasher,
      sourceHashService: options.sourceHashService ?? {
        sha256: options.sourceStagingOptions.sourceDigest.digestSource.bind(
          options.sourceStagingOptions.sourceDigest,
        ),
      },
      storageEstimate: options.storageEstimate,
      now: options.now,
    },
    sourceStaging,
  )
  return Object.freeze({ sourceStaging, repository })
}
