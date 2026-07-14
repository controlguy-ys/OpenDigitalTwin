const encoder = new TextEncoder()

const UNORDERED_COLLECTION_PATHS = [
  ['robot', 'sources'],
  ['robot', 'links'],
  ['robot', 'links', '*', 'sourceRefs'],
  ['robot', 'links', '*', 'sourceRefs', '*', 'meshIndices'],
  ['robot', 'links', '*', 'collisionBoxes'],
  ['robot', 'mechanics', 'joints'],
  ['objectAssets'],
  ['objectAssets', '*', 'collisionBoxes'],
  ['objectInstances'],
  ['builtInEquipment'],
  ['externalEntities'],
  ['opcUa', 'joints'],
  ['opcUa', 'numericStatusBindings'],
  ['opcUa', 'equipmentTransforms'],
  ['collisionPolicy', 'ignoredPairKeys'],
  ['collisionPolicy', 'enabledRobotSelfPairs'],
] as const

export class ProjectRevisionCanonicalError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(`${code}: ${message}`)
    this.name = 'ProjectRevisionCanonicalError'
    this.code = code
  }
}

function fail(code: string, message: string): never {
  throw new ProjectRevisionCanonicalError(code, message)
}

function isUnorderedCollection(path: readonly string[]): boolean {
  return UNORDERED_COLLECTION_PATHS.some((pattern) =>
    pattern.length === path.length && pattern.every((segment, index) =>
      segment === '*' || segment === path[index]))
}

function canonicalSortKey(value: unknown): string {
  return JSON.stringify(value)
}

function compareCanonicalStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeDataGraph(
  value: unknown,
  path: readonly string[],
  active: WeakSet<object>,
): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return fail('PROJECT_REVISION_INVALID', 'Revision projection contains a non-finite number.')
    }
    return Object.is(value, -0) ? 0 : value
  }
  if (typeof value !== 'object') {
    return fail('PROJECT_REVISION_INVALID', 'Revision projection contains a non-data value.')
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return fail(
      'PROJECT_REVISION_CONTAINS_SOURCE_BYTES',
      'Stored revision projection must not contain binary source data.',
    )
  }
  if (active.has(value)) {
    return fail('PROJECT_REVISION_INVALID', 'Revision projection contains a cycle.')
  }
  active.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) {
        return fail('PROJECT_REVISION_INVALID', 'Revision arrays must use the plain Array prototype.')
      }
      const descriptors = Object.getOwnPropertyDescriptors(value)
      const lengthDescriptor = Object.getOwnPropertyDescriptor(value, 'length')
      if (
        lengthDescriptor === undefined ||
        !('value' in lengthDescriptor) ||
        lengthDescriptor.value !== value.length ||
        Reflect.ownKeys(descriptors).length !== value.length + 1
      ) {
        return fail('PROJECT_REVISION_INVALID', 'Revision arrays must be dense closed data arrays.')
      }
      const normalized: unknown[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)]
        if (
          descriptor === undefined ||
          !descriptor.enumerable ||
          !('value' in descriptor)
        ) {
          return fail('PROJECT_REVISION_INVALID', 'Revision arrays cannot contain accessors or gaps.')
        }
        normalized.push(normalizeDataGraph(
          descriptor.value,
          [...path, String(index)],
          active,
        ))
      }
      if (isUnorderedCollection(path)) {
        normalized.sort((left, right) => compareCanonicalStrings(
          canonicalSortKey(left),
          canonicalSortKey(right),
        ))
      }
      return normalized
    }
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return fail('PROJECT_REVISION_INVALID', 'Revision records must use the plain Object prototype.')
    }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    const normalized: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(descriptors).sort((left, right) =>
      compareCanonicalStrings(String(left), String(right)))) {
      if (typeof key !== 'string') {
        return fail('PROJECT_REVISION_INVALID', 'Revision records cannot contain symbol fields.')
      }
      const descriptor = descriptors[key]!
      if (!descriptor.enumerable || !('value' in descriptor)) {
        return fail('PROJECT_REVISION_INVALID', 'Revision records cannot contain accessors.')
      }
      normalized[key] = normalizeDataGraph(descriptor.value, [...path, key], active)
    }
    return normalized
  } finally {
    active.delete(value)
  }
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  for (const nested of Object.values(value)) deepFreeze(nested)
  Object.freeze(value)
}

export function createProjectRevisionIdentityProjectionV3<Projection extends object>(
  projection: Projection,
): Projection {
  const normalized = normalizeDataGraph(
    projection,
    [],
    new WeakSet<object>(),
  ) as Projection
  deepFreeze(normalized)
  return normalized
}

export function canonicalProjectRevisionJsonV1(value: unknown): string {
  return JSON.stringify(normalizeDataGraph(value, [], new WeakSet<object>()))
}

export function createProjectRevisionIdentityBytesV1<Projection extends object>(
  projectId: string,
  projection: Projection,
): Uint8Array<ArrayBuffer> {
  if (typeof projectId !== 'string' || projectId.length === 0) {
    return fail('PROJECT_REVISION_INVALID', 'Revision projectId must be non-empty.')
  }
  return encoder.encode(`${projectId}\n${canonicalProjectRevisionJsonV1(projection)}`)
}

export function projectRevisionProjectionsEqualV1<Projection extends object>(
  left: Projection,
  right: Projection,
): boolean {
  return canonicalProjectRevisionJsonV1(left) === canonicalProjectRevisionJsonV1(right)
}
