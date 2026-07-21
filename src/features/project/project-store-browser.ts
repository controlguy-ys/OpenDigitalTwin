import { useStore } from 'zustand'
import type { StoreApi } from 'zustand/vanilla'

import type {
  RobotDefinitionV4,
  WorkcellProjectV4,
} from '../../core/project-v4/index.js'
import { createProjectHashService, type ProjectHashService } from '../../lib/hash/sha256.js'
import { stepImportClient } from '../import/StepImportClient.js'
import { createCoordinateDisplayStoreV4 } from '../frames/v4/coordinate-display-store.js'
import { createInteractionStoreV4 } from '../interaction/v4/interaction-store.js'
import {
  createHandoverDemoCoordinatorV4,
  type HandoverDemoCoordinatorV4,
} from '../handover/v4/handover-demo-coordinator.js'
import { createHandoverDemoRuntimeStoreV4 } from '../handover/v4/handover-demo-runtime-store.js'
import {
  createRobotJobExecutorV4,
  unavailableJobActionExecutionPortV4,
} from '../jobs/v4/job-executor.js'
import { createJobCommandServiceV4 } from '../jobs/v4/job-command-service.js'
import { createJobRuntimeStoreV4 } from '../jobs/v4/job-runtime-store.js'
import {
  createRobotJobPlaybackControllerV4,
  type AnimationFrameSchedulerV4,
} from '../jobs/v4/simulation-clock.js'
import {
  BUILTIN_CRB_DEFINITION_ID_V4,
  prepareBuiltinCrbGeometryV4,
} from '../robot/v4/builtin-crb-definition.js'
import {
  BUILTIN_NED2_DEFINITION_ID_V4,
  prepareBuiltinNed2GeometryV4,
} from '../robot/v4/builtin-ned2-definition.js'
import {
  createRobotDefinitionGeometryRepositoryV4,
  type PreparedRobotDefinitionGeometryV4,
  type RobotDefinitionGeometryRepositoryV4,
} from '../robot/v4/robot-definition-geometry-repository.js'
import {
  createRobotRuntimeRegistryV4,
  type RobotRuntimeRegistryV4,
} from '../robot/v4/robot-runtime-registry.js'
import {
  createRobotImportControllerV4,
  createRobotImportGeometryResolverV4,
  type RobotImportControllerV4,
  type RobotStepImportParserV4,
} from '../robot/v4/robot-step-import-v4.js'
import {
  createRobotStepAssetRepositoryV4,
  type RobotStepAssetRepositoryV4,
} from '../robot/v4/robot-step-asset-repository-v4.js'
import {
  createSceneCommandServiceV4,
  type SceneCommandServiceV4,
} from '../scene/v4/scene-command-service.js'
import { selectSceneRuntimeV4 } from '../scene/v4/scene-runtime-selector.js'
import {
  createSceneRuntimeStoreV4,
  type SceneRuntimeStoreV4,
} from '../scene/v4/scene-runtime-store.js'
import {
  createViewportPreferenceStoreV4,
  type ViewportPreferenceStoreV4,
} from '../viewport/v4/viewport-preference-store.js'
import {
  createShellLayoutStoreV4,
  type ShellLayoutStoreV4,
} from '../ui/v4/shell-layout-store.js'
import {
  createBrowserUserPromptPortV4,
  type UserPromptPortV4,
} from '../ui/v4/user-prompt-port.js'
import { createBrowserProjectRuntimeV4 } from './v4/browser-project-runtime-v4.js'
import {
  createBrowserRuntimeBundleStoreV4,
  type BrowserRuntimeBundleStoreStateV4,
} from './v4/browser-runtime-bundle-store-v4.js'
import { createDefaultProjectV4 } from './v4/default-project-v4.js'
import { isHackathonHandoverSampleV4 } from './v4/hackathon-handover-sample-v4.js'
import { decodeProjectV4, encodeProjectV4 } from './v4/project-v4-codec.js'
import { ProjectDatabaseV4 } from './v4/project-v4-db.js'
import {
  createProjectMutationServiceV4,
  type ProjectMutationServiceV4,
} from './v4/project-v4-mutation-service.js'
import { createProjectPublicationCoordinatorV4 } from './v4/project-v4-publication.js'
import { createProjectRepositoryV4 } from './v4/project-v4-repository.js'
import {
  createProjectStoreV4,
  type ProjectStoreStateV4,
  type ProjectStoreV4,
} from './v4/project-store-v4.js'
import { createRuntimePublicationBarrierV4 } from './v4/runtime-publication-barrier-v4.js'
import {
  createBrowserProjectFileCommandPortV4,
  type ProjectFileCommandPortV4,
} from './v4/project-file-command-port.js'
import type { CoordinateDisplayStoreStateV4 } from '../frames/v4/coordinate-display-store.js'
import type { InteractionStoreStateV4 } from '../interaction/v4/interaction-store.js'
import type { JobCommandServiceV4 } from '../jobs/v4/job-command-service.js'
import type { JobRuntimeStoreV4 } from '../jobs/v4/job-runtime-store.js'

