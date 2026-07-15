import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkcellProjectSnapshotV3 } from '../../domain/project/project-v3'
import type { StoredWorkcellProjectSnapshotProjectionV3 } from '../project/project-db'
import type { ActiveProjectMutationRecipeV1 } from '../project/project-mutation-service'
import { repositoryProjectFixture } from '../project/project-revision-repository.test-support'
import { createJobCommandService } from './job-command-service'

function pose(id: string, jointOne: number) {
  return {
    id,
    name: id,
    anglesDeg: [jointOne, 0, 0, 0, 0, 0] as const,
    durationMs: 1_000,
    easing: 'easeInOut' as const,
    speedPercentToNext: 100,
  }
}

describe('JobCommandService', () => {
  let snapshot: WorkcellProjectSnapshotV3
  let recipeCount: number
  let nextId: number

  beforeEach(async () => {
    snapshot = await repositoryProjectFixture()
    snapshot = { ...snapshot, simulation: {
      activeJobId: 'job-a',
      jobs: [{
        id: 'job-a',
        name: 'Pick Cups',
        revision: 7,
        poses: [pose('pose-1', 0), pose('pose-2', 20), pose('pose-3', 40)],
      }],
    } }
    recipeCount = 0
    nextId = 0
  })

  function harness() {
    const replaceFromActive = vi.fn(async (recipe: ActiveProjectMutationRecipeV1) => {
      recipeCount += 1
      snapshot = recipe(
        structuredClone(snapshot) as unknown as StoredWorkcellProjectSnapshotProjectionV3,
      ) as unknown as WorkcellProjectSnapshotV3
    })
    const service = createJobCommandService({
      mutationService: {
        replaceFromActive,
        readPublished: () => ({ snapshot }) as never,
      },
      createId: () => `generated-${++nextId}`,
      readAnglesDeg: () => [1, 2, 3, 4, 5, 6],
    })
    return { replaceFromActive, service }
  }

  it('moves and deletes poses atomically while recomputing canonical durations', async () => {
    const { service } = harness()

    await service.movePose('job-a', 'pose-3', 0)
    expect(recipeCount).toBe(1)
    expect(snapshot.simulation.jobs[0]?.poses.map(({ id }) => id)).toEqual([
      'pose-3', 'pose-1', 'pose-2',
    ])
    expect(snapshot.simulation.jobs[0]?.revision).toBe(8)
    expect(snapshot.simulation.jobs[0]?.poses[0]?.durationMs).toBeCloseTo(222.222, 2)

    await service.deletePose('job-a', 'pose-2')
    expect(recipeCount).toBe(2)
    expect(snapshot.simulation.jobs[0]?.poses.map(({ id }) => id)).toEqual([
      'pose-3', 'pose-1',
    ])
    expect(snapshot.simulation.jobs[0]?.revision).toBe(9)
    expect(snapshot.simulation.jobs[0]?.poses[1]?.durationMs).toBe(1_000)
  })

  it('captures a pose in the active Project Job through one recipe', async () => {
    snapshot = { ...snapshot, simulation: {
      activeJobId: 'job-a',
      jobs: [{ id: 'job-a', name: 'Pick Cups', revision: 1, poses: [] }],
    } }
    const { service } = harness()

    await expect(service.saveCurrentPose('Approach')).resolves.toBe('generated-1')

    expect(recipeCount).toBe(1)
    expect(snapshot.simulation.jobs[0]).toMatchObject({ revision: 2 })
    expect(snapshot.simulation.jobs[0]?.poses).toEqual([{
      id: 'generated-1',
      name: 'Approach',
      anglesDeg: [1, 2, 3, 4, 5, 6],
      durationMs: 1_000,
      easing: 'easeInOut',
      speedPercentToNext: 100,
    }])
  })

  it('creates, selects, renames, duplicates, and deletes Jobs in Project V3', async () => {
    const { service } = harness()

    const createdId = await service.createJob('Inspection')
    await service.setActiveJob(createdId)
    await service.renameJob(createdId, 'Inspection A')
    const duplicateId = await service.duplicateJob(createdId)
    await service.deleteJob(createdId)

    expect(snapshot.simulation.activeJobId).toBe(duplicateId)
    expect(snapshot.simulation.jobs.map(({ id }) => id)).toEqual(['job-a', duplicateId])
    expect(snapshot.simulation.jobs[1]).toMatchObject({
      id: duplicateId,
      name: 'Inspection A Copy',
      revision: 1,
    })
    expect(recipeCount).toBe(5)
  })

  it('rejects out-of-range speed without submitting a Project recipe', async () => {
    const { replaceFromActive, service } = harness()

    await expect(service.setPoseSpeed('job-a', 'pose-1', 0)).rejects.toThrow(
      /within \[1, 100\]/i,
    )
    expect(replaceFromActive).not.toHaveBeenCalled()
  })
})
