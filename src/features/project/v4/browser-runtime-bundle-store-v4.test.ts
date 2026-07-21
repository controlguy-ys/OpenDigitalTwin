import { describe, expect, it } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { deriveCollisionPolicyV4 } from '../../../domain/collision/collision-policy-v4.js'
import { buildInitialRobotRuntimeStatesV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import {
  createBrowserRuntimeBundleStoreV4,
  type ActiveBrowserRuntimeBundleV4,
  type BrowserJobRuntimeResourcesV4,
} from './browser-runtime-bundle-store-v4.js'

function jobs(): BrowserJobRuntimeResourcesV4 {
  return {
    executor: {
      startJob: () => ({ runId: 'run-1' }),
      advanceAll: async () => undefined,
      cancelRobotJob: () => undefined,
      readState: () => { throw new Error('unused') },
      waitForTerminal: async () => { throw new Error('unused') },
      reset: () => undefined,
      shutdown: () => undefined,
    },
    playback: {
      startJob: () => ({ runId: 'run-1' }),
      cancelRobotJob: () => undefined,
      ensureRunning: () => undefined,
      quiesce: async () => undefined,
      resume: () => undefined,
      dispose: () => undefined,
    },
    handover: null,
    dispose: () => undefined,
  }
}

function active(revisionId: string): ActiveBrowserRuntimeBundleV4 {
  const project = { ...makeMinimalWorkcellProjectV4(), revisionId }
  const sceneRuntime = selectSceneRuntimeV4(project, {
    projectRevisionId: revisionId,
    robots: buildInitialRobotRuntimeStatesV4(project),
  })
  return Object.freeze({
    project,
    sceneRuntime,
    collisionPolicy: deriveCollisionPolicyV4(
      project.robots,
      project.robotDefinitions,
      { enabled: true, nearMissMarginM: 0.05 },
    ),
    jobs: jobs(),
  })
}

describe('Browser runtime bundle store V4', () => {
  it('owns an exact checkpoint and restores the prior active bundle', () => {
    const store = createBrowserRuntimeBundleStoreV4()
    const first = active('revision-a')
    const second = active('revision-b')
    store.getState().replaceActive(first)
    const checkpoint = store.getState().captureCheckpoint()
    const before = store.getState()

    store.getState().replaceActive(second)
    store.getState().restoreCheckpoint(checkpoint)

    expect(store.getState()).toBe(before)
    expect(store.getState().active).toBe(first)
    expect(store.getState().projectRevisionId).toBe('revision-a')
  })

  it('rejects mismatched Scene revisions and foreign checkpoints pre-mutation', () => {
    const store = createBrowserRuntimeBundleStoreV4()
    const valid = active('revision-a')
    store.getState().replaceActive(valid)
    const before = store.getState()
    const mismatched = {
      ...valid,
      sceneRuntime: active('revision-b').sceneRuntime,
    }

    expect(() => store.getState().replaceActive(mismatched))
      .toThrow(/BROWSER_RUNTIME_BUNDLE_REVISION_MISMATCH/)
    const foreignCheckpoint = createBrowserRuntimeBundleStoreV4()
      .getState()
      .captureCheckpoint()
    expect(() => store.getState().restoreCheckpoint(foreignCheckpoint))
      .toThrow(/BROWSER_RUNTIME_BUNDLE_CHECKPOINT_INVALID/)
    expect(store.getState()).toBe(before)
  })

  it('rejects an incomplete optional Handover resource boundary', () => {
    const store = createBrowserRuntimeBundleStoreV4()
    const invalid = active('revision-handover-invalid')
    const candidate = {
      ...invalid,
      jobs: {
        ...invalid.jobs,
        handover: {},
      },
    }

    expect(() => store.getState().replaceActive(
      candidate as ActiveBrowserRuntimeBundleV4,
    )).toThrow(/BROWSER_RUNTIME_BUNDLE_INVALID/)
    expect(store.getState().active).toBeNull()
  })
})
