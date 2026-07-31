import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  validateGlbMesh,
  type GlbBounds,
  type GlbMeshEvidence,
} from './validate-glb-mesh.js'

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
const BOUNDS_TOLERANCE_M = 1e-6

export interface Ned2RenderAssetBinding {
  readonly linkId: string
  readonly occurrenceKey: string
  readonly assetReferenceId: string
  readonly sourceAssetUri: string
  readonly renderAssetUri: string
  readonly fileName: string
  readonly expectedTriangles: number
  readonly expectedBounds: GlbBounds
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

function requirePositiveInteger(value: unknown, label: string): number {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function requireFiniteVector3(
  value: unknown,
  label: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new Error(`${label} must contain three finite values.`)
  }
  const first = value[0]
  const second = value[1]
  const third = value[2]
  if (
    typeof first !== 'number'
    || typeof second !== 'number'
    || typeof third !== 'number'
    || !Number.isFinite(first)
    || !Number.isFinite(second)
    || !Number.isFinite(third)
  ) {
    throw new Error(`${label} must contain three finite values.`)
  }
  return Object.freeze([first, second, third])
}

function expectedGeometry(
  occurrence: Record<string, unknown>,
  linkId: string,
): Pick<Ned2RenderAssetBinding, 'expectedTriangles' | 'expectedBounds'> {
  const statistics = requireRecord(
    occurrence.statistics,
    `NED2 Link ${linkId} Geometry statistics`,
  )
  const expectedTriangles = requirePositiveInteger(
    statistics.triangles,
    `NED2 Link ${linkId} triangle count`,
  )
  const collisionBoxes = requireArray(
    occurrence.collisionBoxes,
    `NED2 Link ${linkId} collision boxes`,
  )
  if (collisionBoxes.length !== 1) {
    throw new Error(`NED2 Link ${linkId} must have one generated local bounds box.`)
  }
  const bounds = requireRecord(
    collisionBoxes[0],
    `NED2 Link ${linkId} generated local bounds`,
  )
  if (bounds.id !== 'generated-local-bounds') {
    throw new Error(`NED2 Link ${linkId} must use generated-local-bounds.`)
  }
  const center = requireFiniteVector3(
    bounds.centerM,
    `NED2 Link ${linkId} bounds center`,
  )
  const halfExtents = requireFiniteVector3(
    bounds.halfExtentsM,
    `NED2 Link ${linkId} bounds half extents`,
  )
  if (halfExtents.some((value) => value <= 0)) {
    throw new Error(`NED2 Link ${linkId} bounds half extents must be positive.`)
  }
  const min: readonly [number, number, number] = Object.freeze([
    center[0] - halfExtents[0],
    center[1] - halfExtents[1],
    center[2] - halfExtents[2],
  ])
  const max: readonly [number, number, number] = Object.freeze([
    center[0] + halfExtents[0],
    center[1] + halfExtents[1],
    center[2] + halfExtents[2],
  ])
  return Object.freeze({
    expectedTriangles,
    expectedBounds: Object.freeze({ min, max }),
  })
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
      ...expectedGeometry(occurrence, linkId),
    })
  })

  if (
    new Set(bindings.map(({ occurrenceKey }) => occurrenceKey)).size !== LINK_IDS.length
    || new Set(bindings.map(({ renderAssetUri }) => renderAssetUri)).size !== LINK_IDS.length
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

export function assertNed2MeshEvidence(
  binding: Pick<
    Ned2RenderAssetBinding,
    'linkId' | 'expectedTriangles' | 'expectedBounds'
  >,
  evidence: GlbMeshEvidence,
): void {
  if (evidence.triangleCount !== binding.expectedTriangles) {
    throw new Error(
      `${binding.linkId}.glb has ${evidence.triangleCount} triangles; manifest requires ${binding.expectedTriangles}.`,
    )
  }
  for (const bound of ['min', 'max'] as const) {
    for (let axis = 0; axis < 3; axis += 1) {
      const delta = Math.abs(
        evidence.bounds[bound][axis]! - binding.expectedBounds[bound][axis]!,
      )
      if (delta > BOUNDS_TOLERANCE_M) {
        throw new Error(
          `${binding.linkId}.glb ${bound}[${axis}] differs from manifest bounds by ${delta} m.`,
        )
      }
    }
  }
}

export function validateNed2Glb(
  bytes: Uint8Array,
  linkId: string,
): GlbMeshEvidence {
  return validateGlbMesh(bytes, linkId)
}

export async function validateNed2GlbFile(
  path: string,
  binding: Ned2RenderAssetBinding,
): Promise<GlbMeshEvidence> {
  const evidence = validateNed2Glb(await readFile(path), binding.linkId)
  assertNed2MeshEvidence(binding, evidence)
  return evidence
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
  let totalTriangles = 0
  for (const binding of bindings) {
    const evidence = await validateNed2GlbFile(
      resolve(assetDirectory, binding.fileName),
      binding,
    )
    totalBytes += evidence.byteLength
    totalTriangles += evidence.triangleCount
  }
  console.log(
    `NED2 manifest and ${bindings.length} bound GLB assets valid (${totalBytes} bytes, ${totalTriangles} triangles); 0 errors; 0 warnings`,
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
