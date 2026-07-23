import {
  MAX_OPC_UA_ENDPOINTS_V5,
  ProjectV5Error,
  validateWorkcellProjectV5,
  type OpcUaBridgeRouteV5,
  type OpcUaEndpointV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'

export interface OpcUaSettingsDraftV1 {
  readonly baseProjectRevisionId: string
  readonly mode: WorkcellProjectV5['opcUa']['mode']
  readonly endpoints: readonly OpcUaEndpointV5[]
  readonly bridgeRoutes: WorkcellProjectV5['opcUa']['bridgeRoutes']
}

export interface OpcUaSettingsValidationIssueV1 {
  readonly code: string
  readonly path: string
  readonly message: string
}

export interface OpcUaSettingsDraftMutationResultV1 {
  readonly draft: OpcUaSettingsDraftV1
  readonly issues: readonly OpcUaSettingsValidationIssueV1[]
}

export interface DockerLoopbackWarningV1 {
  readonly replacementUrl: string
  readonly message: string
}

function copyDraft(draft: OpcUaSettingsDraftV1): OpcUaSettingsDraftV1 {
  return structuredClone(draft)
}

function endpointIndex(draft: OpcUaSettingsDraftV1, endpointId: string): number {
  const index = draft.endpoints.findIndex((endpoint) => endpoint.endpointId === endpointId)
  if (index < 0) throw new Error(`OPC UA Endpoint ${endpointId} does not exist in the Settings Draft.`)
  return index
}

function bridgeRouteIndex(draft: OpcUaSettingsDraftV1, routeId: string): number {
  const index = draft.bridgeRoutes.findIndex((route) => route.id === routeId)
  if (index < 0) throw new Error(`OPC UA Bridge route ${routeId} does not exist in the Settings Draft.`)
  return index
}

function issueFrom(error: unknown): OpcUaSettingsValidationIssueV1 {
  if (error instanceof ProjectV5Error) {
    return Object.freeze({ code: error.code, path: error.path, message: error.message })
  }
  if (error instanceof Error) return Object.freeze({ code: error.name, path: '$', message: error.message })
  return Object.freeze({ code: 'OPC_UA_SETTINGS_INVALID', path: '$', message: String(error) })
}

function candidateFromDraft(draft: OpcUaSettingsDraftV1, active: WorkcellProjectV5): WorkcellProjectV5 {
  return {
    ...active,
    opcUa: {
      ...active.opcUa,
      mode: draft.mode,
      endpoints: structuredClone(draft.endpoints),
      bridgeRoutes: structuredClone(draft.bridgeRoutes),
    },
  }
}

export function createOpcUaSettingsDraftV1(project: WorkcellProjectV5): OpcUaSettingsDraftV1 {
  return Object.freeze({
    baseProjectRevisionId: project.revisionId,
    mode: project.opcUa.mode,
    endpoints: structuredClone(project.opcUa.endpoints),
    bridgeRoutes: structuredClone(project.opcUa.bridgeRoutes),
  })
}

export function addEndpointV1(draft: OpcUaSettingsDraftV1, endpoint: OpcUaEndpointV5): OpcUaSettingsDraftV1 {
  return Object.freeze({ ...copyDraft(draft), endpoints: [...draft.endpoints, structuredClone(endpoint)] })
}

export function duplicateEndpointV1(
  draft: OpcUaSettingsDraftV1,
  sourceEndpointId: string,
  duplicateEndpointId: string,
): OpcUaSettingsDraftV1 {
  const source = draft.endpoints[endpointIndex(draft, sourceEndpointId)]!
  const duplicate: OpcUaEndpointV5 = {
    endpointId: duplicateEndpointId,
    name: `${source.name} Copy`,
    endpointUrl: source.endpointUrl,
    enabled: source.enabled,
    publishingIntervalMs: source.publishingIntervalMs,
    reconnectDelayMs: source.reconnectDelayMs,
  }
  return addEndpointV1(draft, duplicate)
}

export function updateEndpointV1(
  draft: OpcUaSettingsDraftV1,
  endpointId: string,
  patch: Partial<Omit<OpcUaEndpointV5, 'endpointId'>>,
): OpcUaSettingsDraftV1 {
  const index = endpointIndex(draft, endpointId)
  return Object.freeze({
    ...copyDraft(draft),
    endpoints: draft.endpoints.map((endpoint, candidateIndex) => candidateIndex === index
      ? { ...endpoint, ...structuredClone(patch), endpointId }
      : structuredClone(endpoint)),
  })
}

export function deleteEndpointV1(
  draft: OpcUaSettingsDraftV1,
  active: WorkcellProjectV5,
  endpointId: string,
): OpcUaSettingsDraftMutationResultV1 {
  const index = endpointIndex(draft, endpointId)
  if (active.opcUa.mappings.some((mapping) => mapping.endpointId === endpointId)) {
    return Object.freeze({
      draft,
      issues: Object.freeze([Object.freeze({
        code: 'OPC_UA_ENDPOINT_IN_USE',
        path: `$.opcUa.endpoints[${index}]`,
        message: 'Cannot delete an OPC UA Endpoint while a Mapping references it.',
      })]),
    })
  }
  return Object.freeze({
    draft: Object.freeze({ ...copyDraft(draft), endpoints: draft.endpoints.filter((endpoint) => endpoint.endpointId !== endpointId) }),
    issues: Object.freeze([]),
  })
}

export function dockerLoopbackWarningV1(
  runtime: 'native' | 'docker',
  endpointUrl: string,
): DockerLoopbackWarningV1 | null {
  if (runtime !== 'docker') return null
  let parsed: URL
  try {
    parsed = new URL(endpointUrl)
  } catch {
    return null
  }
  if (!['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)) return null
  parsed.hostname = 'host.docker.internal'
  return Object.freeze({
    replacementUrl: parsed.toString(),
    message: 'Docker containers cannot use the container loopback address to reach a host OPC UA server.',
  })
}

export function replaceLoopbackHostV1(
  draft: OpcUaSettingsDraftV1,
  endpointId: string,
  replacementHost: string,
): OpcUaSettingsDraftV1 {
  const source = draft.endpoints[endpointIndex(draft, endpointId)]!
  const endpointUrl = new URL(source.endpointUrl)
  endpointUrl.hostname = replacementHost
  return updateEndpointV1(draft, endpointId, { endpointUrl: endpointUrl.toString() })
}

export function addBridgeRouteV1(draft: OpcUaSettingsDraftV1, route: OpcUaBridgeRouteV5): OpcUaSettingsDraftV1 {
  return Object.freeze({ ...copyDraft(draft), bridgeRoutes: [...draft.bridgeRoutes, structuredClone(route)] })
}

export function updateBridgeRouteV1(
  draft: OpcUaSettingsDraftV1,
  routeId: string,
  patch: Partial<Omit<OpcUaBridgeRouteV5, 'id'>>,
): OpcUaSettingsDraftV1 {
  const index = bridgeRouteIndex(draft, routeId)
  return Object.freeze({
    ...copyDraft(draft),
    bridgeRoutes: draft.bridgeRoutes.map((route, candidateIndex) => candidateIndex === index
      ? { ...route, ...structuredClone(patch), id: routeId }
      : structuredClone(route)),
  })
}

export function deleteBridgeRouteV1(draft: OpcUaSettingsDraftV1, routeId: string): OpcUaSettingsDraftV1 {
  bridgeRouteIndex(draft, routeId)
  return Object.freeze({ ...copyDraft(draft), bridgeRoutes: draft.bridgeRoutes.filter((route) => route.id !== routeId) })
}

export function createOpcUaSettingsCandidateRecipeV1(
  draft: OpcUaSettingsDraftV1,
): (active: WorkcellProjectV5) => WorkcellProjectV5 {
  const retainedDraft = copyDraft(draft)
  return (active) => candidateFromDraft(retainedDraft, active)
}

export function validateOpcUaSettingsDraftV1(
  draft: OpcUaSettingsDraftV1,
  active: WorkcellProjectV5,
): readonly OpcUaSettingsValidationIssueV1[] {
  if (draft.endpoints.length > MAX_OPC_UA_ENDPOINTS_V5) {
    return Object.freeze([Object.freeze({
      code: 'OPCUA_ENDPOINT_LIMIT_EXCEEDED',
      path: '$.opcUa.endpoints',
      message: `Maximum ${MAX_OPC_UA_ENDPOINTS_V5} OPC UA Endpoints is exceeded.`,
    })])
  }
  try {
    validateWorkcellProjectV5(candidateFromDraft(draft, active))
    return Object.freeze([])
  } catch (error) {
    return Object.freeze([issueFrom(error)])
  }
}
