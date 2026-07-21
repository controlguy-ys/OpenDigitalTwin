import { Group, Mesh, type BufferGeometry } from 'three'
import type { StoreApi } from 'zustand/vanilla'

import {
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
import type { OcctSuccessResult } from '../../../lib/cad/occt-types.js'
import type { ProjectHashService } from '../../../lib/hash/sha256.js'
import type { InteractionStoreStateV4 } from '../../interaction/v4/interaction-store.js'
import { detectStepUnit, postImportScaleForUnit } from '../../import/detect-step-unit.js'
import {
  assertOcctGeometryBudget,
  createThreeGroupFromOcct,
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

const MAX_ROBOT_STEP_FILE_BYTES_V4 = 25 * 1024 * 1024
const MAX_ROBOT_LINK_TRIANGLES_V4 = 150_000
const MAX_ROBOT_LINK_MESHES_V4 = 64
const MAX_ROBOT_LINK_MATERIALS_V4 = 32

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
  readonly statistics: GeometryStatisticsV4
  readonly collisionBox: CollisionBoxV4
  readonly asset: ImportedThreeAsset
  readonly linkOrdinal: number
}

interface ImportedRobotProjectV4 {
  readonly project: WorkcellProjectV4
  readonly definition: RobotDefinitionV4
  readonly robotId: RobotIdV4
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
    if (file.size > MAX_ROBOT_STEP_FILE_BYTES_V4) {
      throw new Error(`${file.name} exceeds the 25 MiB per-file limit.`)
    }
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
    maxTriangles: MAX_ROBOT_LINK_TRIANGLES_V4,
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
  assetsById: ReadonlyMap<string, ImportedThreeAsset>,
): PreparedRobotDefinitionGeometryV4 {
  const consumed = new Set<string>()
  const linkTemplates = new Map<string, Group>()
  try {
    for (const link of definition.links) {
      const linkRoot = new Group()
      linkRoot.name = `imported:${definition.id}:${link.id}`
      for (const occurrence of link.geometryOccurrences) {
        const asset = assetsById.get(occurrence.assetReferenceId)
        if (asset === undefined || consumed.has(occurrence.assetReferenceId)) {
          throw new Error(`Imported Geometry is unavailable for ${occurrence.assetReferenceId}.`)
        }
        consumed.add(occurrence.assetReferenceId)
        applyOccurrencePoseV4(asset.group, occurrence.linkLocalPose)
        linkRoot.add(asset.group)
      }
      linkTemplates.set(link.id, linkRoot)
    }
    const assets = [...assetsById.values()]
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
    for (const asset of assetsById.values()) asset.dispose()
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
  const linkIds = new Map(template.links.map((link, index) => (
    [link.id, `${definitionId}-link-${String(index).padStart(2, '0')}`] as const
  )))
  const frameIds = new Map(template.frames.map((frame, index) => (
    [frame.id, `${definitionId}-frame-${String(index).padStart(2, '0')}`] as const
  )))
  const sourceByOrdinal = new Map(sources.map((source) => [source.linkOrdinal, source]))
  const links = template.links.map((link, index) => {
    const source = sourceByOrdinal.get(index)
    return Object.freeze({
      id: linkIds.get(link.id)!,
      name: `LINK${String(index).padStart(2, '0')}`,
      geometryOccurrences: source === undefined ? Object.freeze([]) : Object.freeze([Object.freeze({
        occurrenceKey: `whole-source:${source.sha256}`,
        assetReferenceId: source.assetId,
        linkLocalPose: Object.freeze({
          positionM: Object.freeze([0, 0, 0]) as Vector3V4,
          quaternion: Object.freeze(orientationQuaternionV4(draft.sourceUpAxis)),
        }),
        statistics: source.statistics,
        collisionBoxes: Object.freeze([source.collisionBox]),
      })]),
    })
  })
  const joints = template.joints.map((joint, index) => Object.freeze({
    ...joint,
    id: `${definitionId}-joint-${index + 1}`,
    parentLinkId: linkIds.get(joint.parentLinkId)!,
    childLinkId: linkIds.get(joint.childLinkId)!,
    origin: Object.freeze({
      positionM: Object.freeze([...joint.origin.positionM]) as Vector3V4,
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
    },
    definition,
    robotId,
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
      const asset = createThreeGroupFromOcct(result, {
        originMode: 'source',
        postImportScale: convention.sourceToMeters,
      }, {
        maxVertices: Number.MAX_SAFE_INTEGER,
        maxTriangles: MAX_ROBOT_LINK_TRIANGLES_V4,
      })
      imported.set(id, asset)
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
          const statistics = statisticsV4(result)
          const totalTriangles = parsed.reduce((total, source) => total + source.statistics.triangles, 0)
            + statistics.triangles
          if (totalTriangles > MAX_ROBOT_DEFINITION_TRIANGLES_V4) {
            throw new Error('Robot STEP Geometry exceeds the 600,000 triangle limit.')
          }
          const detectedUnit = detectStepUnit(bytes)
          const linearUnit = detectedUnit === 'unknown' ? 'millimeter' : detectedUnit
          const sourceToMeters = postImportScaleForUnit(linearUnit)
          const asset = createThreeGroupFromOcct(result, {
            originMode: 'source',
            postImportScale: sourceToMeters,
          }, {
            maxVertices: Number.MAX_SAFE_INTEGER,
            maxTriangles: MAX_ROBOT_LINK_TRIANGLES_V4,
          })
          const assetId = `robot-step-${sha256}`
          importedAssets.set(assetId, asset)
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
            statistics,
            collisionBox: collisionBoxV4(asset, linkOrdinal),
            asset,
            linkOrdinal,
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
        dependencies.interaction.getState().activateRobot(importedProject.robotId)
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
