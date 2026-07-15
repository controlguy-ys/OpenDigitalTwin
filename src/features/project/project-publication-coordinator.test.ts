import { expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type {
  PreparedProjectRevisionRecordV1,
  ProjectRevisionCandidateV1,
  ProjectRevisionRepository,
} from './project-revision-repository'
import { repositoryProjectFixture } from './project-revision-repository.test-support'
import {
  createProjectPublicationCoordinator,
  type AppliedProjectRuntimePublicationV1,
  type ProjectRuntimeV3,
} from './project-publication-coordinator'

function publication(
  overrides: Partial<AppliedProjectRuntimePublicationV1> = {},
): AppliedProjectRuntimePublicationV1 {
  return {
    commit: vi.fn(),
    rollback: vi.fn(),
    cleanup: vi.fn(),
    ...overrides,
  }
}

function prepared(revisionId: string): PreparedProjectRevisionRecordV1 {
  return Object.freeze({
    storedRevision: {
      revisionId,
      projectId: 'project-a',
      createdAt: '2026-07-15T00:00:00.000Z',
      snapshot: {} as PreparedProjectRevisionRecordV1['storedRevision']['snapshot'],
    },
  })
}

function repository(overrides: Partial<ProjectRevisionRepository> = {}): ProjectRevisionRepository {
  return {
    createCandidate: vi.fn(),
    prepareRevision: vi.fn(async () => prepared('revision-b')),
    materializePreparedRuntime: vi.fn(),
    discardPreparedRevision: vi.fn(),
    commitPreparedRevision: vi.fn(async () => undefined),
    finalizePublication: vi.fn(async () => undefined),
    compensatePublication: vi.fn(async () => undefined),
    activatePreparedSources: vi.fn(async () => undefined),
    readRevision: vi.fn(async () => null),
    adoptHydratedRevision: vi.fn(),
    readPointer: vi.fn(async () => null),
    garbageCollect: vi.fn(async () => undefined),
    ...overrides,
  }
}

it('keeps the previous bundle when runtime preparation fails', async () => {
  const projectA = await repositoryProjectFixture({ name: 'Cell A' })
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn()
      .mockResolvedValueOnce({ snapshot: projectA })
      .mockRejectedValueOnce(new Error('prepare failed')),
    apply: vi.fn(() => publication()),
    dispose: vi.fn(),
  }
  const repo = repository({
    materializePreparedRuntime: vi.fn(() => {
      return {
        ...structuredClone(projectA),
        manifest: { ...projectA.manifest, name: 'Cell B' },
      }
    }),
  })
  const coordinator = createProjectPublicationCoordinator({
    repository: repo,
    runtime,
    createCommitToken: () => 'commit-token',
  })
  await coordinator.restorePublished({
    revisionId: 'revision-a',
    snapshot: projectA,
    generation: 1,
  })

  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: 'revision-a',
    generation: 2,
  })).rejects.toThrow('prepare failed')

  expect(coordinator.readPublished()?.snapshot.manifest.name).toBe('Cell A')
  expect(repo.commitPreparedRevision).not.toHaveBeenCalled()
  expect(coordinator.isRecoveryRequired()).toBe(false)
})

it('locks durable edits when finalization fails after runtime publication', async () => {
  const projectB = await repositoryProjectFixture({ name: 'Cell B' })
  const repo = repository({
    materializePreparedRuntime: vi.fn(() => projectB),
    finalizePublication: vi.fn(async () => {
      throw new Error('finalize failed')
    }),
  })
  const application = publication()
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn(() => application),
    dispose: vi.fn(),
  }
  const coordinator = createProjectPublicationCoordinator({
    repository: repo,
    runtime,
    createCommitToken: () => 'commit-token',
  })

  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: null,
    generation: 1,
  })).rejects.toThrow('finalize failed')

  expect(runtime.apply).toHaveBeenCalledOnce()
  expect(application.rollback).toHaveBeenCalledOnce()
  expect(application.commit).not.toHaveBeenCalled()
  expect(application.cleanup).not.toHaveBeenCalled()
  expect(coordinator.readPublished()).toBeNull()
  expect(repo.compensatePublication).not.toHaveBeenCalled()
  expect(coordinator.isRecoveryRequired()).toBe(true)
  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: 'revision-b',
    generation: 2,
  })).rejects.toMatchObject({ code: 'PROJECT_RECOVERY_REQUIRED' })
})

