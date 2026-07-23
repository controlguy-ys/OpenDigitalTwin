import type { AnimationFrameSchedulerV5 } from '../../jobs/v5/simulation-clock.js'
import { createRuntimeGatewayConnectionTestPortV1, type OpcUaConnectionTestPortV1 } from '../../runtime-gateway/v5/runtime-gateway-connection-test.js'
import { createRuntimeGatewayConnectivityClientV1, type RuntimeGatewayConnectivityClientV1 } from '../../runtime-gateway/v5/runtime-gateway-connectivity-client.js'
import { createRuntimeGatewayNodeAddressResolverV1 } from '../../runtime-gateway/v5/runtime-gateway-node-address-resolver.js'
import { createRuntimeConnectivitySnapshotReaderV1 } from '../../runtime-gateway/v5/runtime-integration-diagnostics-client.js'
import { createConnectivityPresentationStoreV1, type ConnectivityPresentationStoreV1 } from '../../connectivity/v5/connectivity-presentation-store.js'
import { createOpcUaSettingsActivationServiceV1, createOpcUaSettingsControllerV1, type OpcUaSettingsControllerV1 } from '../../connectivity/v5/opcua-settings-activation.js'
import type { NamespaceIndexResolutionPortV1 } from '../../connectivity/v5/opcua-node-address-draft.js'
import { createBrowserProjectRuntimeV5, type BrowserProjectResourcesV5 as BrowserRuntimeResourcesV5 } from './browser-project-runtime-v5.js'
import { createDefaultProjectV5 } from './default-project-v5.js'
import { createBrowserProjectFileCommandPortV5, type ProjectFileCommandPortV5 } from './project-file-command-port-v5.js'
import { createProjectStoreV5, type ProjectStoreV5 } from './project-store-v5.js'
import { ProjectDatabaseV5 } from './project-v5-db.js'
import { createProjectV5MutationService, type ProjectV5MutationService } from './project-v5-mutation-service.js'
import { createProjectPublicationCoordinatorV5, type ProjectPublicationCoordinatorV5 } from './project-v5-publication.js'
import { createProjectRepositoryV5, type ProjectRepositoryV5 } from './project-v5-repository.js'

export interface BrowserProjectApplicationResourcesV5 {
  readonly database: ProjectDatabaseV5
  readonly repository: ProjectRepositoryV5
  readonly runtime: BrowserRuntimeResourcesV5
  readonly gateway: RuntimeGatewayConnectivityClientV1
  readonly publication: ProjectPublicationCoordinatorV5
  readonly mutations: ProjectV5MutationService
  readonly store: ProjectStoreV5
  readonly connectivity: ConnectivityPresentationStoreV1
  readonly settings: OpcUaSettingsControllerV1
  readonly connectionTest: OpcUaConnectionTestPortV1
  readonly nodeAddressResolver: NamespaceIndexResolutionPortV1
  readonly files: ProjectFileCommandPortV5
  dispose(): Promise<void>
}

export interface CreateBrowserProjectApplicationResourcesV5Options {
  readonly database?: ProjectDatabaseV5
  readonly repository?: ProjectRepositoryV5
  readonly runtime?: BrowserRuntimeResourcesV5
  readonly gateway?: RuntimeGatewayConnectivityClientV1
  readonly connectivity?: ConnectivityPresentationStoreV1
  readonly files?: ProjectFileCommandPortV5
  readonly fetch?: (input: string, init: RequestInit) => Promise<Response>
  readonly scheduler?: AnimationFrameSchedulerV5
  readonly nowMs?: () => number
  readonly nowIso?: () => string
  readonly createId?: () => string
  readonly onDiagnostic?: (error: unknown) => void
}

function browserScheduler(): AnimationFrameSchedulerV5 {
  return Object.freeze({
    now: () => performance.now(),
    request: (callback: (simulationMs: number) => void) => requestAnimationFrame(callback),
    cancel: (handle: number) => cancelAnimationFrame(handle),
  })
}

