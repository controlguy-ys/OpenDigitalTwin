import { failMechanismV1, MechanismErrorV1 } from './errors.js'
import { createSolverRegistryV1, type SolverRegistryV1 } from './solver-registry.js'
import { createTreeKinematicsSolverV1 } from './tree-kinematics-solver.js'
import { frozenNullPrototypeRecordV1, normalizeMechanismRigidTransformV1 } from './validation-support.js'
import type {
  ForwardKinematicsRequestV1,
  ForwardKinematicsResultV1,
  MechanismDefinitionV1,
  RigidTransformV1,
} from './types.js'

export interface CompiledMechanismEvaluatorV1 {
  readonly definition: MechanismDefinitionV1
  readonly solverKey: string
  readonly solverContractVersion: string
  readonly normalizedSolverParametersHash: string
  readonly evaluateForward: (
    request: Omit<ForwardKinematicsRequestV1, 'mechanismDefinition'>,
  ) => ForwardKinematicsResultV1
}

export interface ApplicationKinematicsServiceV1 {
  readonly compile: (definition: MechanismDefinitionV1) => CompiledMechanismEvaluatorV1
}

function invalidDefinition(path: string): never {
  return failMechanismV1('MECHANISM_VALUE_INVALID', path, 'Definition must contain detached canonical data properties.')
}

function cloneFrozenValue(value: unknown, path: string, ancestors = new WeakSet<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalidDefinition(path)
  if (typeof value !== 'object' || ancestors.has(value)) invalidDefinition(path)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) invalidDefinition(path)
      const output: unknown[] = []
      for (const key of Reflect.ownKeys(value)) {
        if (typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) invalidDefinition(path)
      }
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidDefinition(`${path}[${index}]`)
        output.push(cloneFrozenValue(descriptor.value, `${path}[${index}]`, ancestors))
      }
      return Object.freeze(output)
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) invalidDefinition(path)
    const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') invalidDefinition(path)
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidDefinition(`${path}.${key}`)
      Object.defineProperty(output, key, {
        configurable: false,
        enumerable: true,
        value: cloneFrozenValue(descriptor.value, `${path}.${key}`, ancestors),
        writable: false,
      })
    }
    return Object.freeze(output)
  } finally {
    ancestors.delete(value)
  }
}

function compiledDefinition(definition: MechanismDefinitionV1): MechanismDefinitionV1 {
  return cloneFrozenValue(definition, '$') as MechanismDefinitionV1
}

function validateUniqueMotionGroupIds(definition: MechanismDefinitionV1): void {
  const motionGroups: unknown = definition.motionGroups
  if (!Array.isArray(motionGroups) || Object.getPrototypeOf(motionGroups) !== Array.prototype) return
  const motionGroupIds = new Set<string>()
  for (let index = 0; index < motionGroups.length; index += 1) {
    const entry = Object.getOwnPropertyDescriptor(motionGroups, String(index))
    if (entry === undefined || !entry.enumerable || !('value' in entry)) return
    const group = entry.value
    if (group === null || typeof group !== 'object' || Array.isArray(group)) return
    const prototype = Object.getPrototypeOf(group)
    if (prototype !== Object.prototype && prototype !== null) return
    const id = Object.getOwnPropertyDescriptor(group, 'motionGroupId')
    if (id === undefined || !id.enumerable || !('value' in id) || typeof id.value !== 'string') return
    const motionGroupId = id.value
    if (motionGroupIds.has(motionGroupId)) {
      failMechanismV1(
        'MECHANISM_ID_DUPLICATE',
        `$.motionGroups[${index}].motionGroupId`,
        'Motion Group IDs must be unique.',
      )
    }
    motionGroupIds.add(motionGroupId)
  }
}

function throwFirstValidationError(report: ReturnType<import('./types.js').KinematicsSolverV1['validateDefinition']>): void {
  if (report.valid) return
  const finding = report.errors[0]
  if (finding === undefined) {
    failMechanismV1('MECHANISM_VALUE_INVALID', '$', 'Solver rejected the Definition without a validation finding.')
  }
  failMechanismV1(finding.code as MechanismErrorV1['code'], finding.path, finding.message, finding.recovery)
}

function invalidResult(path: string, message = 'Solver result does not match the compiled Mechanism contract.'): never {
  return failMechanismV1('SOLVER_RESULT_INVALID', path, message)
}

function deeplyFrozen(value: unknown, seen = new WeakSet<object>()): boolean {
  if (value === null || typeof value !== 'object' || seen.has(value)) return true
  if (!Object.isFrozen(value)) return false
  seen.add(value)
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (descriptor === undefined || !('value' in descriptor) || !deeplyFrozen(descriptor.value, seen)) return false
  }
  return true
}

