import { describe, expect, it, vi } from 'vitest'

import {
  validateRuntimeGatewayStatusV1,
  type RuntimeGatewayStatusV1,
} from '../../../core/runtime-protocol/gateway-status-v1.js'
import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
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
    commit: vi.fn((candidate: RuntimeCandidate) => {
      events.push(`runtime.commit:${candidate.revisionId}`)
      failure(failurePoint, 'runtime-commit')
      runtimeActive = published(candidate.project, candidate.configRevision)
    }),
    rollback: vi.fn(async (candidate: RuntimeCandidate) => {
      events.push(`runtime.rollback:${candidate.revisionId}`)
      runtimeActive = previous
    }),
  } satisfies ProjectV5BrowserRuntimePublicationPort<RuntimeCandidate>

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
  const publication = createProjectPublicationCoordinatorV5({
    repository,
    runtime,
    gateway,
    initialPublished: previous,
    configRevisionForProjectV5,
    createCommitToken: () => 'commit-b',
  })
  return {
    previous,
    nextProject,
    repository,
    runtime,
    gateway,
    configRevisionForProjectV5,
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
})
