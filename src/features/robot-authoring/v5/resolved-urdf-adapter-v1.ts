import { materializeRobotMechanicsImportCandidateV5 } from '../../../core/robot-runtime-v5/materialize-robot-mechanics-import.js'
import type { RobotDefinitionEnvelopeV1, RobotGeometryAlignmentV1, RobotMechanicsImportCandidateV1 } from '../../../core/robot-runtime-v5/robot-mechanics-import-candidate.js'
import type { RobotMechanicsDraftV1 } from '../../../core/robot-runtime-v5/robot-mechanics-draft.js'
import { failProjectV5 } from '../../../core/project-v5/errors.js'
import { rpyDegreesToQuaternionV5, type RigidTransformV5, type Vector3V5 } from '../../../core/project-v5/rigid-transform.js'
import type { RobotGeometryOccurrenceV5, RobotMechanicsMetadataV1 } from '../../../core/project-v5/types.js'

export interface ResolvedUrdfAssetBindingsV1 {
  readonly definition: RobotDefinitionEnvelopeV1
  readonly mechanics: RobotMechanicsMetadataV1 & { readonly sourceKind: 'resolved-urdf' }
  readonly geometryOccurrencesByLinkName: Readonly<Record<string, readonly RobotGeometryOccurrenceV5[]>>
  readonly geometryAlignment: RobotGeometryAlignmentV1
}

function invalid(code: string, path: string, message: string): never {
  return failProjectV5(code, path, message, 'Provide an already-expanded, supported URDF document and resolved asset bindings.')
}

function children(element: Element): Element[] {
  const result: Element[] = []
  for (const node of element.childNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) result.push(node as Element)
    else if (node.nodeType !== Node.TEXT_NODE || node.textContent?.trim() !== '') invalid('URDF_UNSUPPORTED', '$.xml', 'Only whitespace text and known elements are allowed.')
  }
  return result
}

function attributes(element: Element, allowed: readonly string[], path: string): void {
  for (const attribute of Array.from(element.attributes)) if (!allowed.includes(attribute.name)) invalid('URDF_UNSUPPORTED', path, `Unsupported attribute ${attribute.name}.`)
}

function namedAttribute(element: Element, name: string, path: string): string {
  const value = element.getAttribute(name)
  if (value === null || value.length === 0 || value.includes('/') || value.includes('\\') || value.includes('..')) invalid('URDF_UNSUPPORTED', path, `Missing or unsafe ${name} attribute.`)
  return value
}

function numbers(value: string, count: number, path: string): number[] {
  const values = value.trim().split(/\s+/u).map(Number)
  if (values.length !== count || values.some((item) => !Number.isFinite(item))) invalid('URDF_UNSUPPORTED', path, `Expected ${count} finite numeric components.`)
  return values
}

function optionalPose(element: Element | undefined, path: string): RigidTransformV5 {
  if (element === undefined) return { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] }
  attributes(element, ['xyz', 'rpy'], path)
  const xyzValues = numbers(element.getAttribute('xyz') ?? '0 0 0', 3, `${path}.xyz`)
  const xyz: Vector3V5 = [xyzValues[0]!, xyzValues[1]!, xyzValues[2]!]
  const rpyRad = numbers(element.getAttribute('rpy') ?? '0 0 0', 3, `${path}.rpy`)
  return { positionM: xyz, quaternion: rpyDegreesToQuaternionV5([rpyRad[0]! * 180 / Math.PI, rpyRad[1]! * 180 / Math.PI, rpyRad[2]! * 180 / Math.PI]) }
}

function sole(childrenByName: ReadonlyMap<string, Element[]>, name: string, path: string, required = true): Element | undefined {
  const values = childrenByName.get(name) ?? []
  if ((required && values.length !== 1) || values.length > 1) invalid('URDF_UNSUPPORTED', path, `${name} must occur ${required ? 'exactly once' : 'at most once'}.`)
  return values[0]
}

