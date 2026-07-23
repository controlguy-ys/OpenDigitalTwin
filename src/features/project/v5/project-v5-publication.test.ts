import { describe, expect, it, vi } from 'vitest'

import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import { createBrowserProjectRuntimeV5 } from './browser-project-runtime-v5.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import type {
  PreparedProjectRevisionV5,
  ProjectRevisionRecordV5,
  ProjectRepositoryV5,
} from './project-v5-repository.js'
import { ProjectRepositoryV5Error } from './project-v5-repository.js'
import type { StoredProjectPointerV5 } from './project-v5-db.js'
import { ProjectDatabaseV5 } from './project-v5-db.js'
import { createProjectRepositoryV5 } from './project-v5-repository.js'
import {
  createProjectPublicationCoordinatorV5,
  type ProjectV5BrowserRuntimePublicationPort,
  type ProjectV5GatewayPublicationPort,
  type ProjectV5GatewayRollbackDispositionV1,
  type PublishedProjectV5,
} from './project-v5-publication.js'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)

type FailurePoint =
  | 'repository-prepare'
  | 'runtime-prepare'
  | 'gateway-prepare'
  | 'runtime-apply'
  | 'gateway-activate'
  | 'repository-commit'
  | 'runtime-commit'
  | 'repository-finalize'

interface RuntimeCandidate {
  readonly revisionId: string
  readonly project: WorkcellProjectV5
  readonly configRevision: string
}

interface GatewayCandidate {
  readonly project: WorkcellProjectV5
  readonly configRevision: string
}

function project(revisionId: string, name: string): WorkcellProjectV5 {
  const candidate = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  return {
    ...candidate,
    revisionId,
    metadata: { ...candidate.metadata, name },
  }
}

function published(projectValue: WorkcellProjectV5, configRevision: string): PublishedProjectV5 {
  return Object.freeze({ project: projectValue, revisionId: projectValue.revisionId, configRevision })
}

function gatewayStatus(projectValue: WorkcellProjectV5, configRevision: string): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1',
    protocolVersion: 1,
    observedAtMs: 1,
    gateway: { gatewayId: 'gateway-1', phase: 'online', runtimeKind: 'native' },
    deployment: {
      http: { bindHost: '127.0.0.1', port: 8081 },
      opcUaServer: {
        bindHost: '127.0.0.1', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'ready', projectId: projectValue.projectId, revisionId: projectValue.revisionId,
      configRevision, activationAttemptId: `attempt-${projectValue.revisionId}`, authorityPhase: 'active', readinessCode: 'READY',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  })
}

function inactiveGatewayStatus(): RuntimeGatewayStatusV1 {
  return validateRuntimeGatewayStatusV1({
    type: 'runtime-gateway-status-v1',
    protocolVersion: 1,
    observedAtMs: 1,
    gateway: { gatewayId: 'gateway-1', phase: 'online', runtimeKind: 'native' },
    deployment: {
      http: { bindHost: '127.0.0.1', port: 8081 },
      opcUaServer: {
        bindHost: '127.0.0.1', port: 4841,
        advertisedHost: '127.0.0.1', advertisedPort: 4841,
      },
    },
    project: {
      phase: 'not-applied', projectId: null, revisionId: null,
      configRevision: null, activationAttemptId: null, authorityPhase: 'inactive', readinessCode: 'NO_ACTIVE_REVISION',
    },
    opcUa: {
      mode: 'off',
      server: { phase: 'disabled', endpointUrl: null, lastError: null },
      clientEndpoints: [],
    },
  })
}

function failure(point: FailurePoint | null, target: FailurePoint): void {
  if (point === target) throw new Error(`TEST_${target.toUpperCase().replaceAll('-', '_')}`)
}