function dataRecord(value: unknown, path: string, keys: readonly string[], requireNullPrototype = false): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalidResult(path)
  const prototype = Object.getPrototypeOf(value)
  if ((requireNullPrototype && prototype !== null) || (!requireNullPrototype && prototype !== Object.prototype && prototype !== null)) invalidResult(path)
  const record = value as Record<string, unknown>
  const expected = new Set(keys)
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== 'string' || !expected.has(key)) invalidResult(`${path}.${String(key)}`)
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidResult(`${path}.${key}`)
  }
  for (const key of keys) {
    if (!Object.hasOwn(record, key)) invalidResult(`${path}.${key}`)
  }
  return record
}

function dataArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalidResult(path)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || (key !== 'length' && !/^(0|[1-9]\d*)$/.test(key))) invalidResult(path)
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalidResult(`${path}[${index}]`)
  }
  return value
}

function stableIds(ids: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(ids)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0))
}

function frozenPose(value: unknown, path: string): RigidTransformV1 {
  const record = dataRecord(value, path, ['positionM', 'quaternion'])
  const position = dataArray(record.positionM, `${path}.positionM`)
  const quaternion = dataArray(record.quaternion, `${path}.quaternion`)
  if (position.length !== 3 || quaternion.length !== 4) invalidResult(path)
  if (![...position, ...quaternion].every((component) => typeof component === 'number' && Number.isFinite(component))) invalidResult(path)
  const raw = {
    positionM: [position[0], position[1], position[2]] as [number, number, number],
    quaternion: [quaternion[0], quaternion[1], quaternion[2], quaternion[3]] as [number, number, number, number],
  }
  let normalized: RigidTransformV1
  try {
    normalized = normalizeMechanismRigidTransformV1(raw, path)
  } catch {
    return invalidResult(path)
  }
  const canonical = (component: number): number => component === 0 ? 0 : component
  if (!raw.positionM.every((component, index) => Object.is(component, canonical(normalized.positionM[index]!)))
    || !raw.quaternion.every((component, index) => Object.is(component, canonical(normalized.quaternion[index]!)))) {
    invalidResult(path, 'Solver transform must already be finite and normalized.')
  }
  return Object.freeze({
    positionM: Object.freeze(normalized.positionM.map(canonical) as [number, number, number]),
    quaternion: Object.freeze(normalized.quaternion.map(canonical) as [number, number, number, number]),
  })
}

function frozenCoordinateRecord(value: unknown, expectedIds: readonly string[], path: string): Readonly<Record<string, number>> {
  const record = dataRecord(value, path, expectedIds, true)
  return frozenNullPrototypeRecordV1(expectedIds.map((id) => {
    const coordinate = record[id]
    if (typeof coordinate !== 'number' || !Number.isFinite(coordinate)) invalidResult(`${path}.${id}`)
    return [id, coordinate === 0 ? 0 : coordinate] as const
  }))
}

function frozenPoseRecord(value: unknown, expectedIds: readonly string[], path: string): Readonly<Record<string, RigidTransformV1>> {
  const record = dataRecord(value, path, expectedIds, true)
  return frozenNullPrototypeRecordV1(expectedIds.map((id) => [id, frozenPose(record[id], `${path}.${id}`)] as const))
}

function requestedFrameIds(
  definition: MechanismDefinitionV1,
  requested: ForwardKinematicsRequestV1['requestedFrameIds'],
): readonly string[] {
  if (requested === undefined) return stableIds(definition.frames.map(({ frameId }) => frameId))
  const values = dataArray(requested, '$.requestedFrameIds')
  const known = new Set(definition.frames.map(({ frameId }) => frameId))
  const ids = values.map((value, index) => typeof value === 'string' ? value : invalidResult(`$.requestedFrameIds[${index}]`))
  if (ids.some((id) => !known.has(id))) invalidResult('$.requestedFrameIds')
  return stableIds(ids)
}

function frozenWarnings(value: unknown): ForwardKinematicsResultV1['warnings'] {
  const warnings = dataArray(value, '$.warnings')
  return Object.freeze(warnings.map((warning, index) => {
    const record = dataRecord(warning, `$.warnings[${index}]`, ['code', 'path', 'message'])
    if (typeof record.code !== 'string' || typeof record.path !== 'string' || typeof record.message !== 'string') invalidResult(`$.warnings[${index}]`)
    return Object.freeze({ code: record.code, path: record.path, message: record.message })
  }))
}

