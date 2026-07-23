import { describe, expect, it } from 'vitest'

import {
  MAX_OPC_UA_ENDPOINTS_V5,
  validateWorkcellProjectV5,
  type OpcUaBridgeRouteV5,
  type OpcUaEndpointV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import {
  addBridgeRouteV1,
  addEndpointV1,
  createOpcUaSettingsCandidateRecipeV1,
  createOpcUaSettingsDraftV1,
  deleteEndpointV1,
  dockerLoopbackWarningV1,
  duplicateEndpointV1,
  replaceLoopbackHostV1,
  updateBridgeRouteV1,
  updateEndpointV1,
  validateOpcUaSettingsDraftV1,
} from './opcua-settings-draft.js'

function project(): WorkcellProjectV5 {
  return validateWorkcellProjectV5(makeMinimalWorkcellProjectV5())
}

function endpoint(id: string): OpcUaEndpointV5 {
  return {
    endpointId: id,
    name: `Endpoint ${id}`,
    endpointUrl: `opc.tcp://localhost:${4840 + Number(id.replace('endpoint-', ''))}`,
    enabled: true,
    publishingIntervalMs: 100,
    reconnectDelayMs: 1_000,
  }
}

function draftWithEndpointCount(count: number) {
  const source = project()
  return {
    ...createOpcUaSettingsDraftV1(source),
    endpoints: Array.from({ length: count }, (_, index) => endpoint(`endpoint-${index + 1}`)),
  }
}

describe('OPC UA Settings Draft V1', () => {
  it('copies only Project-owned OPC UA fields into a disposable Draft', () => {
    const source = project()

    const draft = createOpcUaSettingsDraftV1(source)

    expect(draft).toEqual({
      baseProjectRevisionId: source.revisionId,
      mode: source.opcUa.mode,
      endpoints: source.opcUa.endpoints,
      bridgeRoutes: source.opcUa.bridgeRoutes,
    })
    expect(JSON.stringify(draft)).not.toContain('advertisedHost')
    expect(JSON.stringify(draft)).not.toContain('bindHost')
    expect(draft.endpoints).not.toBe(source.opcUa.endpoints)
  })

  it('accepts exactly eight shared Endpoints and rejects the ninth', () => {
    const source = project()

    expect(validateOpcUaSettingsDraftV1(draftWithEndpointCount(MAX_OPC_UA_ENDPOINTS_V5), source)).toEqual([])
    expect(validateOpcUaSettingsDraftV1(draftWithEndpointCount(MAX_OPC_UA_ENDPOINTS_V5 + 1), source))
      .toContainEqual(expect.objectContaining({ code: 'OPCUA_ENDPOINT_LIMIT_EXCEEDED' }))
  })

  it('adds and duplicates immutable Endpoint copies without Mapping changes', () => {
    const source = project()
    const draft = createOpcUaSettingsDraftV1(source)
    const added = addEndpointV1(draft, endpoint('endpoint-2'))
    const duplicated = duplicateEndpointV1(added, 'endpoint-2', 'endpoint-copy')

    expect(added).not.toBe(draft)
    expect(duplicated.endpoints).toEqual([
      source.opcUa.endpoints[0],
      endpoint('endpoint-2'),
      { ...endpoint('endpoint-2'), endpointId: 'endpoint-copy', name: 'Endpoint endpoint-2 Copy' },
    ])
    expect(source.opcUa.mappings).toHaveLength(1)
    expect(duplicated).not.toHaveProperty('mappings')
  })

  it('updates an Endpoint immutably and blocks deletion while a Mapping references it', () => {
    const source = project()
    const draft = updateEndpointV1(createOpcUaSettingsDraftV1(source), 'endpoint-1', {
      reconnectDelayMs: 2_000,
    })
    const result = deleteEndpointV1(draft, source, 'endpoint-1')

    expect(draft.endpoints[0]?.reconnectDelayMs).toBe(2_000)
    expect(source.opcUa.endpoints[0]?.reconnectDelayMs).toBe(1_000)
    expect(result).toEqual({
      draft,
      issues: [{
        code: 'OPC_UA_ENDPOINT_IN_USE',
        path: '$.opcUa.endpoints[0]',
        message: 'Cannot delete an OPC UA Endpoint while a Mapping references it.',
      }],
    })
  })

  it('warns but does not rewrite a Docker loopback Client URL until explicitly replaced', () => {
    const source = 'opc.tcp://127.0.0.1:4840'
    const warning = dockerLoopbackWarningV1('docker', source)
    const draft = createOpcUaSettingsDraftV1(project())
    const replaced = replaceLoopbackHostV1(draft, 'endpoint-1', 'host.docker.internal')

    expect(warning).toMatchObject({ replacementUrl: 'opc.tcp://host.docker.internal:4840' })
    expect(source).toBe('opc.tcp://127.0.0.1:4840')
    expect(replaced.endpoints[0]?.endpointUrl).toBe('opc.tcp://host.docker.internal:4840')
    expect(draft.endpoints[0]?.endpointUrl).toBe('opc.tcp://localhost:4840')
  })

  it('validates the complete candidate and returns stable validator issues for mappings, routes, and update budget', () => {
    const source = cloneWorkcellProjectV5(project())
    const bridgeSource = {
      ...source,
      logicalSignals: [{ ...source.logicalSignals[0]!, direction: 'bidirectional' as const }],
      opcUa: {
        ...source.opcUa,
        mappings: [
          source.opcUa.mappings[0]!,
          { ...source.opcUa.mappings[0]!, id: 'mapping-2', direction: 'write' as const, nodeAddress: { ...source.opcUa.mappings[0]!.nodeAddress, identifier: 'Signals.PartPresent.Write' } },
        ],
      },
    }
    const base = createOpcUaSettingsDraftV1(bridgeSource)
    const missingEndpoint = { ...base, endpoints: [] }
    const selfRoute: OpcUaBridgeRouteV5 = {
      id: 'self', sourceMappingId: 'mapping-1', destinationMappingId: 'mapping-1', direction: 'forward', scale: 1, offset: 0, unit: '',
    }
    const selfBridged = addBridgeRouteV1(base, selfRoute)
    const cyclic = addBridgeRouteV1(
      updateBridgeRouteV1(selfBridged, 'self', { destinationMappingId: 'mapping-2' }),
      { id: 'back', sourceMappingId: 'mapping-2', destinationMappingId: 'mapping-1', direction: 'forward', scale: 1, offset: 0, unit: '' },
    )
    const budgetSource = cloneWorkcellProjectV5(bridgeSource)
    const manyMappings = Array.from({ length: 32 }, (_, index) => ({
      ...budgetSource.opcUa.mappings[0]!, id: `mapping-${index + 1}`, endpointId: `endpoint-${(index % 8) + 1}`,
      direction: 'write' as const,
      nodeAddress: { ...budgetSource.opcUa.mappings[0]!.nodeAddress, identifier: `Signals.${index + 1}` },
      leaves: Array.from({ length: 32 }, (_, leaf) => ({
        ...budgetSource.opcUa.mappings[0]!.leaves[0]!, leafPath: [leaf], projectPath: [],
      })),
    }))
    const budgetProject = {
      ...budgetSource,
      opcUa: { ...budgetSource.opcUa, endpoints: Array.from({ length: 8 }, (_, index) => ({ ...endpoint(`endpoint-${index + 1}`), publishingIntervalMs: 50 })), mappings: manyMappings },
    }

    expect(validateOpcUaSettingsDraftV1(missingEndpoint, source)).toEqual([expect.objectContaining({ code: 'OPCUA_ENDPOINT_NOT_FOUND', path: '$.opcUa.mappings[0].endpointId' })])
    expect(validateOpcUaSettingsDraftV1(selfBridged, bridgeSource)).toEqual([expect.objectContaining({ code: 'BRIDGE_ROUTE_ECHO', path: '$.opcUa.bridgeRoutes[0]' })])
    expect(validateOpcUaSettingsDraftV1(cyclic, bridgeSource)).toEqual([expect.objectContaining({ code: 'BRIDGE_ROUTE_CYCLE', path: '$.opcUa.bridgeRoutes' })])
    expect(validateOpcUaSettingsDraftV1(createOpcUaSettingsDraftV1(budgetProject), budgetProject))
      .toEqual([expect.objectContaining({ code: 'OPCUA_UPDATE_RATE_LIMIT_EXCEEDED', path: '$.opcUa.mappings' })])
  })

  it('creates a recipe that changes only the Draft-owned OPC UA fields', () => {
    const source = project()
    const draft = updateEndpointV1(createOpcUaSettingsDraftV1(source), 'endpoint-1', { enabled: false })
    const candidate = createOpcUaSettingsCandidateRecipeV1(draft)(source)

    expect(candidate).toMatchObject({ opcUa: { endpoints: [{ endpointId: 'endpoint-1', enabled: false }] } })
    expect(candidate.opcUa.mappings).toEqual(source.opcUa.mappings)
    expect(candidate.metadata).toEqual(source.metadata)
    expect(candidate.revisionId).toBe(source.revisionId)
  })
})