function publicationHarness(
  failurePoint: FailurePoint | null = null,
  onCleanupIssue?: (retry: () => Promise<void>) => void,
  identicalReplacement = false,
) {
  const previousProject = project('revision-a', 'Previous')
  const nextProject = identicalReplacement ? previousProject : project('revision-b', 'Next')
  const previous = published(previousProject, HASH_A)
  const events: string[] = []
  let durable: PublishedProjectV5 | null = previous
  let publishing: PublishedProjectV5 | null = null
  let runtimeActive: PublishedProjectV5 | null = previous
  let gatewayActive: PublishedProjectV5 | null = previous

  const repository = {
    prepareRevision: vi.fn(async (candidate: WorkcellProjectV5, configRevision: string) => {
      events.push(`repository.prepare:${candidate.revisionId}:${configRevision}`)
      failure(failurePoint, 'repository-prepare')
      return Object.freeze({ revisionId: candidate.revisionId, configRevision, project: candidate })
    }),
    materializePreparedProject: (preparedRevision: PreparedProjectRevisionV5) => preparedRevision.project,
    discardPreparedRevision: vi.fn((_preparedRevision: PreparedProjectRevisionV5) => {
      events.push('repository.discard')
    }),
    commitPreparedRevision: vi.fn(async (
      expectedRevisionId: string | null,
      preparedRevision: PreparedProjectRevisionV5,
      _commitToken: string,
    ) => {
      events.push(`repository.commit:${preparedRevision.revisionId}`)
      expect(expectedRevisionId).toBe(durable?.revisionId ?? null)
      failure(failurePoint, 'repository-commit')
      publishing = published(preparedRevision.project, preparedRevision.configRevision)
      durable = publishing
    }),
    finalizePublication: vi.fn(async (_commitToken: string) => {
      events.push('repository.finalize')
      failure(failurePoint, 'repository-finalize')
      publishing = null
    }),
    compensatePublication: vi.fn(async (_commitToken: string) => {
      events.push('repository.compensate')
      durable = previous
      publishing = null
    }),
    readRevision: async (_revisionId: string) => null,
    readActive: async () => durable?.project ?? null,
    readPointer: async (): Promise<StoredProjectPointerV5 | null> => ({
      key: 'active', state: 'stable', revisionId: previous.revisionId, commitToken: 'commit-a',
    }),
    garbageCollect: vi.fn(async () => { events.push('repository.gc') }),
  } satisfies ProjectRepositoryV5

  const runtimeTransition = {
    rollback: vi.fn(async () => {
      events.push('runtime.transition.rollback')
      runtimeActive = previous
    }),
    finalize: vi.fn(async () => {
      events.push('runtime.transition.finalize')
    }),
  }
  const runtime = {
    prepare: vi.fn(async (candidate: WorkcellProjectV5, configRevision: string): Promise<RuntimeCandidate> => {
      events.push(`runtime.prepare:${candidate.revisionId}:${configRevision}`)
      failure(failurePoint, 'runtime-prepare')
      return Object.freeze({ revisionId: candidate.revisionId, project: candidate, configRevision })
    }),
    apply: vi.fn(async (candidate: RuntimeCandidate) => {
      events.push(`runtime.apply:${candidate.revisionId}`)
      failure(failurePoint, 'runtime-apply')
    }),
    commit: vi.fn(async (candidate: RuntimeCandidate) => {
      events.push(`runtime.commit:${candidate.revisionId}`)
      failure(failurePoint, 'runtime-commit')
      runtimeActive = published(candidate.project, candidate.configRevision)
      return runtimeTransition
    }),
    rollback: vi.fn(async (candidate: RuntimeCandidate) => {
      events.push(`runtime.rollback:${candidate.revisionId}`)
      runtimeActive = previous
    }),
    deactivate: vi.fn(async () => ({ rollback: async () => undefined, finalize: async () => undefined })),
  }
  const runtimePort = runtime satisfies ProjectV5BrowserRuntimePublicationPort<RuntimeCandidate>

  const gateway = {
    prepare: vi.fn(async (candidate: WorkcellProjectV5, configRevision: string): Promise<GatewayCandidate> => {
      events.push(`gateway.prepare:${candidate.revisionId}:${configRevision}`)
      failure(failurePoint, 'gateway-prepare')
      return Object.freeze({ project: candidate, configRevision })
    }),
    activate: vi.fn(async (candidate: GatewayCandidate) => {
      events.push(`gateway.activate:${candidate.project.revisionId}`)
      gatewayActive = published(candidate.project, candidate.configRevision)
      failure(failurePoint, 'gateway-activate')
      return gatewayStatus(candidate.project, candidate.configRevision)
    }),
    reactivate: vi.fn(async (previousPublication: PublishedProjectV5) => {
      events.push(`gateway.reactivate:${previousPublication.revisionId}`)
      gatewayActive = previousPublication
      return gatewayStatus(previousPublication.project, previousPublication.configRevision)
    }),
    readStatus: vi.fn(async () => {
      events.push(`gateway.read-status:${gatewayActive?.revisionId ?? 'none'}`)
      if (gatewayActive === null) throw new Error('Gateway has no active Project.')
      return gatewayStatus(gatewayActive.project, gatewayActive.configRevision)
    }),
    rollback: vi.fn(async (candidate: GatewayCandidate) => {
      events.push(`gateway.rollback:${candidate.project.revisionId}`)
      return 'candidate-deactivated' as ProjectV5GatewayRollbackDispositionV1
    }),
    deactivate: vi.fn(async () => inactiveGatewayStatus()),
    cleanupPrevious: vi.fn(async (previousPublication: PublishedProjectV5) => {
      events.push(`gateway.cleanup:${previousPublication.revisionId}`)
    }),
  } satisfies ProjectV5GatewayPublicationPort<GatewayCandidate>

  const configRevisionForProjectV5 = vi.fn(async (candidate: WorkcellProjectV5) => {
    events.push(`hash:${candidate.revisionId}`)
    return identicalReplacement ? HASH_A : HASH_B
  })
  const cleanupDiagnostics = vi.fn()
  let publication!: ReturnType<typeof createProjectPublicationCoordinatorV5<RuntimeCandidate, GatewayCandidate>>
  publication = createProjectPublicationCoordinatorV5({
    repository,
    runtime: runtimePort,
    gateway,
    initialPublished: previous,
    configRevisionForProjectV5,
    createCommitToken: () => 'commit-b',
    onCleanupIssue: (issue) => {
      cleanupDiagnostics(issue)
      onCleanupIssue?.(() => publication.retryCleanup())
    },
  })
  return {
    previous,
    nextProject,
    repository,
    runtime,
    runtimeTransition,
    gateway,
    configRevisionForProjectV5,
    cleanupDiagnostics,
    publication,
    events,
    durable: () => durable,
    runtimeActive: () => runtimeActive,
    gatewayActive: () => gatewayActive,
    publishing: () => publishing,
  }
}

