const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const GLB_HEADER_BYTES = 12
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

export interface GlbBounds {
  readonly min: readonly [number, number, number]
  readonly max: readonly [number, number, number]
}

export interface GlbMeshEvidence {
  readonly byteLength: number
  readonly triangleCount: number
  readonly bounds: GlbBounds
}

interface GlbChunk {
  readonly type: number
  readonly bytes: Uint8Array
}

interface BufferViewLayout {
  readonly byteOffset: number
  readonly byteLength: number
  readonly byteStride: number | null
}

interface AccessorLayout {
  readonly bufferViewIndex: number
  readonly byteOffset: number
  readonly componentType: number
  readonly componentBytes: number
  readonly componentCount: number
  readonly count: number
  readonly type: string
  readonly normalized: boolean
}

interface MeshPrimitive {
  readonly positionAccessorIndex: number
  readonly indexAccessorIndex: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`)
  return value
}

function requireArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array.`)
  return value
}

function requireInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < minimum
  ) {
    throw new Error(`${label} must be an integer greater than or equal to ${minimum}.`)
  }
  return value
}

function optionalInteger(
  value: unknown,
  label: string,
  fallback: number,
): number {
  return value === undefined ? fallback : requireInteger(value, label)
}

function requireIndex(
  value: unknown,
  length: number,
  label: string,
): number {
  const index = requireInteger(value, label)
  if (index >= length) throw new Error(`${label} references missing index ${index}.`)
  return index
}

function componentByteLength(componentType: number): number | undefined {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1
    case 5122:
    case 5123:
      return 2
    case 5125:
    case 5126:
      return 4
    default:
      return undefined
  }
}

function accessorComponentCount(type: string): number | undefined {
  switch (type) {
    case 'SCALAR':
      return 1
    case 'VEC2':
      return 2
    case 'VEC3':
      return 3
    case 'VEC4':
      return 4
    default:
      return undefined
  }
}

function parseGlbChunks(bytes: Uint8Array, linkId: string): readonly GlbChunk[] {
  if (bytes.byteLength <= GLB_HEADER_BYTES) {
    throw new Error(`${linkId}.glb must contain a GLB header and chunks.`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`${linkId}.glb has an invalid GLB magic header.`)
  }
  if (view.getUint32(4, true) !== GLB_VERSION) {
    throw new Error(`${linkId}.glb is not a GLB version 2 container.`)
  }
  if (view.getUint32(8, true) !== bytes.byteLength) {
    throw new Error(`${linkId}.glb declared length does not match its file size.`)
  }

  const chunks: GlbChunk[] = []
  let offset = GLB_HEADER_BYTES
  while (offset < bytes.byteLength) {
    if (bytes.byteLength - offset < 8) {
      throw new Error(`${linkId}.glb has a truncated chunk header.`)
    }
    const chunkLength = view.getUint32(offset, true)
    const chunkType = view.getUint32(offset + 4, true)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkLength
    if (chunkLength === 0 || chunkLength % 4 !== 0 || chunkEnd > bytes.byteLength) {
      throw new Error(`${linkId}.glb has an invalid or truncated chunk length.`)
    }
    chunks.push(Object.freeze({
      type: chunkType,
      bytes: bytes.subarray(chunkStart, chunkEnd),
    }))
    offset = chunkEnd
  }
  if (
    chunks.length !== 2
    || chunks[0]?.type !== JSON_CHUNK_TYPE
    || chunks[1]?.type !== BIN_CHUNK_TYPE
  ) {
    throw new Error(`${linkId}.glb must contain exactly one JSON chunk followed by one BIN chunk.`)
  }
  return Object.freeze(chunks)
}

