import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import createOcct from 'occt-import-js'

import {
  CRB15000_LINK_IDS,
  CRB15000_ROBOT_MODEL_ID,
  LINK_WORLD_ORIGINS,
  type RobotLinkId,
} from './crb15000-asset-contract'
import type {
  OcctModule,
  OcctSuccessResult,
} from '../../src/lib/cad/occt-types'
import { writeLinkGlb } from './occt-to-gltf'

export { LINK_WORLD_ORIGINS }

export const LINK_IDS = CRB15000_LINK_IDS

export type LinkId = RobotLinkId
export type Vector3 = readonly [number, number, number]

export interface Bounds3 {
  min: Vector3
  max: Vector3
}

export interface StepLinkProbe {
  linkId: LinkId
  sourceFile: string
  vertexCount: number
  triangleCount: number
  bounds: Bounds3
}

export interface ExpectedLinkProbe {
  vertexCount: number
  triangleCount: number
  bounds: Bounds3
}

export const BOUNDS_TOLERANCE_METERS = 0.0005
export const TRIANGLE_COUNT_TOLERANCE_RATIO = 0.02

export const EXPECTED_LINK_PROBES: Record<LinkId, ExpectedLinkProbe> = {
  LINK00: {
    vertexCount: 4_527,
    triangleCount: 5_228,
    bounds: { min: [-0.1418, -0.1, 0], max: [0.1, 0.1, 0.214] },
  },
  LINK01: {
    vertexCount: 3_798,
    triangleCount: 5_544,
    bounds: {
      min: [-0.08, -0.09515, 0.2149],
      max: [0.08, 0.1116, 0.41811],
    },
  },
  LINK02: {
    vertexCount: 8_351,
    triangleCount: 9_970,
    bounds: {
      min: [-0.08076, -0.20365, 0.25727],
      max: [0.08076, -0.0863, 1.11353],
    },
  },
  LINK03: {
    vertexCount: 6_681,
    triangleCount: 9_883,
    bounds: {
      min: [-0.065, -0.085, 0.98003],
      max: [0.096, 0.11, 1.20757],
    },
  },
  LINK04: {
    vertexCount: 10_330,
    triangleCount: 11_162,
    bounds: {
      min: [0.097, -0.0528, 1.10218],
      max: [0.58478, 0.133, 1.20782],
    },
  },
  LINK05: {
    vertexCount: 9_056,
    triangleCount: 12_092,
    bounds: {
      min: [0.40657, -0.0935, 1.101],
      max: [0.602, 0.0745, 1.28775],
    },
  },
  LINK06: {
    vertexCount: 9_182,
    triangleCount: 11_476,
    bounds: {
      min: [0.6024, -0.0525, 1.18246],
      max: [0.635, 0.05253, 1.28754],
    },
  },
}

const SOURCE_FILENAMES: Record<LinkId, string> = {
  LINK00: 'CRB15000_12kg-127_Omnicore_rev00_LINK00_CAD.step',
  LINK01: 'CRB15000_12kg-127_Omnicore_rev00_LINK01_CAD.step',
  LINK02: 'CRB15000_12kg-127_Omnicore_rev00_LINK02_CAD.step',
  LINK03: 'CRB15000_12kg-127_Omnicore_rev00_LINK03_CAD.step',
  LINK04: 'CRB15000_12kg-127_Omnicore_rev00_LINK04_CAD.step',
  LINK05: 'CRB15000_12kg-127_Omnicore_rev00_LINK05_CAD.STEP',
  LINK06: 'CRB15000_12kg-127_Omnicore_rev00_LINK06_CAD.step',
}

const SOURCE_DIRECTORY = resolve(
  process.cwd(),
  'CRB15000_12kg-127_OmniCore_rev00_STEP_J',
)

const READ_PARAMETERS = {
  linearUnit: 'meter',
  linearDeflectionType: 'bounding_box_ratio',
  linearDeflection: 0.001,
  angularDeflection: 0.5,
} as const

let occtPromise: Promise<OcctModule> | undefined

function getOcct(): Promise<OcctModule> {
  return (occtPromise ??= createOcct())
}

