import { Group, Mesh, type BufferGeometry } from 'three'
import type { StoreApi } from 'zustand/vanilla'

import {
  composeRigidTransformV4,
  invertRigidTransformV4,
  MAX_JOBS_V4,
  MAX_ROBOT_DEFINITIONS_V4,
  MAX_ROBOT_DEFINITION_STEP_BYTES_V4,
  MAX_ROBOT_DEFINITION_TRIANGLES_V4,
  MAX_ROBOT_INSTANCES_V4,
  MAX_ROBOT_STEP_SOURCES_V4,
  type AssetReferenceV4,
  type CollisionBoxV4,
  type GeometryStatisticsV4,
  type QuaternionV4,
  type RigidTransformV4,
  type RobotDefinitionV4,
  type RobotIdV4,
  type SourceConventionV4,
  type Vector3V4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import { computeSerialRobotPoseV4 } from '../../../core/robot-runtime/serial-kinematics.js'
import type { OcctNode, OcctSuccessResult } from '../../../lib/cad/occt-types.js'
import type { ProjectHashService } from '../../../lib/hash/sha256.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import { detectStepUnit, postImportScaleForUnit } from '../../import/detect-step-unit.js'
import {
  assertOcctGeometryBudget,
  createThreeGroupFromOcct,
  type ImportedBounds,
  type ImportedThreeAsset,
} from '../../import/occt-to-three.js'
import type { ProjectMutationServiceV4 } from '../../project/v4/project-v4-mutation-service.js'
import { createBuiltinCrbDefinitionV4 } from './builtin-crb-definition.js'
import {
  createPreparedRobotDefinitionGeometryV4,
  type PreparedRobotDefinitionGeometryV4,
} from './robot-definition-geometry-repository.js'
import type {
  RobotStepAssetRecordV4,
  RobotStepAssetRepositoryV4,
} from './robot-step-asset-repository-v4.js'

const MAX_ROBOT_LINK_MESHES_V4 = 64
const MAX_ROBOT_LINK_MATERIALS_V4 = 32

export const ROBOT_OCCT_OUTPUT_SCALE_V4 = 1

export type RobotSourceUpAxisV4 = 'x' | 'y' | 'z'

export interface RobotImportDraftV4 {
  readonly name: string
  readonly manufacturer: string
  readonly model: string
  readonly sourceUpAxis: RobotSourceUpAxisV4
}

export interface MappedRobotStepFileV4 {
  readonly linkOrdinal: number
  readonly file: File
}

export interface RobotStepImportParserV4 {
  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult>
  cancel(): void
}

export interface RobotImportControllerV4 {
  importRobot(
    files: readonly File[],
    draft: RobotImportDraftV4,
  ): Promise<RobotIdV4>
  cancel(): boolean
}

interface ParsedRobotStepSourceV4 {
  readonly assetId: string
  readonly sourceFileName: string
  readonly sha256: string
  readonly bytes: ArrayBuffer
  readonly convention: SourceConventionV4
  readonly occurrences: readonly ParsedRobotStepOccurrenceV4[]
}

interface ParsedRobotStepOccurrenceV4 {
  readonly occurrenceKey: string
  readonly statistics: GeometryStatisticsV4
  readonly collisionBox: CollisionBoxV4
  readonly kinematicBounds: ImportedBounds
  readonly asset: ImportedThreeAsset
  readonly linkOrdinal: number
}

interface RobotAssemblyComponentV4 {
  readonly name: string
  readonly meshIndices: readonly number[]
  readonly center: Vector3V4
}

interface RobotLinkMeshSelectionV4 {
  readonly linkOrdinal: number
  readonly meshIndices: readonly number[]
  readonly kinematicMeshIndices: readonly number[]
}

interface ImportedRobotProjectV4 {
  readonly project: WorkcellProjectV4
  readonly definition: RobotDefinitionV4
  readonly robotId: RobotIdV4
  readonly jobId: string
}

export interface RobotImportGeometryResolverV4 {
  stage(definitionId: string, geometry: PreparedRobotDefinitionGeometryV4): void
  discard(definitionId: string): boolean
  resolve(
    project: WorkcellProjectV4,
    definition: RobotDefinitionV4,
  ): Promise<PreparedRobotDefinitionGeometryV4 | null>
}

export interface RobotImportControllerDependenciesV4 {
  readonly mutations: ProjectMutationServiceV4
  readonly interaction: StoreApi<InteractionStoreStateV4>
  readonly assets: RobotStepAssetRepositoryV4
  readonly geometry: RobotImportGeometryResolverV4
  readonly parser: RobotStepImportParserV4
  readonly hash: ProjectHashService
  readonly createId: () => string
}

export function validateRobotStepFilesV4(files: readonly File[]): void {
  if (files.length === 0 || files.length > MAX_ROBOT_STEP_SOURCES_V4) {
    throw new Error('Choose between 1 and 7 Robot STEP files.')
  }
  let totalBytes = 0
  for (const file of files) {
    if (!/\.(?:step|stp)$/i.test(file.name)) {
      throw new Error(`${file.name} is not a .step or .stp file.`)
    }
    if (file.size === 0) throw new Error(`${file.name} is empty.`)
    totalBytes += file.size
  }
  if (totalBytes > MAX_ROBOT_DEFINITION_STEP_BYTES_V4) {
    throw new Error('Robot STEP files exceed the 100 MiB total limit.')
  }
}

export function mapRobotStepFilesV4(
  files: readonly File[],
): readonly MappedRobotStepFileV4[] {
  validateRobotStepFilesV4(files)
  const assigned = new Map<number, File>()
  const unnamed: File[] = []
  for (const file of files) {
    const match = /LINK(0[0-6])(?!\d)/i.exec(file.name)
    if (match === null) {
      unnamed.push(file)
      continue
    }
    const ordinal = Number(match[1])
    if (assigned.has(ordinal)) {
      throw new Error(`Multiple STEP files map to LINK${String(ordinal).padStart(2, '0')}.`)
    }
    assigned.set(ordinal, file)
  }
  for (const file of unnamed) {
    const ordinal = Array.from({ length: 7 }, (_, index) => index)
      .find((candidate) => !assigned.has(candidate))
    if (ordinal === undefined) throw new Error('Robot STEP mapping exceeds LINK00 through LINK06.')
    assigned.set(ordinal, file)
  }
  return Object.freeze([...assigned.entries()]
    .sort(([left], [right]) => left - right)
    .map(([linkOrdinal, file]) => Object.freeze({ linkOrdinal, file })))
}

function orientationQuaternionV4(upAxis: RobotSourceUpAxisV4): QuaternionV4 {
  if (upAxis === 'x') return [0, -Math.SQRT1_2, 0, Math.SQRT1_2]
  if (upAxis === 'y') return [Math.SQRT1_2, 0, 0, Math.SQRT1_2]
  return [0, 0, 0, 1]
}

function countMaterialsV4(result: OcctSuccessResult): number {
  const keys = new Set<string>()
  for (const mesh of result.meshes) {
    keys.add(JSON.stringify(mesh.color ?? [0.68, 0.72, 0.74]))
    for (const face of mesh.brep_faces) {
      if (face.color !== null) keys.add(JSON.stringify(face.color))
    }
  }
  return keys.size
}

function statisticsV4(result: OcctSuccessResult): GeometryStatisticsV4 {
  const totals = assertOcctGeometryBudget(result.meshes, {
    maxVertices: Number.MAX_SAFE_INTEGER,
    maxTriangles: MAX_ROBOT_DEFINITION_TRIANGLES_V4,
  })
  if (result.meshes.length > MAX_ROBOT_LINK_MESHES_V4) {
    throw new Error(`Robot Links support at most ${MAX_ROBOT_LINK_MESHES_V4} meshes.`)
  }
  const materials = countMaterialsV4(result)
  if (materials > MAX_ROBOT_LINK_MATERIALS_V4) {
    throw new Error(`Robot Links support at most ${MAX_ROBOT_LINK_MATERIALS_V4} materials.`)
  }
  return Object.freeze({
    vertices: totals.vertices,
    triangles: totals.triangles,
    meshes: result.meshes.length,
    materials,
  })
}

function meshBoundsV4(
  result: OcctSuccessResult,
  meshIndices: readonly number[],
): ImportedBounds {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY]
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]
  for (const meshIndex of meshIndices) {
    const positions = result.meshes[meshIndex]!.attributes.position.array
    for (let offset = 0; offset < positions.length; offset += 3) {
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis]!, positions[offset + axis]!)
        max[axis] = Math.max(max[axis]!, positions[offset + axis]!)
      }
    }
  }
  const center: Vector3V4 = [
    (min[0]! + max[0]!) / 2,
    (min[1]! + max[1]!) / 2,
    (min[2]! + max[2]!) / 2,
  ]
  return Object.freeze({
    min: Object.freeze([...min]) as [number, number, number],
    max: Object.freeze([...max]) as [number, number, number],
    size: Object.freeze(min.map((value, axis) => max[axis]! - value)) as [number, number, number],
    center: Object.freeze(center) as [number, number, number],
  })
}

