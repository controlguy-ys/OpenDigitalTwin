import { readFile, stat } from 'node:fs/promises'
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
const GLB_MAGIC = 0x46546c67
const GLB_VERSION = 2
const GLB_HEADER_BYTES = 12

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

export function validateNed2Manifest(manifest: unknown): void {
  const root = requireRecord(manifest, 'NED2 manifest')
  const asset = requireRecord(root.assetReference, 'NED2 assetReference')
  const definition = requireRecord(root.definition, 'NED2 definition')

  if (
    asset.id !== ASSET_REFERENCE_ID
    || asset.uri !== 'builtin://niryo/ned2-assembly@v1'
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

  if (!Array.isArray(definition.links) || definition.links.length !== LINK_IDS.length) {
    throw new Error('NED2 definition must contain seven Links.')
  }
  definition.links.forEach((candidate, index) => {
    const link = requireRecord(candidate, `NED2 Link ${index}`)
    const linkId = LINK_IDS[index]
    if (link.id !== linkId || !Array.isArray(link.geometryOccurrences) || link.geometryOccurrences.length !== 1) {
      throw new Error(`NED2 Link ${linkId} has an invalid identity or Geometry occurrence count.`)
    }
    const occurrence = requireRecord(
      link.geometryOccurrences[0],
      `NED2 Link ${linkId} Geometry occurrence`,
    )
    if (
      occurrence.assetReferenceId !== ASSET_REFERENCE_ID
      || occurrence.occurrenceKey !== `whole-source:${linkId}`
    ) {
      throw new Error(`NED2 Link ${linkId} does not reference its deterministic assembly occurrence.`)
    }
  })

  if (!Array.isArray(definition.joints) || definition.joints.length !== 6) {
    throw new Error('NED2 definition must contain six Joints.')
  }
  definition.joints.forEach((candidate, index) => {
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

  if (!Array.isArray(definition.frames)) {
    throw new Error('NED2 definition frames must be an array.')
  }
  const tcp = definition.frames.find((candidate) => (
    isRecord(candidate) && candidate.role === 'tcp'
  ))
  if (!isRecord(tcp) || tcp.id !== 'TCP' || tcp.parentFrameId !== 'Tool') {
    throw new Error('NED2 definition must contain the deterministic TCP frame.')
  }
}

export async function validateNed2GlbFile(path: string, linkId: string): Promise<number> {
  const metadata = await stat(path)
  if (!metadata.isFile() || metadata.size <= GLB_HEADER_BYTES) {
    throw new Error(`${linkId}.glb must be a non-empty GLB file.`)
  }
  const bytes = await readFile(path)
  const header = new DataView(bytes.buffer, bytes.byteOffset, GLB_HEADER_BYTES)
  if (header.getUint32(0, true) !== GLB_MAGIC) {
    throw new Error(`${linkId}.glb has an invalid GLB magic header.`)
  }
  if (header.getUint32(4, true) !== GLB_VERSION) {
    throw new Error(`${linkId}.glb is not a GLB version 2 container.`)
  }
  if (header.getUint32(8, true) !== metadata.size) {
    throw new Error(`${linkId}.glb declared length does not match its file size.`)
  }
  return metadata.size
}

export async function validateRobotAssets(
  assetDirectory = resolve(process.cwd(), 'public', 'models', 'robot', 'ned2'),
): Promise<void> {
  const manifestPath = resolve(assetDirectory, 'manifest.json')
  const manifestSource = await readFile(manifestPath, 'utf8')
  validateNed2Manifest(JSON.parse(manifestSource) as unknown)

  let totalBytes = 0
  for (const linkId of LINK_IDS) {
    totalBytes += await validateNed2GlbFile(
      resolve(assetDirectory, `${linkId}.glb`),
      linkId,
    )
  }
  console.log(
    `NED2 manifest and ${LINK_IDS.length} GLB assets valid (${totalBytes} bytes); 0 errors; 0 warnings`,
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
