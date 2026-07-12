import type { RobotLinkGeometryRecordV1 } from '../../domain/project/project'
import {
  MAX_ASSET_MATERIALS,
  MAX_ASSET_MESHES,
  MAX_ROBOT_LINK_TRIANGLES,
} from '../../domain/project/project'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { detectStepUnit, postImportScaleForUnit } from '../import/detect-step-unit'
import {
  assertOcctGeometryBudget,
  createThreeGroupFromOcct,
  type ImportedThreeAsset,
} from '../import/occt-to-three'

export const MAX_ROBOT_STEP_FILES = 7
export const MAX_ROBOT_STEP_FILE_BYTES = 25 * 1024 * 1024
export const MAX_ROBOT_STEP_TOTAL_BYTES = 100 * 1024 * 1024

export interface MappedRobotStepFile {
  linkId: RobotLinkId
  file: File
}

export interface RobotStepImportController {
  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult>
  cancel(): void
}

export interface RobotGeometryImportResult {
  assets: ReadonlyMap<RobotLinkId, ImportedThreeAsset>
  records: readonly RobotLinkGeometryRecordV1[]
}

type RobotGeometryConverter = typeof createThreeGroupFromOcct

export function validateRobotStepFiles(files: readonly File[]): void {
  if (files.length === 0) {
    throw new Error('Choose at least one robot STEP file.')
  }
  if (files.length > MAX_ROBOT_STEP_FILES) {
    throw new Error('Robot import accepts a maximum of 7 STEP files.')
  }

  let totalBytes = 0
  for (const file of files) {
    if (!/\.(?:step|stp)$/i.test(file.name)) {
      throw new Error(`${file.name} is not a .step or .stp file.`)
    }
    if (file.size > MAX_ROBOT_STEP_FILE_BYTES) {
      throw new Error(`${file.name} exceeds the 25 MiB per-file limit.`)
    }
    totalBytes += file.size
  }
  if (totalBytes > MAX_ROBOT_STEP_TOTAL_BYTES) {
    throw new Error('Robot STEP files exceed the 100 MiB total limit.')
  }
}

export function validateCompleteRobotStepFiles(files: readonly File[]): void {
  validateRobotStepFiles(files)
  if (files.length !== MAX_ROBOT_STEP_FILES) {
    throw new Error('A new Robot import requires exactly 7 STEP files.')
  }
  const mapped = mapRobotStepFiles(files)
  if (mapped.length !== MAX_ROBOT_STEP_FILES) {
    throw new Error('A new Robot import requires LINK00 through LINK06.')
  }
}

export function mapRobotStepFiles(
  files: readonly File[],
): readonly MappedRobotStepFile[] {
  validateRobotStepFiles(files)
  const assigned = new Map<RobotLinkId, File>()
  const generic: File[] = []

  for (const file of files) {
    const match = /LINK(\d{2})/i.exec(file.name)
    if (match === null) {
      generic.push(file)
      continue
    }
    const index = Number(match[1])
    if (!Number.isInteger(index) || index < 0 || index >= MAX_ROBOT_STEP_FILES) {
      throw new Error('Robot filenames may reference LINK00 through LINK06 only.')
    }
    const linkId = `LINK0${index}` as RobotLinkId
    if (assigned.has(linkId)) {
      throw new Error(`Duplicate ${linkId} robot STEP file.`)
    }
    assigned.set(linkId, file)
  }

  for (const file of generic) {
    const index = Array.from({ length: MAX_ROBOT_STEP_FILES }, (_, value) => value)
      .find((candidate) => !assigned.has(`LINK0${candidate}` as RobotLinkId))
    if (index === undefined) {
      throw new Error('Robot import accepts LINK00 through LINK06 only.')
    }
    assigned.set(`LINK0${index}` as RobotLinkId, file)
  }

  return [...assigned.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([linkId, file]) => ({ linkId, file }))
}

export async function importRobotStepFiles(
  files: readonly File[],
  client: RobotStepImportController,
  convert: RobotGeometryConverter = createThreeGroupFromOcct,
): Promise<ReadonlyMap<RobotLinkId, ImportedThreeAsset>> {
  return (await importRobotStepGeometry(files, client, convert)).assets
}

