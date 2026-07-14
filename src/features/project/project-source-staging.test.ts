import { describe, expect, it, vi } from 'vitest'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  canonicalMechanicsBytesV3,
  createProjectSourceMigrationFoundationInternalV1,
  validateWorkcellProjectSnapshotV3,
  verifyProjectCryptographicProvenanceV3,
  type ProjectRigidTransformV3,
  type StepObjectAssetRecordV3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import { createProjectSourceStagingTestServiceV1 } from '../../domain/project/project-source-staging.test-support'
import * as projectSourceStagingFacade from './project-source-staging'
import {
  createProjectHashService,
  createProjectRevisionIdentityHasher,
  createProjectSourceDigest,
  type ProjectSourceDigest,
} from '../../lib/hash/sha256'
import {
  createProjectSourceStagingService,
  stageProjectSourcesV3,
  type ProjectSourceLockedLeaseWorkerV1,
} from './project-source-staging'

const DIGEST_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
const LINK_IDS = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[]
const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [1, 1, 1],
} satisfies ProjectRigidTransformV3

type Mutable<T> = T extends ArrayBuffer
  ? ArrayBuffer
  : T extends readonly unknown[]
    ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
    : T extends object
      ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
      : T

async function validV3Project(): Promise<WorkcellProjectSnapshotV3> {
  const sourceBytes = new TextEncoder().encode('abc').buffer
  const project = {
    manifest: {
      format: 'WebDigitalTwinProject',
      schemaVersion: 3,
      projectId: 'project-1',
      name: 'Invocation Name',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    },
    robot: {
      name: 'Legacy Robot',
      basePosition: [0, 0, 0],
      baseRotationDeg: [0, 0, 0],
      sources: [{
        id: DIGEST_ABC,
        sha256: DIGEST_ABC,
        sourceFileName: 'robot.step',
        sourceBytes,
        detectedUnit: 'meter',
        selectedSourceUnit: 'meter',
        unitDecision: 'legacy-detected',
        sourceToMeters: 1,
        parserVersion: 'occt-import-js@0.0.23',
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      }],
      links: LINK_IDS.map((linkId, index) => ({
        linkId,
        sourceRefs: [{
          sourceAssetId: DIGEST_ABC,
          nodePath: [-1, index],
          nodeName: `legacy-whole-source:${linkId}`,
          meshIndices: [0],
        }],
        coordinateMode: 'link-local' as const,
        zeroPoseLocalization: structuredClone(IDENTITY),
        operatorAdjustment: structuredClone(IDENTITY),
        visible: true,
        collisionBoxes: [{
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      })),
      mechanics: {
        joints: CRB15000_DEFINITION.joints.map((joint, index) => ({
          id: joint.id,
          parentLink: LINK_IDS[index]!,
          childLink: LINK_IDS[index + 1]!,
          originM: [...joint.origin],
          axis: [...joint.axis],
          minDeg: joint.minDeg,
          maxDeg: joint.maxDeg,
          homeDeg: Math.min(joint.maxDeg, Math.max(joint.minDeg, 0)),
          zeroOffsetDeg: 0,
          direction: 1 as const,
          maxVelocityDegPerSec: 180,
        })) as unknown as WorkcellProjectSnapshotV3['robot']['mechanics']['joints'],
        flange: IDENTITY,
        tool0: IDENTITY,
      },
      mechanicsProvenance: { kind: 'manual', canonicalSha256: '0'.repeat(64) },
    },
    frames: { mcp: IDENTITY, tcp: IDENTITY },
    simulation: {
      activeJobId: 'job-default',
      jobs: [{ id: 'job-default', name: 'Default Job', revision: 1, poses: [] }],
    },
    objectAssets: [],
    objectInstances: [],
    builtInEquipment: [],
    externalEntities: [],
    opcUa: {
      endpointUrl: 'opc.tcp://127.0.0.1:4840',
      samplingIntervalMs: 100,
      joints: CRB15000_DEFINITION.joints.map(({ id }) => ({
        id,
        nodeId: `ns=2;s=${id}`,
        scale: 1,
        offset: 0,
      })),
      numericStatusBindings: [],
      equipmentTransforms: [],
    },
    collisionPolicy: {
      enabled: true,
      warningDistanceM: 0.02,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  } as WorkcellProjectSnapshotV3
  const hashService = createProjectHashService({ subtle: globalThis.crypto.subtle })
  ;(project.robot.mechanicsProvenance as { canonicalSha256: string }).canonicalSha256 =
    await createProjectRevisionIdentityHasher(hashService).hashRevisionIdentity(
      canonicalMechanicsBytesV3(project.robot.mechanics),
    )
  return project
}

function nativeRevisionIdentityHasher() {
  return createProjectRevisionIdentityHasher(createProjectHashService({
    subtle: globalThis.crypto.subtle,
  }))
}

function containsArrayBuffer(value: unknown, seen = new WeakSet<object>()): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value)) return false
  try {
    if (Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, 'byteLength')?.get?.call(value) !== undefined) {
      return true
    }
  } catch {
    // The value is not an ArrayBuffer in this realm.
  }
  seen.add(value)
  return Reflect.ownKeys(value).some((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor !== undefined && 'value' in descriptor &&
      containsArrayBuffer(descriptor.value, seen)
  })
}