function parseGlbJson(chunk: Uint8Array, linkId: string): Record<string, unknown> {
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(chunk)
  } catch {
    throw new Error(`${linkId}.glb JSON chunk is not valid UTF-8.`)
  }
  try {
    return requireRecord(
      JSON.parse(source.replace(/ +$/u, '')) as unknown,
      `${linkId}.glb JSON document`,
    )
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${linkId}.glb JSON chunk is malformed.`)
    }
    throw error
  }
}

function readComponent(
  view: DataView,
  offset: number,
  componentType: number,
  normalized: boolean,
): number {
  switch (componentType) {
    case 5120: {
      const value = view.getInt8(offset)
      return normalized ? Math.max(value / 127, -1) : value
    }
    case 5121: {
      const value = view.getUint8(offset)
      return normalized ? value / 255 : value
    }
    case 5122: {
      const value = view.getInt16(offset, true)
      return normalized ? Math.max(value / 32767, -1) : value
    }
    case 5123: {
      const value = view.getUint16(offset, true)
      return normalized ? value / 65535 : value
    }
    case 5125: {
      const value = view.getUint32(offset, true)
      return normalized ? value / 4294967295 : value
    }
    case 5126:
      return view.getFloat32(offset, true)
    default:
      throw new Error(`Unsupported glTF component type ${componentType}.`)
  }
}

function decodeAccessorElement(
  binary: Uint8Array,
  bufferViews: readonly BufferViewLayout[],
  accessor: AccessorLayout,
  elementIndex: number,
): readonly number[] {
  const bufferView = bufferViews[accessor.bufferViewIndex]!
  const elementBytes = accessor.componentBytes * accessor.componentCount
  const stride = bufferView.byteStride ?? elementBytes
  const offset = bufferView.byteOffset + accessor.byteOffset + (elementIndex * stride)
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength)
  return Object.freeze(Array.from(
    { length: accessor.componentCount },
    (_, componentIndex) => readComponent(
      view,
      offset + (componentIndex * accessor.componentBytes),
      accessor.componentType,
      accessor.normalized,
    ),
  ))
}

function validateGlbDocument(
  document: Record<string, unknown>,
  binary: Uint8Array,
  linkId: string,
): Omit<GlbMeshEvidence, 'byteLength'> {
  const asset = requireRecord(document.asset, `${linkId}.glb asset`)
  if (asset.version !== '2.0') {
    throw new Error(`${linkId}.glb asset.version must be 2.0.`)
  }

  const buffers = requireArray(document.buffers, `${linkId}.glb buffers`)
  if (buffers.length !== 1) {
    throw new Error(`${linkId}.glb must declare exactly one embedded buffer.`)
  }
  const buffer = requireRecord(buffers[0], `${linkId}.glb buffer 0`)
  const bufferByteLength = requireInteger(
    buffer.byteLength,
    `${linkId}.glb buffer 0 byteLength`,
    1,
  )
  if (
    buffer.uri !== undefined
    || bufferByteLength > binary.byteLength
    || binary.byteLength - bufferByteLength > 3
  ) {
    throw new Error(`${linkId}.glb embedded buffer length does not match its BIN chunk.`)
  }

  const bufferViews = requireArray(document.bufferViews, `${linkId}.glb bufferViews`)
  if (bufferViews.length === 0) {
    throw new Error(`${linkId}.glb must contain bufferViews.`)
  }
  const bufferViewLayouts = bufferViews.map((candidate, index): BufferViewLayout => {
    const bufferView = requireRecord(candidate, `${linkId}.glb bufferView ${index}`)
    if (bufferView.buffer !== 0) {
      throw new Error(`${linkId}.glb bufferView ${index} must reference buffer 0.`)
    }
    const byteOffset = optionalInteger(
      bufferView.byteOffset,
      `${linkId}.glb bufferView ${index} byteOffset`,
      0,
    )
    const byteLength = requireInteger(
      bufferView.byteLength,
      `${linkId}.glb bufferView ${index} byteLength`,
      1,
    )
    if (byteOffset + byteLength > bufferByteLength) {
      throw new Error(`${linkId}.glb bufferView ${index} exceeds buffer 0.`)
    }
    const byteStride = bufferView.byteStride === undefined
      ? null
      : requireInteger(
        bufferView.byteStride,
        `${linkId}.glb bufferView ${index} byteStride`,
        4,
      )
    if (byteStride !== null && (byteStride > 252 || byteStride % 4 !== 0)) {
      throw new Error(`${linkId}.glb bufferView ${index} has an invalid byteStride.`)
    }
    return Object.freeze({ byteOffset, byteLength, byteStride })
  })

  const accessors = requireArray(document.accessors, `${linkId}.glb accessors`)
  if (accessors.length === 0) throw new Error(`${linkId}.glb must contain accessors.`)
  const accessorLayouts = accessors.map((candidate, index): AccessorLayout => {
    const accessor = requireRecord(candidate, `${linkId}.glb accessor ${index}`)
    if (accessor.sparse !== undefined) {
      throw new Error(`${linkId}.glb accessor ${index} must not use sparse storage.`)
    }
    const bufferViewIndex = requireIndex(
      accessor.bufferView,
      bufferViews.length,
      `${linkId}.glb accessor ${index} bufferView`,
    )
    const componentType = requireInteger(
      accessor.componentType,
      `${linkId}.glb accessor ${index} componentType`,
    )
    const componentBytes = componentByteLength(componentType)
    if (componentBytes === undefined) {
      throw new Error(`${linkId}.glb accessor ${index} has an invalid componentType.`)
    }
    if (typeof accessor.type !== 'string') {
      throw new Error(`${linkId}.glb accessor ${index} has an unsupported type.`)
    }
    const componentCount = accessorComponentCount(accessor.type)
    if (componentCount === undefined) {
      throw new Error(`${linkId}.glb accessor ${index} has an unsupported type.`)
    }
    const count = requireInteger(
      accessor.count,
      `${linkId}.glb accessor ${index} count`,
      1,
    )
    const byteOffset = optionalInteger(
      accessor.byteOffset,
      `${linkId}.glb accessor ${index} byteOffset`,
      0,
    )
    if (byteOffset % componentBytes !== 0) {
      throw new Error(`${linkId}.glb accessor ${index} has an unaligned byteOffset.`)
    }
    const elementBytes = componentBytes * componentCount
    const layout = bufferViewLayouts[bufferViewIndex]!
    const stride = layout.byteStride ?? elementBytes
    if (stride < elementBytes) {
      throw new Error(`${linkId}.glb accessor ${index} exceeds its bufferView byteStride.`)
    }
    const requiredBytes = ((count - 1) * stride) + elementBytes
    if (byteOffset + requiredBytes > layout.byteLength) {
      throw new Error(`${linkId}.glb accessor ${index} exceeds its bufferView.`)
    }
    return Object.freeze({
      bufferViewIndex,
      byteOffset,
      componentType,
      componentBytes,
      componentCount,
      count,
      type: accessor.type,
      normalized: accessor.normalized === true,
    })
  })

  const materials = requireArray(document.materials, `${linkId}.glb materials`)
  if (materials.length === 0) throw new Error(`${linkId}.glb must contain materials.`)
  materials.forEach((candidate, index) => {
    requireRecord(candidate, `${linkId}.glb material ${index}`)
  })

  const meshes = requireArray(document.meshes, `${linkId}.glb meshes`)
  if (meshes.length === 0) throw new Error(`${linkId}.glb must contain meshes.`)
  const usedAccessors = new Set<number>()
  const usedMaterials = new Set<number>()
  const positionAccessors = new Set<number>()
  const primitivesByMesh: MeshPrimitive[][] = []
  meshes.forEach((candidate, meshIndex) => {
    const mesh = requireRecord(candidate, `${linkId}.glb mesh ${meshIndex}`)
    const primitives = requireArray(
      mesh.primitives,
      `${linkId}.glb mesh ${meshIndex} primitives`,
    )
    if (primitives.length === 0) {
      throw new Error(`${linkId}.glb mesh ${meshIndex} must contain primitives.`)
    }
    primitivesByMesh[meshIndex] = primitives.map((primitiveCandidate, primitiveIndex) => {
      const primitive = requireRecord(
        primitiveCandidate,
        `${linkId}.glb mesh ${meshIndex} primitive ${primitiveIndex}`,
      )
      const mode = optionalInteger(
        primitive.mode,
        `${linkId}.glb mesh ${meshIndex} primitive ${primitiveIndex} mode`,
        4,
      )
      if (mode !== 4) {
        throw new Error(`${linkId}.glb render primitives must use TRIANGLES mode.`)
      }
      const attributes = requireRecord(
        primitive.attributes,
        `${linkId}.glb mesh ${meshIndex} primitive ${primitiveIndex} attributes`,
      )
      for (const [semantic, accessorCandidate] of Object.entries(attributes)) {
        usedAccessors.add(requireIndex(
          accessorCandidate,
          accessors.length,
          `${linkId}.glb ${semantic} accessor`,
        ))
      }
      const positionAccessorIndex = requireIndex(
        attributes.POSITION,
        accessors.length,
        `${linkId}.glb POSITION accessor`,
      )
      const normalAccessorIndex = requireIndex(
        attributes.NORMAL,
        accessors.length,
        `${linkId}.glb NORMAL accessor`,
      )
      const position = accessorLayouts[positionAccessorIndex]!
      positionAccessors.add(positionAccessorIndex)
      const normal = accessorLayouts[normalAccessorIndex]!
      if (
        position.type !== 'VEC3'
        || position.componentType !== 5126
        || position.normalized
        || normal.type !== 'VEC3'
        || normal.count !== position.count
      ) {
        throw new Error(`${linkId}.glb POSITION/NORMAL accessor contract is invalid.`)
      }
      const indexAccessorIndex = requireIndex(
        primitive.indices,
        accessors.length,
        `${linkId}.glb index accessor`,
      )
      const indices = accessorLayouts[indexAccessorIndex]!
      if (
        indices.type !== 'SCALAR'
        || indices.normalized
        || ![5121, 5123, 5125].includes(indices.componentType)
        || indices.count % 3 !== 0
      ) {
        throw new Error(`${linkId}.glb index accessor must contain unsigned TRIANGLES.`)
      }
      usedAccessors.add(indexAccessorIndex)
      usedMaterials.add(requireIndex(
        primitive.material,
        materials.length,
        `${linkId}.glb material`,
      ))
      return Object.freeze({ positionAccessorIndex, indexAccessorIndex })
    })
  })
  if (usedAccessors.size !== accessors.length) {
    throw new Error(`${linkId}.glb contains orphan accessors.`)
  }
  const usedBufferViews = new Set(
    [...usedAccessors].map((index) => accessorLayouts[index]!.bufferViewIndex),
  )
  if (usedBufferViews.size !== bufferViews.length) {
    throw new Error(`${linkId}.glb contains orphan bufferViews.`)
  }
  if (usedMaterials.size !== materials.length) {
    throw new Error(`${linkId}.glb contains orphan materials.`)
  }
  for (const accessorIndex of usedAccessors) {
    if (positionAccessors.has(accessorIndex)) continue
    const accessor = accessorLayouts[accessorIndex]!
    for (let elementIndex = 0; elementIndex < accessor.count; elementIndex += 1) {
      const values = decodeAccessorElement(
        binary,
        bufferViewLayouts,
        accessor,
        elementIndex,
      )
      if (values.some((value) => !Number.isFinite(value))) {
        throw new Error(`${linkId}.glb accessor ${accessorIndex} contains a non-finite value.`)
      }
    }
  }

  const nodes = requireArray(document.nodes, `${linkId}.glb nodes`)
  if (nodes.length === 0) throw new Error(`${linkId}.glb must contain nodes.`)
  const nodeMeshes = new Set<number>()
  const nodeChildren = nodes.map((candidate, nodeIndex) => {
    const node = requireRecord(candidate, `${linkId}.glb node ${nodeIndex}`)
    for (const transform of ['matrix', 'translation', 'rotation', 'scale']) {
      if (node[transform] !== undefined) {
        throw new Error(`${linkId}.glb node transforms must be baked into Link-local Geometry.`)
      }
    }
    if (node.mesh !== undefined) {
      const meshIndex = requireIndex(
        node.mesh,
        meshes.length,
        `${linkId}.glb node ${nodeIndex} mesh`,
      )
      if (nodeMeshes.has(meshIndex)) {
        throw new Error(`${linkId}.glb mesh ${meshIndex} is instanced by multiple nodes.`)
      }
      nodeMeshes.add(meshIndex)
    }
    const children = node.children === undefined
      ? []
      : requireArray(node.children, `${linkId}.glb node ${nodeIndex} children`)
        .map((child, childIndex) => requireIndex(
          child,
          nodes.length,
          `${linkId}.glb node ${nodeIndex} child ${childIndex}`,
        ))
    if (new Set(children).size !== children.length || children.includes(nodeIndex)) {
      throw new Error(`${linkId}.glb node ${nodeIndex} has duplicate or self children.`)
    }
    return children
  })
  if (nodeMeshes.size !== meshes.length) {
    throw new Error(`${linkId}.glb contains a mesh without a node.`)
  }

  const parentCounts = Array<number>(nodes.length).fill(0)
  nodeChildren.flat().forEach((child) => {
    parentCounts[child] = parentCounts[child]! + 1
    if (parentCounts[child]! > 1) {
      throw new Error(`${linkId}.glb node ${child} has more than one parent.`)
    }
  })

  const scenes = requireArray(document.scenes, `${linkId}.glb scenes`)
  if (scenes.length === 0) throw new Error(`${linkId}.glb must contain scenes.`)
  const sceneRoots = scenes.map((candidate, sceneIndex) => {
    const scene = requireRecord(candidate, `${linkId}.glb scene ${sceneIndex}`)
    const roots = requireArray(
      scene.nodes,
      `${linkId}.glb scene ${sceneIndex} nodes`,
    ).map((node, index) => requireIndex(
      node,
      nodes.length,
      `${linkId}.glb scene ${sceneIndex} root ${index}`,
    ))
    if (roots.length === 0 || new Set(roots).size !== roots.length) {
      throw new Error(`${linkId}.glb scene ${sceneIndex} must contain unique root nodes.`)
    }
    return roots
  })
  const defaultSceneIndex = requireIndex(
    document.scene,
    scenes.length,
    `${linkId}.glb default scene`,
  )
  const roots = sceneRoots[defaultSceneIndex]!
  const visiting = new Set<number>()
  const visited = new Set<number>()
  const visit = (nodeIndex: number): void => {
    if (visiting.has(nodeIndex)) throw new Error(`${linkId}.glb node graph contains a cycle.`)
    if (visited.has(nodeIndex)) return
    visiting.add(nodeIndex)
    nodeChildren[nodeIndex]!.forEach(visit)
    visiting.delete(nodeIndex)
    visited.add(nodeIndex)
  }
  roots.forEach(visit)
  if (visited.size !== nodes.length) {
    throw new Error(`${linkId}.glb contains nodes outside its default scene.`)
  }

  const positionCache = new Map<number, readonly (readonly number[])[]>()
  const positionsFor = (accessorIndex: number): readonly (readonly number[])[] => {
    const cached = positionCache.get(accessorIndex)
    if (cached !== undefined) return cached
    const accessor = accessorLayouts[accessorIndex]!
    const positions = Object.freeze(Array.from(
      { length: accessor.count },
      (_, index) => {
        const position = decodeAccessorElement(binary, bufferViewLayouts, accessor, index)
        if (position.some((value) => !Number.isFinite(value))) {
          throw new Error(`${linkId}.glb POSITION accessor contains a non-finite value.`)
        }
        return position
      },
    ))
    positionCache.set(accessorIndex, positions)
    return positions
  }

  const min: [number, number, number] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  ]
  const max: [number, number, number] = [
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]
  let triangleCount = 0
  for (const primitive of primitivesByMesh.flat()) {
    const positions = positionsFor(primitive.positionAccessorIndex)
    positions.forEach((position) => {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, position[axis]!)
        max[axis] = Math.max(max[axis]!, position[axis]!)
      }
    })
    const indexAccessor = accessorLayouts[primitive.indexAccessorIndex]!
    const decodedIndices = Array.from(
      { length: indexAccessor.count },
      (_, index) => decodeAccessorElement(
        binary,
        bufferViewLayouts,
        indexAccessor,
        index,
      )[0]!,
    )
    for (let offset = 0; offset < decodedIndices.length; offset += 3) {
      const first = decodedIndices[offset]!
      const second = decodedIndices[offset + 1]!
      const third = decodedIndices[offset + 2]!
      if (
        !Number.isInteger(first)
        || !Number.isInteger(second)
        || !Number.isInteger(third)
        || first < 0
        || second < 0
        || third < 0
        || first >= positions.length
        || second >= positions.length
        || third >= positions.length
      ) {
        throw new Error(`${linkId}.glb triangle contains an out-of-range index.`)
      }
      if (first === second || second === third || first === third) {
        throw new Error(`${linkId}.glb triangle contains repeated indices.`)
      }
      triangleCount += 1
    }
  }

  return Object.freeze({
    triangleCount,
    bounds: Object.freeze({
      min: Object.freeze(min),
      max: Object.freeze(max),
    }),
  })
}

export function validateGlbMesh(
  bytes: Uint8Array,
  linkId: string,
): GlbMeshEvidence {
  const chunks = parseGlbChunks(bytes, linkId)
  const document = parseGlbJson(chunks[0]!.bytes, linkId)
  const evidence = validateGlbDocument(document, chunks[1]!.bytes, linkId)
  return Object.freeze({ byteLength: bytes.byteLength, ...evidence })
}