function collectRobotAssemblyComponentsV4(
  result: OcctSuccessResult,
): readonly RobotAssemblyComponentV4[] | null {
  const components: RobotAssemblyComponentV4[] = []
  const seenMeshes = new Set<number>()
  let invalid = false
  const visit = (node: OcctNode): void => {
    if (node.meshes.length > 0) {
      const meshIndices = [...node.meshes]
      if (meshIndices.some((index) => (
        !Number.isSafeInteger(index)
        || index < 0
        || index >= result.meshes.length
        || seenMeshes.has(index)
      ))) {
        invalid = true
        return
      }
      meshIndices.forEach((index) => seenMeshes.add(index))
      components.push(Object.freeze({
        name: node.name,
        meshIndices: Object.freeze(meshIndices),
        center: meshBoundsV4(result, meshIndices).center,
      }))
    }
    node.children.forEach(visit)
  }
  visit(result.root)
  if (invalid || components.length < 7 || seenMeshes.size !== result.meshes.length) return null
  return Object.freeze(components)
}

function explicitRobotLinkOrdinalV4(name: string): number | null {
  const link = /(?:^|[^a-z0-9])link[\s_-]*0?([0-6])(?:[^0-9]|$)/i.exec(name)
  if (link !== null) return Number(link[1])
  if (/(?:^|[^a-z0-9])base(?:[^a-z0-9]|$)/i.test(name)) return 0
  const joint = /(?:^|[^a-z0-9])j(?:oint)?[\s_-]*([1-6])(?:[^0-9]|$)/i.exec(name)
  return joint === null ? null : Number(joint[1])
}

