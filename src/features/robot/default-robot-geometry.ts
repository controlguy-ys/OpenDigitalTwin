import type { RobotLinkGeometryRecordV2 } from '../../domain/project/project'
import { LINK_WORLD_ORIGINS, type RobotLinkId } from '../../domain/robot/crb15000'

const SOURCE_URLS = {
  LINK00: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK00_CAD.step',
    import.meta.url,
  ).href,
  LINK01: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK01_CAD.step',
    import.meta.url,
  ).href,
  LINK02: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK02_CAD.step',
    import.meta.url,
  ).href,
  LINK03: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK03_CAD.step',
    import.meta.url,
  ).href,
  LINK04: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK04_CAD.step',
    import.meta.url,
  ).href,
  LINK05: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK05_CAD.STEP',
    import.meta.url,
  ).href,
  LINK06: new URL(
    '../../../CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK06_CAD.step',
    import.meta.url,
  ).href,
} as const satisfies Record<RobotLinkId, string>

interface AssetReportLink {
  id: RobotLinkId
  sourceFile: string
  source: {
    vertexCount: number
    triangleCount: number
    bounds: { min: [number, number, number]; max: [number, number, number] }
  }
  generated: {
    meshCount: number
    primitiveCount: number
    materialColors: readonly unknown[]
  }
}

interface AssetReport {
  links: AssetReportLink[]
}

function tupleMap(
  tuple: readonly [number, number, number],
  map: (value: number, index: number) => number,
): [number, number, number] {
  return [map(tuple[0], 0), map(tuple[1], 1), map(tuple[2], 2)]
}

export async function loadDefaultRobotGeometry(): Promise<RobotLinkGeometryRecordV2[]> {
  const reportResponse = await fetch('/models/robot/asset-report.json')
  if (!reportResponse.ok) throw new Error('Unable to load the default Robot asset report.')
  const report = (await reportResponse.json()) as AssetReport
  return Promise.all(
    report.links.map(async (link) => {
      const response = await fetch(SOURCE_URLS[link.id])
      if (!response.ok) throw new Error(`Unable to load default ${link.id} STEP source.`)
      const sourceBytes = await response.arrayBuffer()
      const origin = LINK_WORLD_ORIGINS[link.id]
      const localMin = tupleMap(link.source.bounds.min, (value, axis) => value - origin[axis]!)
      const localMax = tupleMap(link.source.bounds.max, (value, axis) => value - origin[axis]!)
      const collisionCenter = tupleMap(localMin, (value, axis) =>
        (value + localMax[axis]!) / 2,
      )
      const collisionHalfExtents = tupleMap(localMin, (value, axis) =>
        (localMax[axis]! - value) / 2,
      )
      return {
        linkId: link.id,
        sourceFileName: link.sourceFile,
        sourceBytes,
        localTransform: {
          position: [-origin[0], -origin[1], -origin[2]],
          quaternion: [0, 0, 0, 1],
          scale: [1, 1, 1],
        },
        visible: true,
        collisionCenter,
        collisionHalfExtents,
        collisionBoxes: [{
          id: 'default',
          center: [...collisionCenter],
          halfExtents: [...collisionHalfExtents],
          quaternion: [0, 0, 0, 1],
        }],
        statistics: {
          vertices: link.source.vertexCount,
          triangles: link.source.triangleCount,
          meshes: link.generated.meshCount,
          materials: link.generated.materialColors.length,
        },
      }
    }),
  )
}
