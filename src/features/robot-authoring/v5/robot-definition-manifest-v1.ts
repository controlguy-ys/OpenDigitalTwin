import { materializeRobotMechanicsImportCandidateV5 } from '../../../core/robot-runtime-v5/materialize-robot-mechanics-import.js'
import type { RobotMechanicsImportCandidateV1 } from '../../../core/robot-runtime-v5/robot-mechanics-import-candidate.js'
import { failProjectV5 } from '../../../core/project-v5/errors.js'

const MANIFEST_SCHEMA_V1 = 'open-digital-twin/robot-definition-manifest/1'
const SOURCE_TO_METERS_BY_LINEAR_UNIT: Readonly<Record<string, number>> = {
  millimeter: 0.001,
  centimeter: 0.01,
  meter: 1,
  inch: 0.0254,
  foot: 0.3048,
}

function invalid(path: string, message: string): never {
  return failProjectV5('PROJECT_VALUE_INVALID', path, message, 'Correct the Robot Definition Manifest and try again.')
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) invalid(path, 'Expected a plain object.')
  const result = value as Record<string, unknown>
  const actual = Reflect.ownKeys(result)
  if (actual.some((key) => typeof key !== 'string') || actual.length !== keys.length || keys.some((key) => !actual.includes(key))) {
    failProjectV5('PROJECT_RECORD_NOT_CLOSED', path, 'Object must contain exactly the supported fields.', 'Remove unsupported Manifest fields.')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(result, key)
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) invalid(`${path}.${key}`, 'Fields must be enumerable own data properties.')
  }
  return result
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length) invalid(path, 'Expected a dense array.')
  return value
}

function finite(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'Expected a finite number.')
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('/') || value.includes('\\') || value.includes('..')) invalid(path, 'Expected a non-empty traversal-safe string.')
  return value
}

function pose(value: unknown, path: string): void {
  const valueRecord = record(value, path, ['positionM', 'quaternion'])
  const position = array(valueRecord.positionM, `${path}.positionM`)
  const quaternion = array(valueRecord.quaternion, `${path}.quaternion`)
  if (position.length !== 3 || quaternion.length !== 4) invalid(path, 'Transform tuples have invalid length.')
  position.forEach((component, index) => finite(component, `${path}.positionM[${index}]`))
  quaternion.forEach((component, index) => finite(component, `${path}.quaternion[${index}]`))
}

function occurrence(value: unknown, path: string, collisionBoxIds: Set<string>): void {
  const valueRecord = record(value, path, ['occurrenceKey', 'assetReferenceId', 'linkLocalPose', 'statistics', 'collisionBoxes'])
  text(valueRecord.occurrenceKey, `${path}.occurrenceKey`)
  text(valueRecord.assetReferenceId, `${path}.assetReferenceId`)
  pose(valueRecord.linkLocalPose, `${path}.linkLocalPose`)
  const statistics = record(valueRecord.statistics, `${path}.statistics`, ['vertices', 'triangles', 'meshes', 'materials'])
  for (const key of ['vertices', 'triangles', 'meshes', 'materials']) finite(statistics[key], `${path}.statistics.${key}`)
  const boxes = array(valueRecord.collisionBoxes, `${path}.collisionBoxes`)
  boxes.forEach((box, index) => {
    const boxRecord = record(box, `${path}.collisionBoxes[${index}]`, ['id', 'centerM', 'halfExtentsM', 'quaternion'])
    const id = text(boxRecord.id, `${path}.collisionBoxes[${index}].id`)
    if (collisionBoxIds.has(id)) failProjectV5('PROJECT_ID_DUPLICATE', `${path}.collisionBoxes[${index}].id`, 'Collision box id is duplicated.', 'Use each collision box id once.')
    collisionBoxIds.add(id)
    const center = array(boxRecord.centerM, `${path}.collisionBoxes[${index}].centerM`)
    const extents = array(boxRecord.halfExtentsM, `${path}.collisionBoxes[${index}].halfExtentsM`)
    const quaternion = array(boxRecord.quaternion, `${path}.collisionBoxes[${index}].quaternion`)
    if (center.length !== 3 || extents.length !== 3 || quaternion.length !== 4) invalid(`${path}.collisionBoxes[${index}]`, 'Collision tuple has invalid length.')
    ;[...center, ...extents, ...quaternion].forEach((component, componentIndex) => finite(component, `${path}.collisionBoxes[${index}][${componentIndex}]`))
  })
}