function statistics(result: OcctSuccessResult) {
  const totals = assertOcctGeometryBudget(result.meshes, {
    maxVertices: Number.MAX_SAFE_INTEGER,
    maxTriangles: MAX_ROBOT_LINK_TRIANGLES,
  })
  if (result.meshes.length > MAX_ASSET_MESHES) {
    throw new Error(`Robot Links support at most ${MAX_ASSET_MESHES} meshes.`)
  }
  const materialKeys = new Set<string>()
  for (const mesh of result.meshes) {
    materialKeys.add(JSON.stringify(mesh.color ?? [0.68, 0.72, 0.74]))
    for (const face of mesh.brep_faces) {
      if (face.color !== null) materialKeys.add(JSON.stringify(face.color))
    }
  }
  if (materialKeys.size > MAX_ASSET_MATERIALS) {
    throw new Error(`Robot Links support at most ${MAX_ASSET_MATERIALS} materials.`)
  }
  return {
    ...totals,
    meshes: result.meshes.length,
    materials: materialKeys.size,
  }
}

export async function importRobotStepGeometry(
  files: readonly File[],
  client: RobotStepImportController,
  convert: RobotGeometryConverter = createThreeGroupFromOcct,
): Promise<RobotGeometryImportResult> {
  const mapped = mapRobotStepFiles(files)
  return importMappedRobotStepGeometry(mapped, client, convert)
}

export async function importMappedRobotStepGeometry(
  mapped: readonly MappedRobotStepFile[],
  client: RobotStepImportController,
  convert: RobotGeometryConverter = createThreeGroupFromOcct,
): Promise<RobotGeometryImportResult> {
  const assets = new Map<RobotLinkId, ImportedThreeAsset>()
  const records: RobotLinkGeometryRecordV1[] = []

  try {
    for (const { linkId, file } of mapped) {
      const bytes = await file.arrayBuffer()
      const detectedUnit = detectStepUnit(bytes)
      const result = await client.import(bytes)
      const geometryStatistics = statistics(result)
      const asset = convert(result, {
        originMode: 'source',
        postImportScale:
          detectedUnit === 'unknown'
            ? postImportScaleForUnit('millimeter')
            : 1,
      }, {
        maxVertices: Number.MAX_SAFE_INTEGER,
        maxTriangles: MAX_ROBOT_LINK_TRIANGLES,
      })
      assets.set(linkId, asset)
      records.push({
        linkId,
        sourceFileName: file.name,
        sourceBytes: bytes,
        localTransform: {
          position: [0, 0, 0],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        collisionCenter: [...asset.colliderCenter],
        collisionHalfExtents: [
          asset.bounds.size[0] / 2,
          asset.bounds.size[1] / 2,
          asset.bounds.size[2] / 2,
        ],
        statistics: geometryStatistics,
      })
    }
    return { assets, records }
  } catch (error) {
    for (const asset of assets.values()) asset.dispose()
    throw error
  }
}

export async function restoreRobotGeometryRecords(
  records: readonly RobotLinkGeometryRecordV1[],
  client: RobotStepImportController,
  convert: RobotGeometryConverter = createThreeGroupFromOcct,
): Promise<ReadonlyMap<RobotLinkId, ImportedThreeAsset>> {
  const assets = new Map<RobotLinkId, ImportedThreeAsset>()
  try {
    for (const record of records) {
      const result = await client.import(record.sourceBytes)
      statistics(result)
      const detectedUnit = detectStepUnit(record.sourceBytes)
      const asset = convert(
        result,
        {
          originMode: 'source',
          postImportScale:
            detectedUnit === 'unknown'
              ? postImportScaleForUnit('millimeter')
              : 1,
        },
        {
          maxVertices: Number.MAX_SAFE_INTEGER,
          maxTriangles: MAX_ROBOT_LINK_TRIANGLES,
        },
      )
      assets.set(record.linkId, asset)
    }
    return assets
  } catch (error) {
    for (const asset of assets.values()) asset.dispose()
    throw error
  }
}