export interface BrowserProjectResourcesV4 {
  readonly projectStore: ProjectStoreV4
  readonly mutations: ProjectMutationServiceV4
  readonly robots: StoreApi<RobotRuntimeRegistryV4>
  readonly jobs: StoreApi<JobRuntimeStoreV4>
  readonly scene: StoreApi<SceneRuntimeStoreV4>
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplay: StoreApi<CoordinateDisplayStoreStateV4>
  readonly viewportPreferences: ViewportPreferenceStoreV4
  readonly shellLayoutStore: ShellLayoutStoreV4
  readonly geometry: RobotDefinitionGeometryRepositoryV4
  readonly runtimeBundle: StoreApi<BrowserRuntimeBundleStoreStateV4>
  readonly sceneCommands: SceneCommandServiceV4
  readonly jobCommands: JobCommandServiceV4
  readonly projectFiles: ProjectFileCommandPortV4
  readonly userPrompt: UserPromptPortV4
  readonly robotImport?: RobotImportControllerV4
}

export interface BrowserProjectResourcesOptionsV4 {
  readonly database?: ProjectDatabaseV4
  readonly nowIso?: () => string
  readonly createId?: () => string
  readonly animationScheduler?: AnimationFrameSchedulerV4
  readonly resolveDefinitionGeometry?: (
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ) => Promise<PreparedRobotDefinitionGeometryV4 | null>
  readonly projectFiles?: ProjectFileCommandPortV4
  readonly userPrompt?: UserPromptPortV4
  readonly robotStepAssets?: RobotStepAssetRepositoryV4
  readonly robotStepParser?: RobotStepImportParserV4
  readonly robotHash?: ProjectHashService
}

function browserAnimationSchedulerV4(): AnimationFrameSchedulerV4 {
  return {
    now: () => performance.now(),
    request: (callback) => requestAnimationFrame(callback),
    cancel: (handle) => cancelAnimationFrame(handle),
  }
}

function createScopedAnimationSchedulerV4(
  delegate: AnimationFrameSchedulerV4,
): { readonly scheduler: AnimationFrameSchedulerV4; dispose(): void } {
  const handles = new Set<number>()
  let disposed = false
  const scheduler: AnimationFrameSchedulerV4 = {
    now: () => delegate.now(),
    request(callback) {
      if (disposed) throw new Error('Handover animation scheduler is disposed.')
      let handle = -1
      handle = delegate.request((simulationMs) => {
        handles.delete(handle)
        if (!disposed) callback(simulationMs)
      })
      handles.add(handle)
      return handle
    },
    cancel(handle) {
      handles.delete(handle)
      delegate.cancel(handle)
    },
  }
  return Object.freeze({
    scheduler,
    dispose() {
      if (disposed) return
      disposed = true
      for (const handle of handles) delegate.cancel(handle)
      handles.clear()
    },
  })
}

function requirePublishedProjectV4(
  mutations: ProjectMutationServiceV4,
): WorkcellProjectV4 {
  const project = mutations.readPublished()?.project
  if (project === undefined) {
    throw new Error('No Project V4 revision is published.')
  }
  return project
}

