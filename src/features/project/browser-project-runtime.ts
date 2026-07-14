import { DEFAULT_COLLISION_POLICY } from '../../domain/collision/collision'
import type {
  ObjectAssetRecordV2,
  ObjectInstanceRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import {
  WORKCELL_PROJECT_SCHEMA_VERSION_V3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import { createPortableId } from '../../lib/id/create-portable-id'
import {
  createProjectHashService,
  type ProjectSourceDigest,
} from '../../lib/hash/sha256'
import { useCollisionStore } from '../collision/collision-store'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { stepImportClient } from '../import/StepImportClient'
import {
  ImportedGeometryRepository,
  importedGeometryRepository,
} from '../import/imported-geometry-repository'
import type { ImportedThreeAsset } from '../import/occt-to-three'
import { useRobotStore } from '../joints/robot-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import { loadDefaultRobotGeometry } from '../robot/default-robot-geometry'
import {
  createDatasheetRobotConfiguration,
  useRobotConfigurationStore,
} from '../robot/robot-configuration-store'
import { robotGeometryRepository } from '../robot/robot-geometry-repository'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { restoreRobotGeometryRecords } from '../robot/robot-step-import'
import type {
  PreparedProjectRuntimeBundleV1,
  ProjectRuntimeV3,
} from './project-publication-coordinator'

interface BrowserProjectRuntimeResources {
  readonly robotAssets: ReadonlyMap<
    WorkcellProjectSnapshotV3['robot']['links'][number]['linkId'],
    ImportedThreeAsset
  >
  readonly objectAssets: ReadonlyMap<string, ImportedThreeAsset>
  readonly objectRepository: ImportedGeometryRepository
  readonly robotLinks: readonly RobotLinkGeometryRecordV2[]
  readonly objectRecords: readonly ObjectAssetRecordV2[]
  readonly objectInstances: readonly ObjectInstanceRecordV1[]
}

export type BrowserProjectRuntimeBundleV1 = PreparedProjectRuntimeBundleV1<
  BrowserProjectRuntimeResources
>

export interface BrowserProjectRuntime
  extends ProjectRuntimeV3<BrowserProjectRuntimeResources> {
  createNew(): Promise<WorkcellProjectSnapshotV3>
  activeRevisionId(): string | null
}

export interface BrowserProjectRuntimeOptions {
  readonly loadRobotGeometry?: (() => Promise<readonly RobotLinkGeometryRecordV2[]>) | undefined
  readonly prepareRobotAssets?: (
    links: readonly RobotLinkGeometryRecordV2[],
  ) => Promise<ReadonlyMap<RobotLinkGeometryRecordV2['linkId'], ImportedThreeAsset>>
  readonly sourceDigest?: Pick<ProjectSourceDigest, 'digestSource'> | undefined
  readonly idFactory?: (() => string) | undefined
}

const DEFAULT_OPC_UA = {
  endpointUrl: 'opc.tcp://127.0.0.1:4840',
  samplingIntervalMs: 100,
  joints: (['J1', 'J2', 'J3', 'J4', 'J5', 'J6'] as const).map((id) => ({
    id,
    nodeId: `ns=2;s=Robot.${id}`,
    scale: 1,
    offset: 0,
  })),
  numericStatusBindings: [],
  equipmentTransforms: [],
}

const identityTransform = () => ({
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [1, 1, 1],
})

function mutableTransform(transform: {
  readonly position: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
  readonly scale: readonly [number, number, number]
}) {
  return {
    position: [...transform.position] as [number, number, number],
    quaternion: [...transform.quaternion] as [number, number, number, number],
    scale: [...transform.scale] as [number, number, number],
  }
}

function mutableCollisionBoxes(
  boxes: WorkcellProjectSnapshotV3['robot']['links'][number]['collisionBoxes'],
) {
  return boxes.map((box) => ({
    id: box.id,
    center: [...box.center] as [number, number, number],
    halfExtents: [...box.halfExtents] as [number, number, number],
    quaternion: [...box.quaternion] as [number, number, number, number],
  }))
}

function activeJob(snapshot: WorkcellProjectSnapshotV3) {
  return snapshot.simulation.jobs.find(({ id }) => id === snapshot.simulation.activeJobId)
}

function legacyRobotLinks(snapshot: WorkcellProjectSnapshotV3): RobotLinkGeometryRecordV2[] {
  const sources = new Map(snapshot.robot.sources.map((source) => [source.id, source]))
  return snapshot.robot.links.map((link) => {
    const source = sources.get(link.sourceRefs[0]!.sourceAssetId)
    if (source === undefined) throw new Error(`Robot Link ${link.linkId} has no source.`)
    const firstCollision = link.collisionBoxes[0]!
    return {
      linkId: link.linkId,
      sourceFileName: source.sourceFileName,
      sourceBytes: source.sourceBytes,
      localTransform: mutableTransform(link.operatorAdjustment),
      visible: link.visible,
      collisionCenter: [...firstCollision.center],
      collisionHalfExtents: [...firstCollision.halfExtents],
      collisionBoxes: mutableCollisionBoxes(link.collisionBoxes),
      statistics: { ...link.statistics },
    }
  })
}

function legacyObjects(snapshot: WorkcellProjectSnapshotV3): {
  readonly assets: ObjectAssetRecordV2[]
  readonly instances: ObjectInstanceRecordV1[]
} {
  const assets = snapshot.objectAssets
    .filter((asset) => asset.sourceKind === 'step')
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      sourceFileName: asset.sourceFileName,
      sourceBytes: asset.sourceBytes,
      importScale: asset.importScale,
      originMode: asset.originMode,
      colliderCenter: [...asset.colliderCenter],
      collisionHalfExtents: [...asset.collisionHalfExtents],
      collisionBoxes: mutableCollisionBoxes(asset.collisionBoxes),
      statistics: { ...asset.statistics },
    } satisfies ObjectAssetRecordV2))
  const assetIds = new Set(assets.map(({ id }) => id))
  const transforms = new Map(snapshot.externalEntities.map((state) => [state.entityId, state]))
  const instances = snapshot.objectInstances
    .filter(({ assetId }) => assetIds.has(assetId))
    .map((instance) => ({
      id: instance.id,
      assetId: instance.assetId,
      name: instance.name,
      transform: mutableTransform(
        transforms.get(`object:${instance.id}`)?.manualTransform ?? identityTransform(),
      ),
      numericStatus: instance.manualNumericStatus,
      statusSource: instance.statusSource,
      statusOverlayVisible: instance.statusOverlayVisible,
      visible: instance.visible,
    }))
  return { assets, instances }
}

