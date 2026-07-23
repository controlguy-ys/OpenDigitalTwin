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
  ProjectRepositoryV5,
} from './project-v5-repository.js'
import {
  createProjectPublicationCoordinatorV5,
  type ProjectV5BrowserRuntimePublicationPort,
  type ProjectV5GatewayPublicationPort,
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
      configRevision, readinessCode: 'READY',
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
      configRevision: null, readinessCode: 'NO_ACTIVE_REVISION',
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

function publicationHarness(failurePoint: FailurePoint | null = null) {
  const previousProject = project('revision-a', 'Previous')
  const nextProject = project('revision-b', 'Next')
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
      expect(expectedRevisionId).toBe(previous.revisionId)
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
    readPointer: async () => null,
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
    }),
    cleanupPrevious: vi.fn(async (previousPublication: PublishedProjectV5) => {
      events.push(`gateway.cleanup:${previousPublication.revisionId}`)
    }),
  } satisfies ProjectV5GatewayPublicationPort<GatewayCandidate>

  const configRevisionForProjectV5 = vi.fn(async (candidate: WorkcellProjectV5) => {
    events.push(`hash:${candidate.revisionId}`)
    return HASH_B
  })
  const cleanupDiagnostics = vi.fn()
  const publication = createProjectPublicationCoordinatorV5({
    repository,
    runtime: runtimePort,
    gateway,
    initialPublished: previous,
    configRevisionForProjectV5,
    createCommitToken: () => 'commit-b',
    onCleanupIssue: cleanupDiagnostics,
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
    expect(harness.gateway.prepare).toHaveBeenCalledWith(harness.nextProject, HASH_B)
    expect(harness.events).toEqual([
      'hash:revision-b',
      `repository.prepare:revision-b:${HASH_B}`,
      `runtime.prepare:revision-b:${HASH_B}`,
      `gateway.prepare:revision-b:${HASH_B}`,
      'runtime.apply:revision-b',
      'gateway.activate:revision-b',
      'repository.commit:revision-b',
      'runtime.commit:revision-b',
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
    expect(harness.gateway.readStatus).toHaveBeenCalledOnce()
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
        { kind: 'repository-garbage-collection', revisionId: 'revision-b', attemptCount: 1 },
      ],
    })
    await Promise.all([harness.publication.retryCleanup(), harness.publication.retryCleanup()])
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
    } satisfies ProjectV5BrowserRuntimePublicationPort<{ readonly revisionId: string }>
    const gateway = {
      prepare: vi.fn(async () => Object.freeze({ revisionId: nextProject.revisionId })),
      activate: vi.fn(async () => {
        gatewayActive = published(nextProject, HASH_B)
        return gatewayStatus(nextProject, HASH_B)
      }),
      reactivate: vi.fn(async () => { throw new Error('There is no previous Gateway publication.') }),
      readStatus: vi.fn(async () => gatewayStatus(nextProject, HASH_B)),
      rollback: vi.fn(async () => { gatewayActive = null }),
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
    expect(gateway.readStatus).toHaveBeenCalledOnce()
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
      readStatus: vi.fn(async () => inactiveGatewayStatus()),
      rollback: vi.fn(async () => { gatewayActive = null }),
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
      expect(gateway.readStatus).toHaveBeenCalledOnce()
      expect(publication.readPublished()).toBeNull()
      expect(publication.isRecoveryRequired()).toBe(false)

      gateway.readStatus.mockRejectedValueOnce(new Error('Gateway rollback readback failed.'))
      await expect(publication.replace({ candidate: nextProject, expectedRevisionId: null })).rejects.toThrow('TEST_REAL_RUNTIME_FINALIZE')
      expect(runtime.readActiveBundle()).toBeNull()
      expect(durable).toBeNull()
      expect(gatewayActive).toBeNull()
      expect(publication.isRecoveryRequired()).toBe(true)
    } finally {
      await runtime.dispose()
    }
  })
})
