import {
  validateOpcUaNodeAddressV1,
  type OpcUaMappingLeafV5,
  type OpcUaMappingV5,
  type OpcUaProjectTargetV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'

export const FRAME_PROJECT_PATHS_V1 = Object.freeze([
  ['positionM', 0],
  ['positionM', 1],
  ['positionM', 2],
  ['rpyDegrees', 0],
  ['rpyDegrees', 1],
  ['rpyDegrees', 2],
] as const)

export const FRAME_LEAF_LABELS_V1 = Object.freeze(['X', 'Y', 'Z', 'Roll', 'Pitch', 'Yaw'] as const)

export interface BindingTargetOptionV1 {
  readonly target: OpcUaProjectTargetV5
  readonly label: string
}

export interface BindingMappingDraftV1 {
  readonly mappingId: string
  readonly target: OpcUaProjectTargetV5
  readonly endpointId: string
  readonly namespaceUri: string
  readonly identifierType: 'string' | 'numeric' | 'guid' | 'byteString'
  readonly identifier: string
  readonly direction: OpcUaMappingV5['direction']
  readonly publishingIntervalMs: string
  readonly coherenceGroupId: string
  readonly interpolationMode: OpcUaMappingV5['interpolationMode']
  readonly scalarUnit: string
  readonly leafPaths: readonly string[]
  readonly leafTemplates: readonly OpcUaMappingLeafV5[]
}

function targetKey(target: OpcUaProjectTargetV5): string {
  if (target.type === 'robot-joint') return JSON.stringify([target.type, target.robotId, target.jointId])
  if (target.type === 'robot-frame') return JSON.stringify([target.type, target.robotId, target.frameId])
  if (target.type === 'robot-status') return JSON.stringify([target.type, target.robotId])
  if (target.type === 'entity-frame') return JSON.stringify([target.type, target.entityId, target.frameId])
  if (target.type === 'entity-status') return JSON.stringify([target.type, target.entityId])
  return JSON.stringify([target.type, target.signalId])
}

function targetOf(mapping: OpcUaMappingV5): OpcUaProjectTargetV5 {
  const target = mapping.leaves[0]?.projectTarget
  if (target === undefined) throw new Error('BINDING_MAPPING_TARGET_MISSING')
  return target
}

function sameTarget(left: OpcUaProjectTargetV5, right: OpcUaProjectTargetV5): boolean {
  return targetKey(left) === targetKey(right)
}

function sameOwnershipScope(left: OpcUaProjectTargetV5, right: OpcUaProjectTargetV5): boolean {
  if (left.type === 'robot-joint' && right.type === 'robot-joint') return left.robotId === right.robotId
  if (left.type === 'entity-frame' && right.type === 'entity-frame') return left.entityId === right.entityId
  return sameTarget(left, right)
}

export function bindingTargetKeyV1(target: OpcUaProjectTargetV5): string {
  return targetKey(target)
}

export function availableBindingTargetsV1(project: WorkcellProjectV5): readonly BindingTargetOptionV1[] {
  const options: BindingTargetOptionV1[] = []
  for (const entity of project.spatialEntities) {
    for (const frame of entity.movingFrames) {
      options.push({
        target: { type: 'entity-frame', entityId: entity.id, frameId: frame.frameId },
        label: `${entity.name} / Pose / ${frame.name}`,
      })
    }
    options.push({
      target: { type: 'entity-status', entityId: entity.id },
      label: `${entity.name} / Status`,
    })
  }
  for (const robot of project.robots) {
    const definition = project.robotDefinitions.find(({ id }) => id === robot.definitionId)
    if (definition === undefined) continue
    for (const joint of definition.joints) {
      options.push({
        target: { type: 'robot-joint', robotId: robot.id, jointId: joint.id },
        label: `${robot.name} / Joint / ${joint.id}`,
      })
    }
    for (const frame of definition.frames) {
      options.push({
        target: { type: 'robot-frame', robotId: robot.id, frameId: frame.id },
        label: `${robot.name} / Frame / ${frame.name}`,
      })
    }
    options.push({
      target: { type: 'robot-status', robotId: robot.id },
      label: `${robot.name} / Status`,
    })
  }
  return Object.freeze(options)
}

function robotJointType(
  project: WorkcellProjectV5,
  target: Extract<OpcUaProjectTargetV5, { readonly type: 'robot-joint' }>,
): 'revolute' | 'prismatic' | null {
  const robot = project.robots.find(({ id }) => id === target.robotId)
  const definition = robot === undefined
    ? undefined
    : project.robotDefinitions.find(({ id }) => id === robot.definitionId)
  return definition?.joints.find(({ id }) => id === target.jointId)?.type ?? null
}

function defaultInterpolation(
  project: WorkcellProjectV5,
  target: OpcUaProjectTargetV5,
): OpcUaMappingV5['interpolationMode'] {
  if (target.type === 'entity-frame' || target.type === 'robot-frame') return 'shortest-quaternion'
  if (target.type === 'robot-joint') return robotJointType(project, target) === 'prismatic' ? 'linear' : 'revolute-wrapped'
  return 'none'
}

function defaultLeafPaths(target: OpcUaProjectTargetV5): readonly string[] {
  if (target.type === 'entity-frame' || target.type === 'robot-frame') {
    return Object.freeze(FRAME_LEAF_LABELS_V1.map((label) => JSON.stringify([label])))
  }
  return Object.freeze(['[]'])
}

function scalarUnitFor(project: WorkcellProjectV5, target: OpcUaProjectTargetV5): string {
  if (target.type !== 'robot-joint') return 'number'
  return robotJointType(project, target) === 'prismatic'
    ? 'metre'
    : 'degree'
}

export function createBindingMappingDraftV1(
  project: WorkcellProjectV5,
  target: OpcUaProjectTargetV5,
  mappingId: string,
  selection: { readonly existingMappingId?: string; readonly createNew?: boolean } = {},
): BindingMappingDraftV1 {
  const existing = selection.createNew === true
    ? undefined
    : selection.existingMappingId === undefined
      ? project.opcUa.mappings.find((mapping) => sameTarget(targetOf(mapping), target))
      : project.opcUa.mappings.find((mapping) => (
          mapping.id === selection.existingMappingId
          && sameTarget(targetOf(mapping), target)
        ))
  if (
    selection.createNew !== true
    && selection.existingMappingId !== undefined
    && existing === undefined
  ) {
    throw new Error('BINDING_MAPPING_NOT_FOUND')
  }
  if (existing !== undefined) {
    const orderedLeaves = target.type === 'entity-frame' || target.type === 'robot-frame'
      ? FRAME_PROJECT_PATHS_V1.map((projectPath) => {
          const leaf = existing.leaves.find((candidate) => (
            JSON.stringify(candidate.projectPath) === JSON.stringify(projectPath)
          ))
          if (leaf === undefined) throw new Error('BINDING_FRAME_PROJECT_PATH_MISSING')
          return leaf
        })
      : [...existing.leaves]
    return Object.freeze({
      mappingId: existing.id,
      target,
      endpointId: existing.endpointId,
      namespaceUri: existing.nodeAddress.namespaceUri,
      identifierType: existing.nodeAddress.identifierType,
      identifier: existing.nodeAddress.identifier,
      direction: existing.direction,
      publishingIntervalMs: existing.publishingIntervalMs === undefined ? '' : String(existing.publishingIntervalMs),
      coherenceGroupId: existing.coherenceGroupId ?? '',
      interpolationMode: existing.interpolationMode,
      scalarUnit: existing.leaves[0]?.unit ?? scalarUnitFor(project, target),
      leafPaths: Object.freeze(orderedLeaves.map(({ leafPath }) => JSON.stringify(leafPath))),
      leafTemplates: Object.freeze(structuredClone(orderedLeaves)),
    })
  }
  const scalarUnit = scalarUnitFor(project, target)
  const leafTemplates = defaultLeafTemplates(target, scalarUnit)
  return Object.freeze({
    mappingId,
    target,
    endpointId: project.opcUa.endpoints[0]?.endpointId ?? '',
    namespaceUri: 'urn:controller',
    identifierType: 'string',
    identifier: '',
    direction: 'read',
    publishingIntervalMs: '',
    coherenceGroupId: target.type === 'entity-frame' || target.type === 'robot-frame' ? mappingId : '',
    interpolationMode: defaultInterpolation(project, target),
    scalarUnit,
    leafPaths: defaultLeafPaths(target),
    leafTemplates,
  })
}

function leafPath(value: string): readonly (string | number)[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('BINDING_LEAF_PATH_JSON_INVALID')
  }
  if (
    !Array.isArray(parsed)
    || parsed.some((segment) => (
      typeof segment !== 'string'
      && (!Number.isSafeInteger(segment) || (segment as number) < 0)
    ))
  ) {
    throw new Error('BINDING_LEAF_PATH_JSON_INVALID')
  }
  return Object.freeze(parsed as (string | number)[])
}

