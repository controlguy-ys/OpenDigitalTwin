import {
  opcUaNodeAddressKeyV1,
  validateWorkcellProjectV5,
  type OpcUaMappingLeafV5,
  type OpcUaMappingV5,
  type OpcUaNodeAddressV1,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { rpyDegreesToRuntimeQuaternionV1 } from '../../src/core/runtime-interpolation/v1.js'
import type { RuntimeScalarOrStructureV1 } from '../../src/core/runtime-protocol/v1.js'

export interface CompiledOpcUaClientMonitoredRootV1 {
  readonly rootKey: string
  readonly endpointId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly mappingIds: readonly string[]
  readonly samplingIntervalMs: number
}

export interface CompiledOpcUaClientEndpointReadPlanV1 {
  readonly endpointId: string
  readonly monitoredRoots: readonly CompiledOpcUaClientMonitoredRootV1[]
}

export interface ResolvedOpcUaClientMonitoredRootV1 {
  readonly rootKey: string
  readonly endpointId: string
  readonly nodeId: string
  readonly mappingIds: readonly string[]
  readonly samplingIntervalMs: number
}

export interface ResolvedOpcUaClientMonitoredGroupV1 {
  readonly samplingIntervalMs: number
  readonly roots: readonly ResolvedOpcUaClientMonitoredRootV1[]
}

export type AssembleMappingValueResultV1 =
  | { readonly ok: true; readonly value: RuntimeScalarOrStructureV1; readonly unit: string }
  | { readonly ok: false; readonly statusCode: 'BadNoData' | 'BadTypeMismatch' | 'BadOutOfRange' }

interface MutableRootV1 {
  readonly rootKey: string
  readonly endpointId: string
  readonly nodeAddress: OpcUaNodeAddressV1
  readonly mappingIds: string[]
  samplingIntervalMs: number
}

type LeafValueResultV1 =
  | { readonly ok: true; readonly value: RuntimeScalarOrStructureV1 }
  | { readonly ok: false; readonly statusCode: 'BadNoData' | 'BadTypeMismatch' | 'BadOutOfRange' }

type MutableRuntimeStructureV1 = Record<string, RuntimeScalarOrStructureV1> | RuntimeScalarOrStructureV1[]

function isClientMode(project: WorkcellProjectV5): boolean {
  return project.opcUa.mode === 'client' || project.opcUa.mode === 'bridge'
}

function isReadDirection(direction: OpcUaMappingV5['direction']): boolean {
  return direction === 'read' || direction === 'readWrite'
}

export function opcUaClientReadPlanRootKeyV1(endpointId: string, nodeAddress: OpcUaNodeAddressV1): string {
  return `${endpointId}\0${opcUaNodeAddressKeyV1(nodeAddress)}`
}

export function effectiveOpcUaMappingLeafNodeAddressV1(
  mapping: OpcUaMappingV5,
  leaf: OpcUaMappingLeafV5,
): OpcUaNodeAddressV1 {
  return leaf.nodeAddress ?? mapping.nodeAddress
}

function nodeIdIdentifierPrefix(address: OpcUaNodeAddressV1): 's' | 'i' | 'g' | 'b' {
  if (address.identifierType === 'string') return 's'
  if (address.identifierType === 'numeric') return 'i'
  if (address.identifierType === 'guid') return 'g'
  return 'b'
}

export function resolveOpcUaNodeAddressV1(
  address: OpcUaNodeAddressV1,
  namespaceArray: readonly string[],
): string {
  const namespaceIndex = namespaceArray.indexOf(address.namespaceUri)
  if (namespaceIndex < 0) {
    throw new Error(`OPC_UA_NAMESPACE_URI_NOT_FOUND: ${address.namespaceUri}`)
  }
  return `ns=${namespaceIndex};${nodeIdIdentifierPrefix(address)}=${address.identifier}`
}

export function compileOpcUaClientReadPlanV1(
  projectInput: WorkcellProjectV5,
): readonly CompiledOpcUaClientEndpointReadPlanV1[] {
  const project = validateWorkcellProjectV5(projectInput)
  if (!isClientMode(project)) return Object.freeze([])

  const rootsByEndpoint = new Map<string, Map<string, MutableRootV1>>()
  for (const mapping of project.opcUa.mappings) {
    if (!isReadDirection(mapping.direction)) continue
    const endpoint = project.opcUa.endpoints.find((candidate) => candidate.endpointId === mapping.endpointId)
    if (endpoint === undefined || !endpoint.enabled) continue
    const endpointRoots = rootsByEndpoint.get(endpoint.endpointId) ?? new Map<string, MutableRootV1>()
    rootsByEndpoint.set(endpoint.endpointId, endpointRoots)
    const interval = mapping.publishingIntervalMs ?? endpoint.publishingIntervalMs
    const hasLeafNodeAddresses = mapping.leaves.some((leaf) => leaf.nodeAddress !== undefined)
    const roots = !hasLeafNodeAddresses
      ? [{ nodeAddress: mapping.nodeAddress }]
      : mapping.leaves.map((leaf) => ({
          nodeAddress: effectiveOpcUaMappingLeafNodeAddressV1(mapping, leaf),
        }))
    for (const { nodeAddress } of roots) {
      const key = opcUaClientReadPlanRootKeyV1(endpoint.endpointId, nodeAddress)
      const existing = endpointRoots.get(key)
      if (existing === undefined) {
        endpointRoots.set(key, {
          rootKey: key,
          endpointId: endpoint.endpointId,
          nodeAddress,
          mappingIds: [mapping.id],
          samplingIntervalMs: interval,
        })
      } else {
        if (!existing.mappingIds.includes(mapping.id)) existing.mappingIds.push(mapping.id)
        existing.samplingIntervalMs = Math.min(existing.samplingIntervalMs, interval)
      }
    }
  }

  const plans: CompiledOpcUaClientEndpointReadPlanV1[] = []
  for (const endpoint of project.opcUa.endpoints) {
    const roots = rootsByEndpoint.get(endpoint.endpointId)
    if (roots === undefined || roots.size === 0) continue
    plans.push(Object.freeze({
      endpointId: endpoint.endpointId,
      monitoredRoots: Object.freeze([...roots.values()].map((root) => Object.freeze({
        rootKey: root.rootKey,
        endpointId: root.endpointId,
        nodeAddress: root.nodeAddress,
        mappingIds: Object.freeze([...root.mappingIds]),
        samplingIntervalMs: root.samplingIntervalMs,
      }))),
    }))
  }
  return Object.freeze(plans)
}

export function resolveOpcUaClientReadRootsV1(
  roots: readonly CompiledOpcUaClientMonitoredRootV1[],
  namespaceArray: readonly string[],
): readonly ResolvedOpcUaClientMonitoredRootV1[] {
  return Object.freeze(roots.map((root) => Object.freeze({
    rootKey: root.rootKey,
    endpointId: root.endpointId,
    nodeId: resolveOpcUaNodeAddressV1(root.nodeAddress, namespaceArray),
    mappingIds: root.mappingIds,
    samplingIntervalMs: root.samplingIntervalMs,
  })))
}

export function groupResolvedRootsBySamplingIntervalV1(
  roots: readonly ResolvedOpcUaClientMonitoredRootV1[],
): readonly ResolvedOpcUaClientMonitoredGroupV1[] {
  const grouped = new Map<number, ResolvedOpcUaClientMonitoredRootV1[]>()
  for (const root of roots) {
    const group = grouped.get(root.samplingIntervalMs) ?? []
    group.push(root)
    grouped.set(root.samplingIntervalMs, group)
  }
  return Object.freeze([...grouped.entries()].map(([samplingIntervalMs, groupedRoots]) => Object.freeze({
    samplingIntervalMs,
    roots: Object.freeze(groupedRoots),
  })))
}

export function valueAtLeafPathV1(input: unknown, path: readonly (string | number)[]): unknown {
  let value = input
  for (const segment of path) {
    if (value === null || typeof value !== 'object') return undefined
    if (typeof segment === 'number') {
      if (!Array.isArray(value) && !ArrayBuffer.isView(value)) return undefined
    }
    value = Reflect.get(value, String(segment))
  }
  return value
}

function normalizeNumericLeaf(
  leaf: OpcUaMappingLeafV5,
  input: unknown,
): LeafValueResultV1 {
  if (typeof input !== 'number' || !Number.isFinite(input)) {
    return { ok: false, statusCode: 'BadTypeMismatch' }
  }
  const integral = leaf.opcUaDataType === 'SByte'
    || leaf.opcUaDataType === 'Byte'
    || leaf.opcUaDataType === 'Int16'
    || leaf.opcUaDataType === 'UInt16'
    || leaf.opcUaDataType === 'Int32'
    || leaf.opcUaDataType === 'UInt32'
  if (integral && !Number.isInteger(input)) return { ok: false, statusCode: 'BadTypeMismatch' }
  const limits: readonly [number, number] | null = leaf.opcUaDataType === 'SByte' ? [-128, 127]
    : leaf.opcUaDataType === 'Byte' ? [0, 255]
    : leaf.opcUaDataType === 'Int16' ? [-32_768, 32_767]
    : leaf.opcUaDataType === 'UInt16' ? [0, 65_535]
    : leaf.opcUaDataType === 'Int32' ? [-2_147_483_648, 2_147_483_647]
    : leaf.opcUaDataType === 'UInt32' ? [0, 4_294_967_295]
    : null
  if (limits !== null && (input < limits[0] || input > limits[1])) {
    return { ok: false, statusCode: 'BadOutOfRange' }
  }
  const scaled = input * leaf.scale + leaf.offset
  if (!Number.isFinite(scaled)) return { ok: false, statusCode: 'BadOutOfRange' }
  return { ok: true, value: leaf.projectDataType === 'integer' ? Math.trunc(scaled) : scaled }
}

function normalizeLeafValue(leaf: OpcUaMappingLeafV5, input: unknown): LeafValueResultV1 {
  if (input === undefined) return { ok: false, statusCode: 'BadNoData' }
  if (leaf.opcUaDataType === 'Boolean') {
    return typeof input === 'boolean'
      ? { ok: true, value: input }
      : { ok: false, statusCode: 'BadTypeMismatch' }
  }
  if (leaf.opcUaDataType === 'String') {
    return typeof input === 'string'
      ? { ok: true, value: input }
      : { ok: false, statusCode: 'BadTypeMismatch' }
  }
  return normalizeNumericLeaf(leaf, input)
}

function setProjectPath(
  target: MutableRuntimeStructureV1,
  path: readonly (string | number)[],
  value: RuntimeScalarOrStructureV1,
): boolean {
  if (path.length === 0) return false
  let current = target
  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index]!
    const nextSegment = path[index + 1]!
    const child = Array.isArray(current)
      ? typeof segment === 'number' ? current[segment] : undefined
      : current[String(segment)]
    if (child !== undefined && typeof child === 'object' && child !== null) {
      if (Array.isArray(current)) {
        if (typeof segment !== 'number') return false
        current = current[segment] as MutableRuntimeStructureV1
      } else {
        current = current[String(segment)] as MutableRuntimeStructureV1
      }
      continue
    }
    const next: MutableRuntimeStructureV1 = typeof nextSegment === 'number' ? [] : {}
    if (Array.isArray(current)) {
      if (typeof segment !== 'number') return false
      current[segment] = next
    } else {
      current[String(segment)] = next
    }
    current = next
  }
  const finalSegment = path.at(-1)
  if (finalSegment === undefined) return false
  if (Array.isArray(current)) {
    if (typeof finalSegment !== 'number') return false
    current[finalSegment] = value
  } else {
    current[String(finalSegment)] = value
  }
  return true
}

