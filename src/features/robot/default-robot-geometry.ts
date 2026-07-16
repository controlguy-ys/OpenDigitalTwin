import type { RobotLinkGeometryRecordV2 } from '../../domain/project/project'
import { LINK_WORLD_ORIGINS, type RobotLinkId } from '../../domain/robot/crb15000'

export const DEFAULT_ROBOT_SOURCE_FILE_NAMES = {
  LINK00: 'CRB15000_12kg-127_Omnicore_rev00_LINK00_CAD.step',
  LINK01: 'CRB15000_12kg-127_Omnicore_rev00_LINK01_CAD.step',
  LINK02: 'CRB15000_12kg-127_Omnicore_rev00_LINK02_CAD.step',
  LINK03: 'CRB15000_12kg-127_Omnicore_rev00_LINK03_CAD.step',
  LINK04: 'CRB15000_12kg-127_Omnicore_rev00_LINK04_CAD.step',
  LINK05: 'CRB15000_12kg-127_Omnicore_rev00_LINK05_CAD.STEP',
  LINK06: 'CRB15000_12kg-127_Omnicore_rev00_LINK06_CAD.step',
} as const satisfies Record<RobotLinkId, string>

export const DEFAULT_ROBOT_SOURCE_SHA256 = {
  LINK00: 'cc16b2240874d432b46e4c77bcf24f56121ad26e604a81b612650af050c1b801',
  LINK01: 'f65e5210c2f7dcc3d9c79b378b0e5435feeb757fda004d9f879df5ed51da2db1',
  LINK02: '9618cccd139b30bfeb56deaed045bb1b0af10bd2c2fef18a8973c218b03e1343',
  LINK03: 'fafb59b202bc72628f8cbaeb68a8fb1ae062faa254e18034f6cd8a2be4d43671',
  LINK04: '97654624273168c0a7369a8ffbad5b4651a74cae55210c08df5ef1b42bada7c1',
  LINK05: 'aa9908bef33bb89ccc7b27e19ab6a421f7deeac5fc908ec5414807e30e57e9bf',
  LINK06: '8a18f30a2ccf4ff0aad024d9f4cc8d257e5459148a013026c8ef1f03a90221c0',
} as const satisfies Record<RobotLinkId, string>

export function bundledDefaultRobotLinkIds(
  robot: {
    readonly sources: readonly {
      readonly id: string
      readonly sourceFileName: string
      readonly sha256: string
    }[]
    readonly links: readonly {
      readonly linkId: RobotLinkId
      readonly sourceRefs: readonly {
        readonly sourceAssetId: string
        readonly nodePath: readonly number[]
        readonly nodeName: string
        readonly meshIndices: readonly number[]
      }[]
      readonly coordinateMode: string
      readonly zeroPoseLocalization: {
        readonly position: readonly number[]
        readonly quaternion: readonly number[]
        readonly scale: readonly number[]
      }
    }[]
  },
): ReadonlySet<RobotLinkId> {
  const sources = new Map(robot.sources.map((source) => [source.id, source]))
  const bundled = new Set<RobotLinkId>()
  robot.links.forEach((link) => {
    const { linkId, sourceRefs, zeroPoseLocalization } = link
    const canonicalIndex = Number(linkId.slice(-2))
    const sourceRef = sourceRefs[0]
    const source = sources.get(sourceRef?.sourceAssetId ?? '')
    const matches = source?.sourceFileName === DEFAULT_ROBOT_SOURCE_FILE_NAMES[linkId] &&
      source.sha256 === DEFAULT_ROBOT_SOURCE_SHA256[linkId] &&
      sourceRefs.length === 1 &&
      sourceRef?.nodeName === `whole-source:${linkId}` &&
      sourceRef.nodePath.length === 2 &&
      sourceRef.nodePath[0] === -1 && sourceRef.nodePath[1] === canonicalIndex &&
      sourceRef.meshIndices.length === 1 && sourceRef.meshIndices[0] === 0 &&
      link.coordinateMode === 'link-local' &&
      zeroPoseLocalization.position.join(',') === '0,0,0' &&
      zeroPoseLocalization.quaternion.join(',') === '0,0,0,1' &&
      zeroPoseLocalization.scale.join(',') === '1,1,1'
    if (matches) bundled.add(linkId)
  })
  return bundled
}

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
          position: [0, 0, 0],
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