function defaultLeafTemplates(
  target: OpcUaProjectTargetV5,
  scalarUnit: string,
): readonly OpcUaMappingLeafV5[] {
  if (target.type === 'entity-frame' || target.type === 'robot-frame') {
    return Object.freeze(FRAME_PROJECT_PATHS_V1.map((projectPath, index) => Object.freeze({
      leafPath: Object.freeze([FRAME_LEAF_LABELS_V1[index]!]),
      projectPath,
      projectTarget: target,
      opcUaDataType: 'Double' as const,
      projectDataType: 'number' as const,
      scale: 1,
      offset: 0,
      unit: index < 3 ? 'metre' : 'degree',
      required: true,
    })))
  }
  return Object.freeze([Object.freeze({
    leafPath: Object.freeze([]),
    projectPath: Object.freeze([]),
    projectTarget: target,
    opcUaDataType: 'Double' as const,
    projectDataType: 'number' as const,
    scale: 1,
    offset: 0,
    unit: scalarUnit,
    required: true,
  })])
}

function leavesFor(draft: BindingMappingDraftV1): readonly OpcUaMappingLeafV5[] {
  const target = draft.target
  if (target.type === 'entity-frame' || target.type === 'robot-frame') {
    if (
      draft.leafPaths.length !== FRAME_PROJECT_PATHS_V1.length
      || draft.leafTemplates.length !== FRAME_PROJECT_PATHS_V1.length
    ) {
      throw new Error('BINDING_FRAME_LEAF_COUNT_INVALID')
    }
    return Object.freeze(FRAME_PROJECT_PATHS_V1.map((projectPath, index) => Object.freeze({
      ...draft.leafTemplates[index]!,
      leafPath: leafPath(draft.leafPaths[index] ?? ''),
      projectPath,
      projectTarget: target,
    })))
  }
  if (draft.leafTemplates.length !== 1 || draft.leafPaths.length !== 1) {
    throw new Error('BINDING_SCALAR_LEAF_COUNT_INVALID')
  }
  return Object.freeze([Object.freeze({
    ...draft.leafTemplates[0]!,
    leafPath: leafPath(draft.leafPaths[0] ?? ''),
    projectPath: Object.freeze([]),
    projectTarget: target,
  })])
}