function distanceSquaredV4(left: Vector3V4, right: Vector3V4): number {
  return left.reduce((total, value, axis) => {
    const delta = value - right[axis]!
    return total + delta * delta
  }, 0)
}

function robotAssemblySelectionsV4(
  result: OcctSuccessResult,
): readonly RobotLinkMeshSelectionV4[] | null {
  const components = collectRobotAssemblyComponentsV4(result)
  if (components === null) return null
  const primary = new Map<number, RobotAssemblyComponentV4>()
  const extras: RobotAssemblyComponentV4[] = []
  for (const component of components) {
    const ordinal = explicitRobotLinkOrdinalV4(component.name)
    if (ordinal === null || primary.has(ordinal)) extras.push(component)
    else primary.set(ordinal, component)
  }
  if (components.length === 7 && primary.size < 7) {
    primary.clear()
    components.forEach((component, ordinal) => primary.set(ordinal, component))
    extras.length = 0
  }
  if (primary.size !== 7) return null

  const meshesByLink = new Map<number, number[]>(
    [...primary].map(([ordinal, component]) => [ordinal, [...component.meshIndices]]),
  )
  for (const component of extras) {
    const nearest = [...primary].reduce((best, candidate) => (
      distanceSquaredV4(component.center, candidate[1].center)
        < distanceSquaredV4(component.center, best[1].center)
        ? candidate
        : best
    ))
    meshesByLink.get(nearest[0])!.push(...component.meshIndices)
  }
  return Object.freeze(Array.from({ length: 7 }, (_, linkOrdinal) => Object.freeze({
    linkOrdinal,
    meshIndices: Object.freeze(meshesByLink.get(linkOrdinal)!.sort((left, right) => left - right)),
    kinematicMeshIndices: primary.get(linkOrdinal)!.meshIndices,
  })))
}

function selectedOcctResultV4(
  result: OcctSuccessResult,
  meshIndices: readonly number[],
): OcctSuccessResult {
  return {
    success: true,
    root: { name: '', meshes: [], children: [] },
    meshes: meshIndices.map((index) => result.meshes[index]!),
  }
}

function occurrenceKeyV4(sha256: string, linkOrdinal: number, splitAssembly: boolean): string {
  return splitAssembly
    ? `assembly-link-${String(linkOrdinal).padStart(2, '0')}:${sha256}`
    : `whole-source:${sha256}`
}

