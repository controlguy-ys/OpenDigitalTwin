import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LINK_IDS = Object.freeze([
  'LINK00',
  'LINK01',
  'LINK02',
  'LINK03',
  'LINK04',
  'LINK05',
  'LINK06',
] as const)

const DEFINITION_ID = 'builtin-niryo-ned2-v1'
const ASSET_REFERENCE_ID = 'builtin-niryo-ned2-assembly-v1'
const ASSET_URI = 'builtin://niryo/ned2-assembly@v1'
const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const GLB_HEADER_BYTES = 12
const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

const TYPE_COMPONENTS = Object.freeze({
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
} as const)

export interface Ned2RenderAssetBinding {
  readonly linkId: string
  readonly occurrenceKey: string
  readonly assetReferenceId: string
  readonly sourceAssetUri: string
  readonly renderAssetUri: string
  readonly fileName: string
}

interface GlbChunk {
  readonly type: number
  readonly bytes: Uint8Array
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function exactStrings(value: unknown, expected: readonly string[]): boolean {
  return Array.isArray(value)
    && value.length === expected.length
    && value.every((entry, index) => entry === expected[index])
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

export function validateNed2Manifest(
  manifest: unknown,
): readonly Ned2RenderAssetBinding[] {
  const root = requireRecord(manifest, 'NED2 manifest')
  const asset = requireRecord(root.assetReference, 'NED2 assetReference')
  const definition = requireRecord(root.definition, 'NED2 definition')

  if (
    asset.id !== ASSET_REFERENCE_ID
    || asset.uri !== ASSET_URI
    || asset.sourceFileName !== 'NED2_STEP.step'
    || asset.mediaType !== 'model/step'
    || typeof asset.byteLength !== 'number'
    || !Number.isSafeInteger(asset.byteLength)
    || asset.byteLength <= 0
    || typeof asset.sha256 !== 'string'
    || !/^[0-9a-f]{64}$/.test(asset.sha256)
  ) {
    throw new Error('NED2 assetReference does not match the built-in assembly contract.')
  }

  if (
    definition.id !== DEFINITION_ID
    || definition.manufacturer !== 'Niryo'
    || definition.model !== 'NED2'
    || !exactStrings(definition.assetReferenceIds, [ASSET_REFERENCE_ID])
  ) {
    throw new Error('NED2 definition identity or asset reference is invalid.')
  }

  const conventions = requireRecord(
    definition.sourceConventions,
    'NED2 sourceConventions',
  )
  if (!exactStrings(Object.keys(conventions), [ASSET_REFERENCE_ID])) {
    throw new Error('NED2 sourceConventions must contain only the assembly asset URI key.')
  }
  const convention = requireRecord(
    conventions[ASSET_REFERENCE_ID],
    'NED2 assembly source convention',
  )
  const orientation = requireRecord(
    convention.orientation,
    'NED2 assembly orientation',
  )
  if (
    convention.linearUnit !== 'millimeter'
    || convention.sourceToMeters !== 0.001
    || orientation.mode !== 'up-axis'
    || orientation.upAxis !== 'z'
  ) {
    throw new Error('NED2 assembly source convention is invalid.')
  }

  const links = requireArray(definition.links, 'NED2 definition Links')
  if (links.length !== LINK_IDS.length) {
    throw new Error('NED2 definition must contain seven Links.')
  }

  const bindings = links.map((candidate, index): Ned2RenderAssetBinding => {
    const link = requireRecord(candidate, `NED2 Link ${index}`)
    const linkId = LINK_IDS[index]
    if (linkId === undefined) {
      throw new Error(`NED2 Link index ${index} is outside the render asset contract.`)
    }
    const occurrences = requireArray(
      link.geometryOccurrences,
      `NED2 Link ${linkId} Geometry occurrences`,
    )
    if (link.id !== linkId || occurrences.length !== 1) {
      throw new Error(`NED2 Link ${linkId} has an invalid identity or Geometry occurrence count.`)
    }
    const occurrence = requireRecord(
      occurrences[0],
      `NED2 Link ${linkId} Geometry occurrence`,
    )
    const occurrenceKey = `whole-source:${linkId}`
    if (
      occurrence.assetReferenceId !== ASSET_REFERENCE_ID
      || occurrence.occurrenceKey !== occurrenceKey
    ) {
      throw new Error(
        `NED2 Link ${linkId} must map ${occurrenceKey} to ${ASSET_REFERENCE_ID}.`,
      )
    }
    return Object.freeze({
      linkId,
      occurrenceKey,
      assetReferenceId: ASSET_REFERENCE_ID,
      sourceAssetUri: ASSET_URI,
      renderAssetUri: `/models/robot/ned2/${linkId}.glb`,
      fileName: `${linkId}.glb`,
    })
  })

  const occurrenceKeys = bindings.map(({ occurrenceKey }) => occurrenceKey)
  const renderUris = bindings.map(({ renderAssetUri }) => renderAssetUri)
  if (
    new Set(occurrenceKeys).size !== LINK_IDS.length
    || new Set(renderUris).size !== LINK_IDS.length
  ) {
    throw new Error('NED2 render Geometry bindings contain duplicate keys or URIs.')
  }

  const joints = requireArray(definition.joints, 'NED2 definition Joints')
  if (joints.length !== 6) {
    throw new Error('NED2 definition must contain six Joints.')
  }
  joints.forEach((candidate, index) => {
    const joint = requireRecord(candidate, `NED2 Joint ${index + 1}`)
    if (
      joint.id !== `J${index + 1}`
      || joint.type !== 'revolute'
      || joint.parentLinkId !== LINK_IDS[index]
      || joint.childLinkId !== LINK_IDS[index + 1]
    ) {
      throw new Error(`NED2 Joint J${index + 1} does not form the expected serial Link chain.`)
    }
  })

  const frames = requireArray(definition.frames, 'NED2 definition frames')
  const tcp = frames.find((candidate) => (
    isRecord(candidate) && candidate.role === 'tcp'
  ))
  if (!isRecord(tcp) || tcp.id !== 'TCP' || tcp.parentFrameId !== 'Tool') {
    throw new Error('NED2 definition must contain the deterministic TCP frame.')
  }
  return Object.freeze(bindings)
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

function validateGlbDocument(
  document: Record<string, unknown>,
  binaryByteLength: number,
  linkId: string,
): void {
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
    || bufferByteLength > binaryByteLength
    || binaryByteLength - bufferByteLength > 3
  ) {
    throw new Error(`${linkId}.glb embedded buffer length does not match its BIN chunk.`)
  }

  const bufferViews = requireArray(document.bufferViews, `${linkId}.glb bufferViews`)
  if (bufferViews.length === 0) {
    throw new Error(`${linkId}.glb must contain bufferViews.`)
  }
  const bufferViewLayouts = bufferViews.map((candidate, index) => {
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
    return Object.freeze({ byteLength, byteStride })
  })

  const accessors = requireArray(document.accessors, `${linkId}.glb accessors`)
  if (accessors.length === 0) throw new Error(`${linkId}.glb must contain accessors.`)
  const accessorShapes = accessors.map((candidate, index) => {
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
    if (
      typeof accessor.type !== 'string'
      || !(accessor.type in TYPE_COMPONENTS)
    ) {
      throw new Error(`${linkId}.glb accessor ${index} has an unsupported type.`)
    }
    const type = accessor.type as keyof typeof TYPE_COMPONENTS
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
    const elementBytes = componentBytes * TYPE_COMPONENTS[type]
    const layout = bufferViewLayouts[bufferViewIndex]!
    const stride = layout.byteStride ?? elementBytes
    if (stride < elementBytes) {
      throw new Error(`${linkId}.glb accessor ${index} exceeds its bufferView byteStride.`)
    }
    const requiredBytes = ((count - 1) * stride) + elementBytes
    if (byteOffset + requiredBytes > layout.byteLength) {
      throw new Error(`${linkId}.glb accessor ${index} exceeds its bufferView.`)
    }
    return Object.freeze({ type, componentType, bufferViewIndex })
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
  meshes.forEach((candidate, meshIndex) => {
    const mesh = requireRecord(candidate, `${linkId}.glb mesh ${meshIndex}`)
    const primitives = requireArray(
      mesh.primitives,
      `${linkId}.glb mesh ${meshIndex} primitives`,
    )
    if (primitives.length === 0) {
      throw new Error(`${linkId}.glb mesh ${meshIndex} must contain primitives.`)
    }
    primitives.forEach((primitiveCandidate, primitiveIndex) => {
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
        const accessorIndex = requireIndex(
          accessorCandidate,
          accessors.length,
          `${linkId}.glb ${semantic} accessor`,
        )
        usedAccessors.add(accessorIndex)
      }
      const positionIndex = requireIndex(
        attributes.POSITION,
        accessors.length,
        `${linkId}.glb POSITION accessor`,
      )
      const normalIndex = requireIndex(
        attributes.NORMAL,
        accessors.length,
        `${linkId}.glb NORMAL accessor`,
      )
      if (
        accessorShapes[positionIndex]?.type !== 'VEC3'
        || accessorShapes[normalIndex]?.type !== 'VEC3'
      ) {
        throw new Error(`${linkId}.glb POSITION and NORMAL accessors must be VEC3.`)
      }
      const indicesIndex = requireIndex(
        primitive.indices,
        accessors.length,
        `${linkId}.glb index accessor`,
      )
      const indices = accessorShapes[indicesIndex]!
      if (
        indices.type !== 'SCALAR'
        || ![5121, 5123, 5125].includes(indices.componentType)
      ) {
        throw new Error(`${linkId}.glb index accessor must use unsigned SCALAR values.`)
      }
      usedAccessors.add(indicesIndex)
      usedMaterials.add(requireIndex(
        primitive.material,
        materials.length,
        `${linkId}.glb material`,
      ))
    })
  })
  if (usedAccessors.size !== accessors.length) {
    throw new Error(`${linkId}.glb contains orphan accessors.`)
  }
  const usedBufferViews = new Set(
    [...usedAccessors].map((index) => accessorShapes[index]!.bufferViewIndex),
  )
  if (usedBufferViews.size !== bufferViews.length) {
    throw new Error(`${linkId}.glb contains orphan bufferViews.`)
  }
  if (usedMaterials.size !== materials.length) {
    throw new Error(`${linkId}.glb contains orphan materials.`)
  }

  const nodes = requireArray(document.nodes, `${linkId}.glb nodes`)
  if (nodes.length === 0) throw new Error(`${linkId}.glb must contain nodes.`)
  const nodeMeshes = new Set<number>()
  const nodeChildren = nodes.map((candidate, nodeIndex) => {
    const node = requireRecord(candidate, `${linkId}.glb node ${nodeIndex}`)
    if (node.mesh !== undefined) {
      nodeMeshes.add(requireIndex(
        node.mesh,
        meshes.length,
        `${linkId}.glb node ${nodeIndex} mesh`,
      ))
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
    const scene = requireRecord(
      candidate,
      `${linkId}.glb scene ${sceneIndex}`,
    )
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
}

export function validateNed2Glb(
  bytes: Uint8Array,
  linkId: string,
): number {
  const chunks = parseGlbChunks(bytes, linkId)
  const document = parseGlbJson(chunks[0]!.bytes, linkId)
  validateGlbDocument(document, chunks[1]!.bytes.byteLength, linkId)
  return bytes.byteLength
}

export async function validateNed2GlbFile(
  path: string,
  linkId: string,
): Promise<number> {
  return validateNed2Glb(await readFile(path), linkId)
}

export async function validateRobotAssets(
  assetDirectory = resolve(process.cwd(), 'public', 'models', 'robot', 'ned2'),
): Promise<void> {
  const manifestPath = resolve(assetDirectory, 'manifest.json')
  const manifestSource = await readFile(manifestPath, 'utf8')
  const bindings = validateNed2Manifest(JSON.parse(manifestSource) as unknown)
  const expectedFiles = bindings.map(({ fileName }) => fileName).sort()
  const actualFiles = (await readdir(assetDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /\.glb$/i.test(entry.name))
    .map(({ name }) => name)
    .sort()
  if (!exactStrings(actualFiles, expectedFiles)) {
    throw new Error(
      `NED2 render asset files do not match manifest bindings: expected ${expectedFiles.join(', ')}; found ${actualFiles.join(', ')}.`,
    )
  }

  let totalBytes = 0
  for (const binding of bindings) {
    totalBytes += await validateNed2GlbFile(
      resolve(assetDirectory, binding.fileName),
      binding.linkId,
    )
  }
  console.log(
    `NED2 manifest and ${bindings.length} bound GLB assets valid (${totalBytes} bytes); 0 errors; 0 warnings`,
  )
}

if (
  process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  validateRobotAssets().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