export function mappingFromBindingDraftV1(draft: BindingMappingDraftV1): OpcUaMappingV5 {
  if (draft.mappingId.trim().length === 0 || draft.endpointId.trim().length === 0) throw new Error('BINDING_REQUIRED_FIELD_MISSING')
  const publishingInterval = draft.publishingIntervalMs.trim()
  const publishingIntervalMs = publishingInterval.length === 0 ? undefined : Number(publishingInterval)
  if (publishingIntervalMs !== undefined && (!Number.isSafeInteger(publishingIntervalMs) || publishingIntervalMs < 1)) {
    throw new Error('BINDING_PUBLISHING_INTERVAL_INVALID')
  }
  const nodeAddress = validateOpcUaNodeAddressV1({
    namespaceUri: draft.namespaceUri.trim(),
    identifierType: draft.identifierType,
    identifier: draft.identifier,
  }, '$.nodeAddress')
  return Object.freeze({
    id: draft.mappingId.trim(),
    endpointId: draft.endpointId,
    nodeAddress,
    direction: draft.direction,
    ...(publishingIntervalMs === undefined ? {} : { publishingIntervalMs }),
    coherenceGroupId: draft.coherenceGroupId.trim() || null,
    interpolationMode: draft.interpolationMode,
    coordinateConvention: 'project-v5-z-up-metres-quaternion-xyzw',
    leaves: leavesFor(draft),
  })
}