function parsedOccurrencesV4(
  result: OcctSuccessResult,
  sha256: string,
  fallbackLinkOrdinal: number,
  splitAssembly: boolean,
): readonly ParsedRobotStepOccurrenceV4[] {
  const inferred = splitAssembly ? robotAssemblySelectionsV4(result) : null
  const selections = inferred ?? Object.freeze([Object.freeze({
    linkOrdinal: fallbackLinkOrdinal,
    meshIndices: Object.freeze(result.meshes.map((_, index) => index)),
    kinematicMeshIndices: Object.freeze(result.meshes.map((_, index) => index)),
  })])
  const occurrences: ParsedRobotStepOccurrenceV4[] = []
  try {
    for (const selection of selections) {
      const selectedResult = selectedOcctResultV4(result, selection.meshIndices)
      const statistics = statisticsV4(selectedResult)
      const asset = createThreeGroupFromOcct(selectedResult, {
        originMode: 'source',
        postImportScale: ROBOT_OCCT_OUTPUT_SCALE_V4,
      }, {
        maxVertices: Number.MAX_SAFE_INTEGER,
        maxTriangles: MAX_ROBOT_DEFINITION_TRIANGLES_V4,
      })
      occurrences.push(Object.freeze({
        occurrenceKey: occurrenceKeyV4(sha256, selection.linkOrdinal, inferred !== null),
        statistics,
        collisionBox: collisionBoxV4(asset, selection.linkOrdinal),
        kinematicBounds: meshBoundsV4(result, selection.kinematicMeshIndices),
        asset,
        linkOrdinal: selection.linkOrdinal,
      }))
    }
    return Object.freeze(occurrences)
  } catch (error) {
    occurrences.forEach(({ asset }) => asset.dispose())
    throw error
  }
}

function collisionBoxV4(
  asset: ImportedThreeAsset,
  ordinal: number,
): CollisionBoxV4 {
  const positiveHalfExtent = (size: number): number => Math.max(size / 2, 1e-6)
  return Object.freeze({
    id: `imported-box-${ordinal}`,
    centerM: Object.freeze([...asset.colliderCenter]) as Vector3V4,
    halfExtentsM: Object.freeze(asset.bounds.size.map(positiveHalfExtent)) as Vector3V4,
    quaternion: Object.freeze([0, 0, 0, 1]) as QuaternionV4,
  })
}

function collectSharedGeometryV4(assets: Iterable<ImportedThreeAsset>): Set<BufferGeometry> {
  const geometry = new Set<BufferGeometry>()
  for (const asset of assets) {
    asset.group.traverse((object) => {
      if (object instanceof Mesh) geometry.add(object.geometry)
    })
  }
  return geometry
}

function applyOccurrencePoseV4(group: Group, pose: RigidTransformV4): void {
  group.position.set(...pose.positionM)
  group.quaternion.set(...pose.quaternion)
  group.updateMatrix()
}

function prepareImportedGeometryV4(
  definition: RobotDefinitionV4,
  assetsByOccurrenceKey: ReadonlyMap<string, ImportedThreeAsset>,
): PreparedRobotDefinitionGeometryV4 {
  const consumed = new Set<string>()
  const linkTemplates = new Map<string, Group>()
  try {
    for (const link of definition.links) {
      const linkRoot = new Group()
      linkRoot.name = `imported:${definition.id}:${link.id}`
      for (const occurrence of link.geometryOccurrences) {
        const asset = assetsByOccurrenceKey.get(occurrence.occurrenceKey)
        if (asset === undefined || consumed.has(occurrence.occurrenceKey)) {
          throw new Error(`Imported Geometry is unavailable for ${occurrence.occurrenceKey}.`)
        }
        consumed.add(occurrence.occurrenceKey)
        applyOccurrencePoseV4(asset.group, occurrence.linkLocalPose)
        linkRoot.add(asset.group)
      }
      linkTemplates.set(link.id, linkRoot)
    }
    const assets = [...assetsByOccurrenceKey.values()]
    const sharedGeometry = collectSharedGeometryV4(assets)
    const triangleCount = definition.links.reduce((total, link) => (
      total + link.geometryOccurrences.reduce((linkTotal, occurrence) => (
        linkTotal + occurrence.statistics.triangles
      ), 0)
    ), 0)
    return createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates,
      sharedGeometry,
      triangleCount,
      disposeResources: () => {
        for (const asset of assets) asset.dispose()
      },
    })
  } catch (error) {
    for (const asset of assetsByOccurrenceKey.values()) asset.dispose()
    throw error
  }
}

function portableIdSegmentV4(value: string): string {
  const normalized = value.trim().replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '')
  if (normalized === '') throw new Error('Robot Import could not create a portable identity.')
  return normalized.slice(0, 64)
}

function importedAssetReferenceV4(source: ParsedRobotStepSourceV4): AssetReferenceV4 {
  return Object.freeze({
    id: source.assetId,
    uri: `asset://robot-import/${source.sha256}.step`,
    sha256: source.sha256,
    byteLength: source.bytes.byteLength,
    sourceFileName: source.sourceFileName,
    mediaType: 'model/step',
  })
}