export function createBrowserProjectRuntime(
  options: BrowserProjectRuntimeOptions = {},
): BrowserProjectRuntime {
  const loadRobotGeometry = options.loadRobotGeometry ?? loadDefaultRobotGeometry
  const prepareRobotAssets = options.prepareRobotAssets ?? (
    (links) => restoreRobotGeometryRecords(links, stepImportClient)
  )
  const digest = options.sourceDigest ?? {
    digestSource: createProjectHashService({ subtle: crypto.subtle }).sha256,
  }
  const idFactory = options.idFactory ?? (() => createPortableId())
  let active: BrowserProjectRuntimeBundleV1 | null = null
  const resourceOwnership = new WeakMap<object, 'prepared' | 'published' | 'released'>()

  const runtime: BrowserProjectRuntime = {
    async createNew() {
      const now = new Date().toISOString()
      const configuration = createDatasheetRobotConfiguration()
      const sourceLinks = await loadRobotGeometry()
      const sources: WorkcellProjectSnapshotV3['robot']['sources'][number][] = []
      const knownSources = new Set<string>()
      const sourceIds: string[] = []
      for (const link of sourceLinks) {
        const sha256 = await digest.digestSource(link.sourceBytes)
        sourceIds.push(sha256)
        if (knownSources.has(sha256)) continue
        knownSources.add(sha256)
        sources.push({
          id: sha256,
          sha256,
          sourceFileName: link.sourceFileName,
          sourceBytes: link.sourceBytes,
          detectedUnit: 'meter',
          selectedSourceUnit: 'meter',
          unitDecision: 'detected',
          sourceToMeters: 1,
          parserVersion: 'occt-import-js@0.0.23',
          statistics: { ...link.statistics },
        })
      }
      const snapshot: WorkcellProjectSnapshotV3 = {
        manifest: {
          format: 'WebDigitalTwinProject',
          schemaVersion: WORKCELL_PROJECT_SCHEMA_VERSION_V3,
          projectId: idFactory(),
          name: 'Untitled Workcell',
          createdAt: now,
          updatedAt: now,
        },
        robot: {
          name: configuration.name,
          basePosition: [...configuration.basePosition],
          baseRotationDeg: [...configuration.baseRotationDeg],
          sources,
          links: sourceLinks.map((link, index) => ({
            linkId: link.linkId,
            sourceRefs: [{
              sourceAssetId: sourceIds[index]!,
              nodePath: [-1, index],
              nodeName: `legacy-whole-source:${link.linkId}`,
              meshIndices: [0],
            }],
            coordinateMode: 'link-local',
            zeroPoseLocalization: identityTransform(),
            operatorAdjustment: mutableTransform(link.localTransform),
            visible: link.visible,
            collisionBoxes: mutableCollisionBoxes(link.collisionBoxes),
            statistics: { ...link.statistics },
          })),
          mechanics: {
            joints: configuration.joints.map((joint) => ({
              id: joint.id,
              parentLink: joint.parentLink,
              childLink: joint.childLink,
              originM: [...joint.origin],
              axis: [...joint.axis],
              minDeg: joint.minDeg,
              maxDeg: joint.maxDeg,
              homeDeg: Math.min(joint.maxDeg, Math.max(joint.minDeg, 0)),
              zeroOffsetDeg: 0,
              direction: 1 as const,
              maxVelocityDegPerSec: joint.maxVelocityDegPerSec,
            })) as unknown as WorkcellProjectSnapshotV3['robot']['mechanics']['joints'],
            flange: identityTransform(),
            tool0: identityTransform(),
          },
          mechanicsProvenance: {
            kind: 'datasheet',
            configurationId: 'ABB-CRB-15000',
            configurationRevision: '1',
          },
        },
        frames: {
          mcp: {
            ...mutableTransform(useCoordinateFrameStore.getState().frames.mcp),
            scale: [1, 1, 1],
          },
          tcp: {
            ...mutableTransform(useCoordinateFrameStore.getState().frames.tcp),
            scale: [1, 1, 1],
          },
        },
        simulation: { activeJobId: null, jobs: [] },
        objectAssets: [],
        objectInstances: [],
        builtInEquipment: [],
        externalEntities: [],
        opcUa: DEFAULT_OPC_UA,
        collisionPolicy: {
          enabled: useCollisionStore.getState().policy.enabled ?? DEFAULT_COLLISION_POLICY.enabled,
          warningDistanceM: useCollisionStore.getState().policy.warningDistanceM ??
            DEFAULT_COLLISION_POLICY.warningDistanceM,
          ignoredPairKeys: [...useCollisionStore.getState().policy.ignoredPairKeys],
          enabledRobotSelfPairs: [...useCollisionStore.getState().policy.enabledRobotSelfPairs],
        },
      }
      return snapshot
    },

    async prepare(snapshot) {
      const robotLinks = legacyRobotLinks(snapshot)
      const objects = legacyObjects(snapshot)
      const objectRepository = new ImportedGeometryRepository(stepImportClient)
      let robotAssets: ReadonlyMap<RobotLinkGeometryRecordV2['linkId'], ImportedThreeAsset> | null = null
      try {
        robotAssets = await prepareRobotAssets(robotLinks)
        await objectRepository.restoreObjectAssets(objects.assets)
        const objectAssets = new Map<string, ImportedThreeAsset>()
        for (const asset of objects.assets) {
          const geometry = objectRepository.get(asset.id)
          if (geometry === undefined) throw new Error(`Unable to stage Object Asset ${asset.name}.`)
          objectAssets.set(asset.id, geometry)
        }
        const resources = Object.freeze({
          robotAssets,
          objectAssets,
          objectRepository,
          robotLinks,
          objectRecords: objects.assets,
          objectInstances: objects.instances,
        })
        resourceOwnership.set(resources, 'prepared')
        return resources
      } catch (error) {
        if (robotAssets !== null) {
          for (const asset of robotAssets.values()) asset.dispose()
        }
        objectRepository.dispose()
        throw error
      }
    },

    publish(bundle) {
      const resources = bundle.resources
      if (resourceOwnership.get(resources) !== 'prepared') {
        throw new Error('PROJECT_RUNTIME_BUNDLE_INVALID: Runtime bundle is not prepared.')
      }
      if (active !== null) resourceOwnership.set(active.resources, 'released')
      useRobotGeometryStore.setState({ links: resources.robotLinks })
      useObjectAssetStore.setState({
        assets: resources.objectRecords,
        instances: resources.objectInstances,
      })
      useRobotConfigurationStore.getState().setConfiguration({
        name: bundle.snapshot.robot.name,
        basePosition: [...bundle.snapshot.robot.basePosition],
        baseRotationDeg: [...bundle.snapshot.robot.baseRotationDeg],
        joints: bundle.snapshot.robot.mechanics.joints.map((joint) => ({
          id: joint.id,
          parentLink: joint.parentLink,
          childLink: joint.childLink,
          origin: [...joint.originM],
          axis: [...joint.axis],
          minDeg: joint.minDeg,
          maxDeg: joint.maxDeg,
          maxVelocityDegPerSec: joint.maxVelocityDegPerSec,
        })),
      })
      useRobotStore.getState().replaceKeyframes(
        (activeJob(bundle.snapshot)?.poses ?? []).map((pose) => ({
          ...pose,
          anglesDeg: [...pose.anglesDeg],
        })),
      )
      useCoordinateFrameStore.getState().replaceFrames({
        mcp: mutableTransform(bundle.snapshot.frames.mcp),
        tcp: mutableTransform(bundle.snapshot.frames.tcp),
      })
      useCollisionStore.getState().replaceCollisionState({
        policy: bundle.snapshot.collisionPolicy,
        currentFindings: [],
        diagnostics: [],
      }, null)
      useCollisionStore.getState().setValidationReport(null)
      robotGeometryRepository.replace(resources.robotAssets)
      importedGeometryRepository.replaceAll(resources.objectAssets)
      resourceOwnership.set(resources, 'published')
      active = bundle
    },

    dispose(bundle) {
      const ownership = resourceOwnership.get(bundle.resources)
      if (ownership === undefined || ownership === 'released') return
      if (ownership === 'prepared') {
        for (const asset of bundle.resources.robotAssets.values()) asset.dispose()
        bundle.resources.objectRepository.dispose()
      }
      resourceOwnership.set(bundle.resources, 'released')
    },

    activeRevisionId() {
      return active?.revisionId ?? null
    },
  }
  return Object.freeze(runtime)
}

export const browserProjectRuntime = createBrowserProjectRuntime()
