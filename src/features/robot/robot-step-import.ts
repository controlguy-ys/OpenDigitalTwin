import {
  LINK_WORLD_ORIGINS,
  type RobotLinkId,
} from '../../domain/robot/crb15000'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { detectStepUnit, postImportScaleForUnit } from '../import/detect-step-unit'
import {
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
  const mapped = mapRobotStepFiles(files)
  const assets = new Map<RobotLinkId, ImportedThreeAsset>()

  try {
    for (const { linkId, file } of mapped) {
      const bytes = await file.arrayBuffer()
      const detectedUnit = detectStepUnit(bytes)
      const result = await client.import(bytes)
      const asset = convert(result, {
        originMode: 'source',
        postImportScale:
          detectedUnit === 'unknown'
            ? postImportScaleForUnit('millimeter')
            : 1,
      })
      const origin = LINK_WORLD_ORIGINS[linkId]
      asset.group.position.set(-origin[0], -origin[1], -origin[2])
      asset.group.updateMatrix()
      assets.set(linkId, asset)
    }
    return assets
  } catch (error) {
    for (const asset of assets.values()) asset.dispose()
    throw error
  }
}