function hydrationHarness(initialPointer: StoredProjectPointerV5 | null, options: {
  readonly failTargetActivation?: boolean
  readonly staleActiveWhenEmpty?: boolean
  readonly healthyGatewayCasLoser?: boolean
  readonly movePointerOnTargetCommit?: StoredProjectPointerV5
  readonly movePointerOnPreviousCommit?: StoredProjectPointerV5
} = {}) {
  const previous = published(project('hydration-previous', 'Previous'), HASH_A)
  const target = published(project('hydration-target', 'Target'), HASH_B)
  let pointer = initialPointer
  let runtimeActive: PublishedProjectV5 | null = options.staleActiveWhenEmpty ? target : null
  let gatewayActive: PublishedProjectV5 | null = options.staleActiveWhenEmpty || options.healthyGatewayCasLoser ? target : null
  const events: string[] = []
  const record = (value: PublishedProjectV5): ProjectRevisionRecordV5 => ({
    revisionId: value.revisionId,
    configRevision: value.configRevision,
    project: value.project,
  })
  const repository = {
    prepareRevision: vi.fn(async () => { throw new Error('not used by hydration') }),
    materializePreparedProject: vi.fn(),
    discardPreparedRevision: vi.fn(),
    commitPreparedRevision: vi.fn(async () => { throw new Error('not used by hydration') }),
    finalizePublication: vi.fn(async (token: string) => {
      expect(pointer).toMatchObject({ state: 'publishing', commitToken: token })
      if (pointer?.state !== 'publishing') throw new Error('pointer is not publishing')
      pointer = { key: 'active', state: 'stable', revisionId: pointer.revisionId, commitToken: pointer.commitToken }
    }),
    compensatePublication: vi.fn(async (token: string) => {
      expect(pointer).toMatchObject({ state: 'publishing', commitToken: token })
      if (pointer?.state !== 'publishing') throw new Error('pointer is not publishing')
      pointer = pointer.previousRevisionId === null
        ? null
        : { key: 'active', state: 'stable', revisionId: pointer.previousRevisionId, commitToken: pointer.previousCommitToken! }
    }),
    readRevision: vi.fn(async (revisionId: string) => {
      if (revisionId === target.revisionId) return record(target)
      if (revisionId === previous.revisionId) return record(previous)
      return null
    }),
    readActive: vi.fn(async () => null),
    readPointer: vi.fn(async () => pointer),
    garbageCollect: vi.fn(async () => { events.push('repository.gc') }),
  } satisfies ProjectRepositoryV5
  const transition = {
    rollback: vi.fn(async () => { events.push('runtime.rollback'); runtimeActive = null }),
    finalize: vi.fn(async () => { events.push('runtime.finalize') }),
  }
  const runtime = {
    prepare: vi.fn(async (candidate: WorkcellProjectV5, configRevision: string) => ({ candidate, configRevision })),
    apply: vi.fn(async () => undefined),
    commit: vi.fn(async (prepared: { readonly candidate: WorkcellProjectV5; readonly configRevision: string }) => {
      runtimeActive = published(prepared.candidate, prepared.configRevision)
      if (options.movePointerOnTargetCommit !== undefined && prepared.candidate.revisionId === target.revisionId) {
        pointer = options.movePointerOnTargetCommit
      }
      if (options.movePointerOnPreviousCommit !== undefined && prepared.candidate.revisionId === previous.revisionId) {
        pointer = options.movePointerOnPreviousCommit
      }
      return transition
    }),
    rollback: vi.fn(async () => { runtimeActive = null }),
    deactivate: vi.fn(async () => {
      const old = runtimeActive
      runtimeActive = null
      return {
        rollback: async () => { runtimeActive = old },
        finalize: async () => { events.push('runtime.deactivate.finalize') },
      }
    }),
  } satisfies ProjectV5BrowserRuntimePublicationPort<{ readonly candidate: WorkcellProjectV5; readonly configRevision: string }>
  const gateway = {
    prepare: vi.fn(async (candidate: WorkcellProjectV5, configRevision: string) => ({ candidate, configRevision })),
    activate: vi.fn(async (prepared: { readonly candidate: WorkcellProjectV5; readonly configRevision: string }) => {
      if (options.healthyGatewayCasLoser && prepared.candidate.revisionId === target.revisionId) {
        const error = new Error('Gateway activation lost a healthy same-target CAS race.') as Error & { code: string }
        error.code = 'PROJECT_ACTIVATION_CONFLICT'
        throw error
      }
      if (options.failTargetActivation && prepared.candidate.revisionId === target.revisionId) throw new Error('target activation failed')
      gatewayActive = published(prepared.candidate, prepared.configRevision)
      return gatewayStatus(prepared.candidate, prepared.configRevision)
    }),
    reactivate: vi.fn(async (value: PublishedProjectV5) => {
      gatewayActive = value
      return gatewayStatus(value.project, value.configRevision)
    }),
    readStatus: vi.fn(async () => gatewayActive === null ? inactiveGatewayStatus() : gatewayStatus(gatewayActive.project, gatewayActive.configRevision)),
    rollback: vi.fn(async () => {
      if (options.healthyGatewayCasLoser) return 'other-authority' as ProjectV5GatewayRollbackDispositionV1
      gatewayActive = null
      return 'candidate-deactivated' as ProjectV5GatewayRollbackDispositionV1
    }),
    deactivate: vi.fn(async () => { gatewayActive = null; return inactiveGatewayStatus() }),
    cleanupPrevious: vi.fn(async (value: PublishedProjectV5) => { events.push(`gateway.cleanup:${value.revisionId}`) }),
  } satisfies ProjectV5GatewayPublicationPort<{ readonly candidate: WorkcellProjectV5; readonly configRevision: string }>
  const publication = createProjectPublicationCoordinatorV5({
    repository,
    runtime,
    gateway,
    configRevisionForProjectV5: vi.fn(async () => { throw new Error('hydrate must use persisted config revision') }),
  })
  return { previous, target, repository, runtime, gateway, publication, pointer: () => pointer, setPointer: (value: StoredProjectPointerV5 | null) => { pointer = value }, runtimeActive: () => runtimeActive, gatewayActive: () => gatewayActive, events }
}