function interfaceCenterV4(left: ImportedBounds, right: ImportedBounds): Vector3V4 {
  return Object.freeze(left.min.map((leftMin, axis) => {
    const overlapMin = Math.max(leftMin, right.min[axis]!)
    const overlapMax = Math.min(left.max[axis]!, right.max[axis]!)
    if (overlapMin <= overlapMax) return (overlapMin + overlapMax) / 2
    return left.max[axis]! < right.min[axis]!
      ? (left.max[axis]! + right.min[axis]!) / 2
      : (right.max[axis]! + leftMin) / 2
  })) as Vector3V4
}

function importedLinkHomePosesV4(
  template: RobotDefinitionV4,
  sources: readonly ParsedRobotStepSourceV4[],
  sourceOrientation: RigidTransformV4,
): ReadonlyMap<number, RigidTransformV4> {
  const occurrenceByOrdinal = new Map<number, ParsedRobotStepOccurrenceV4>()
  let ambiguous = false
  for (const source of sources) {
    for (const occurrence of source.occurrences) {
      if (occurrenceByOrdinal.has(occurrence.linkOrdinal)) ambiguous = true
      occurrenceByOrdinal.set(occurrence.linkOrdinal, occurrence)
    }
  }

  let rawOrigins: readonly Vector3V4[]
  if (!ambiguous && occurrenceByOrdinal.size === template.links.length) {
    const origins: Vector3V4[] = [Object.freeze([0, 0, 0])]
    for (let ordinal = 1; ordinal < template.links.length; ordinal += 1) {
      origins.push(interfaceCenterV4(
        occurrenceByOrdinal.get(ordinal - 1)!.kinematicBounds,
        occurrenceByOrdinal.get(ordinal)!.kinematicBounds,
      ))
    }
    rawOrigins = Object.freeze(origins)
  } else {
    const home = computeSerialRobotPoseV4(
      template,
      Object.fromEntries(template.joints.map((joint) => [joint.id, joint.home])),
    )
    rawOrigins = Object.freeze(template.links.map((link) => (
      home.linkWorldPoses[link.id]!.positionM
    )))
  }

  return new Map(rawOrigins.map((positionM, ordinal) => {
    const oriented = composeRigidTransformV4(sourceOrientation, {
      positionM,
      quaternion: [0, 0, 0, 1],
    })
    return [ordinal, Object.freeze({
      positionM: Object.freeze([...oriented.positionM]) as Vector3V4,
      quaternion: Object.freeze([0, 0, 0, 1]) as QuaternionV4,
    })] as const
  }))
}

