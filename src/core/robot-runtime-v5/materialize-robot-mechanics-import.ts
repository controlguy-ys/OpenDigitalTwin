import { failProjectV5 } from '../project-v5/errors.js'
import type { RobotDefinitionV5, RobotMechanicsMetadataV1 } from '../project-v5/types.js'
import { clonePlainDataV5 } from '../project-v5/validation-support.js'
import { validateRobotDefinitionShapeV5 } from '../project-v5/validate-shape.js'
import { alignAssembledGeometryV5 } from './align-assembled-geometry.js'
import { canonicalizeRobotMechanicsV5 } from './canonicalize-robot-mechanics.js'
import type { RobotMechanicsImportCandidateV1 } from './robot-mechanics-import-candidate.js'

function invalid(path: string, message: string): never {
  failProjectV5('PROJECT_VALUE_INVALID', path, message, 'Correct the Robot mechanics import candidate and try again.')
}

function closedRecord(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    invalid(path, 'Value must be a plain object.')
  }
  const record = value as Record<string, unknown>
  const actual = Reflect.ownKeys(record)
  if (actual.some((key) => typeof key !== 'string') || actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    invalid(path, 'Object must contain exactly the supported fields.')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(record, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
      invalid(`${path}.${key}`, 'Object fields must be enumerable own data properties.')
    }
  }
  return record
}

function nonEmptyString(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) invalid(path, 'Value must be a non-empty string.')
}

function validateMechanics(value: unknown): asserts value is RobotMechanicsMetadataV1 {
  const record = closedRecord(value, '$.mechanics', ['schemaVersion', 'status', 'sourceKind', 'sourceName', 'calibrationRevision'])
  if (record.schemaVersion !== 1) invalid('$.mechanics.schemaVersion', 'Mechanics schema version must be 1.')
  if (record.status !== 'estimated' && record.status !== 'confirmed') invalid('$.mechanics.status', 'Mechanics status is invalid.')
  if (!['manual', 'manifest', 'resolved-urdf', 'datasheet', 'step-estimate'].includes(record.sourceKind as string)) {
    invalid('$.mechanics.sourceKind', 'Mechanics source kind is invalid.')
  }
  nonEmptyString(record.sourceName, '$.mechanics.sourceName')
  nonEmptyString(record.calibrationRevision, '$.mechanics.calibrationRevision')
}

function validateCandidate(candidate: RobotMechanicsImportCandidateV1): void {
  const record = closedRecord(candidate, '$', ['schemaVersion', 'definition', 'mechanics', 'draft', 'geometryAlignment'])
  if (record.schemaVersion !== 1) invalid('$.schemaVersion', 'Robot mechanics import schema version must be 1.')
  closedRecord(record.definition, '$.definition', ['id', 'name', 'identification', 'assetReferenceIds', 'sourceConventions', 'excludedGeometryOccurrenceKeys'])
  closedRecord(record.draft, '$.draft', ['links', 'joints', 'frames'])
  if (!Array.isArray((record.draft as Record<string, unknown>).links) || !Array.isArray((record.draft as Record<string, unknown>).joints) || !Array.isArray((record.draft as Record<string, unknown>).frames)) {
    invalid('$.draft', 'Robot mechanics draft collections must be arrays.')
  }
  validateMechanics(record.mechanics)
  const rawAlignment = record.geometryAlignment
  if (rawAlignment === null || typeof rawAlignment !== 'object' || Array.isArray(rawAlignment) || Object.getPrototypeOf(rawAlignment) !== Object.prototype) {
    invalid('$.geometryAlignment', 'Value must be a plain object.')
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(rawAlignment, 'kind')
  if (kindDescriptor === undefined || !kindDescriptor.enumerable || !('value' in kindDescriptor)) {
    invalid('$.geometryAlignment.kind', 'Object fields must be enumerable own data properties.')
  }
  if (kindDescriptor.value !== 'link-local' && kindDescriptor.value !== 'assembled-home') invalid('$.geometryAlignment.kind', 'Geometry alignment kind is invalid.')
  const alignment = closedRecord(rawAlignment, '$.geometryAlignment', kindDescriptor.value === 'assembled-home'
    ? ['kind', 'occurrenceWorldPoses']
    : ['kind'])
  if (alignment.kind === 'assembled-home' && (alignment.occurrenceWorldPoses === null || typeof alignment.occurrenceWorldPoses !== 'object' || Array.isArray(alignment.occurrenceWorldPoses))) {
    invalid('$.geometryAlignment.occurrenceWorldPoses', 'Assembled Geometry poses must be a record.')
  }
}

function validateMaterializedDefinition(definition: RobotDefinitionV5): RobotDefinitionV5 {
  const validated = validateRobotDefinitionShapeV5(clonePlainDataV5(definition))
  const assetReferenceIds = new Set(validated.assetReferenceIds)
  if (assetReferenceIds.size === 0) {
    failProjectV5('ROBOT_STEP_SOURCE_LIMIT_EXCEEDED', '$.assetReferenceIds', 'At least one Robot STEP source is required.', 'Declare at least one STEP asset source.')
  }
  if (assetReferenceIds.size !== validated.assetReferenceIds.length) {
    failProjectV5('PROJECT_ID_DUPLICATE', '$.assetReferenceIds', 'Robot STEP source IDs must be unique.', 'Use each STEP asset source once.')
  }
  const conventionKeys = Object.keys(validated.sourceConventions)
  if (conventionKeys.length !== assetReferenceIds.size || conventionKeys.some((id) => !assetReferenceIds.has(id))) {
    failProjectV5('SOURCE_CONVENTION_KEY_MISMATCH', '$.sourceConventions', 'Source conventions must match declared STEP source IDs exactly.', 'Declare one source convention for each STEP asset source.')
  }
  const excluded = new Set(validated.excludedGeometryOccurrenceKeys)
  if (excluded.size !== validated.excludedGeometryOccurrenceKeys.length) {
    failProjectV5('PROJECT_ID_DUPLICATE', '$.excludedGeometryOccurrenceKeys', 'Excluded Geometry occurrence keys must be unique.', 'List each excluded Geometry occurrence once.')
  }
  return validated
}

export function materializeRobotMechanicsImportCandidateV5(
  candidate: RobotMechanicsImportCandidateV1,
): RobotDefinitionV5 {
  validateCandidate(candidate)
  const canonical = canonicalizeRobotMechanicsV5(candidate.draft)
  const definition: RobotDefinitionV5 = {
    ...candidate.definition,
    mechanics: candidate.mechanics,
    links: canonical.links,
    joints: canonical.joints,
    frames: canonical.frames,
  }
  const aligned = candidate.geometryAlignment.kind === 'assembled-home'
    ? alignAssembledGeometryV5(definition, candidate.geometryAlignment.occurrenceWorldPoses)
    : definition
  return Object.freeze(validateMaterializedDefinition(aligned))
}