function withOwner(
  project: WorkcellProjectV5,
  target: OpcUaProjectTargetV5,
  owner: `opcua:${string}` | 'manual',
): WorkcellProjectV5 {
  if (target.type === 'robot-joint') {
    return { ...project, robots: project.robots.map((robot) => robot.id === target.robotId ? { ...robot, jointSource: owner } : robot) }
  }
  if (target.type === 'robot-frame') {
    return {
      ...project,
      robots: project.robots.map((robot) => robot.id === target.robotId
        ? { ...robot, frameSources: { ...robot.frameSources, [target.frameId]: owner } }
        : robot),
    }
  }
  if (target.type === 'robot-status') {
    return {
      ...project,
      robots: project.robots.map((robot) => robot.id === target.robotId
        ? { ...robot, numericStatus: { ...robot.numericStatus, sourceOwnership: owner } }
        : robot),
    }
  }
  if (target.type === 'entity-frame') {
    return {
      ...project,
      spatialEntities: project.spatialEntities.map((entity) => entity.id === target.entityId
        ? {
            ...entity,
            transformOwner: owner,
            movingFrames: entity.movingFrames.map((frame) => (
              frame.frameId === target.frameId
              || (owner === 'manual' && frame.sourceOwnership.startsWith('opcua:'))
            ) ? { ...frame, sourceOwnership: owner } : frame),
          }
        : entity),
    }
  }
  if (target.type === 'entity-status') {
    return {
      ...project,
      spatialEntities: project.spatialEntities.map((entity) => entity.id === target.entityId
        ? { ...entity, numericStatus: { ...entity.numericStatus, sourceOwnership: owner } }
        : entity),
    }
  }
  return project
}

export function saveBindingMappingV1(
  project: WorkcellProjectV5,
  draft: BindingMappingDraftV1,
): WorkcellProjectV5 {
  const mapping = mappingFromBindingDraftV1(draft)
  const index = project.opcUa.mappings.findIndex(({ id }) => id === mapping.id)
  const mappings = [...project.opcUa.mappings]
  if (index < 0) mappings.push(mapping)
  else mappings[index] = mapping
  const configured = {
    ...project,
    opcUa: { ...project.opcUa, mappings },
  }
  if (mapping.direction !== 'write') {
    return withOwner(configured, draft.target, `opcua:${mapping.endpointId}`)
  }
  return configured
}

export function removeBindingMappingV1(
  project: WorkcellProjectV5,
  mappingId: string,
): WorkcellProjectV5 {
  const removed = project.opcUa.mappings.find(({ id }) => id === mappingId)
  if (removed === undefined) return project
  const mappings = project.opcUa.mappings.filter(({ id }) => id !== mappingId)
  const bridgeRoutes = project.opcUa.bridgeRoutes.filter(({ sourceMappingId, destinationMappingId }) => (
    sourceMappingId !== mappingId && destinationMappingId !== mappingId
  ))
  const configured = { ...project, opcUa: { ...project.opcUa, mappings, bridgeRoutes } }
  return configured
}

export function takeManualBindingOwnershipV1(
  project: WorkcellProjectV5,
  target: OpcUaProjectTargetV5,
): WorkcellProjectV5 {
  const removedIds = new Set(project.opcUa.mappings
    .filter((mapping) => mapping.direction !== 'write' && sameOwnershipScope(targetOf(mapping), target))
    .map(({ id }) => id))
  const mappings = project.opcUa.mappings.filter(({ id }) => !removedIds.has(id))
  const bridgeRoutes = project.opcUa.bridgeRoutes.filter(({ sourceMappingId, destinationMappingId }) => (
    !removedIds.has(sourceMappingId) && !removedIds.has(destinationMappingId)
  ))
  return withOwner({ ...project, opcUa: { ...project.opcUa, mappings, bridgeRoutes } }, target, 'manual')
}

export function bindingTargetLabelV1(project: WorkcellProjectV5, target: OpcUaProjectTargetV5): string {
  return availableBindingTargetsV1(project).find((option) => sameTarget(option.target, target))?.label
    ?? targetKey(target)
}
