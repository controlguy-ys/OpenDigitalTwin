import { describe, expect, it } from 'vitest'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { deriveCollisionPolicyV4 } from '../../../domain/collision/collision-policy-v4.js'
import type { HandoverDemoCoordinatorV4 } from '../../handover/v4/handover-demo-coordinator.js'
import { createHandoverDemoRuntimeStoreV4 } from '../../handover/v4/handover-demo-runtime-store.js'
import { buildInitialRobotRuntimeStatesV4 } from '../../robot/v4/robot-runtime-registry.js'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector.js'
import {
  createBrowserRuntimeBundleStoreV4,
  type ActiveBrowserRuntimeBundleV4,
  type BrowserHandoverRuntimeResourcesV4,
  type BrowserJobRuntimeResourcesV4,
} from './browser-runtime-bundle-store-v4.js'
import { createHackathonHandoverSampleV4 } from './hackathon-handover-sample-v4.js'

function handover(): BrowserHandoverRuntimeResourcesV4 {
  const project = createHackathonHandoverSampleV4({
    projectId: 'project-runtime-bundle-handover',
    revisionId: 'revision-runtime-bundle-handover',
    nowIso: '2026-07-21T06:00:00.000Z',
  })
  const coordinator: HandoverDemoCoordinatorV4 = {
    canHandle: () => true,
    canStart: () => true,
    start: () => ({ runId: 'handover-run' }),
    canCancel: () => true,
    cancel: () => undefined,
    canReset: () => true,
    reset: () => undefined,
    setGripConfirmTimeoutInjection: () => undefined,
    dispose: () => undefined,
  }
  return {
    store: createHandoverDemoRuntimeStoreV4(project),
    coordinator,
  }
}

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

  it('validates every required optional Handover Coordinator capability', () => {
    const requiredMethods = [
      'canHandle',
      'canStart',
      'start',
      'canCancel',
      'cancel',
      'canReset',
      'reset',
      'setGripConfirmTimeoutInjection',
      'dispose',
    ] as const

    for (const method of requiredMethods) {
      const store = createBrowserRuntimeBundleStoreV4()
      const invalid = active(`revision-handover-missing-${method}`)
      const validHandover = handover()
      const coordinator = { ...validHandover.coordinator } as Record<string, unknown>
      delete coordinator[method]
      const candidate = {
        ...invalid,
        jobs: {
          ...invalid.jobs,
          handover: {
            ...validHandover,
            coordinator,
          },
        },
      }

      expect(() => store.getState().replaceActive(
        candidate as unknown as ActiveBrowserRuntimeBundleV4,
      )).toThrow(/BROWSER_RUNTIME_BUNDLE_INVALID/)
      expect(store.getState().active).toBeNull()
    }
  })
})