function validateClosedCandidate(value: unknown): asserts value is RobotMechanicsImportCandidateV1 {
  const candidate = record(value, '$', ['schemaVersion', 'definition', 'mechanics', 'draft', 'geometryAlignment'])
  if (candidate.schemaVersion !== 1) invalid('$.schemaVersion', 'Expected schemaVersion 1.')
  const definition = record(candidate.definition, '$.definition', ['id', 'name', 'identification', 'assetReferenceIds', 'sourceConventions', 'excludedGeometryOccurrenceKeys'])
  text(definition.id, '$.definition.id'); text(definition.name, '$.definition.name')
  const identification = record(definition.identification, '$.definition.identification', ['manufacturer', 'model', 'productCode', 'serialNumberTemplate', 'motionDeviceCategory'])
  text(identification.manufacturer, '$.definition.identification.manufacturer'); text(identification.model, '$.definition.identification.model'); text(identification.productCode, '$.definition.identification.productCode')
  if (identification.serialNumberTemplate !== null) text(identification.serialNumberTemplate, '$.definition.identification.serialNumberTemplate')
  const assets = array(definition.assetReferenceIds, '$.definition.assetReferenceIds'); assets.forEach((asset, index) => text(asset, `$.definition.assetReferenceIds[${index}]`))
  const conventions = definition.sourceConventions
  if (conventions === null || typeof conventions !== 'object' || Array.isArray(conventions)) invalid('$.definition.sourceConventions', 'Expected a source convention record.')
  Object.entries(conventions as Record<string, unknown>).forEach(([assetId, convention]) => {
    text(assetId, `$.definition.sourceConventions.${assetId}`)
    const item = record(convention, `$.definition.sourceConventions.${assetId}`, ['linearUnit', 'sourceToMeters', 'orientation'])
    const sourceToMeters = finite(item.sourceToMeters, `$.definition.sourceConventions.${assetId}.sourceToMeters`)
    const expectedSourceToMeters = SOURCE_TO_METERS_BY_LINEAR_UNIT[item.linearUnit as string]
    if (expectedSourceToMeters === undefined || sourceToMeters <= 0 || sourceToMeters !== expectedSourceToMeters) {
      invalid(`$.definition.sourceConventions.${assetId}`, 'Source unit and sourceToMeters must use the canonical V5 conversion.')
    }
    const orientation = item.orientation as Record<string, unknown>
    if (orientation?.mode === 'up-axis') record(orientation, `$.definition.sourceConventions.${assetId}.orientation`, ['mode', 'upAxis'])
    else if (orientation?.mode === 'root-rotation') { const root = record(orientation, `$.definition.sourceConventions.${assetId}.orientation`, ['mode', 'quaternion']); const quaternion = array(root.quaternion, `$.definition.sourceConventions.${assetId}.orientation.quaternion`); if (quaternion.length !== 4) invalid(`$.definition.sourceConventions.${assetId}.orientation.quaternion`, 'Expected a quaternion.') }
    else invalid(`$.definition.sourceConventions.${assetId}.orientation`, 'Unsupported source orientation.')
  })
  array(definition.excludedGeometryOccurrenceKeys, '$.definition.excludedGeometryOccurrenceKeys').forEach((key, index) => text(key, `$.definition.excludedGeometryOccurrenceKeys[${index}]`))
  const mechanics = record(candidate.mechanics, '$.mechanics', ['schemaVersion', 'status', 'sourceKind', 'sourceName', 'calibrationRevision'])
  if (mechanics.schemaVersion !== 1 || mechanics.sourceKind !== 'manifest') invalid('$.mechanics', 'Manifest mechanics provenance is invalid.')
  text(mechanics.sourceName, '$.mechanics.sourceName'); text(mechanics.calibrationRevision, '$.mechanics.calibrationRevision')
  const draft = record(candidate.draft, '$.draft', ['links', 'joints', 'frames'])
  const collisionBoxIds = new Set<string>()
  array(draft.links, '$.draft.links').forEach((link, index) => { const item = record(link, `$.draft.links[${index}]`, ['id', 'name', 'geometryOccurrences']); text(item.id, `$.draft.links[${index}].id`); text(item.name, `$.draft.links[${index}].name`); array(item.geometryOccurrences, `$.draft.links[${index}].geometryOccurrences`).forEach((geometry, geometryIndex) => occurrence(geometry, `$.draft.links[${index}].geometryOccurrences[${geometryIndex}]`, collisionBoxIds)) })
  array(draft.joints, '$.draft.joints').forEach((joint, index) => { const item = record(joint, `$.draft.joints[${index}]`, ['id', 'type', 'parentLinkId', 'childLinkId', 'origin', 'axis', 'min', 'max', 'home', 'zeroOffset', 'direction', 'maximumVelocity']); text(item.id, `$.draft.joints[${index}].id`); text(item.parentLinkId, `$.draft.joints[${index}].parentLinkId`); text(item.childLinkId, `$.draft.joints[${index}].childLinkId`); pose(item.origin, `$.draft.joints[${index}].origin`); finite(item.zeroOffset, `$.draft.joints[${index}].zeroOffset`) })
  array(draft.frames, '$.draft.frames').forEach((frame, index) => { const item = record(frame, `$.draft.frames[${index}]`, ['id', 'name', 'parentFrameId', 'localPose', 'role']); text(item.id, `$.draft.frames[${index}].id`); text(item.name, `$.draft.frames[${index}].name`); if (item.parentFrameId !== null) text(item.parentFrameId, `$.draft.frames[${index}].parentFrameId`); pose(item.localPose, `$.draft.frames[${index}].localPose`) })
  const alignment = candidate.geometryAlignment as Record<string, unknown>
  if (alignment?.kind === 'link-local') record(alignment, '$.geometryAlignment', ['kind'])
  else if (alignment?.kind === 'assembled-home') { const item = record(alignment, '$.geometryAlignment', ['kind', 'occurrenceWorldPoses']); Object.entries(item.occurrenceWorldPoses as Record<string, unknown>).forEach(([key, itemPose]) => { text(key, `$.geometryAlignment.occurrenceWorldPoses.${key}`); pose(itemPose, `$.geometryAlignment.occurrenceWorldPoses.${key}`) }) }
  else invalid('$.geometryAlignment.kind', 'Unsupported geometry alignment.')
}

export function decodeRobotDefinitionManifestV1(bytes: Uint8Array): RobotMechanicsImportCandidateV1 {
  let parsed: unknown
  try { parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) } catch { invalid('$', 'Manifest must be valid UTF-8 JSON.') }
  const envelope = record(parsed, '$', ['schema', 'units', 'definition', 'mechanics', 'draft', 'geometryAlignment'])
  if (envelope.schema !== MANIFEST_SCHEMA_V1) invalid('$.schema', 'Unsupported Robot Definition Manifest schema.')
  const units = record(envelope.units, '$.units', ['linear', 'angular', 'transform'])
  if (units.linear !== 'meter' || units.angular !== 'degree' || units.transform !== 'project-v5-z-up-metres-quaternion-xyzw') invalid('$.units', 'Manifest units and transform convention are invalid.')
  const candidate = { schemaVersion: 1, definition: envelope.definition, mechanics: envelope.mechanics, draft: envelope.draft, geometryAlignment: envelope.geometryAlignment }
  validateClosedCandidate(candidate)
  materializeRobotMechanicsImportCandidateV5(candidate)
  return candidate
}