it('rolls runtime state back without notification when source activation fails', async () => {
  const projectB = await repositoryProjectFixture({ name: 'Cell B' })
  const repo = repository({
    materializePreparedRuntime: vi.fn(() => projectB),
    activatePreparedSources: vi.fn(async () => {
      throw new Error('activation failed')
    }),
  })
  const application = publication()
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn(() => application),
    dispose: vi.fn(),
  }
  const coordinator = createProjectPublicationCoordinator({
    repository: repo,
    runtime,
    createCommitToken: () => 'commit-token',
  })

  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: null,
    generation: 1,
  })).rejects.toThrow('activation failed')

  expect(repo.finalizePublication).toHaveBeenCalledOnce()
  expect(application.rollback).toHaveBeenCalledOnce()
  expect(application.commit).not.toHaveBeenCalled()
  expect(application.cleanup).not.toHaveBeenCalled()
  expect(coordinator.readPublished()).toBeNull()
  expect(coordinator.isRecoveryRequired()).toBe(true)
})

it('requires reload when runtime publication throws after durable commit', async () => {
  const projectB = await repositoryProjectFixture({ name: 'Cell B' })
  const repo = repository({
    materializePreparedRuntime: vi.fn(() => projectB),
  })
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn(() => {
      throw new Error('runtime publish failed')
    }),
    dispose: vi.fn(),
  }
  const coordinator = createProjectPublicationCoordinator({
    repository: repo,
    runtime,
    createCommitToken: () => 'commit-token',
  })

  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: null,
    generation: 1,
  })).rejects.toThrow('runtime publish failed')

  expect(repo.compensatePublication).not.toHaveBeenCalled()
  expect(runtime.dispose).not.toHaveBeenCalled()
  expect(coordinator.isRecoveryRequired()).toBe(true)
})

it('keeps the new bundle authoritative when post-commit cleanup throws', async () => {
  const projectA = await repositoryProjectFixture({ name: 'Cell A' })
  const projectB = await repositoryProjectFixture({ name: 'Cell B' })
  const repo = repository({ materializePreparedRuntime: vi.fn(() => projectB) })
  const firstPublication = publication()
  const cleanupFailure = publication({
    cleanup: vi.fn(() => { throw new Error('old cleanup failed') }),
  })
  const runtime: ProjectRuntimeV3<{ snapshot: WorkcellProjectSnapshotV3 }> = {
    prepare: vi.fn(async (snapshot) => ({ snapshot })),
    apply: vi.fn()
      .mockReturnValueOnce(firstPublication)
      .mockReturnValueOnce(cleanupFailure),
    dispose: vi.fn(),
  }
  const coordinator = createProjectPublicationCoordinator({
    repository: repo,
    runtime,
    createCommitToken: () => 'commit-token',
  })
  await coordinator.restorePublished({
    revisionId: 'revision-a',
    snapshot: projectA,
    generation: 1,
  })

  await expect(coordinator.replace({
    candidate: {} as ProjectRevisionCandidateV1,
    expectedRevisionId: 'revision-a',
    generation: 2,
  })).resolves.toMatchObject({ revisionId: 'revision-b' })

  expect(coordinator.readPublished()?.snapshot.manifest.name).toBe('Cell B')
  expect(cleanupFailure.commit).toHaveBeenCalledOnce()
  expect(cleanupFailure.rollback).not.toHaveBeenCalled()
  expect(coordinator.isRecoveryRequired()).toBe(false)
})
