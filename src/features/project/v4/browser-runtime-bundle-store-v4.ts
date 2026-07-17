import {
  failProjectV4,
  validateWorkcellProjectV4,
  type RevisionIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  validateCollisionPolicyV4,
  type CollisionPolicyV4,
} from '../../../domain/collision/collision.js'
import type { RobotJobExecutorV4 } from '../../jobs/v4/job-executor.js'
import type { RobotJobPlaybackControllerV4 } from '../../jobs/v4/simulation-clock.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import { createStore, type StoreApi } from 'zustand/vanilla'

export interface BrowserJobRuntimeResourcesV4 {
  readonly executor: RobotJobExecutorV4
  readonly playback: RobotJobPlaybackControllerV4
  dispose(): void
}

export interface ActiveBrowserRuntimeBundleV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly collisionPolicy: CollisionPolicyV4
  readonly jobs: BrowserJobRuntimeResourcesV4
}

export interface BrowserRuntimeBundleCheckpointV4 {
  readonly kind: 'browser-runtime-bundle-checkpoint-v4'
}

export interface BrowserRuntimeBundleStoreStateV4 {
  readonly projectRevisionId: RevisionIdV4 | null
  readonly active: ActiveBrowserRuntimeBundleV4 | null
  replaceActive(active: ActiveBrowserRuntimeBundleV4): void
  captureCheckpoint(): BrowserRuntimeBundleCheckpointV4
  restoreCheckpoint(checkpoint: BrowserRuntimeBundleCheckpointV4): void
}

function bundleFailureV4(code: string, message: string): never {
  failProjectV4(
    code,
    '$.activeRuntimeBundle',
    message,
    'Publish one complete Project V4 runtime bundle and try again.',
  )
}

function inspectActiveBundleV4(active: ActiveBrowserRuntimeBundleV4): void {
  if (active === null || typeof active !== 'object') {
    bundleFailureV4(
      'BROWSER_RUNTIME_BUNDLE_INVALID',
      'Active browser runtime bundle must be an object.',
    )
  }
  const project = validateWorkcellProjectV4(active.project)
  validateCollisionPolicyV4(active.collisionPolicy)
  if (active.sceneRuntime.projectRevisionId !== project.revisionId) {
    bundleFailureV4(
      'BROWSER_RUNTIME_BUNDLE_REVISION_MISMATCH',
      'Project and Scene runtime revisions must match.',
    )
  }
  if (
    active.jobs === null
    || typeof active.jobs !== 'object'
    || typeof active.jobs.dispose !== 'function'
    || typeof active.jobs.playback?.quiesce !== 'function'
    || typeof active.jobs.playback?.resume !== 'function'
  ) {
    bundleFailureV4(
      'BROWSER_RUNTIME_BUNDLE_INVALID',
      'Active browser runtime bundle must own complete Job resources.',
    )
  }
}

export function createBrowserRuntimeBundleStoreV4(
): StoreApi<BrowserRuntimeBundleStoreStateV4> {
  const checkpoints = new WeakMap<object, BrowserRuntimeBundleStoreStateV4>()

  return createStore<BrowserRuntimeBundleStoreStateV4>()((set, get) => ({
    projectRevisionId: null,
    active: null,
    replaceActive: (active) => {
      inspectActiveBundleV4(active)
      set((state) => ({
        ...state,
        projectRevisionId: active.project.revisionId,
        active,
      }), true)
    },
    captureCheckpoint: () => {
      const checkpoint = Object.freeze({
        kind: 'browser-runtime-bundle-checkpoint-v4' as const,
      })
      checkpoints.set(checkpoint, get())
      return checkpoint
    },
    restoreCheckpoint: (checkpoint) => {
      if (checkpoint === null || typeof checkpoint !== 'object') {
        bundleFailureV4(
          'BROWSER_RUNTIME_BUNDLE_CHECKPOINT_INVALID',
          'Runtime bundle checkpoint is not owned by this store.',
        )
      }
      const captured = checkpoints.get(checkpoint)
      if (captured === undefined) {
        bundleFailureV4(
          'BROWSER_RUNTIME_BUNDLE_CHECKPOINT_INVALID',
          'Runtime bundle checkpoint is not owned by this store.',
        )
      }
      set(captured, true)
    },
  }))
}