function resolvedGeometry(bindings: ResolvedUrdfAssetBindingsV1, linkNames: ReadonlySet<string>): void {
  const boundNames = Object.keys(bindings.geometryOccurrencesByLinkName)
  if (boundNames.length !== linkNames.size || boundNames.some((name) => !linkNames.has(name))) invalid('URDF_BINDING_LINK_MISMATCH', '$.geometryOccurrencesByLinkName', 'Bindings must cover exactly the URDF Link names.')
  const assetIds = new Set(bindings.definition.assetReferenceIds)
  const occurrenceKeys = new Set<string>()
  for (const [linkName, occurrences] of Object.entries(bindings.geometryOccurrencesByLinkName)) {
    if (!linkNames.has(linkName) || !Array.isArray(occurrences)) invalid('URDF_BINDING_LINK_MISMATCH', '$.geometryOccurrencesByLinkName', 'Resolved geometry binding is invalid.')
    for (const occurrence of occurrences) {
      if (occurrence === null || typeof occurrence !== 'object' || typeof occurrence.occurrenceKey !== 'string' || !assetIds.has(occurrence.assetReferenceId)) {
        invalid('ASSET_REFERENCE_NOT_FOUND', `$.geometryOccurrencesByLinkName.${linkName}`, 'Geometry occurrence must reference a declared asset.')
      }
      if (occurrenceKeys.has(occurrence.occurrenceKey)) invalid('GEOMETRY_OCCURRENCE_DUPLICATE', `$.geometryOccurrencesByLinkName.${linkName}`, 'Geometry occurrence keys must be unique.')
      occurrenceKeys.add(occurrence.occurrenceKey)
    }
  }
}

function parseJoint(element: Element, linkNames: ReadonlySet<string>): RobotMechanicsDraftV1['joints'][number] {
  attributes(element, ['name', 'type'], '$.joint')
  const id = namedAttribute(element, 'name', '$.joint.name')
  const type = namedAttribute(element, 'type', `$.joint.${id}.type`)
  if (['continuous', 'floating', 'planar'].includes(type)) invalid('URDF_UNSUPPORTED', `$.joint.${id}.type`, `Joint type ${type} is unsupported.`)
  if (!['revolute', 'prismatic', 'fixed'].includes(type)) invalid('URDF_UNSUPPORTED', `$.joint.${id}.type`, 'Unknown Joint type.')
  const jointType: 'revolute' | 'prismatic' | 'fixed' = type === 'revolute' ? 'revolute' : type === 'prismatic' ? 'prismatic' : 'fixed'
  const grouped = new Map<string, Element[]>()
  for (const child of children(element)) {
    if (!['parent', 'child', 'origin', 'axis', 'limit', 'mimic'].includes(child.tagName)) invalid('URDF_UNSUPPORTED', `$.joint.${id}`, `Unsupported Joint element ${child.tagName}.`)
    const values = grouped.get(child.tagName) ?? []; values.push(child); grouped.set(child.tagName, values)
  }
  if ((grouped.get('mimic')?.length ?? 0) > 0) invalid('URDF_UNSUPPORTED', `$.joint.${id}.mimic`, 'Mimic Joints are unsupported.')
  const parent = sole(grouped, 'parent', `$.joint.${id}.parent`)!
  const child = sole(grouped, 'child', `$.joint.${id}.child`)!
  attributes(parent, ['link'], `$.joint.${id}.parent`); attributes(child, ['link'], `$.joint.${id}.child`)
  const parentLinkId = namedAttribute(parent, 'link', `$.joint.${id}.parent.link`)
  const childLinkId = namedAttribute(child, 'link', `$.joint.${id}.child.link`)
  if (!linkNames.has(parentLinkId) || !linkNames.has(childLinkId)) invalid('URDF_LINK_NOT_FOUND', `$.joint.${id}`, 'Joint parent and child must be declared URDF Links.')
  const origin = optionalPose(sole(grouped, 'origin', `$.joint.${id}.origin`, false), `$.joint.${id}.origin`)
  if (jointType === 'fixed') {
    if ((grouped.get('axis')?.length ?? 0) > 0 || (grouped.get('limit')?.length ?? 0) > 0) invalid('URDF_UNSUPPORTED', `$.joint.${id}`, 'Fixed Joints cannot define axis or limits.')
    return { id, type: jointType, parentLinkId, childLinkId, origin, axis: null, min: null, max: null, home: null, zeroOffset: 0, direction: 1, maximumVelocity: null }
  }
  const axisElement = sole(grouped, 'axis', `$.joint.${id}.axis`)!
  attributes(axisElement, ['xyz'], `$.joint.${id}.axis`)
  const axisValues = numbers(namedAttribute(axisElement, 'xyz', `$.joint.${id}.axis.xyz`), 3, `$.joint.${id}.axis.xyz`)
  const axis: Vector3V5 = [axisValues[0]!, axisValues[1]!, axisValues[2]!]
  const limit = sole(grouped, 'limit', `$.joint.${id}.limit`)!
  attributes(limit, ['lower', 'upper', 'velocity', 'effort'], `$.joint.${id}.limit`)
  const lower = Number(limit.getAttribute('lower')); const upper = Number(limit.getAttribute('upper')); const velocity = Number(limit.getAttribute('velocity'))
  if (![lower, upper, velocity].every(Number.isFinite)) invalid('URDF_UNSUPPORTED', `$.joint.${id}.limit`, 'Movable Joints require finite lower, upper, and velocity limits.')
  const radiansToDegrees = jointType === 'revolute' ? 180 / Math.PI : 1
  return { id, type: jointType, parentLinkId, childLinkId, origin, axis, min: lower * radiansToDegrees, max: upper * radiansToDegrees, home: 0, zeroOffset: 0, direction: 1, maximumVelocity: velocity * radiansToDegrees }
}