function buildImportedRobotProjectV4(
  active: WorkcellProjectV4,
  sources: readonly ParsedRobotStepSourceV4[],
  draft: RobotImportDraftV4,
  identity: string,
): ImportedRobotProjectV4 {
  if (active.robots.length >= MAX_ROBOT_INSTANCES_V4) {
    throw new Error(`A Project supports at most ${MAX_ROBOT_INSTANCES_V4} Robot instances.`)
  }
  if (active.robotDefinitions.length >= MAX_ROBOT_DEFINITIONS_V4) {
    throw new Error(`A Project supports at most ${MAX_ROBOT_DEFINITIONS_V4} Robot definitions.`)
  }
  if (active.jobs.length >= MAX_JOBS_V4) {
    throw new Error(`A Project supports at most ${MAX_JOBS_V4} Robot Jobs.`)
  }
  const name = draft.name.trim()
  const manufacturer = draft.manufacturer.trim()
  const model = draft.model.trim()
  if (name === '' || manufacturer === '' || model === '') {
    throw new Error('Robot name, manufacturer, and model are required.')
  }

  const template = createBuiltinCrbDefinitionV4()
  const token = portableIdSegmentV4(identity)
  const definitionId = `imported-robot-definition-${token}`
  const robotId = `imported-robot-${token}`
  const jobId = `imported-robot-job-${token}`
  const linkIds = new Map(template.links.map((link, index) => (
    [link.id, `${definitionId}-link-${String(index).padStart(2, '0')}`] as const
  )))
  const frameIds = new Map(template.frames.map((frame, index) => (
    [frame.id, `${definitionId}-frame-${String(index).padStart(2, '0')}`] as const
  )))
  const sourceOrientation = Object.freeze({
    positionM: Object.freeze([0, 0, 0]) as Vector3V4,
    quaternion: Object.freeze(orientationQuaternionV4(draft.sourceUpAxis)),
  })
  const linkHomePoses = importedLinkHomePosesV4(template, sources, sourceOrientation)
  const geometryPoseByOrdinal = new Map(template.links.map((_link, index) => {
    const localized = composeRigidTransformV4(
      invertRigidTransformV4(linkHomePoses.get(index)!),
      sourceOrientation,
    )
    return [index, Object.freeze({
      positionM: Object.freeze([...localized.positionM]) as Vector3V4,
      quaternion: Object.freeze([...localized.quaternion]) as QuaternionV4,
    })] as const
  }))
  const occurrencesByOrdinal = new Map<number, Array<{
    readonly source: ParsedRobotStepSourceV4
    readonly occurrence: ParsedRobotStepOccurrenceV4
  }>>()
  for (const source of sources) {
    for (const occurrence of source.occurrences) {
      const entries = occurrencesByOrdinal.get(occurrence.linkOrdinal) ?? []
      entries.push({ source, occurrence })
      occurrencesByOrdinal.set(occurrence.linkOrdinal, entries)
    }
  }
  const links = template.links.map((link, index) => {
    const occurrences = occurrencesByOrdinal.get(index) ?? []
    return Object.freeze({
      id: linkIds.get(link.id)!,
      name: `LINK${String(index).padStart(2, '0')}`,
      geometryOccurrences: Object.freeze(occurrences.map(({ source, occurrence }) => Object.freeze({
        occurrenceKey: occurrence.occurrenceKey,
        assetReferenceId: source.assetId,
        linkLocalPose: geometryPoseByOrdinal.get(index)!,
        statistics: occurrence.statistics,
        collisionBoxes: Object.freeze([occurrence.collisionBox]),
      }))),
    })
  })
  const joints = template.joints.map((joint, index) => Object.freeze({
    ...joint,
    id: `${definitionId}-joint-${index + 1}`,
    parentLinkId: linkIds.get(joint.parentLinkId)!,
    childLinkId: linkIds.get(joint.childLinkId)!,
    origin: Object.freeze({
      positionM: Object.freeze(linkHomePoses.get(index + 1)!.positionM.map((value, axis) => (
        value - linkHomePoses.get(index)!.positionM[axis]!
      ))) as Vector3V4,
      quaternion: Object.freeze([...joint.origin.quaternion]) as QuaternionV4,
    }),
    axis: Object.freeze([...joint.axis]) as Vector3V4,
  }))
  const frames = template.frames.map((frame) => Object.freeze({
    ...frame,
    id: frameIds.get(frame.id)!,
    parentFrameId: frame.parentFrameId === null
      ? null
      : linkIds.get(frame.parentFrameId) ?? frameIds.get(frame.parentFrameId)!,
    localPose: Object.freeze({
      positionM: Object.freeze([...frame.localPose.positionM]) as Vector3V4,
      quaternion: Object.freeze([...frame.localPose.quaternion]) as QuaternionV4,
    }),
  }))
  const definition = Object.freeze({
    id: definitionId,
    name,
    manufacturer,
    model,
    assetReferenceIds: Object.freeze(sources.map(({ assetId }) => assetId)),
    sourceConventions: Object.freeze(Object.fromEntries(sources.map((source) => (
      [source.assetId, source.convention]
    )))),
    links: Object.freeze(links),
    joints: Object.freeze(joints),
    frames: Object.freeze(frames),
    excludedGeometryOccurrenceKeys: Object.freeze([]),
  }) satisfies RobotDefinitionV4
  const baseParentFrame = active.scene.frames.find(({ role }) => role === 'mcp')
    ?? active.scene.frames.find(({ role }) => role === 'world')
  if (baseParentFrame === undefined) throw new Error('Project MCP or World Frame is unavailable.')
  const toolFrame = frames.find(({ role }) => role === 'tool')
  const tcpFrame = frames.find(({ role }) => role === 'tcp')
  if (toolFrame === undefined || tcpFrame === undefined) {
    throw new Error('Imported Robot Tool and TCP Frames are unavailable.')
  }
  const initialJointValues = Object.fromEntries(joints.map((joint) => [joint.id, joint.home]))
  const robot = Object.freeze({
    id: robotId,
    name,
    definitionId,
    visible: true,
    baseParentFrameId: baseParentFrame.id,
    localBasePose: Object.freeze({
      positionM: Object.freeze([active.robots.length * 1.5, 0, 0]) as Vector3V4,
      quaternion: Object.freeze([0, 0, 0, 1]) as QuaternionV4,
    }),
    initialJointValues: Object.freeze(initialJointValues),
    jointSource: 'simulation' as const,
    selectedToolFrameId: toolFrame.id,
    selectedTcpFrameId: tcpFrame.id,
    numericStatus: Object.freeze({
      value: 0,
      sourceOwnership: 'simulation' as const,
      overlay: Object.freeze({ visible: true, frameId: tcpFrame.id }),
    }),
    intentionalMountEntityId: null,
  })

  const assetReferences = [...active.assetReferences]
  const existingAssets = new Map(assetReferences.map((asset) => [asset.id, asset]))
  for (const source of sources) {
    const next = importedAssetReferenceV4(source)
    const existing = existingAssets.get(next.id)
    if (existing !== undefined) {
      if (existing.sha256 !== next.sha256 || existing.byteLength !== next.byteLength) {
        throw new Error(`Project Asset ${next.id} conflicts with imported STEP content.`)
      }
      continue
    }
    assetReferences.push(next)
    existingAssets.set(next.id, next)
  }

  return Object.freeze({
    project: {
      ...active,
      assetReferences,
      robotDefinitions: [...active.robotDefinitions, definition],
      robots: [...active.robots, robot],
      jobs: [...active.jobs, Object.freeze({
        id: jobId,
        name: `${name} Job`,
        robotId,
        steps: Object.freeze([]),
      })],
    },
    definition,
    robotId,
    jobId,
  })
}