function getResultBounds(result: OcctSuccessResult): Bounds3 {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]

  for (const mesh of result.meshes) {
    const positions = mesh.attributes.position.array
    if (positions.length === 0 || positions.length % 3 !== 0) {
      throw new Error(`OCCT returned an invalid position array for mesh ${mesh.name}`)
    }

    for (let index = 0; index < positions.length; index += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        const value = positions[index + axis]
        if (!Number.isFinite(value)) {
          throw new Error(`OCCT returned a non-finite position for mesh ${mesh.name}`)
        }
        min[axis] = Math.min(min[axis]!, value!)
        max[axis] = Math.max(max[axis]!, value!)
      }
    }
  }

  return {
    min: [min[0]!, min[1]!, min[2]!],
    max: [max[0]!, max[1]!, max[2]!],
  }
}

async function readStepLink(linkId: LinkId): Promise<OcctSuccessResult> {
  const sourceFile = SOURCE_FILENAMES[linkId]
  const bytes = await readFile(resolve(SOURCE_DIRECTORY, sourceFile))
  const occt = await getOcct()
  const result = occt.ReadStepFile(bytes, READ_PARAMETERS)

  if (result.success !== true) {
    throw new Error(`OCCT failed to read ${sourceFile}`)
  }
  if (result.meshes.length === 0) {
    throw new Error(`OCCT returned no meshes for ${sourceFile}`)
  }

  return result
}

function probeResult(linkId: LinkId, result: OcctSuccessResult): StepLinkProbe {
  return {
    linkId,
    sourceFile: SOURCE_FILENAMES[linkId],
    vertexCount: result.meshes.reduce(
      (count, mesh) => count + mesh.attributes.position.array.length / 3,
      0,
    ),
    triangleCount: result.meshes.reduce(
      (count, mesh) => count + mesh.index.array.length / 3,
      0,
    ),
    bounds: getResultBounds(result),
  }
}

function assertProbeMatchesExpected(probe: StepLinkProbe): void {
  const expected = EXPECTED_LINK_PROBES[probe.linkId]
  if (probe.vertexCount !== expected.vertexCount) {
    throw new Error(
      `${probe.linkId} has ${probe.vertexCount} vertices; expected ${expected.vertexCount}`,
    )
  }

  const triangleDelta = Math.abs(probe.triangleCount - expected.triangleCount)
  if (triangleDelta > expected.triangleCount * TRIANGLE_COUNT_TOLERANCE_RATIO) {
    throw new Error(
      `${probe.linkId} has ${probe.triangleCount} triangles; expected ${expected.triangleCount} within 2%`,
    )
  }

  for (const bound of ['min', 'max'] as const) {
    for (const axis of [0, 1, 2] as const) {
      const delta = Math.abs(
        probe.bounds[bound][axis] - expected.bounds[bound][axis],
      )
      if (delta > BOUNDS_TOLERANCE_METERS) {
        throw new Error(
          `${probe.linkId} ${bound}[${axis}] differs from expected by ${delta} m`,
        )
      }
    }
  }
}

export async function probeStepLink(linkId: LinkId): Promise<StepLinkProbe> {
  const result = await readStepLink(linkId)

  return probeResult(linkId, result)
}

export async function convertRobotAssets(
  outputDirectory = resolve(process.cwd(), 'public', 'models', 'robot'),
): Promise<void> {
  await mkdir(outputDirectory, { recursive: true })
  const links = []

  for (const linkId of LINK_IDS) {
    const result = await readStepLink(linkId)
    const probe = probeResult(linkId, result)
    assertProbeMatchesExpected(probe)

    const outputFile = `${linkId}.glb`
    const generated = await writeLinkGlb(
      linkId,
      result,
      resolve(outputDirectory, outputFile),
    )
    links.push({
      id: linkId,
      sourceFile: probe.sourceFile,
      worldOrigin: LINK_WORLD_ORIGINS[linkId],
      source: {
        vertexCount: probe.vertexCount,
        triangleCount: probe.triangleCount,
        bounds: probe.bounds,
      },
      generated: {
        file: outputFile,
        ...generated,
      },
    })
    console.log(
      `${linkId}: ${probe.vertexCount} vertices, ${probe.triangleCount} triangles, ${generated.materialColors.length} colors`,
    )
  }

  const report = {
    schemaVersion: 1,
    robotId: CRB15000_ROBOT_MODEL_ID,
    outputLinearUnit: 'meter',
    tessellation: READ_PARAMETERS,
    boundsToleranceMeters: BOUNDS_TOLERANCE_METERS,
    triangleCountToleranceRatio: TRIANGLE_COUNT_TOLERANCE_RATIO,
    links,
  }
  await writeFile(
    resolve(outputDirectory, 'asset-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  )
}

if (import.meta.url === pathToFileURL(process.argv[1]!).href) {
  convertRobotAssets().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
