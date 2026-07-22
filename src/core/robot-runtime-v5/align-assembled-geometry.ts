import { failProjectV5 } from '../project-v5/errors.js'
import {
  normalizeRigidTransformV5,
  relativeRigidTransformV5,
  type RigidTransformV5,
} from '../project-v5/rigid-transform.js'
import type { RobotDefinitionV5, RobotLinkDefinitionV5 } from '../project-v5/types.js'
import { computeSerialRobotPoseV5 } from './serial-kinematics.js'

function invalid(code: string, path: string, message: string): never {
  failProjectV5(code, path, message, 'Correct the assembled Geometry poses and try again.')
}

function normalizedAssembledPose(value: unknown, path: string): RigidTransformV5 {
  if (value === null || typeof value !== 'object') {
    invalid('PROJECT_VALUE_INVALID', path, 'Assembled Geometry pose must be an object.')
  }
  const record = value as { positionM?: unknown; quaternion?: unknown }
  if (!Array.isArray(record.positionM) || record.positionM.length !== 3 || !Array.isArray(record.quaternion) || record.quaternion.length !== 4
    || record.positionM.some((component) => typeof component !== 'number')
    || record.quaternion.some((component) => typeof component !== 'number')) {
    invalid('PROJECT_VALUE_INVALID', path, 'Assembled Geometry pose must contain position and quaternion tuples.')
  }
  return normalizeRigidTransformV5({
    positionM: [record.positionM[0] as number, record.positionM[1] as number, record.positionM[2] as number],
    quaternion: [record.quaternion[0] as number, record.quaternion[1] as number, record.quaternion[2] as number, record.quaternion[3] as number],
  }, path)
}

function occurrenceWorldPoseMap(
  definition: RobotDefinitionV5,
  assembledOccurrenceWorldPoses: Readonly<Record<string, RigidTransformV5>>,
): ReadonlyMap<string, RigidTransformV5> {
  if (assembledOccurrenceWorldPoses === null || typeof assembledOccurrenceWorldPoses !== 'object' || Array.isArray(assembledOccurrenceWorldPoses)) {
    invalid('GEOMETRY_OCCURRENCE_ALIGNMENT_MISMATCH', '$.geometryAlignment.occurrenceWorldPoses', 'Assembled Geometry poses must be a record.')
  }
  const expected = new Set<string>()
  const values = new Map<string, RigidTransformV5>()
  definition.links.forEach((link, linkIndex) => link.geometryOccurrences.forEach((occurrence, occurrenceIndex) => {
    const path = `$.definition.links[${linkIndex}].geometryOccurrences[${occurrenceIndex}].occurrenceKey`
    if (typeof occurrence.occurrenceKey !== 'string' || occurrence.occurrenceKey.length === 0) {
      invalid('PROJECT_ID_INVALID', path, 'Geometry occurrence key must be a non-empty string.')
    }
    if (expected.has(occurrence.occurrenceKey)) {
      invalid('GEOMETRY_OCCURRENCE_DUPLICATE', path, 'Geometry occurrence is included more than once.')
    }
    expected.add(occurrence.occurrenceKey)
  }))
  const suppliedKeys = Reflect.ownKeys(assembledOccurrenceWorldPoses)
  if (suppliedKeys.some((key) => typeof key !== 'string') || suppliedKeys.length !== expected.size || suppliedKeys.some((key) => !expected.has(key as string))) {
    invalid('GEOMETRY_OCCURRENCE_ALIGNMENT_MISMATCH', '$.geometryAlignment.occurrenceWorldPoses', 'Assembled Geometry poses must match canonical Geometry occurrences exactly once.')
  }
  for (const key of suppliedKeys as string[]) {
    const descriptor = Object.getOwnPropertyDescriptor(assembledOccurrenceWorldPoses, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalid('PROJECT_VALUE_INVALID', `$.geometryAlignment.occurrenceWorldPoses.${key}`, 'Assembled Geometry poses must use enumerable own data properties.')
    }
    values.set(key, normalizedAssembledPose(descriptor.value, `$.geometryAlignment.occurrenceWorldPoses.${key}`))
  }
  return values
}

function mapGeometryOccurrences(
  definition: RobotDefinitionV5,
  mapOccurrence: (linkId: string, occurrence: RobotLinkDefinitionV5['geometryOccurrences'][number]) => RobotLinkDefinitionV5['geometryOccurrences'][number],
): RobotDefinitionV5 {
  const links = Object.freeze(definition.links.map((link) => Object.freeze({
    ...link,
    geometryOccurrences: Object.freeze(link.geometryOccurrences.map((occurrence) => Object.freeze(mapOccurrence(link.id, occurrence)))),
  })))
  return Object.freeze({ ...definition, links })
}

export function homeJointValuesV5(definition: RobotDefinitionV5): Readonly<Record<string, number>> {
  return Object.freeze(Object.fromEntries(definition.joints.map((joint) => [joint.id, joint.home])))
}

export function alignAssembledGeometryV5(
  definition: RobotDefinitionV5,
  assembledOccurrenceWorldPoses: Readonly<Record<string, RigidTransformV5>>,
): RobotDefinitionV5 {
  const assembled = occurrenceWorldPoseMap(definition, assembledOccurrenceWorldPoses)
  const home = computeSerialRobotPoseV5(definition, homeJointValuesV5(definition))
  return mapGeometryOccurrences(definition, (linkId, occurrence) => ({
    ...occurrence,
    linkLocalPose: relativeRigidTransformV5(home.linkWorldPoses[linkId]!, assembled.get(occurrence.occurrenceKey)!),
  }))
}