function vector3(value: RuntimeScalarOrStructureV1 | undefined): readonly [number, number, number] | null {
  if (!Array.isArray(value) || value.length !== 3) return null
  const [x, y, z] = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return null
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null
  return [x, y, z]
}

function assembledFrameValue(
  structured: Record<string, RuntimeScalarOrStructureV1>,
): RuntimeScalarOrStructureV1 | null {
  const positionM = vector3(structured.positionM)
  const rpyDegrees = vector3(structured.rpyDegrees)
  if (positionM === null || rpyDegrees === null) return null
  return Object.freeze({
    positionM,
    quaternion: rpyDegreesToRuntimeQuaternionV1(rpyDegrees),
  })
}

function assembleMappingValueFromInputsV1(
  mapping: OpcUaMappingV5,
  inputForLeaf: (leaf: OpcUaMappingLeafV5, leafIndex: number) => unknown,
): AssembleMappingValueResultV1 {
  const firstLeaf = mapping.leaves[0]
  if (firstLeaf === undefined) return { ok: false, statusCode: 'BadNoData' }
  if (mapping.leaves.length === 1 && firstLeaf.projectPath.length === 0) {
    const normalized = normalizeLeafValue(firstLeaf, inputForLeaf(firstLeaf, 0))
    return normalized.ok
      ? { ok: true, value: normalized.value, unit: firstLeaf.unit }
      : normalized
  }

  const structured: Record<string, RuntimeScalarOrStructureV1> = {}
  for (const [leafIndex, leaf] of mapping.leaves.entries()) {
    const normalized = normalizeLeafValue(leaf, inputForLeaf(leaf, leafIndex))
    if (!normalized.ok) return normalized
    if (!setProjectPath(structured, leaf.projectPath, normalized.value)) {
      return { ok: false, statusCode: 'BadTypeMismatch' }
    }
  }
  const target = firstLeaf.projectTarget
  if (target.type === 'entity-frame' || target.type === 'robot-frame') {
    const frame = assembledFrameValue(structured)
    return frame === null
      ? { ok: false, statusCode: 'BadTypeMismatch' }
      : { ok: true, value: frame, unit: mapping.coordinateConvention }
  }
  return { ok: true, value: Object.freeze(structured), unit: firstLeaf.unit }
}

export function assembleMappingValueV1(
  mapping: OpcUaMappingV5,
  rootValue: unknown,
): AssembleMappingValueResultV1 {
  return assembleMappingValueFromInputsV1(
    mapping,
    (leaf) => valueAtLeafPathV1(rootValue, leaf.leafPath),
  )
}

export function assembleMappingValueFromLeafValuesV1(
  mapping: OpcUaMappingV5,
  leafValues: ReadonlyMap<number, unknown>,
): AssembleMappingValueResultV1 {
  return assembleMappingValueFromInputsV1(
    mapping,
    (_leaf, leafIndex) => leafValues.get(leafIndex),
  )
}