function nativeDigest(): ProjectSourceDigest {
  return createProjectSourceDigest(createProjectHashService({
    subtle: globalThis.crypto.subtle,
  }))
}

describe('ProjectSourceStagingService', () => {
  it('locks construction adapters against later mutation', async () => {
    const digestSource = vi.fn(nativeDigest().digestSource)
    const copySource = vi.fn((bytes: ArrayBuffer) => bytes.slice(0))
    const sourceDigest = { digestSource }
    let tokenSequence = 0
    const tokenIdFactory = vi.fn(() => `locked-${++tokenSequence}`)
    const lockedLegacyAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async ({
      tokenId,
      generation,
      sourceBytes,
    }) => ({
      tokenId,
      generation,
      sourceBytes,
      analysis: { detectedUnit: 'meter', meshIndices: [0] },
    }))
    const options = {
      sourceDigest,
      copySource,
      tokenIdFactory,
      lockedLegacyAnalyzer,
    }
    const foundation = createProjectSourceMigrationFoundationInternalV1(options)
    const replacementDigest = vi.fn(async () => '0'.repeat(64))
    const replacementCopy = vi.fn((bytes: ArrayBuffer) => bytes.slice(0))
    const replacementTokenId = vi.fn(() => 'replaced')
    const replacementAnalyzer = vi.fn<ProjectSourceLockedLeaseWorkerV1>(async ({
      tokenId,
      generation,
      sourceBytes,
    }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: { detectedUnit: 'inch', meshIndices: [0] },
      }))
    sourceDigest.digestSource = replacementDigest
    options.copySource = replacementCopy
    options.tokenIdFactory = replacementTokenId
    options.lockedLegacyAnalyzer = replacementAnalyzer

    const owned = Uint8Array.from([9, 8, 7]).buffer
    const prepared = await foundation.sourceStaging.stage('robot', owned)
    await expect(foundation.sourceStaging.analyzeLegacyRobotSource(prepared)).resolves.toEqual({
      detectedUnit: 'meter',
      meshIndices: [0],
    })

    expect(digestSource).toHaveBeenCalledTimes(1)
    expect(replacementDigest).not.toHaveBeenCalled()
    expect(copySource).toHaveBeenCalledTimes(1)
    expect(replacementCopy).not.toHaveBeenCalled()
    expect(tokenIdFactory).toHaveBeenCalledTimes(1)
    expect(replacementTokenId).not.toHaveBeenCalled()
    expect(lockedLegacyAnalyzer).toHaveBeenCalledTimes(1)
    expect(replacementAnalyzer).not.toHaveBeenCalled()
    expect(prepared.tokenId).toBe('locked-1')
    expect(() => foundation.sourceStaging.assertPrepared(prepared)).not.toThrow()
    foundation.sourceStaging.revoke(prepared)
    expect(() => foundation.sourceStaging.assertPrepared(prepared)).toThrow(/revoked/i)
    expect('createProjectSourceMigrationFoundationInternalV1' in projectSourceStagingFacade).toBe(false)
    expect('assertCanonicalProjectSourceMigrationStagingServiceInternalV1' in projectSourceStagingFacade).toBe(false)
    expect('ownedSourceStaging' in projectSourceStagingFacade).toBe(false)
    expect('stageOwnedLegacyProjectSourcesV2' in projectSourceStagingFacade).toBe(false)
  })

  it('hashes a source once, leases and returns its bytes, and revokes it on discard', async () => {
    const digestSource = vi.fn(nativeDigest().digestSource)
    const copySource = vi.fn((bytes: ArrayBuffer) => bytes.slice(0))
    const staging = createProjectSourceStagingTestServiceV1({
      sourceDigest: { digestSource },
      copySource,
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: {
          detectedUnit: 'meter',
          meshIndices: [...new Uint8Array(sourceBytes)],
        },
      }),
    })
    const callerBytes = Uint8Array.from([1, 2, 3]).buffer
    const prepared = await staging.stage('robot', callerBytes)

    expect(Object.isFrozen(staging)).toBe(true)
    expect(digestSource).toHaveBeenCalledTimes(1)
    expect(copySource).toHaveBeenCalledTimes(1)
    expect(Object.keys(prepared).sort()).toEqual([
      'byteLength', 'namespace', 'sha256', 'tokenId',
    ])
    expect(prepared).not.toHaveProperty('sourceBytes')

    const leased = await staging.analyzeLegacyRobotSource(prepared)
    expect(leased.meshIndices).toEqual([1, 2, 3])
    expect(digestSource).toHaveBeenCalledTimes(1)
    expect(copySource).toHaveBeenCalledTimes(1)
    expect(() => staging.assertPrepared(prepared)).not.toThrow()

    staging.revoke(prepared)
    expect(() => staging.assertPrepared(prepared)).toThrow(/revoked/i)
  })

  it('forbids prepared use while leased and revokes a failed lease', async () => {
    let release!: () => void
    const staging = createProjectSourceStagingTestServiceV1({
      sourceDigest: nativeDigest(),
      lockedLegacyAnalyzer: async () => {
        await new Promise<void>((resolve) => { release = resolve })
        throw new Error('parse failed')
      },
    })
    const prepared = await staging.stage('robot', Uint8Array.from([4, 5, 6]).buffer)
    const lease = staging.analyzeLegacyRobotSource(prepared)
    expect(() => staging.assertPrepared(prepared)).toThrow(/leased/i)
    release()
    await expect(lease).rejects.toThrow(/parse failed/)
    expect(() => staging.assertPrepared(prepared)).toThrow(/revoked/i)
  })

  it('transfer-reclaims a locked parser return and detaches its external buffer alias', async () => {
    const digestSource = vi.fn(nativeDigest().digestSource)
    let returnedAlias: ArrayBuffer | undefined
    const staging = createProjectSourceStagingTestServiceV1({
      sourceDigest: { digestSource },
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => {
        returnedAlias = sourceBytes
        return {
          tokenId,
          generation,
          sourceBytes,
          analysis: { detectedUnit: 'meter', meshIndices: [0] },
        }
      },
    })
    const prepared = await staging.stage('robot', Uint8Array.from([1, 2, 3]).buffer)

    await expect(staging.analyzeLegacyRobotSource(prepared)).resolves.toEqual({
      detectedUnit: 'meter',
      meshIndices: [0],
    })
    expect(returnedAlias!.byteLength).toBe(0)
    expect(() => staging.assertPrepared(prepared)).not.toThrow()
    await expect(staging.analyzeLegacyRobotSource(prepared)).resolves.toBeDefined()
    expect(returnedAlias!.byteLength).toBe(0)
    expect(digestSource).toHaveBeenCalledTimes(1)
  })

  it('rejects binary aliases in the closed locked-parser result and revokes the token', async () => {
    const staging = createProjectSourceStagingTestServiceV1({
      sourceDigest: nativeDigest(),
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: {
          detectedUnit: 'meter',
          meshIndices: [0],
          alias: new Uint8Array(sourceBytes),
        } as never,
      }),
    })
    const prepared = await staging.stage('robot', Uint8Array.from([1, 2, 3]).buffer)

    await expect(staging.analyzeLegacyRobotSource(prepared)).rejects.toThrow(/unknown|analysis/i)
    expect(() => staging.assertPrepared(prepared)).toThrow(/revoked/i)
  })

  it('keeps the injected lease test authority disjoint from canonical Project finalization', async () => {
    const testService = createProjectSourceStagingTestServiceV1({
      sourceDigest: nativeDigest(),
      lockedLegacyAnalyzer: async ({ tokenId, generation, sourceBytes }) => ({
        tokenId,
        generation,
        sourceBytes,
        analysis: { detectedUnit: 'meter', meshIndices: [0] },
      }),
    })

    await expect(stageProjectSourcesV3(
      await validV3Project(),
      testService as unknown as ReturnType<typeof createProjectSourceStagingService>,
      nativeRevisionIdentityHasher(),
    )).rejects.toMatchObject({ code: 'PROJECT_SOURCE_STAGING_SERVICE_INVALID' })
  })

  it('rejects Robot bytes that do not match both declared digest fields', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    project.robot.sources[0]!.id = '0'.repeat(64)
    project.robot.sources[0]!.sha256 = '0'.repeat(64)
    for (const link of project.robot.links) {
      link.sourceRefs[0]!.sourceAssetId = '0'.repeat(64)
    }
    const owned = validateWorkcellProjectSnapshotV3(project)
    const staging = createProjectSourceStagingService({ sourceDigest: nativeDigest() })

    await expect(stageProjectSourcesV3(
      owned,
      staging,
      nativeRevisionIdentityHasher(),
    )).rejects.toMatchObject({
      code: 'PROJECT_SOURCE_DIGEST_MISMATCH',
    })
  })

  it('rejects false Manual Mechanics provenance before hashing owned sources', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    project.robot.mechanicsProvenance = {
      kind: 'manual',
      canonicalSha256: '0'.repeat(64),
    }
    const digestSource = vi.fn(nativeDigest().digestSource)
    const staging = createProjectSourceStagingService({
      sourceDigest: { digestSource },
    })

    await expect(stageProjectSourcesV3(
      project,
      staging,
      nativeRevisionIdentityHasher(),
    )).rejects.toMatchObject({ code: 'PROJECT_MANUAL_MECHANICS_DIGEST_MISMATCH' })
    expect(digestSource).not.toHaveBeenCalled()
  })

  it('verifies Manual provenance over normalized Mechanics before returning staged output', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    project.robot.mechanics.joints[0]!.axis = [2, 0, 0]
    project.robot.mechanics.flange.quaternion = [0, 0, 0, 2]
    const revisionIdentityHasher = nativeRevisionIdentityHasher()
    project.robot.mechanicsProvenance = {
      kind: 'manual',
      canonicalSha256: await revisionIdentityHasher.hashRevisionIdentity(
        canonicalMechanicsBytesV3(project.robot.mechanics),
      ),
    }

    const result = await stageProjectSourcesV3(
      project,
      createProjectSourceStagingService({ sourceDigest: nativeDigest() }),
      revisionIdentityHasher,
    )
    expect(result.projection.robot.mechanics.joints[0]!.axis).toEqual([1, 0, 0])
    expect(result.projection.robot.mechanics.flange.quaternion).toEqual([0, 0, 0, 1])
    await expect(verifyProjectCryptographicProvenanceV3(
      result.projection,
      revisionIdentityHasher,
    )).resolves.toBeUndefined()
  })

  it('owns the complete graph and every source before its first await and hashes sequentially', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    project.objectAssets = [
      {
        id: 'asset-a',
        name: 'Asset A',
        sourceKind: 'step',
        sourceFileName: 'a.step',
        sourceBytes: Uint8Array.from([10, 11]).buffer,
        importScale: 1,
        originMode: 'source',
        colliderCenter: [0, 0, 0],
        collisionHalfExtents: [0.1, 0.1, 0.1],
        collisionBoxes: [{
          id: 'default', center: [0, 0, 0], halfExtents: [0.1, 0.1, 0.1], quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      },
      {
        id: 'asset-b',
        name: 'Asset B',
        sourceKind: 'step',
        sourceFileName: 'b.step',
        sourceBytes: Uint8Array.from([20, 21]).buffer,
        importScale: 1,
        originMode: 'source',
        colliderCenter: [0, 0, 0],
        collisionHalfExtents: [0.1, 0.1, 0.1],
        collisionBoxes: [{
          id: 'default', center: [0, 0, 0], halfExtents: [0.1, 0.1, 0.1], quaternion: [0, 0, 0, 1],
        }],
        statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
      },
    ]
    const sourceB = project.objectAssets[1] as Mutable<StepObjectAssetRecordV3>
    const sourceBBefore = [...new Uint8Array(sourceB.sourceBytes)]
    let firstStarted!: () => void
    const firstSourceStarted = new Promise<void>((resolve) => { firstStarted = resolve })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    let active = 0
    let maximumActive = 0
    let calls = 0
    const native = nativeDigest()
    const sourceDigest: ProjectSourceDigest = {
      async digestSource(bytes, signal) {
        calls += 1
        active += 1
        maximumActive = Math.max(maximumActive, active)
        if (calls === 1) {
          firstStarted()
          await gate
        }
        try {
          return await native.digestSource(bytes, signal)
        } finally {
          active -= 1
        }
      },
    }
    const staging = createProjectSourceStagingService({ sourceDigest })
    const pending = stageProjectSourcesV3(project, staging, nativeRevisionIdentityHasher())

    await firstSourceStarted
    project.manifest.name = 'Mutated Name'
    new Uint8Array(sourceB.sourceBytes).fill(255)
    release()
    const result = await pending

    expect(result.projection.manifest.name).toBe('Invocation Name')
    expect(maximumActive).toBe(1)
    const group = result.preparedSourceGroups.find(({ ownerKeys }) =>
      ownerKeys.includes('object-asset:asset-b'))
    expect(group).toBeDefined()
    const expectedDigest = await native.digestSource(
      Uint8Array.from(sourceBBefore),
    )
    expect(group!.preparedSource.sha256).toBe(expectedDigest)
  })

  it('deduplicates byte-identical Object sources behind one opaque group', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    const shared = Uint8Array.from([7, 8, 9]).buffer
    const asset = {
      id: 'asset-a',
      name: 'Asset A',
      sourceKind: 'step' as const,
      sourceFileName: 'asset.step',
      sourceBytes: shared,
      importScale: 1,
      originMode: 'source' as const,
      colliderCenter: [0, 0, 0] as [number, number, number],
      collisionHalfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      collisionBoxes: [{
        id: 'default',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    }
    project.objectAssets = [asset, { ...asset, id: 'asset-b', name: 'Asset B' }]
    const native = nativeDigest()
    const digestSource = vi.fn(native.digestSource.bind(native))
    const sourceDigest: ProjectSourceDigest = { digestSource }
    const staging = createProjectSourceStagingService({ sourceDigest })
    const result = await stageProjectSourcesV3(project, staging, nativeRevisionIdentityHasher())
    const objectGroups = result.preparedSourceGroups.filter(({ preparedSource }) =>
      preparedSource.namespace === 'object')

    expect(objectGroups).toHaveLength(1)
    expect(objectGroups[0]!.ownerKeys).toEqual([
      'object-asset:asset-a',
      'object-asset:asset-b',
    ])
    expect(result.projection.objectAssets).toEqual([
      expect.objectContaining({ id: 'asset-a', sourceSha256: objectGroups[0]!.preparedSource.sha256 }),
      expect.objectContaining({ id: 'asset-b', sourceSha256: objectGroups[0]!.preparedSource.sha256 }),
    ])
    expect(digestSource).toHaveBeenCalledTimes(2)
  })

  it('splits one caller-owned Robot/Object alias synchronously into namespace-local groups', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    const shared = project.robot.sources[0]!.sourceBytes
    const asset = {
      id: 'asset-a',
      name: 'Asset A',
      sourceKind: 'step' as const,
      sourceFileName: 'asset.step',
      sourceBytes: shared,
      importScale: 1,
      originMode: 'source' as const,
      colliderCenter: [0, 0, 0] as [number, number, number],
      collisionHalfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      collisionBoxes: [{
        id: 'default',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    }
    project.objectAssets = [asset, { ...asset, id: 'asset-b', name: 'Asset B' }]
    const before = structuredClone(project)
    const sharedBefore = [...new Uint8Array(shared)]
    const native = nativeDigest()
    let firstDigestStarted!: () => void
    const firstDigest = new Promise<void>((resolve) => { firstDigestStarted = resolve })
    let releaseFirstDigest!: () => void
    const firstDigestGate = new Promise<void>((resolve) => { releaseFirstDigest = resolve })
    let digestCalls = 0
    const digestSource = vi.fn(async (bytes: ArrayBuffer | ArrayBufferView, signal?: AbortSignal) => {
      digestCalls += 1
      if (digestCalls === 1) {
        firstDigestStarted()
        await firstDigestGate
      }
      return native.digestSource(bytes, signal)
    })
    const staging = createProjectSourceStagingService({ sourceDigest: { digestSource } })
    const originalStructuredClone = globalThis.structuredClone
    let sourceBearingCopyCalls = 0
    let sourceTransferCalls = 0
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(
      ((value: unknown, options?: StructuredSerializeOptions) => {
        if (containsArrayBuffer(value)) {
          if ((options?.transfer?.length ?? 0) > 0) sourceTransferCalls += 1
          else sourceBearingCopyCalls += 1
        }
        return originalStructuredClone(value, options)
      }) as typeof structuredClone,
    )

    try {
      const pending = stageProjectSourcesV3(
        project,
        staging,
        nativeRevisionIdentityHasher(),
      )
      const sourceCopiesBeforeFirstAwait = sourceBearingCopyCalls
      const sourceTransfersBeforeFirstAwait = sourceTransferCalls
      await Promise.race([
        firstDigest,
        pending.then(() => { throw new Error('Staging completed before source hashing began.') }),
      ])
      const sharedByteLengthDuringFirstDigest = shared.byteLength
      const sharedBytesDuringFirstDigest = [...new Uint8Array(shared)]
      const aliasesDuringFirstDigest = [
        project.robot.sources[0]!.sourceBytes,
        (project.objectAssets[0] as Mutable<StepObjectAssetRecordV3>).sourceBytes,
        (project.objectAssets[1] as Mutable<StepObjectAssetRecordV3>).sourceBytes,
      ]
      releaseFirstDigest()
      const result = await pending
      const matchingGroups = result.preparedSourceGroups.filter(({ preparedSource }) =>
        preparedSource.sha256 === DIGEST_ABC)
      const robotGroup = matchingGroups.find(({ preparedSource }) =>
        preparedSource.namespace === 'robot')
      const objectGroup = matchingGroups.find(({ preparedSource }) =>
        preparedSource.namespace === 'object')

      expect(sourceCopiesBeforeFirstAwait).toBe(2)
      expect(sourceTransfersBeforeFirstAwait).toBe(0)
      expect(sharedByteLengthDuringFirstDigest).toBe(sharedBefore.length)
      expect(sharedBytesDuringFirstDigest).toEqual(sharedBefore)
      expect(aliasesDuringFirstDigest).toEqual([shared, shared, shared])
      expect(sourceBearingCopyCalls).toBe(2)
      expect(sourceTransferCalls).toBe(2)
      expect(digestSource).toHaveBeenCalledTimes(2)
      expect(result.preparedSourceGroups).toHaveLength(2)
      expect(matchingGroups).toHaveLength(2)
      expect(robotGroup?.ownerKeys).toEqual([`robot-source:${DIGEST_ABC}`])
      expect(objectGroup?.ownerKeys).toEqual([
        'object-asset:asset-a',
        'object-asset:asset-b',
      ])
      expect(robotGroup?.preparedSource).not.toBe(objectGroup?.preparedSource)
      expect(robotGroup?.preparedSource).not.toHaveProperty('sourceBytes')
      expect(objectGroup?.preparedSource).not.toHaveProperty('sourceBytes')
      expect(result.projection.objectAssets.map((candidate) =>
        candidate.sourceKind === 'step' ? candidate.sourceSha256 : undefined)).toEqual([
        DIGEST_ABC,
        DIGEST_ABC,
      ])
      expect(project).toEqual(before)
      expect(project.robot.sources[0]!.sourceBytes).toBe(shared)
      expect((project.objectAssets[0] as Mutable<StepObjectAssetRecordV3>).sourceBytes).toBe(shared)
      expect((project.objectAssets[1] as Mutable<StepObjectAssetRecordV3>).sourceBytes).toBe(shared)
      expect(shared.byteLength).toBe(sharedBefore.length)
      expect([...new Uint8Array(shared)]).toEqual(sharedBefore)
    } finally {
      releaseFirstDigest()
      cloneSpy.mockRestore()
    }
  })

  it('rejects splitting one opaque token across multiple owner groups', async () => {
    const project = await validV3Project() as unknown as Mutable<WorkcellProjectSnapshotV3>
    const shared = Uint8Array.from([7, 8, 9]).buffer
    const asset = {
      id: 'asset-a',
      name: 'Asset A',
      sourceKind: 'step' as const,
      sourceFileName: 'asset.step',
      sourceBytes: shared,
      importScale: 1,
      originMode: 'source' as const,
      colliderCenter: [0, 0, 0] as [number, number, number],
      collisionHalfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      collisionBoxes: [{
        id: 'default',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    }
    project.objectAssets = [asset, { ...asset, id: 'asset-b', name: 'Asset B' }]
    const staging = createProjectSourceStagingService({ sourceDigest: nativeDigest() })
    const result = await stageProjectSourcesV3(
      project,
      staging,
      nativeRevisionIdentityHasher(),
    )
    const objectGroup = result.preparedSourceGroups.find(({ preparedSource }) =>
      preparedSource.namespace === 'object')!
    const splitGroups = objectGroup.ownerKeys.map((ownerKey) => ({
      ownerKeys: [ownerKey],
      preparedSource: objectGroup.preparedSource,
    }))

    expect(() => staging.validateProjection(result.projection, splitGroups)).toThrow(
      /exactly one owner group/i,
    )
  })

  it('makes only the ownership copy source-bearing and transfer-detaches each staged group', async () => {
    const project = await validV3Project()
    const originalStructuredClone = globalThis.structuredClone
    let sourceBearingCopyCalls = 0
    let sourceTransferCalls = 0
    const cloneSpy = vi.spyOn(globalThis, 'structuredClone').mockImplementation(
      ((value: unknown, options?: StructuredSerializeOptions) => {
        if (containsArrayBuffer(value)) {
          if ((options?.transfer?.length ?? 0) > 0) sourceTransferCalls += 1
          else sourceBearingCopyCalls += 1
        }
        return originalStructuredClone(value, options)
      }) as typeof structuredClone,
    )
    try {
      const result = await stageProjectSourcesV3(
        project,
        createProjectSourceStagingService({ sourceDigest: nativeDigest() }),
        nativeRevisionIdentityHasher(),
      )

      expect(sourceBearingCopyCalls).toBe(1)
      expect(sourceTransferCalls).toBe(result.preparedSourceGroups.length)
      expect(Object.isFrozen(result.projection)).toBe(true)
      expect(Object.isFrozen(result.projection.robot.sources[0])).toBe(true)
      expect(Object.isFrozen(result.preparedSourceGroups)).toBe(true)
      expect(Object.isFrozen(result.preparedSourceGroups[0])).toBe(true)
      expect(Object.isFrozen(result.preparedSourceGroups[0]!.ownerKeys)).toBe(true)
    } finally {
      cloneSpy.mockRestore()
    }
  })

  it('rejects revoked and cross-service tokens at the high-level projection boundary', async () => {
    const staging = createProjectSourceStagingService({ sourceDigest: nativeDigest() })
    const result = await stageProjectSourcesV3(
      await validV3Project(),
      staging,
      nativeRevisionIdentityHasher(),
    )
    const prepared = result.preparedSourceGroups[0]!.preparedSource
    const other = createProjectSourceStagingService({ sourceDigest: nativeDigest() })

    expect(() => other.assertPrepared(prepared)).toThrow(/another service|forged/i)
    staging.revoke(prepared)
    expect(() => staging.validateProjection(
      result.projection,
      result.preparedSourceGroups,
    )).toThrow(/revoked/i)
  })
})