export function createBrowserProjectApplicationResourcesV5(
  options: CreateBrowserProjectApplicationResourcesV5Options = {},
): BrowserProjectApplicationResourcesV5 {
  const nowMs = options.nowMs ?? Date.now
  const nowIso = options.nowIso ?? (() => new Date().toISOString())
  const createId = options.createId ?? (() => crypto.randomUUID())
  const onDiagnostic = options.onDiagnostic ?? ((error: unknown) => console.error(error))
  const database = options.database ?? new ProjectDatabaseV5()
  const repository = options.repository ?? createProjectRepositoryV5({ database, now: nowIso })
  const runtime = options.runtime ?? createBrowserProjectRuntimeV5({
    gatewayId: 'browser-v5',
    scheduler: options.scheduler ?? browserScheduler(),
    createRunId: createId,
    createCommandId: createId,
    stream: {
      nowMs,
      location: {
        protocol: globalThis.location.protocol,
        host: globalThis.location.host,
      },
    },
    command: {
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
      nowMs,
    },
    onDiagnostic,
  })
  const gateway = options.gateway ?? createRuntimeGatewayConnectivityClientV1({
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    createActivationAttemptId: createId,
  })
  const connectivity = options.connectivity ?? createConnectivityPresentationStoreV1({
    readConnectivitySnapshot: createRuntimeConnectivitySnapshotReaderV1(
      options.fetch === undefined ? {} : { fetch: options.fetch },
    ),
    nowMs,
  })
  const publication = createProjectPublicationCoordinatorV5({ repository, runtime, gateway })
  const mutationAuthority = createProjectV5MutationService({
    publication,
    createRevisionId: createId,
    nowIso,
  })
  const trackPublication = async <Result>(operation: () => Promise<Result>): Promise<Result> => {
    connectivity.setPublicationPhase('activating')
    try {
      const result = await operation()
      connectivity.setPublicationPhase('idle')
      return result
    } catch (error) {
      connectivity.setPublicationPhase({
        phase: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  }
  const mutations: ProjectV5MutationService = Object.freeze({
    readPublished: () => mutationAuthority.readPublished(),
    isRecoveryRequired: () => mutationAuthority.isRecoveryRequired(),
    readRecoveryError: () => mutationAuthority.readRecoveryError(),
    subscribe: (listener: () => void) => mutationAuthority.subscribe(listener),
    hydrate: () => trackPublication(() => mutationAuthority.hydrate()),
    replace: (request: Parameters<ProjectV5MutationService['replace']>[0]) => (
      trackPublication(() => mutationAuthority.replace(request))
    ),
    mutate: (request: Parameters<ProjectV5MutationService['mutate']>[0]) => (
      trackPublication(() => mutationAuthority.mutate(request))
    ),
  })
  const store = createProjectStoreV5({
    mutations,
    createDefaultProject: () => createDefaultProjectV5({
      createProjectId: createId,
      createRevisionId: createId,
      nowIso,
    }),
  })
  const settings = createOpcUaSettingsControllerV1(createOpcUaSettingsActivationServiceV1(mutations))
  const connectionTest = createRuntimeGatewayConnectionTestPortV1({ gateway, nowMs })
  const nodeAddressResolver = createRuntimeGatewayNodeAddressResolverV1(
    options.fetch === undefined ? {} : { fetch: options.fetch },
  )
  const files = options.files ?? createBrowserProjectFileCommandPortV5()
  let disposed = false

  return Object.freeze({
    database,
    repository,
    runtime,
    gateway,
    publication,
    mutations,
    store,
    connectivity,
    settings,
    connectionTest,
    nodeAddressResolver,
    files,
    async dispose() {
      if (disposed) return
      disposed = true
      connectivity.dispose()
      runtime.stopGatewayStream()
      await runtime.dispose()
      database.close()
    },
  })
}