export function parseResolvedUrdfV1(xml: string, assetBindings: ResolvedUrdfAssetBindingsV1): RobotMechanicsImportCandidateV1 {
  if (typeof xml !== 'string' || xml.includes('<!') || xml.includes('<?')) invalid('URDF_UNSUPPORTED', '$.xml', 'URDF must not contain declarations, entities, or processing instructions.')
  const document = new DOMParser().parseFromString(xml, 'application/xml')
  if (document.querySelector('parsererror') !== null) invalid('URDF_UNSUPPORTED', '$.xml', 'URDF XML is malformed.')
  const robot = document.documentElement
  if (robot.tagName !== 'robot') invalid('URDF_UNSUPPORTED', '$.xml', 'URDF root must be robot.')
  attributes(robot, ['name'], '$.robot'); namedAttribute(robot, 'name', '$.robot.name')
  const links: RobotMechanicsDraftV1['links'][number][] = []
  const jointElements: Element[] = []
  const linkNames = new Set<string>()
  for (const child of children(robot)) {
    if (child.tagName === 'link') { attributes(child, ['name'], '$.link'); const name = namedAttribute(child, 'name', '$.link.name'); if (children(child).length !== 0 || linkNames.has(name)) invalid('URDF_UNSUPPORTED', '$.link', 'Links must be unique and contain no unresolved geometry.'); linkNames.add(name); links.push({ id: name, name, geometryOccurrences: assetBindings.geometryOccurrencesByLinkName[name] ?? [] }) }
    else if (child.tagName === 'joint') jointElements.push(child)
    else invalid('URDF_UNSUPPORTED', '$.robot', `Unsupported URDF element ${child.tagName}.`)
  }
  if (linkNames.size === 0) invalid('URDF_UNSUPPORTED', '$.robot', 'URDF must contain Links.')
  resolvedGeometry(assetBindings, linkNames)
  const joints = jointElements.map((joint) => parseJoint(joint, linkNames))
  if (new Set(joints.map((joint) => joint.id)).size !== joints.length) invalid('PROJECT_ID_DUPLICATE', '$.joint', 'URDF Joint names must be unique.')
  const fixedLeaves = joints.filter((joint) => joint.type === 'fixed' && !joints.some((other) => other.parentLinkId === joint.childLinkId))
  const frames = fixedLeaves.flatMap((joint) => [
    { id: `${joint.childLinkId}-tool0`, name: `${joint.childLinkId} tool0`, parentFrameId: joint.childLinkId, localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } as RigidTransformV5, role: 'tool0' as const },
    { id: `${joint.childLinkId}-tcp`, name: `${joint.childLinkId} TCP`, parentFrameId: joint.childLinkId, localPose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] } as RigidTransformV5, role: 'tcp' as const },
  ])
  const candidate: RobotMechanicsImportCandidateV1 = { schemaVersion: 1, definition: assetBindings.definition, mechanics: assetBindings.mechanics, draft: { links, joints, frames }, geometryAlignment: assetBindings.geometryAlignment }
  materializeRobotMechanicsImportCandidateV5(candidate)
  return candidate
}