async function restoreImportedGeometryV4(
  assets: RobotStepAssetRepositoryV4,
  parser: RobotStepImportParserV4,
  definition: RobotDefinitionV4,
): Promise<PreparedRobotDefinitionGeometryV4 | null> {
  const records = new Map<string, RobotStepAssetRecordV4>()
  for (const id of definition.assetReferenceIds) {
    const record = await assets.read(id)
    if (record === null) return null
    records.set(id, record)
  }
  const imported = new Map<string, ImportedThreeAsset>()
  try {
    for (const id of definition.assetReferenceIds) {
      const record = records.get(id)!
      const convention = definition.sourceConventions[id]
      if (convention === undefined) throw new Error(`Robot source convention is missing for ${id}.`)
      const result = await parser.import(record.bytes)
      const definedOccurrences = definition.links.flatMap((link, linkOrdinal) => (
        link.geometryOccurrences
          .filter((occurrence) => occurrence.assetReferenceId === id)
          .map((occurrence) => ({ occurrence, linkOrdinal }))
      ))
      if (definedOccurrences.length === 0) {
        throw new Error(`Robot source ${id} has no Geometry occurrence.`)
      }
      const splitAssembly = definedOccurrences.some(({ occurrence }) => (
        occurrence.occurrenceKey.startsWith('assembly-link-')
      ))
      const parsedOccurrences = parsedOccurrencesV4(
        result,
        record.sha256,
        definedOccurrences[0]!.linkOrdinal,
        splitAssembly,
      )
      const expectedKeys = new Set(definedOccurrences.map(({ occurrence }) => occurrence.occurrenceKey))
      for (const parsed of parsedOccurrences) {
        if (!expectedKeys.has(parsed.occurrenceKey)) {
          parsed.asset.dispose()
          continue
        }
        imported.set(parsed.occurrenceKey, parsed.asset)
      }
      if ([...expectedKeys].some((key) => !imported.has(key))) {
        throw new Error(`Robot source ${id} could not restore its Assembly Link mapping.`)
      }
    }
    return prepareImportedGeometryV4(definition, imported)
  } catch (error) {
    for (const asset of imported.values()) asset.dispose()
    throw error
  }
}

export function createRobotImportGeometryResolverV4(dependencies: {
  readonly assets: RobotStepAssetRepositoryV4
  readonly parser: RobotStepImportParserV4
}): RobotImportGeometryResolverV4 {
  const staged = new Map<string, PreparedRobotDefinitionGeometryV4>()
  return Object.freeze({
    stage(definitionId: string, geometry: PreparedRobotDefinitionGeometryV4) {
      if (staged.has(definitionId)) throw new Error(`Robot Geometry ${definitionId} is already staged.`)
      staged.set(definitionId, geometry)
    },
    discard(definitionId: string) {
      const geometry = staged.get(definitionId)
      if (geometry === undefined) return false
      staged.delete(definitionId)
      geometry.dispose()
      return true
    },
    async resolve(_project: WorkcellProjectV4, definition: RobotDefinitionV4) {
      const prepared = staged.get(definition.id)
      if (prepared !== undefined) {
        staged.delete(definition.id)
        return prepared
      }
      return restoreImportedGeometryV4(dependencies.assets, dependencies.parser, definition)
    },
  })
}

function abortErrorV4(): DOMException {
  return new DOMException('Robot STEP import was cancelled.', 'AbortError')
}