export function createBrowserProjectResourcesV4(
  options: BrowserProjectResourcesOptionsV4 = {},
): BrowserProjectResourcesV4 {
  const database = options.database ?? new ProjectDatabaseV4()
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const animationScheduler = options.animationScheduler
    ?? browserAnimationSchedulerV4()
  const projectFiles = options.projectFiles ?? createBrowserProjectFileCommandPortV4()
  const userPrompt = options.userPrompt ?? createBrowserUserPromptPortV4()
  const robotStepAssets = options.robotStepAssets ?? createRobotStepAssetRepositoryV4()
  const robotStepParser = options.robotStepParser ?? stepImportClient
  const importedGeometry = createRobotImportGeometryResolverV4({
    assets: robotStepAssets,
    parser: robotStepParser,
  })

  const rawRobots = createRobotRuntimeRegistryV4()
  const rawJobs = createJobRuntimeStoreV4()
  const rawScene = createSceneRuntimeStoreV4()
  const rawInteraction = createInteractionStoreV4()
  const rawCoordinateDisplay = createCoordinateDisplayStoreV4()
  const rawRuntimeBundle = createBrowserRuntimeBundleStoreV4()
  const rawGeometry = createRobotDefinitionGeometryRepositoryV4()
  const notifications = createRuntimePublicationBarrierV4({
    onListenerError: (error) => console.error(error),
  })

  const robots = notifications.gateStore(rawRobots)
  const jobs = notifications.gateStore(rawJobs)
  const scene = notifications.gateStore(rawScene)
  const interaction = notifications.gateStore(rawInteraction)
  const coordinateDisplay = notifications.gateStore(rawCoordinateDisplay)
  const runtimeBundle = notifications.gateStore(rawRuntimeBundle)
  const geometry = notifications.gateGeometryRepository(rawGeometry)
  const viewportPreferences = createViewportPreferenceStoreV4(
    typeof localStorage === 'undefined' ? null : localStorage,
  )
  const shellLayoutStore = createShellLayoutStoreV4({
    storage: typeof localStorage === 'undefined' ? null : localStorage,
  })

  const resolveDefinitionGeometry = options.resolveDefinitionGeometry
    ?? (async (
      _project: WorkcellProjectV4,
      definition: RobotDefinitionV4,
    ): Promise<PreparedRobotDefinitionGeometryV4 | null> => (
      definition.id === BUILTIN_CRB_DEFINITION_ID_V4
        ? prepareBuiltinCrbGeometryV4(definition)
        : definition.id === BUILTIN_NED2_DEFINITION_ID_V4
          ? prepareBuiltinNed2GeometryV4(definition)
        : importedGeometry.resolve(_project, definition)
    ))

  const runtime = createBrowserProjectRuntimeV4({
    robotRegistry: rawRobots,
    jobStore: rawJobs,
    sceneStore: rawScene,
    interactionStore: rawInteraction,
    coordinateDisplayStore: rawCoordinateDisplay,
    runtimeBundleStore: rawRuntimeBundle,
    geometryRepository: rawGeometry,
    notifications,
    resolveDefinitionGeometry,
    prepareScene: (project, robotStates) => selectSceneRuntimeV4(project, {
      projectRevisionId: project.revisionId,
      robots: robotStates,
    }),
    createJobRuntime: (project) => {
      const executor = createRobotJobExecutorV4({
        readProject: () => project,
        robots: rawRobots,
        jobs: rawJobs,
        actionPort: unavailableJobActionExecutionPortV4,
        createRunId: createId,
      })
      const playback = createRobotJobPlaybackControllerV4({
        executor,
        jobs: rawJobs,
        scheduler: animationScheduler,
        onError: (error) => console.error(error),
      })
      const handover = (() => {
        if (!isHackathonHandoverSampleV4(project)) return null
        const store = createHandoverDemoRuntimeStoreV4(project)
        const ownedScheduler = createScopedAnimationSchedulerV4(animationScheduler)
        const implementation = createHandoverDemoCoordinatorV4({
          readProject: () => project,
          robots: rawRobots,
          jobs: rawJobs,
          demo: store,
          scheduler: ownedScheduler.scheduler,
          createRunId: createId,
        })
        let handoverDisposed = false
        let coordinator: HandoverDemoCoordinatorV4
        coordinator = Object.freeze({
          canHandle: (jobId: string) => !handoverDisposed && implementation.canHandle(jobId),
          canStart: (jobId: string) => !handoverDisposed && implementation.canStart(jobId),
          start(jobId: string) {
            if (handoverDisposed) throw new Error('Handover Coordinator is disposed.')
            return implementation.start(jobId)
          },
          canCancel: () => !handoverDisposed && implementation.canCancel(),
          cancel(reason: string) {
            if (!handoverDisposed) implementation.cancel(reason)
          },
          canReset: (jobId: string) => !handoverDisposed && implementation.canReset(jobId),
          reset() {
            if (!handoverDisposed) implementation.reset()
          },
          setGripConfirmTimeoutInjection(enabled: boolean) {
            if (handoverDisposed) throw new Error('Handover Coordinator is disposed.')
            implementation.setGripConfirmTimeoutInjection(enabled)
          },
          dispose() {
            if (handoverDisposed) return
            handoverDisposed = true
            const isPublishedOwner = rawRuntimeBundle.getState().active
              ?.jobs.handover?.coordinator === coordinator
            try {
              if (isPublishedOwner) implementation.dispose()
              else store.getState().reset()
            } finally {
              ownedScheduler.dispose()
            }
          },
        })
        return Object.freeze({ store, coordinator })
      })()
      let disposed = false
      return Object.freeze({
        executor,
        playback,
        handover,
        dispose() {
          if (disposed) return
          disposed = true
          let cleanupError: unknown
          const cleanup = (operation: () => void): void => {
            try {
              operation()
            } catch (error) {
              cleanupError ??= error
            }
          }
          cleanup(() => handover?.coordinator.dispose())
          cleanup(() => playback.dispose())
          cleanup(() => executor.shutdown('Project runtime disposed.'))
          if (cleanupError !== undefined) throw cleanupError
        },
      })
    },
  })
  const repository = createProjectRepositoryV4({ database, now: nowIso })
  const publication = createProjectPublicationCoordinatorV4({
    repository,
    runtime,
  })
  const mutations = createProjectMutationServiceV4({
    repository,
    publication,
    nowIso,
    createRevisionId: createId,
  })
  const projectStore = createProjectStoreV4({
    mutations,
    createDefaultProject: () => {
      const timestamp = nowIso()
      return createDefaultProjectV4({
        projectId: createId(),
        revisionId: createId(),
        nowIso: timestamp,
      })
    },
    encodeProject: encodeProjectV4,
    decodeProject: decodeProjectV4,
  })
  const sceneCommands = createSceneCommandServiceV4({
    mutations,
    createId,
  })
  const jobCommands = createJobCommandServiceV4({
    mutations,
    readProject: () => requirePublishedProjectV4(mutations),
    jobs,
    createId,
  })
  const robotImport = createRobotImportControllerV4({
    mutations,
    interaction,
    assets: robotStepAssets,
    geometry: importedGeometry,
    parser: robotStepParser,
    hash: options.robotHash ?? createProjectHashService({ subtle: globalThis.crypto?.subtle }),
    createId,
  })

  return Object.freeze({
    projectStore,
    mutations,
    robots,
    jobs,
    scene,
    interaction,
    coordinateDisplay,
    viewportPreferences,
    shellLayoutStore,
    geometry,
    runtimeBundle,
    sceneCommands,
    jobCommands,
    projectFiles,
    userPrompt,
    robotImport,
  })
}

export const browserProjectResourcesV4 = createBrowserProjectResourcesV4()
export const projectStoreV4 = browserProjectResourcesV4.projectStore

export function useProjectStoreV4<Selected>(
  selector: (state: ProjectStoreStateV4) => Selected,
): Selected {
  return useStore(projectStoreV4, selector)
}