describe('Project V5 publication coordinator', () => {
  it('owns one canonical hash and publishes it in the required safe order', async () => {
    const harness = publicationHarness()

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).resolves.toEqual(published(harness.nextProject, HASH_B))

    expect(harness.configRevisionForProjectV5).toHaveBeenCalledTimes(1)
    expect(harness.repository.prepareRevision).toHaveBeenCalledWith(harness.nextProject, HASH_B)
    expect(harness.runtime.prepare).toHaveBeenCalledWith(harness.nextProject, HASH_B)
    expect(harness.gateway.prepare).toHaveBeenCalledWith(harness.nextProject, HASH_B, harness.previous)
    expect(harness.events).toEqual([
      'hash:revision-b',
      `repository.prepare:revision-b:${HASH_B}`,
      `runtime.prepare:revision-b:${HASH_B}`,
      `gateway.prepare:revision-b:${HASH_B}`,
      'runtime.apply:revision-b',
      'gateway.activate:revision-b',
      'repository.commit:revision-b',
      'runtime.commit:revision-b',
      'gateway.read-status:revision-b',
      'repository.finalize',
      'runtime.transition.finalize',
      'gateway.cleanup:revision-a',
      'repository.gc',
    ])
    expect(harness.publication.readPublished()).toEqual(published(harness.nextProject, HASH_B))
    expect(harness.durable()).toEqual(published(harness.nextProject, HASH_B))
    expect(harness.runtimeActive()).toEqual(published(harness.nextProject, HASH_B))
    expect(harness.gatewayActive()).toEqual(published(harness.nextProject, HASH_B))
  })

  it('does not retain previous Gateway cleanup for an identical logical replacement', async () => {
    const harness = publicationHarness(null, undefined, true)
    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).resolves.toEqual(published(harness.nextProject, HASH_A))
    await Promise.resolve()
    expect(harness.gateway.cleanupPrevious).not.toHaveBeenCalled()
    await expect(harness.publication.replace({
      candidate: project('revision-b', 'After unchanged import'),
      expectedRevisionId: harness.nextProject.revisionId,
    })).resolves.toMatchObject({ revisionId: 'revision-b' })
  })

  it('compensates valid void runtime and Gateway prepared handles after apply fails', async () => {
    const harness = publicationHarness()
    harness.runtime.prepare.mockResolvedValueOnce(undefined as never)
    harness.gateway.prepare.mockResolvedValueOnce(undefined as never)
    harness.runtime.apply.mockRejectedValueOnce(new Error('TEST_VOID_APPLY'))
    harness.runtime.rollback.mockImplementationOnce(async (handle) => { expect(handle).toBeUndefined() })
    harness.gateway.rollback.mockImplementationOnce(async (handle) => { expect(handle).toBeUndefined(); return 'prepared-only' })
    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toThrow('TEST_VOID_APPLY')
    expect(harness.runtime.rollback).toHaveBeenCalledOnce()
    expect(harness.gateway.rollback).toHaveBeenCalledOnce()
  })

  it('reconciles a commit that takes effect before rejecting by exact pointer and token', async () => {
    const harness = publicationHarness()
    harness.repository.commitPreparedRevision.mockImplementationOnce(async () => { throw new Error('TEST_COMMIT_RESPONSE_LOST') })
    harness.repository.readPointer = async (): Promise<StoredProjectPointerV5 | null> => ({
      key: 'active', state: 'publishing', revisionId: harness.nextProject.revisionId,
      commitToken: 'commit-b', previousRevisionId: harness.previous.revisionId, previousCommitToken: 'commit-a',
    })
    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toThrow('TEST_COMMIT_RESPONSE_LOST')
    expect(harness.repository.compensatePublication).toHaveBeenCalledWith('commit-b')
    expect(harness.repository.discardPreparedRevision).not.toHaveBeenCalled()
  })

  it('keeps the exact stable publication when finalization succeeds before its response is lost', async () => {
    const harness = publicationHarness()
    harness.repository.finalizePublication.mockRejectedValueOnce(new Error('TEST_FINALIZE_RESPONSE_LOST'))
    harness.repository.readPointer = async (): Promise<StoredProjectPointerV5 | null> => ({
      key: 'active',
      state: 'stable',
      revisionId: harness.nextProject.revisionId,
      commitToken: 'commit-b',
    })

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).resolves.toEqual(published(harness.nextProject, HASH_B))

    expect(harness.publication.readPublished()).toEqual(published(harness.nextProject, HASH_B))
    expect(harness.repository.compensatePublication).not.toHaveBeenCalled()
    expect(harness.runtimeTransition.rollback).not.toHaveBeenCalled()
    expect(harness.gateway.rollback).not.toHaveBeenCalled()
    expect(harness.publication.isRecoveryRequired()).toBe(false)
  })

  it.each([
    'repository-prepare',
    'runtime-prepare',
    'gateway-prepare',
    'runtime-apply',
    'gateway-activate',
    'repository-commit',
    'runtime-commit',
    'repository-finalize',
  ] as const)('restores the prior durable, runtime, and Gateway publication when %s fails', async (failurePoint) => {
    const harness = publicationHarness(failurePoint)

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toThrow(`TEST_${failurePoint.toUpperCase().replaceAll('-', '_')}`)

    expect(harness.durable()).toEqual(harness.previous)
    expect(harness.runtimeActive()).toEqual(harness.previous)
    expect(harness.gatewayActive()).toEqual(harness.previous)
    expect(harness.publishing()).toBeNull()
    expect(harness.publication.readPublished()).toEqual(harness.previous)
    expect(harness.publication.isRecoveryRequired()).toBe(false)
    if (failurePoint === 'gateway-activate' || failurePoint === 'repository-commit' || failurePoint === 'runtime-commit' || failurePoint === 'repository-finalize') {
      expect(harness.gateway.reactivate).toHaveBeenCalledWith(harness.previous)
    }
  })

  it('rejects a stale expected revision before candidate hashing or preparation', async () => {
    const harness = publicationHarness()

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: 'stale-revision',
    })).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(harness.configRevisionForProjectV5).not.toHaveBeenCalled()
    expect(harness.repository.prepareRevision).not.toHaveBeenCalled()
  })

  it('enters explicit recovery only if restoring prior authority itself fails', async () => {
    const harness = publicationHarness('repository-finalize')
    harness.gateway.reactivate.mockRejectedValueOnce(new Error('previous gateway unavailable'))

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toThrow('TEST_REPOSITORY_FINALIZE')

    expect(harness.publication.isRecoveryRequired()).toBe(true)
    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toMatchObject({ code: 'PROJECT_RECOVERY_REQUIRED' })
  })

  it('rolls back Gateway residue, the exact runtime transition, and the repository before reactivating the old Gateway', async () => {
    const harness = publicationHarness('repository-finalize')
    let oldGatewayActivated = false
    const reactivate = harness.gateway.reactivate.getMockImplementation()!
    const rollbackGateway = harness.gateway.rollback.getMockImplementation()!
    harness.gateway.reactivate.mockImplementation(async (previousPublication) => {
      oldGatewayActivated = true
      return reactivate(previousPublication)
    })
    harness.gateway.rollback.mockImplementation(async (candidate) => {
      if (oldGatewayActivated) throw new Error('Gateway candidate residue was cleaned after old activation.')
      return rollbackGateway(candidate)
    })

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).rejects.toThrow('TEST_REPOSITORY_FINALIZE')

    expect(harness.publication.isRecoveryRequired()).toBe(false)
    expect(harness.runtimeTransition.rollback).toHaveBeenCalledOnce()
    const gatewayRollback = harness.events.indexOf('gateway.rollback:revision-b')
    const runtimeRollback = harness.events.indexOf('runtime.transition.rollback')
    const repositoryRollback = harness.events.indexOf('repository.compensate')
    const gatewayReactivate = harness.events.indexOf('gateway.reactivate:revision-a')
    expect(gatewayRollback).toBeGreaterThanOrEqual(0)
    expect(runtimeRollback).toBeGreaterThan(gatewayRollback)
    expect(repositoryRollback).toBeGreaterThan(runtimeRollback)
    expect(gatewayReactivate).toBeGreaterThan(repositoryRollback)
    expect(harness.gateway.readStatus).toHaveBeenCalledTimes(2)
    expect(harness.events.indexOf('gateway.read-status:revision-a')).toBeGreaterThan(gatewayReactivate)
    expect(harness.durable()).toEqual(harness.previous)
    expect(harness.runtimeActive()).toEqual(harness.previous)
    expect(harness.gatewayActive()).toEqual(harness.previous)
  })

  it('retains bounded cleanup issues and serializes one retry for the active publication', async () => {
    const harness = publicationHarness()
    harness.gateway.cleanupPrevious.mockRejectedValueOnce(new Error('gateway cleanup unavailable'))
    harness.repository.garbageCollect.mockRejectedValueOnce(new Error('repository cleanup unavailable'))

    await expect(harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })).resolves.toEqual(published(harness.nextProject, HASH_B))

    expect(harness.publication.readCleanupStatus()).toMatchObject({
      pending: [
        { kind: 'gateway-previous', revisionId: 'revision-a', attemptCount: 1 },
        { kind: 'repository-garbage-collection', revisionId: 'revision-b', attemptCount: 0 },
      ],
    })
    await Promise.all([harness.publication.retryCleanup(), harness.publication.retryCleanup()])
    await vi.waitFor(() => expect(harness.repository.garbageCollect).toHaveBeenCalledOnce())
    expect(harness.publication.readCleanupStatus().pending[0]).toMatchObject({
      kind: 'repository-garbage-collection', attemptCount: 1,
    })
    await harness.publication.retryCleanup()
    await vi.waitFor(() => expect(harness.publication.readCleanupStatus()).toEqual({ pending: [] }))
    expect(harness.gateway.cleanupPrevious).toHaveBeenCalledTimes(2)
    expect(harness.repository.garbageCollect).toHaveBeenCalledTimes(2)
    expect(harness.cleanupDiagnostics).toHaveBeenCalledTimes(2)
    expect(harness.cleanupDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'gateway-previous', revisionId: 'revision-a', attemptCount: 1,
    }))
    expect(harness.cleanupDiagnostics).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'repository-garbage-collection', revisionId: 'revision-b', attemptCount: 1,
    }))
    expect(harness.publication.readCleanupStatus()).toEqual({ pending: [] })
  })

  it('retries one failed cleanup automatically before the next publication', async () => {
    const harness = publicationHarness()
    harness.gateway.cleanupPrevious.mockRejectedValueOnce(new Error('transient gateway cleanup failure'))

    await harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })
    await vi.waitFor(() => expect(harness.publication.readCleanupStatus().pending[0]).toMatchObject({
      kind: 'gateway-previous',
      attemptCount: 1,
    }))

    const afterCleanup = project('revision-c', 'After transient cleanup')
    await expect(harness.publication.replace({
      candidate: afterCleanup,
      expectedRevisionId: harness.nextProject.revisionId,
    })).resolves.toMatchObject({ revisionId: afterCleanup.revisionId })

    expect(harness.gateway.cleanupPrevious).toHaveBeenCalledTimes(3)
    expect(harness.publication.isRecoveryRequired()).toBe(false)
  })

  it('shares one retry generation that waits for the exact in-flight drain before retrying a failed head', async () => {
    const harness = publicationHarness()
    let rejectFirst!: (error: Error) => void
    harness.runtimeTransition.finalize.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      rejectFirst = reject
    }))

    await harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })
    const firstRetry = harness.publication.retryCleanup()
    const secondRetry = harness.publication.retryCleanup()
    expect(secondRetry).toBe(firstRetry)
    rejectFirst(new Error('first finalize failed'))

    await expect(firstRetry).resolves.toBeUndefined()
    expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(2)
    expect(harness.publication.readCleanupStatus().pending).toEqual([])
  })

  it('does not lose a synchronous retry requested from the cleanup issue observer', async () => {
    let retryFromIssue: Promise<void> | null = null
    const harness = publicationHarness(null, (retry) => {
      retryFromIssue = retry()
    })
    harness.runtimeTransition.finalize.mockRejectedValueOnce(new Error('transient finalize failure'))

    await harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })
    await vi.waitFor(() => expect(retryFromIssue).not.toBeNull())
    await retryFromIssue!

    expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(2)
    expect(harness.publication.readCleanupStatus().pending).toEqual([])
    const afterSuccess = harness.publication.retryCleanup()
    expect(harness.publication.retryCleanup()).toBe(afterSuccess)
    let afterSuccessSettled = false
    void afterSuccess.then(() => { afterSuccessSettled = true })
    await vi.waitFor(() => expect(afterSuccessSettled).toBe(true))
  })

  it('shares a fully quiescent retry generation for same-stack callers and settles it', async () => {
    const harness = publicationHarness()

    const first = harness.publication.retryCleanup()
    const second = harness.publication.retryCleanup()

    expect(second).toBe(first)
    await expect(first).resolves.toBeUndefined()
    expect(harness.runtimeTransition.finalize).not.toHaveBeenCalled()
  })

  it('queues one following retry generation across synchronous then deferred cleanup failures', async () => {
    const retryGenerations: Promise<void>[] = []
    let releaseSecond!: () => void
    let inFlight = 0
    let maximumInFlight = 0
    const harness = publicationHarness(null, (retry) => {
      const first = retry()
      const concurrent = retry()
      expect(concurrent).toBe(first)
      if (retryGenerations.at(-1) !== first) retryGenerations.push(first)
    })
    const finalize = harness.runtimeTransition.finalize.getMockImplementation()!
    let attempt = 0
    harness.runtimeTransition.finalize.mockImplementation(() => {
      attempt += 1
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)
      if (attempt === 1) {
        inFlight -= 1
        throw new Error('first synchronous finalize failure')
      }
      if (attempt === 2) {
        return new Promise<void>((_resolve, reject) => {
          releaseSecond = () => {
            inFlight -= 1
            reject(new Error('second deferred finalize failure'))
          }
        })
      }
      inFlight -= 1
      return finalize()
    })

    await harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })
    await vi.waitFor(() => expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(2))
    expect(retryGenerations).toHaveLength(1)
    releaseSecond()
    await vi.waitFor(() => expect(retryGenerations).toHaveLength(2))
    expect(retryGenerations[1]).not.toBe(retryGenerations[0])
    await vi.waitFor(() => expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(3))
    await expect(Promise.all(retryGenerations)).resolves.toEqual([undefined, undefined])

    expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(3)
    expect(maximumInFlight).toBe(1)
    expect(harness.events.indexOf('gateway.cleanup:revision-a'))
      .toBeGreaterThan(harness.events.indexOf('runtime.transition.finalize'))
    expect(harness.events.indexOf('repository.gc'))
      .toBeGreaterThan(harness.events.indexOf('gateway.cleanup:revision-a'))
    expect(harness.publication.readCleanupStatus().pending).toEqual([])

    const later = project('revision-c', 'Later')
    await expect(harness.publication.replace({
      candidate: later,
      expectedRevisionId: harness.nextProject.revisionId,
    })).resolves.toEqual(published(later, HASH_B))
  })

  it('retains retry generations requested from microtask-delayed issue observers', async () => {
    const retryGenerations: Promise<void>[] = []
    const harness = publicationHarness(null, (retry) => {
      queueMicrotask(() => {
        const first = retry()
        const concurrent = retry()
        expect(concurrent).toBe(first)
        if (retryGenerations.at(-1) !== first) retryGenerations.push(first)
      })
    })
    harness.runtimeTransition.finalize
      .mockImplementationOnce(() => { throw new Error('first synchronous failure') })
      .mockRejectedValueOnce(new Error('second asynchronous failure'))

    await harness.publication.replace({
      candidate: harness.nextProject,
      expectedRevisionId: harness.previous.revisionId,
    })
    await vi.waitFor(() => expect(harness.runtimeTransition.finalize).toHaveBeenCalledTimes(3))
    await vi.waitFor(() => expect(retryGenerations).toHaveLength(2))
    expect(retryGenerations[1]).not.toBe(retryGenerations[0])
    await expect(Promise.all(retryGenerations)).resolves.toEqual([undefined, undefined])
    expect(harness.publication.readCleanupStatus().pending).toEqual([])
  })

  it('marks recovery when a first-publication Gateway rollback readback is not canonical', async () => {
    const nextProject = project('revision-first', 'First')
    let runtimeActive: PublishedProjectV5 | null = null
    let gatewayActive: PublishedProjectV5 | null = null
    let durable: PublishedProjectV5 | null = null
    const preparedRevision: PreparedProjectRevisionV5 = Object.freeze({
      revisionId: nextProject.revisionId,
      configRevision: HASH_B,
      project: nextProject,
    })
    const transition = {
      rollback: vi.fn(async () => { runtimeActive = null }),
      finalize: vi.fn(async () => undefined),
    }
    const repository = {
      prepareRevision: vi.fn(async () => preparedRevision),
      materializePreparedProject: () => nextProject,
      discardPreparedRevision: vi.fn(async () => undefined),
      commitPreparedRevision: vi.fn(async (expectedRevisionId: string | null) => {
        expect(expectedRevisionId).toBeNull()
        durable = published(nextProject, HASH_B)
      }),
      finalizePublication: vi.fn(async () => { throw new Error('TEST_FIRST_FINALIZE') }),
      compensatePublication: vi.fn(async () => { durable = null }),
      readRevision: async () => null,
      readActive: async () => durable?.project ?? null,
      readPointer: async () => null,
      garbageCollect: vi.fn(async () => undefined),
    } satisfies ProjectRepositoryV5
    const runtime = {
      prepare: vi.fn(async () => Object.freeze({ revisionId: nextProject.revisionId })),
      apply: vi.fn(async () => undefined),
      commit: vi.fn(async () => {
        runtimeActive = published(nextProject, HASH_B)
        return transition
      }),
      rollback: vi.fn(async () => { throw new Error('Runtime must not be reconstructed during compensation.') }),
      deactivate: vi.fn(async () => ({ rollback: async () => undefined, finalize: async () => undefined })),
    } satisfies ProjectV5BrowserRuntimePublicationPort<{ readonly revisionId: string }>
    const gateway = {
      prepare: vi.fn(async () => Object.freeze({ revisionId: nextProject.revisionId })),
      activate: vi.fn(async () => {
        gatewayActive = published(nextProject, HASH_B)
        return gatewayStatus(nextProject, HASH_B)
      }),
      reactivate: vi.fn(async () => { throw new Error('There is no previous Gateway publication.') }),
      readStatus: vi.fn(async () => gatewayStatus(nextProject, HASH_B)),
      rollback: vi.fn(async () => { gatewayActive = null; return 'candidate-deactivated' as const }),
      deactivate: vi.fn(async () => inactiveGatewayStatus()),
      cleanupPrevious: vi.fn(async () => undefined),
    } satisfies ProjectV5GatewayPublicationPort<{ readonly revisionId: string }>
    const publication = createProjectPublicationCoordinatorV5({
      repository,
      runtime,
      gateway,
      configRevisionForProjectV5: async () => HASH_B,
      createCommitToken: () => 'commit-first',
    })

    await expect(publication.replace({ candidate: nextProject, expectedRevisionId: null })).rejects.toThrow('TEST_FIRST_FINALIZE')

    expect(transition.rollback).toHaveBeenCalledOnce()
    expect(runtime.rollback).not.toHaveBeenCalled()
    expect(gateway.reactivate).not.toHaveBeenCalled()
    expect(gateway.readStatus).toHaveBeenCalledTimes(2)
    expect(durable).toBeNull()
    expect(runtimeActive).toBeNull()
    expect(gatewayActive).toBeNull()
    expect(publication.readPublished()).toBeNull()
    expect(publication.isRecoveryRequired()).toBe(true)
  })

  it('restores real Browser runtime, repository, and Gateway to no publication after first finalization failure', async () => {
    const nextProject = project('revision-first-real-runtime', 'First real runtime')
    const runtime = createBrowserProjectRuntimeV5({
      gatewayId: 'gateway-1',
      scheduler: { now: () => 0, request: () => 1, cancel: () => undefined },
      createRunId: () => 'run-1',
      createCommandId: () => 'command-1',
      stream: {
        url: 'ws://runtime.test/runtime/ws',
        createWebSocket: () => { throw new Error('Socket was not expected in this test.') },
        nowMs: () => 100,
      },
      command: { fetch: async () => new Response(), nowMs: () => 100 },
      onDiagnostic: () => undefined,
    })
    let durable: PublishedProjectV5 | null = null
    let gatewayActive: PublishedProjectV5 | null = null
    const preparedRevision: PreparedProjectRevisionV5 = Object.freeze({
      revisionId: nextProject.revisionId,
      configRevision: HASH_B,
      project: nextProject,
    })
    const repository = {
      prepareRevision: vi.fn(async () => preparedRevision),
      materializePreparedProject: () => nextProject,
      discardPreparedRevision: vi.fn(async () => undefined),
      commitPreparedRevision: vi.fn(async (expectedRevisionId: string | null) => {
        expect(expectedRevisionId).toBeNull()
        durable = published(nextProject, HASH_B)
      }),
      finalizePublication: vi.fn(async () => { throw new Error('TEST_REAL_RUNTIME_FINALIZE') }),
      compensatePublication: vi.fn(async () => { durable = null }),
      readRevision: async () => null,
      readActive: async () => durable?.project ?? null,
      readPointer: async () => null,
      garbageCollect: vi.fn(async () => undefined),
    } satisfies ProjectRepositoryV5
    const gateway = {
      prepare: vi.fn(async () => Object.freeze({ revisionId: nextProject.revisionId })),
      activate: vi.fn(async () => {
        gatewayActive = published(nextProject, HASH_B)
        return gatewayStatus(nextProject, HASH_B)
      }),
      reactivate: vi.fn(async () => { throw new Error('There is no previous Gateway publication.') }),
      readStatus: vi.fn(async () => gatewayActive === null
        ? inactiveGatewayStatus()
        : gatewayStatus(gatewayActive.project, gatewayActive.configRevision)),
      rollback: vi.fn(async () => { gatewayActive = null; return 'candidate-deactivated' as const }),
      deactivate: vi.fn(async () => inactiveGatewayStatus()),
      cleanupPrevious: vi.fn(async () => undefined),
    } satisfies ProjectV5GatewayPublicationPort<{ readonly revisionId: string }>
    const publication = createProjectPublicationCoordinatorV5({
      repository,
      runtime,
      gateway,
      initialPublished: null,
      configRevisionForProjectV5: async () => HASH_B,
      createCommitToken: () => 'commit-first-real-runtime',
    })

    try {
      await expect(publication.replace({ candidate: nextProject, expectedRevisionId: null })).rejects.toThrow('TEST_REAL_RUNTIME_FINALIZE')
      expect(runtime.readActiveBundle()).toBeNull()
      expect(durable).toBeNull()
      expect(gatewayActive).toBeNull()
      expect(gateway.readStatus).toHaveBeenCalledTimes(2)
      expect(publication.readPublished()).toBeNull()
      expect(publication.isRecoveryRequired()).toBe(false)

      gateway.readStatus
        .mockResolvedValueOnce(gatewayStatus(nextProject, HASH_B))
        .mockRejectedValueOnce(new Error('Gateway rollback readback failed.'))
      await expect(publication.replace({ candidate: nextProject, expectedRevisionId: null })).rejects.toThrow('TEST_REAL_RUNTIME_FINALIZE')
      expect(runtime.readActiveBundle()).toBeNull()
      expect(durable).toBeNull()
      expect(gatewayActive).toBeNull()
      expect(publication.isRecoveryRequired()).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })

  it('hydrates a stable durable revision through runtime and Gateway using its stored config revision', async () => {
    const subject = hydrationHarness({ key: 'active', state: 'stable', revisionId: 'hydration-target', commitToken: 'stable-target' })
    const observed = vi.fn()
    subject.publication.subscribe(observed)

    await expect(subject.publication.hydrate()).resolves.toEqual(subject.target)

    expect(subject.repository.readRevision).toHaveBeenCalledWith(subject.target.revisionId)
    expect(subject.runtime.prepare).toHaveBeenCalledWith(subject.target.project, HASH_B)
    expect(subject.gateway.prepare).toHaveBeenCalledWith(subject.target.project, HASH_B, null)
    expect(subject.repository.finalizePublication).not.toHaveBeenCalled()
    expect(subject.publication.readPublished()).toEqual(subject.target)
    expect(observed).toHaveBeenCalledOnce()
  })

  it('converges two same-target hydration coordinators when this tab loses Gateway activation CAS', async () => {
    const subject = hydrationHarness(
      { key: 'active', state: 'stable', revisionId: 'hydration-target', commitToken: 'stable-target' },
      { healthyGatewayCasLoser: true },
    )

    await expect(subject.publication.hydrate()).resolves.toEqual(subject.target)

    expect(subject.gateway.readStatus).toHaveBeenCalled()
    expect(subject.gatewayActive()).toEqual(subject.target)
    expect(subject.publication.isRecoveryRequired()).toBe(false)
  })

  it('hydrates an empty durable pointer without creating a publication', async () => {
    const subject = hydrationHarness(null)

    await expect(subject.publication.hydrate()).resolves.toBeNull()

    expect(subject.repository.readRevision).not.toHaveBeenCalled()
    expect(subject.runtime.prepare).not.toHaveBeenCalled()
    expect(subject.gateway.prepare).not.toHaveBeenCalled()
  })

  it('finalizes an interrupted publishing pointer after restoring its durable target', async () => {
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    })

    await expect(subject.publication.hydrate()).resolves.toEqual(subject.target)

    expect(subject.repository.finalizePublication).toHaveBeenCalledWith('publishing-target')
    expect(subject.pointer()).toEqual({ key: 'active', state: 'stable', revisionId: 'hydration-target', commitToken: 'publishing-target' })
  })

  it('accepts an interrupted hydration finalization whose durable response is lost', async () => {
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    })
    subject.repository.finalizePublication.mockImplementationOnce(async () => {
      subject.setPointer({
        key: 'active',
        state: 'stable',
        revisionId: 'hydration-target',
        commitToken: 'publishing-target',
      })
      throw new Error('TEST_HYDRATION_FINALIZE_RESPONSE_LOST')
    })

    await expect(subject.publication.hydrate()).resolves.toEqual(subject.target)

    expect(subject.publication.readPublished()).toEqual(subject.target)
    expect(subject.runtimeActive()).toEqual(subject.target)
    expect(subject.gatewayActive()).toEqual(subject.target)
    expect(subject.publication.isRecoveryRequired()).toBe(false)
  })

  it('rolls back stable hydration when Gateway readback fails before publication', async () => {
    const subject = hydrationHarness({
      key: 'active', state: 'stable', revisionId: 'hydration-target', commitToken: 'stable-target',
    })
    subject.gateway.readStatus.mockRejectedValueOnce(new Error('TEST_HYDRATION_GATEWAY_READBACK'))

    await expect(subject.publication.hydrate()).rejects.toThrow('TEST_HYDRATION_GATEWAY_READBACK')

    expect(subject.publication.readPublished()).toBeNull()
    expect(subject.runtimeActive()).toBeNull()
    expect(subject.gatewayActive()).toBeNull()
    expect(subject.publication.isRecoveryRequired()).toBe(false)
  })

  it('compensates an interrupted publishing pointer to the previous durable project when target restoration fails', async () => {
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    }, { failTargetActivation: true })

    await expect(subject.publication.hydrate()).resolves.toEqual(subject.previous)

    expect(subject.repository.compensatePublication).toHaveBeenCalledWith('publishing-target')
    expect(subject.pointer()).toEqual({ key: 'active', state: 'stable', revisionId: 'hydration-previous', commitToken: 'stable-previous' })
    expect(subject.runtimeActive()).toEqual(subject.previous)
    expect(subject.gatewayActive()).toEqual(subject.previous)
  })

  it('rejects a corrupt durable pointer before runtime or Gateway restoration', async () => {
    const subject = hydrationHarness({ key: 'active', state: 'stable', revisionId: 'missing-revision', commitToken: 'stable-missing' })

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_HYDRATION_REVISION_MISSING' })

    expect(subject.runtime.prepare).not.toHaveBeenCalled()
    expect(subject.gateway.prepare).not.toHaveBeenCalled()
    expect(subject.publication.isRecoveryRequired()).toBe(true)
  })

  it('refuses empty hydration when another coordinator still owns Gateway authority', async () => {
    const subject = hydrationHarness(null, { staleActiveWhenEmpty: true })

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_GATEWAY_ROLLBACK_MISMATCH' })

    expect(subject.runtime.deactivate).not.toHaveBeenCalled()
    expect(subject.gateway.deactivate).not.toHaveBeenCalled()
    expect(subject.gateway.readStatus).toHaveBeenCalled()
    expect(subject.runtimeActive()).toEqual(subject.target)
    expect(subject.gatewayActive()).toEqual(subject.target)
    expect(subject.publication.isRecoveryRequired()).toBe(true)
  })

  it('preserves a first interrupted publishing pointer and enters recovery when its target cannot restore', async () => {
    const interrupted = {
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: null, previousCommitToken: null, commitToken: 'publishing-first',
    } as const
    const subject = hydrationHarness(interrupted, { failTargetActivation: true })

    await expect(subject.publication.hydrate()).rejects.toThrow('target activation failed')

    expect(subject.repository.compensatePublication).not.toHaveBeenCalled()
    expect(subject.pointer()).toEqual(interrupted)
    expect(subject.publication.isRecoveryRequired()).toBe(true)
  })

  it('preserves a first interrupted publishing pointer when its durable target is missing', async () => {
    const interrupted = {
      key: 'active', state: 'publishing', revisionId: 'missing-first-target',
      previousRevisionId: null, previousCommitToken: null, commitToken: 'publishing-first',
    } as const
    const subject = hydrationHarness(interrupted)

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_HYDRATION_REVISION_MISSING' })

    expect(subject.repository.compensatePublication).not.toHaveBeenCalled()
    expect(subject.pointer()).toEqual(interrupted)
    expect(subject.publication.isRecoveryRequired()).toBe(true)
  })

  it('rolls back a stable hydration when the exact durable pointer tuple moves during activation', async () => {
    const moved = { key: 'active', state: 'stable', revisionId: 'other-revision', commitToken: 'other-token' } as const
    const subject = hydrationHarness(
      { key: 'active', state: 'stable', revisionId: 'hydration-target', commitToken: 'stable-target' },
      { movePointerOnTargetCommit: moved },
    )

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(subject.events).toContain('runtime.rollback')
    expect(subject.publication.readPublished()).toBeNull()
  })

  it('does not finalize an interrupted pointer that moves during target restoration', async () => {
    const moved = { key: 'active', state: 'stable', revisionId: 'other-revision', commitToken: 'other-token' } as const
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    }, { movePointerOnTargetCommit: moved })

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(subject.repository.finalizePublication).not.toHaveBeenCalled()
    expect(subject.events).toContain('runtime.rollback')
    expect(subject.publication.isRecoveryRequired()).toBe(false)
  })

  it('rolls back compensated previous restoration when its exact stable tuple moves', async () => {
    const moved = { key: 'active', state: 'stable', revisionId: 'other-revision', commitToken: 'other-token' } as const
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    }, { failTargetActivation: true, movePointerOnPreviousCommit: moved })

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_ACTIVE_REVISION_CHANGED' })

    expect(subject.events).toContain('runtime.rollback')
    expect(subject.publication.isRecoveryRequired()).toBe(false)
    expect(subject.publication.readPublished()).toBeNull()
  })

  it('latches malformed durable pointer reads as recovery and notifies a snapshot of listeners once', async () => {
    const subject = hydrationHarness(null)
    subject.repository.readPointer.mockRejectedValueOnce(new ProjectRepositoryV5Error(
      'PROJECT_POINTER_INVALID', 'Stored pointer is malformed.',
    ))
    const later = vi.fn()
    const first = vi.fn()
    let unsubscribe: () => void = () => undefined
    unsubscribe = subject.publication.subscribe(() => {
      first()
      unsubscribe()
      subject.publication.subscribe(later)
    })

    await expect(subject.publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_POINTER_INVALID' })

    expect(subject.publication.isRecoveryRequired()).toBe(true)
    expect(subject.publication.readRecoveryError()).toMatchObject({ cause: expect.objectContaining({ code: 'PROJECT_POINTER_INVALID' }) })
    expect(first).toHaveBeenCalledOnce()
    expect(later).not.toHaveBeenCalled()
  })

  it('latches a truly malformed IndexedDB pointer row as recovery before runtime or Gateway work', async () => {
    const database = new ProjectDatabaseV5(`publication-malformed-${crypto.randomUUID()}`)
    const repository = createProjectRepositoryV5({ database })
    const runtime = {
      prepare: vi.fn(), apply: vi.fn(), commit: vi.fn(), rollback: vi.fn(),
      deactivate: vi.fn(async () => ({ rollback: async () => undefined, finalize: async () => undefined })),
    } satisfies ProjectV5BrowserRuntimePublicationPort
    const gateway = {
      prepare: vi.fn(), activate: vi.fn(), reactivate: vi.fn(), readStatus: vi.fn(), rollback: vi.fn(),
      deactivate: vi.fn(async () => inactiveGatewayStatus()), cleanupPrevious: vi.fn(),
    } satisfies ProjectV5GatewayPublicationPort
    const publication = createProjectPublicationCoordinatorV5({ repository, runtime, gateway })
    const observed = vi.fn()
    publication.subscribe(observed)
    try {
      await database.projectPointers.put({
        key: 'active', state: 'stable', revisionId: 42, commitToken: 'malformed',
      } as never)

      await expect(publication.hydrate()).rejects.toMatchObject({ code: 'PROJECT_POINTER_INVALID' })

      expect(publication.isRecoveryRequired()).toBe(true)
      expect(observed).toHaveBeenCalledOnce()
      expect(runtime.deactivate).not.toHaveBeenCalled()
      expect(gateway.deactivate).not.toHaveBeenCalled()
    } finally {
      database.close()
      await database.delete()
    }
  })

  it('finalizes publishing hydration cleanup in prerequisite order using the previous durable publication', async () => {
    const subject = hydrationHarness({
      key: 'active', state: 'publishing', revisionId: 'hydration-target',
      previousRevisionId: 'hydration-previous', previousCommitToken: 'stable-previous', commitToken: 'publishing-target',
    })

    await subject.publication.hydrate()
    await vi.waitFor(() => expect(subject.repository.garbageCollect).toHaveBeenCalledOnce())

    expect(subject.events).toEqual([
      'runtime.finalize',
      'gateway.cleanup:hydration-previous',
      'repository.gc',
    ])
  })

  it('publishes first, then coalesces the next publication behind an active cleanup drain', async () => {
    const subject = publicationHarness()
    let release!: () => void
    subject.runtimeTransition.finalize.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve }))
    const observed = vi.fn()
    subject.publication.subscribe(observed)

    const replacing = subject.publication.replace({ candidate: subject.nextProject, expectedRevisionId: subject.previous.revisionId })
    await expect(replacing).resolves.toEqual(published(subject.nextProject, HASH_B))
    expect(observed).toHaveBeenCalledOnce()
    expect(subject.publication.readCleanupStatus().pending[0]).toMatchObject({ kind: 'runtime-transition-finalize' })
    let overlappingSettled = false
    const overlapping = subject.publication.replace({
      candidate: subject.nextProject,
      expectedRevisionId: subject.nextProject.revisionId,
    }).then((result) => {
      overlappingSettled = true
      return result
    })
    await Promise.resolve()
    expect(overlappingSettled).toBe(false)
    expect(subject.runtimeTransition.finalize).toHaveBeenCalledOnce()
    release()
    await expect(overlapping).resolves.toEqual(published(subject.nextProject, HASH_B))
    await vi.waitFor(() => expect(subject.publication.readCleanupStatus().pending).toEqual([]))
    expect(subject.runtimeTransition.finalize).toHaveBeenCalledTimes(2)
  })
})