export function createRobotImportControllerV4(
  dependencies: RobotImportControllerDependenciesV4,
): RobotImportControllerV4 {
  let activeAbort: AbortController | null = null
  let committing = false

  return Object.freeze({
    async importRobot(files: readonly File[], draft: RobotImportDraftV4) {
      if (activeAbort !== null) throw new Error('A Robot STEP import is already running.')
      const mapped = mapRobotStepFilesV4(files)
      const abort = new AbortController()
      activeAbort = abort
      const importedAssets = new Map<string, ImportedThreeAsset>()
      const parsed: ParsedRobotStepSourceV4[] = []
      const createdAssetIds: string[] = []
      let definitionId: string | null = null
      let robotId: string | null = null
      try {
        for (const { file, linkOrdinal } of mapped) {
          if (abort.signal.aborted) throw abortErrorV4()
          const bytes = await file.arrayBuffer()
          if (bytes.byteLength !== file.size) throw new Error(`${file.name} changed while it was being read.`)
          const sha256 = await dependencies.hash.sha256(bytes, abort.signal)
          if (parsed.some((source) => source.sha256 === sha256)) {
            throw new Error('Robot STEP sources must contain unique file content.')
          }
          if (abort.signal.aborted) throw abortErrorV4()
          const result = await dependencies.parser.import(bytes)
          if (abort.signal.aborted) throw abortErrorV4()
          statisticsV4(result)
          const occurrences = parsedOccurrencesV4(
            result,
            sha256,
            linkOrdinal,
            mapped.length === 1,
          )
          const occurrenceTriangles = occurrences.reduce((total, occurrence) => (
            total + occurrence.statistics.triangles
          ), 0)
          const totalTriangles = parsed.reduce((total, source) => (
            total + source.occurrences.reduce((sourceTotal, occurrence) => (
              sourceTotal + occurrence.statistics.triangles
            ), 0)
          ), 0) + occurrenceTriangles
          if (totalTriangles > MAX_ROBOT_DEFINITION_TRIANGLES_V4) {
            occurrences.forEach(({ asset }) => asset.dispose())
            throw new Error('Robot STEP Geometry exceeds the 600,000 triangle limit.')
          }
          const detectedUnit = detectStepUnit(bytes)
          const linearUnit = detectedUnit === 'unknown' ? 'millimeter' : detectedUnit
          const sourceToMeters = postImportScaleForUnit(linearUnit)
          const assetId = `robot-step-${sha256}`
          occurrences.forEach((occurrence) => {
            importedAssets.set(occurrence.occurrenceKey, occurrence.asset)
          })
          parsed.push(Object.freeze({
            assetId,
            sourceFileName: file.name,
            sha256,
            bytes,
            convention: Object.freeze({
              linearUnit,
              sourceToMeters,
              orientation: Object.freeze({ mode: 'up-axis', upAxis: draft.sourceUpAxis }),
            }),
            occurrences,
          }))
        }

        const active = dependencies.mutations.readPublished()?.project
        if (active === undefined) throw new Error('No active Project is published.')
        const importedProject = buildImportedRobotProjectV4(
          active,
          parsed,
          draft,
          dependencies.createId(),
        )
        definitionId = importedProject.definition.id
        robotId = importedProject.robotId
        for (const source of parsed) {
          const state = await dependencies.assets.write({
            id: source.assetId,
            sha256: source.sha256,
            sourceFileName: source.sourceFileName,
            bytes: source.bytes,
          })
          if (state === 'created') createdAssetIds.push(source.assetId)
        }
        const prepared = prepareImportedGeometryV4(importedProject.definition, importedAssets)
        importedAssets.clear()
        dependencies.geometry.stage(importedProject.definition.id, prepared)
        committing = true
        await dependencies.mutations.replaceFromActive({
          description: `Import Robot STEP: ${draft.name.trim()}`,
          mutate: () => importedProject.project,
        })
        dependencies.interaction.getState().selectJob(
          importedProject.robotId,
          importedProject.jobId,
        )
        return importedProject.robotId
      } catch (error) {
        for (const asset of importedAssets.values()) asset.dispose()
        const published = robotId !== null
          && dependencies.mutations.readPublished()?.project.robots.some(({ id }) => id === robotId)
        if (!published) {
          if (definitionId !== null) dependencies.geometry.discard(definitionId)
          await Promise.allSettled(createdAssetIds.map((id) => dependencies.assets.delete(id)))
        }
        throw error
      } finally {
        committing = false
        if (activeAbort === abort) activeAbort = null
      }
    },
    cancel() {
      if (activeAbort === null || committing) return false
      activeAbort.abort()
      dependencies.parser.cancel()
      return true
    },
  })
}