function validateSolverResult(
  value: unknown,
  definition: MechanismDefinitionV1,
  normalizedCoordinates: Readonly<Record<string, number>>,
  requestedFrameIdsSnapshot: readonly string[] | undefined,
  requestedMotionGroupId: string | undefined,
): ForwardKinematicsResultV1 {
  if (!deeplyFrozen(value)) invalidResult('$')
  const result = dataRecord(value, '$', [
    'solverKey', 'solverContractVersion', 'normalizedCoordinates', 'bodyLocalPoses', 'bodyWorldPoses',
    'frameWorldPoses', 'motionGroupEndFramePoses', 'warnings',
  ])
  if (result.solverKey !== definition.solverRef.solverKey || result.solverContractVersion !== definition.solverRef.contractVersion) {
    invalidResult('$.solverKey')
  }
  const coordinateIds = stableIds(definition.joints.filter((joint) => joint.jointType !== 'fixed').map(({ jointId }) => jointId))
  const resultCoordinates = frozenCoordinateRecord(result.normalizedCoordinates, coordinateIds, '$.normalizedCoordinates')
  for (const coordinateId of coordinateIds) if (!Object.is(resultCoordinates[coordinateId], normalizedCoordinates[coordinateId])) invalidResult(`$.normalizedCoordinates.${coordinateId}`)
  const bodyIds = stableIds(definition.bodies.map(({ bodyId }) => bodyId))
  const frameIds = requestedFrameIdsSnapshot ?? stableIds(definition.frames.map(({ frameId }) => frameId))
  const groups = requestedMotionGroupId === undefined
    ? definition.motionGroups.slice().sort((left, right) => left.motionGroupId < right.motionGroupId ? -1 : left.motionGroupId > right.motionGroupId ? 1 : 0)
    : definition.motionGroups.filter(({ motionGroupId }) => motionGroupId === requestedMotionGroupId)
  if (requestedMotionGroupId !== undefined && groups.length !== 1) invalidResult('$.requestedMotionGroupId')
  const groupIds = groups.map(({ motionGroupId }) => motionGroupId)
  const groupRecord = dataRecord(result.motionGroupEndFramePoses, '$.motionGroupEndFramePoses', groupIds, true)
  return Object.freeze({
    solverKey: definition.solverRef.solverKey,
    solverContractVersion: definition.solverRef.contractVersion,
    normalizedCoordinates: resultCoordinates,
    bodyLocalPoses: frozenPoseRecord(result.bodyLocalPoses, bodyIds, '$.bodyLocalPoses'),
    bodyWorldPoses: frozenPoseRecord(result.bodyWorldPoses, bodyIds, '$.bodyWorldPoses'),
    frameWorldPoses: frozenPoseRecord(result.frameWorldPoses, frameIds, '$.frameWorldPoses'),
    motionGroupEndFramePoses: frozenNullPrototypeRecordV1(groups.map((group) => [
      group.motionGroupId,
      frozenPoseRecord(groupRecord[group.motionGroupId], stableIds(group.endFrameIds), `$.motionGroupEndFramePoses.${group.motionGroupId}`),
    ] as const)),
    warnings: frozenWarnings(result.warnings),
  })
}

export function createApplicationKinematicsServiceV1(
  registry: SolverRegistryV1,
): ApplicationKinematicsServiceV1 {
  return Object.freeze({
    compile: (definition: MechanismDefinitionV1) => {
      const canonicalDefinition = compiledDefinition(definition)
      validateUniqueMotionGroupIds(canonicalDefinition)
      const solver = registry['require'](canonicalDefinition.solverRef.solverKey, canonicalDefinition.solverRef.contractVersion)
      throwFirstValidationError(solver.validateDefinition(canonicalDefinition))
      return Object.freeze({
        definition: canonicalDefinition,
        solverKey: canonicalDefinition.solverRef.solverKey,
        solverContractVersion: canonicalDefinition.solverRef.contractVersion,
        normalizedSolverParametersHash: canonicalDefinition.solverRef.normalizedParametersHash,
        evaluateForward: (request: Omit<ForwardKinematicsRequestV1, 'mechanismDefinition'>) => {
          const normalizedCoordinates = solver.normalizeCoordinates(canonicalDefinition, request.coordinatesByStableId)
          const coordinateIds = stableIds(canonicalDefinition.joints.filter((joint) => joint.jointType !== 'fixed').map(({ jointId }) => jointId))
          const canonicalCoordinates = frozenCoordinateRecord(normalizedCoordinates, coordinateIds, '$.normalizedCoordinates')
          const requestedFrameIdsSnapshot = request.requestedFrameIds === undefined
            ? undefined
            : requestedFrameIds(canonicalDefinition, request.requestedFrameIds)
          const forwardedRequest: ForwardKinematicsRequestV1 = {
            mechanismDefinition: canonicalDefinition,
            rootWorldPose: request.rootWorldPose,
            coordinatesByStableId: canonicalCoordinates,
            ...(requestedFrameIdsSnapshot === undefined ? {} : { requestedFrameIds: requestedFrameIdsSnapshot }),
            ...(request.requestedMotionGroupId === undefined ? {} : { requestedMotionGroupId: request.requestedMotionGroupId }),
          }
          const result = solver.evaluateForward(forwardedRequest)
          return validateSolverResult(
            result,
            canonicalDefinition,
            canonicalCoordinates,
            requestedFrameIdsSnapshot,
            request.requestedMotionGroupId,
          )
        },
      })
    },
  })
}

export function createDefaultApplicationKinematicsServiceV1(): ApplicationKinematicsServiceV1 {
  return createApplicationKinematicsServiceV1(createSolverRegistryV1([createTreeKinematicsSolverV1()]))
}
