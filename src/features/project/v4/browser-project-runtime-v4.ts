import {
  failProjectV4,
  validateWorkcellProjectV4,
  type RobotDefinitionIdV4,
  type RobotDefinitionV4,
  type RobotIdV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { deriveCollisionPolicyV4 } from '../../../domain/collision/collision-policy-v4.js'
import type { CollisionPolicyV4 } from '../../../domain/collision/collision.js'
import type { StoreApi } from 'zustand/vanilla'
import type { CoordinateDisplayStoreStateV4 } from '../../frames/v4/coordinate-display-store.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import {
  buildInitialJobRuntimeStatesV4,
  type JobRuntimeStoreV4,
  type RobotJobRuntimeStateV4,
} from '../../jobs/v4/job-runtime-store.js'
import type {
  PreparedRobotDefinitionGeometryV4,
  RobotDefinitionGeometryPublicationHandleV4,
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from '../../robot/v4/robot-definition-geometry-repository.js'
import {
  buildInitialRobotRuntimeStatesV4,
  type RobotRuntimeRegistryV4,
  type RobotRuntimeStateV4,
} from '../../robot/v4/robot-runtime-registry.js'
import type { SceneRuntimeProjectionV4 } from '../../scene/v4/scene-runtime-selector.js'
import type { SceneRuntimeStoreV4 } from '../../scene/v4/scene-runtime-store.js'
import { assertPreparedVisibleSceneTriangleBudgetV4 } from '../../scene/v4/Workcell.js'
import type {
  AppliedProjectRuntimePublicationV4,
  PreparedProjectRuntimeBundleV4,
  ProjectRuntimeV4,
} from './project-v4-publication.js'
import type {
  ActiveBrowserRuntimeBundleV4,
  BrowserJobRuntimeResourcesV4,
  BrowserRuntimeBundleStoreStateV4,
} from './browser-runtime-bundle-store-v4.js'
import type { RuntimePublicationBarrierV4 } from './runtime-publication-barrier-v4.js'

export interface PreparedDefinitionPublicationV4 {
  readonly definition: RobotDefinitionV4
  readonly geometry: PreparedRobotDefinitionGeometryV4 | null
  readonly triangleCount: number
}

export interface BrowserProjectRuntimeResourcesV4 {
  readonly project: WorkcellProjectV4
  readonly robotStates: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>
  readonly jobStates: Readonly<Record<RobotIdV4, RobotJobRuntimeStateV4>>
  readonly sceneProjection: SceneRuntimeProjectionV4
  readonly collisionPolicy: CollisionPolicyV4
  readonly definitionPublications: readonly PreparedDefinitionPublicationV4[]
  readonly activeBundle: ActiveBrowserRuntimeBundleV4
}

export interface BrowserProjectRuntimeDependenciesV4 {
  readonly robotRegistry: StoreApi<RobotRuntimeRegistryV4>
  readonly jobStore: StoreApi<JobRuntimeStoreV4>
  readonly sceneStore: StoreApi<SceneRuntimeStoreV4>
  readonly interactionStore: StoreApi<InteractionStoreStateV4>
  readonly coordinateDisplayStore: StoreApi<CoordinateDisplayStoreStateV4>
  readonly runtimeBundleStore: StoreApi<BrowserRuntimeBundleStoreStateV4>
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly notifications: RuntimePublicationBarrierV4
  readonly resolveDefinitionGeometry: (
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ) => Promise<PreparedRobotDefinitionGeometryV4 | null>
  readonly prepareScene: (
    project: WorkcellProjectV4,
    robotStates: Readonly<Record<RobotIdV4, RobotRuntimeStateV4>>,
  ) => SceneRuntimeProjectionV4
  readonly createJobRuntime: (
    project: WorkcellProjectV4,
  ) => BrowserJobRuntimeResourcesV4
}

type PreparedRuntimeStateV4 =
  | 'PREPARED'
  | 'APPLIED'
  | 'COMMITTED'
  | 'ROLLED_BACK'
  | 'DISPOSED'

interface PreparedRuntimeAuthorityV4 {
  state: PreparedRuntimeStateV4
  jobDisposed: boolean
}

function runtimeFailureV4(code: string, path: string, message: string): never {
  failProjectV4(
    code,
    path,
    message,
    'Prepare and publish one complete Project V4 runtime revision.',
  )
}

function declaredDefinitionTriangleCountV4(definition: RobotDefinitionV4): number {
  const excluded = new Set(definition.excludedGeometryOccurrenceKeys)
  return definition.links.reduce((definitionTotal, link) => (
    definitionTotal + link.geometryOccurrences.reduce((linkTotal, occurrence) => (
      linkTotal + (excluded.has(occurrence.occurrenceKey)
        ? 0
        : occurrence.statistics.triangles)
    ), 0)
  ), 0)
}

function inspectPreparedGeometryV4(
  definition: RobotDefinitionV4,
  geometry: PreparedRobotDefinitionGeometryV4,
): void {
  if (
    geometry === null
    || typeof geometry !== 'object'
    || geometry.lifecycleState !== 'READY'
    || geometry.definitionId !== definition.id
    || !Number.isSafeInteger(geometry.triangleCount)
    || geometry.triangleCount < 0
  ) {
    runtimeFailureV4(
      'ROBOT_GEOMETRY_PREPARED_RESOURCE_INVALID',
      `$.robotDefinitions.${definition.id}.geometry`,
      'Resolved Robot Geometry is invalid or belongs to another Definition.',
    )
  }
  if (
    geometry.linkTemplates.size !== definition.links.length
    || definition.links.some(({ id }) => !geometry.linkTemplates.has(id))
  ) {
    runtimeFailureV4(
      'ROBOT_GEOMETRY_LINK_TEMPLATE_MISMATCH',
      `$.robotDefinitions.${definition.id}.geometry.linkTemplates`,
      'Resolved Robot Geometry must contain exactly one template per Link.',
    )
  }
}

function inspectJobResourcesV4(resources: BrowserJobRuntimeResourcesV4): void {
  if (
    resources === null
    || typeof resources !== 'object'
    || typeof resources.dispose !== 'function'
    || typeof resources.executor?.reset !== 'function'
    || typeof resources.playback?.quiesce !== 'function'
    || typeof resources.playback?.resume !== 'function'
    || !Object.hasOwn(resources, 'handover')
  ) {
    runtimeFailureV4(
      'BROWSER_JOB_RUNTIME_RESOURCE_INVALID',
      '$.jobs',
      'Browser Job runtime factory returned incomplete resources.',
    )
  }
}

function disposeJobResourcesV4(
  resources: BrowserJobRuntimeResourcesV4,
  authority: PreparedRuntimeAuthorityV4,
): void {
  if (authority.jobDisposed) return
  authority.jobDisposed = true
  let cleanupError: unknown = null
  cleanupError = captureCleanupErrorV4(
    cleanupError,
    () => resources.handover?.coordinator.dispose(),
  )
  cleanupError = captureCleanupErrorV4(cleanupError, resources.dispose)
  if (cleanupError !== null) throw cleanupError
}

function captureCleanupErrorV4(
  current: unknown,
  operation: () => void,
): unknown {
  try {
    operation()
    return current
  } catch (error) {
    return current ?? error
  }
}

function mergeCleanupErrorV4(current: unknown, candidate: unknown): unknown {
  return current ?? candidate
}

function disposePreparedDefinitionsV4(
  publications: readonly PreparedDefinitionPublicationV4[],
): unknown {
  let cleanupError: unknown = null
  for (const publication of publications) {
    if (publication.geometry === null) continue
    cleanupError = captureCleanupErrorV4(
      cleanupError,
      () => publication.geometry!.dispose(),
    )
  }
  return cleanupError
}

function preparedGeometrySnapshotsV4(
  publications: readonly PreparedDefinitionPublicationV4[],
): ReadonlyMap<RobotDefinitionIdV4, RobotDefinitionGeometryPublicationSnapshotV4> {
  return new Map(publications.map((publication) => [
    publication.definition.id,
    Object.freeze({
      definitionId: publication.definition.id,
      handle: Object.freeze({
        kind: 'robot-definition-geometry-publication-v4' as const,
      }),
      resolution: publication.geometry === null ? 'UNRESOLVED' as const : 'RESOLVED' as const,
      triangleCount: publication.triangleCount,
    }),
  ]))
}

export function createBrowserProjectRuntimeV4(
  dependencies: BrowserProjectRuntimeDependenciesV4,
): ProjectRuntimeV4<BrowserProjectRuntimeResourcesV4> {
  const authorities = new WeakMap<object, PreparedRuntimeAuthorityV4>()

  const requireAuthority = (
    bundle: PreparedProjectRuntimeBundleV4<BrowserProjectRuntimeResourcesV4>,
  ): PreparedRuntimeAuthorityV4 => {
    const authority = authorities.get(bundle.resources)
    if (
      authority === undefined
      || bundle.revisionId !== bundle.resources.project.revisionId
      || bundle.project.revisionId !== bundle.resources.project.revisionId
    ) {
      runtimeFailureV4(
        'BROWSER_RUNTIME_PREPARED_BUNDLE_INVALID',
        '$.bundle',
        'Prepared browser runtime bundle is not owned by this runtime.',
      )
    }
    return authority
  }

  return Object.freeze({
    async prepare(
      projectCandidate: WorkcellProjectV4,
      revisionId: string,
    ): Promise<PreparedProjectRuntimeBundleV4<BrowserProjectRuntimeResourcesV4>> {
      const project = validateWorkcellProjectV4(projectCandidate)
      if (revisionId !== project.revisionId) {
        runtimeFailureV4(
          'BROWSER_RUNTIME_REVISION_MISMATCH',
          '$.revisionId',
          'Requested runtime revision must match the validated Project.',
        )
      }

      const definitionPublications: PreparedDefinitionPublicationV4[] = []
      let jobResources: BrowserJobRuntimeResourcesV4 | null = null
      try {
        for (const definition of project.robotDefinitions) {
          const geometry = await dependencies.resolveDefinitionGeometry(project, definition)
          if (geometry !== null) {
            try {
              inspectPreparedGeometryV4(definition, geometry)
            } catch (error) {
              try {
                geometry.dispose()
              } catch {
                // Geometry validation remains the primary preparation error.
              }
              throw error
            }
          }
          definitionPublications.push(Object.freeze({
            definition,
            geometry,
            triangleCount: geometry?.triangleCount
              ?? declaredDefinitionTriangleCountV4(definition),
          }))
        }

        const robotStates = buildInitialRobotRuntimeStatesV4(project)
        const jobStates = buildInitialJobRuntimeStatesV4(project)
        const sceneProjection = dependencies.prepareScene(project, robotStates)
        if (sceneProjection.projectRevisionId !== project.revisionId) {
          runtimeFailureV4(
            'SCENE_RUNTIME_REVISION_MISMATCH',
            '$.sceneProjection.projectRevisionId',
            'Prepared Scene projection belongs to another Project revision.',
          )
        }
        const collisionPolicy = deriveCollisionPolicyV4(
          project.robots,
          project.robotDefinitions,
          { enabled: true, nearMissMarginM: 0.05 },
        )
        assertPreparedVisibleSceneTriangleBudgetV4(
          project,
          sceneProjection,
          preparedGeometrySnapshotsV4(definitionPublications),
        )

        jobResources = dependencies.createJobRuntime(project)
        inspectJobResourcesV4(jobResources)
        const activeBundle = Object.freeze({
          project,
          sceneRuntime: sceneProjection,
          collisionPolicy,
          jobs: jobResources,
        })
        const resources = Object.freeze({
          project,
          robotStates,
          jobStates,
          sceneProjection,
          collisionPolicy,
          definitionPublications: Object.freeze(definitionPublications),
          activeBundle,
        })
        authorities.set(resources, { state: 'PREPARED', jobDisposed: false })
        return Object.freeze({ project, revisionId, resources })
      } catch (error) {
        let cleanupError = disposePreparedDefinitionsV4(definitionPublications)
        if (jobResources !== null && typeof jobResources.dispose === 'function') {
          cleanupError = captureCleanupErrorV4(
            cleanupError,
            () => jobResources!.dispose(),
          )
        }
        void cleanupError
        throw error
      }
    },

    async apply(
      bundle: PreparedProjectRuntimeBundleV4<BrowserProjectRuntimeResourcesV4>,
    ): Promise<AppliedProjectRuntimePublicationV4> {
      const authority = requireAuthority(bundle)
      if (authority.state !== 'PREPARED') {
        runtimeFailureV4(
          'BROWSER_RUNTIME_PREPARED_BUNDLE_INVALID',
          '$.bundle',
          'Prepared browser runtime bundle was already applied or disposed.',
        )
      }

      const previousActive = dependencies.runtimeBundleStore.getState().active
      try {
        await previousActive?.jobs.playback.quiesce()
      } catch (error) {
        try {
          previousActive?.jobs.playback.resume()
        } catch {
          // The original quiesce failure is authoritative.
        }
        throw error
      }

      const capturePublicationContext = () => {
        const transaction = dependencies.notifications.begin()
        try {
          return {
            transaction,
            robotCheckpoint: dependencies.robotRegistry.getState().captureCheckpoint(),
            jobCheckpoint: dependencies.jobStore.getState().captureCheckpoint(),
            sceneCheckpoint: dependencies.sceneStore.getState().captureCheckpoint(),
            interactionCheckpoint: dependencies.interactionStore.getState().captureCheckpoint(),
            coordinateCheckpoint: dependencies.coordinateDisplayStore
              .getState()
              .captureCheckpoint(),
            bundleCheckpoint: dependencies.runtimeBundleStore.getState().captureCheckpoint(),
          }
        } catch (error) {
          transaction.rollback()
          throw error
        }
      }

      let publicationContext: ReturnType<typeof capturePublicationContext>
      try {
        publicationContext = capturePublicationContext()
      } catch (error) {
        authority.state = 'DISPOSED'
        let cleanupError = disposePreparedDefinitionsV4(
          bundle.resources.definitionPublications,
        )
        cleanupError = captureCleanupErrorV4(
          cleanupError,
          () => disposeJobResourcesV4(bundle.resources.activeBundle.jobs, authority),
        )
        cleanupError = captureCleanupErrorV4(
          cleanupError,
          () => previousActive?.jobs.playback.resume(),
        )
        void cleanupError
        throw error
      }
      const {
        transaction,
        robotCheckpoint,
        jobCheckpoint,
        sceneCheckpoint,
        interactionCheckpoint,
        coordinateCheckpoint,
        bundleCheckpoint,
      } = publicationContext
      const candidateHandles: RobotDefinitionGeometryPublicationHandleV4[] = []
      const priorHandles = new Set<RobotDefinitionGeometryPublicationHandleV4>()
      for (const definition of previousActive?.project.robotDefinitions ?? []) {
        const current = dependencies.geometryRepository.readCurrent(definition.id)
        if (current !== null) priorHandles.add(current.handle)
      }
      let geometryCommitted = false

      const restoreStores = (): unknown => {
        let cleanupError: unknown = null
        const restorations = [
          () => dependencies.runtimeBundleStore.getState().restoreCheckpoint(bundleCheckpoint),
          () => dependencies.coordinateDisplayStore.getState().restoreCheckpoint(coordinateCheckpoint),
          () => dependencies.interactionStore.getState().restoreCheckpoint(interactionCheckpoint),
          () => dependencies.sceneStore.getState().restoreCheckpoint(sceneCheckpoint),
          () => dependencies.jobStore.getState().restoreCheckpoint(jobCheckpoint),
          () => dependencies.robotRegistry.getState().restoreCheckpoint(robotCheckpoint),
        ]
        for (const restore of restorations) {
          cleanupError = captureCleanupErrorV4(cleanupError, restore)
        }
        return cleanupError
      }

      const retireCandidateGeometry = (): unknown => {
        let cleanupError: unknown = null
        for (const handle of [...candidateHandles].reverse()) {
          cleanupError = captureCleanupErrorV4(cleanupError, () => {
            if (geometryCommitted) dependencies.geometryRepository.revoke(handle)
            else dependencies.geometryRepository.rollback(handle)
          })
        }
        return cleanupError
      }

      try {
        for (const publication of bundle.resources.definitionPublications) {
          candidateHandles.push(publication.geometry === null
            ? dependencies.geometryRepository.stageUnresolved(
                publication.definition,
                publication.triangleCount,
              )
            : dependencies.geometryRepository.stage(
                publication.definition,
                publication.geometry,
              ))
        }
        dependencies.robotRegistry.getState().replaceProject(bundle.resources.project)
        dependencies.jobStore.getState().replaceProject(bundle.resources.project)
        dependencies.sceneStore.getState().replaceProjection(bundle.resources.sceneProjection)
        dependencies.interactionStore.getState().replaceProject(bundle.resources.project)
        dependencies.coordinateDisplayStore.getState().replaceProject(bundle.resources.project)
        dependencies.runtimeBundleStore.getState().replaceActive(bundle.resources.activeBundle)
      } catch (error) {
        let cleanupError = restoreStores()
        cleanupError = mergeCleanupErrorV4(cleanupError, retireCandidateGeometry())
        cleanupError = mergeCleanupErrorV4(
          cleanupError,
          disposePreparedDefinitionsV4(bundle.resources.definitionPublications),
        )
        cleanupError = captureCleanupErrorV4(cleanupError, transaction.rollback)
        authority.state = 'DISPOSED'
        cleanupError = captureCleanupErrorV4(
          cleanupError,
          () => disposeJobResourcesV4(bundle.resources.activeBundle.jobs, authority),
        )
        cleanupError = captureCleanupErrorV4(
          cleanupError,
          () => previousActive?.jobs.playback.resume(),
        )
        void cleanupError
        throw error
      }

      authority.state = 'APPLIED'
      let applicationState: 'PENDING' | 'COMMITTED' | 'ROLLED_BACK' = 'PENDING'
      let cleaned = false

      return Object.freeze({
        commit() {
          if (applicationState !== 'PENDING') return
          if (candidateHandles.length > 0) {
            dependencies.geometryRepository.commitBatch(candidateHandles)
            geometryCommitted = true
          }
          transaction.commit()
          applicationState = 'COMMITTED'
          authority.state = 'COMMITTED'
          try {
            bundle.resources.activeBundle.jobs.playback.resume()
          } catch {
            // Runtime publication is already observable and cannot be reversed here.
          }
        },

        rollback() {
          if (applicationState !== 'PENDING') return
          applicationState = 'ROLLED_BACK'
          let rollbackError = restoreStores()
          rollbackError = mergeCleanupErrorV4(
            rollbackError,
            retireCandidateGeometry(),
          )
          rollbackError = captureCleanupErrorV4(rollbackError, transaction.rollback)
          authority.state = 'ROLLED_BACK'
          rollbackError = captureCleanupErrorV4(
            rollbackError,
            () => disposeJobResourcesV4(bundle.resources.activeBundle.jobs, authority),
          )
          rollbackError = captureCleanupErrorV4(
            rollbackError,
            () => previousActive?.jobs.playback.resume(),
          )
          if (rollbackError !== null) throw rollbackError
        },

        cleanup() {
          if (applicationState !== 'COMMITTED' || cleaned) return
          cleaned = true
          let cleanupError: unknown = null
          for (const handle of priorHandles) {
            try {
              dependencies.geometryRepository.revoke(handle)
            } catch (error) {
              cleanupError ??= error
            }
          }
          if (previousActive !== null) {
            try {
              previousActive.jobs.dispose()
            } catch (error) {
              cleanupError ??= error
            }
          }
          if (cleanupError !== null) throw cleanupError
        },
      })
    },

    dispose(
      bundle: PreparedProjectRuntimeBundleV4<BrowserProjectRuntimeResourcesV4>,
    ): void {
      const authority = requireAuthority(bundle)
      if (authority.state !== 'PREPARED') return
      authority.state = 'DISPOSED'
      let cleanupError = disposePreparedDefinitionsV4(
        bundle.resources.definitionPublications,
      )
      cleanupError = captureCleanupErrorV4(
        cleanupError,
        () => disposeJobResourcesV4(bundle.resources.activeBundle.jobs, authority),
      )
      if (cleanupError !== null) throw cleanupError
    },
  })
}
