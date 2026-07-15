import { DEFAULT_COLLISION_POLICY } from '../../domain/collision/collision'
import type {
  ObjectInstanceRecordV1,
  RobotLinkGeometryRecordV2,
} from '../../domain/project/project'
import {
  WORKCELL_PROJECT_SCHEMA_VERSION_V3,
  type WorkcellProjectSnapshotV3,
} from '../../domain/project/project-v3'
import { createPortableId } from '../../lib/id/create-portable-id'
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
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
  AppliedProjectRuntimePublicationV1,
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
  readonly objectRecords: WorkcellProjectSnapshotV3['objectAssets']
  readonly objectInstances: readonly ObjectInstanceRecordV1[]
}

export type BrowserProjectRuntimeBundleV1 = PreparedProjectRuntimeBundleV1<
  BrowserProjectRuntimeResources
>

export interface BrowserProjectRuntime
  extends ProjectRuntimeV3<BrowserProjectRuntimeResources> {
  createNew(): Promise<WorkcellProjectSnapshotV3>
  activeRevisionId(): string | null
  readCleanupDiagnostics(): readonly BrowserRuntimeCleanupDiagnosticV1[]
  retryCleanup(token: string): boolean
}

export interface BrowserRuntimeCleanupDiagnosticV1 {
  readonly token: string
  readonly revisionId: string
  readonly message: string
  readonly attempts: number
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

function projectRobotReadModels(snapshot: WorkcellProjectSnapshotV3): RobotLinkGeometryRecordV2[] {
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

function projectObjectReadModels(snapshot: WorkcellProjectSnapshotV3): {
  readonly assets: WorkcellProjectSnapshotV3['objectAssets']
  readonly instances: Array<ObjectInstanceRecordV1 & { readonly graspable: boolean }>
} {
  const assets = snapshot.objectAssets
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
      graspable: instance.graspable,
      statusSource: instance.statusSource,
      statusOverlayVisible: instance.statusOverlayVisible,
      visible: instance.visible,
    }))
  return { assets, instances }
}

function primitiveObjectAsset(
  asset: Extract<WorkcellProjectSnapshotV3['objectAssets'][number], {
    readonly sourceKind: 'box' | 'cylinder'
  }>,
): ImportedThreeAsset {
  const geometry = asset.sourceKind === 'box'
    ? new BoxGeometry(...asset.dimensionsM)
    : new CylinderGeometry(
        asset.radiusM,
        asset.radiusM,
        asset.heightM,
        asset.radialSegments,
      ).rotateX(Math.PI / 2)
  const material = new MeshStandardMaterial({ color: asset.color })
  const group = new Group()
  group.add(new Mesh(geometry, material))
  const center = [...asset.colliderCenter] as [number, number, number]
  const half = [...asset.collisionHalfExtents] as [number, number, number]
  return {
    group,
    colliderCenter: center,
    bounds: {
      min: center.map((value, index) => value - half[index]!) as [number, number, number],
      max: center.map((value, index) => value + half[index]!) as [number, number, number],
      size: half.map((value) => value * 2) as [number, number, number],
      center,
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      group.clear()
    },
  }
}

type NotificationListener = (...args: unknown[]) => void
interface NotificationSource {
  subscribe(listener: NotificationListener): () => void
}
interface NotificationState {
  depth: number
  readonly pending: Map<NotificationListener, readonly unknown[]>
}

const notificationStates = new WeakMap<object, NotificationState>()

function installNotificationTransaction(source: NotificationSource): NotificationState {
  const existing = notificationStates.get(source as object)
  if (existing !== undefined) return existing
  const state: NotificationState = { depth: 0, pending: new Map() }
  const originalSubscribe = source.subscribe.bind(source)
  source.subscribe = (listener) => originalSubscribe((...args) => {
    if (state.depth === 0) listener(...args)
    else state.pending.set(listener, args)
  })
  notificationStates.set(source as object, state)
  return state
}

function beginReadModelPublication(sources: readonly NotificationSource[]) {
  const states = sources.map(installNotificationTransaction)
  for (const state of states) state.depth += 1
  let closed = false
  const close = (publish: boolean): void => {
    if (closed) return
    closed = true
    const callbacks: Array<readonly [NotificationListener, readonly unknown[]]> = []
    for (const state of states) {
      state.depth -= 1
      if (state.depth !== 0) continue
      if (publish) callbacks.push(...state.pending.entries())
      state.pending.clear()
    }
    for (const [listener, args] of callbacks) {
      try { listener(...args) } catch { /* Published state remains authoritative. */ }
    }
  }
  return Object.freeze({
    commit: () => close(true),
    rollback: () => close(false),
  })
}

function disposePreparedResources(resources: BrowserProjectRuntimeResources): void {
  for (const asset of resources.robotAssets.values()) asset.dispose()
  for (const [id, asset] of resources.objectAssets) {
    if (resources.objectRepository.get(id) !== asset) asset.dispose()
  }
  resources.objectRepository.dispose()
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
  const cleanupRetries = new Map<string, {
    diagnostic: BrowserRuntimeCleanupDiagnosticV1
    cleanup: () => void
  }>()
  let cleanupSequence = 0
  const queueCleanup = (
    revisionId: string,
    label: string,
    cleanup: () => void,
  ): void => {
    try {
      cleanup()
    } catch (error) {
      const token = `runtime-cleanup-${++cleanupSequence}`
      if (cleanupRetries.size >= 8) {
        cleanupRetries.delete(cleanupRetries.keys().next().value!)
      }
      cleanupRetries.set(token, {
        cleanup,
        diagnostic: Object.freeze({
          token,
          revisionId,
          message: `${label}: ${error instanceof Error ? error.message : 'Cleanup failed.'}`,
          attempts: 1,
        }),
      })
    }
  }
  const notificationSources = [
    useRobotGeometryStore,
    useObjectAssetStore,
    useRobotConfigurationStore,
    useRobotStore,
    useCoordinateFrameStore,
    useCollisionStore,
    robotGeometryRepository,
    importedGeometryRepository,
  ].map((source) => source as unknown as NotificationSource)
  notificationSources.forEach(installNotificationTransaction)

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
              nodeName: `whole-source:${link.linkId}`,
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
        frames: { mcp: identityTransform(), tcp: identityTransform() },
        simulation: { activeJobId: null, jobs: [] },
        objectAssets: [],
        objectInstances: [],
        builtInEquipment: [],
        externalEntities: [],
        opcUa: DEFAULT_OPC_UA,
        collisionPolicy: {
          enabled: DEFAULT_COLLISION_POLICY.enabled,
          warningDistanceM: DEFAULT_COLLISION_POLICY.warningDistanceM,
          ignoredPairKeys: [...DEFAULT_COLLISION_POLICY.ignoredPairKeys],
          enabledRobotSelfPairs: [...DEFAULT_COLLISION_POLICY.enabledRobotSelfPairs],
        },
      }
      return snapshot
    },

    async prepare(snapshot) {
      const robotLinks = projectRobotReadModels(snapshot)
      const objects = projectObjectReadModels(snapshot)
      const objectRepository = new ImportedGeometryRepository(stepImportClient)
      let robotAssets: ReadonlyMap<RobotLinkGeometryRecordV2['linkId'], ImportedThreeAsset> | null = null
      const primitiveAssets = new Map<string, ImportedThreeAsset>()
      try {
        robotAssets = await prepareRobotAssets(robotLinks)
        await objectRepository.restoreObjectAssets(
          objects.assets.filter((asset) => asset.sourceKind === 'step'),
        )
        const objectAssets = new Map<string, ImportedThreeAsset>()
        for (const asset of objects.assets) {
          const geometry = asset.sourceKind === 'step'
            ? objectRepository.get(asset.id)
            : primitiveObjectAsset(asset)
          if (geometry === undefined) {
            throw new Error(`Unable to stage Object Asset ${asset.name}.`)
          }
          if (asset.sourceKind !== 'step') primitiveAssets.set(asset.id, geometry)
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
        for (const asset of primitiveAssets.values()) asset.dispose()
        objectRepository.dispose()
        throw error
      }
    },

    apply(bundle): AppliedProjectRuntimePublicationV1 {
      const resources = bundle.resources
      if (resourceOwnership.get(resources) !== 'prepared') {
        throw new Error('PROJECT_RUNTIME_BUNDLE_INVALID: Runtime bundle is not prepared.')
      }
      const previousStores = {
        robotGeometry: useRobotGeometryStore.getState(),
        objects: useObjectAssetStore.getState(),
        configuration: useRobotConfigurationStore.getState(),
        robot: useRobotStore.getState(),
        frames: useCoordinateFrameStore.getState(),
        collision: useCollisionStore.getState(),
      }
      const publication = beginReadModelPublication(notificationSources)
      let previousRobotAssets: ReadonlyMap<RobotLinkGeometryRecordV2['linkId'], ImportedThreeAsset> | undefined
      let previousObjectAssets: ReadonlyMap<string, ImportedThreeAsset> | undefined
      try {
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
        previousRobotAssets = robotGeometryRepository.exchange(resources.robotAssets)
        previousObjectAssets = importedGeometryRepository.exchangeAll(resources.objectAssets)
      } catch (error) {
        useRobotGeometryStore.setState(previousStores.robotGeometry, true)
        useObjectAssetStore.setState(previousStores.objects, true)
        useRobotConfigurationStore.setState(previousStores.configuration, true)
        useRobotStore.setState(previousStores.robot, true)
        useCoordinateFrameStore.setState(previousStores.frames, true)
        useCollisionStore.setState(previousStores.collision, true)
        if (previousRobotAssets !== undefined) {
          robotGeometryRepository.exchange(previousRobotAssets)
        }
        if (previousObjectAssets !== undefined) {
          importedGeometryRepository.exchangeAll(previousObjectAssets)
        }
        publication.rollback()
        disposePreparedResources(resources)
        resourceOwnership.set(resources, 'released')
        throw error
      }
      const previous = active
      let closed: 'open' | 'committed' | 'rolled-back' | 'cleaned' = 'open'
      return Object.freeze({
        commit() {
          if (closed !== 'open') return
          closed = 'committed'
          if (previous !== null) resourceOwnership.set(previous.resources, 'released')
          resourceOwnership.set(resources, 'published')
          active = bundle
          publication.commit()
        },
        rollback() {
          if (closed !== 'open') return
          closed = 'rolled-back'
          useRobotGeometryStore.setState(previousStores.robotGeometry, true)
          useObjectAssetStore.setState(previousStores.objects, true)
          useRobotConfigurationStore.setState(previousStores.configuration, true)
          useRobotStore.setState(previousStores.robot, true)
          useCoordinateFrameStore.setState(previousStores.frames, true)
          useCollisionStore.setState(previousStores.collision, true)
          robotGeometryRepository.exchange(previousRobotAssets!)
          importedGeometryRepository.exchangeAll(previousObjectAssets!)
          publication.rollback()
          disposePreparedResources(resources)
          resourceOwnership.set(resources, 'released')
        },
        cleanup() {
          if (closed !== 'committed' || previous === null) return
          closed = 'cleaned'
          for (const [linkId, asset] of previousRobotAssets!) {
            if (resources.robotAssets.get(linkId) === asset) continue
            queueCleanup(previous.revisionId, `Robot geometry ${linkId}`, () => asset.dispose())
          }
          for (const [assetId, asset] of previousObjectAssets!) {
            if (resources.objectAssets.get(assetId) === asset) continue
            queueCleanup(previous.revisionId, `Object geometry ${assetId}`, () => asset.dispose())
          }
        },
      })
    },

    dispose(bundle) {
      const ownership = resourceOwnership.get(bundle.resources)
      if (ownership === undefined || ownership === 'released') return
      if (ownership === 'prepared') {
        disposePreparedResources(bundle.resources)
      }
      resourceOwnership.set(bundle.resources, 'released')
    },

    activeRevisionId() {
      return active?.revisionId ?? null
    },

    readCleanupDiagnostics() {
      return Object.freeze([...cleanupRetries.values()].map(({ diagnostic }) => diagnostic))
    },

    retryCleanup(token) {
      const pending = cleanupRetries.get(token)
      if (pending === undefined) return false
      try {
        pending.cleanup()
        cleanupRetries.delete(token)
        return true
      } catch (error) {
        pending.diagnostic = Object.freeze({
          ...pending.diagnostic,
          message: pending.diagnostic.message.split(': ')[0] + ': ' +
            (error instanceof Error ? error.message : 'Cleanup failed.'),
          attempts: pending.diagnostic.attempts + 1,
        })
        return false
      }
    },
  }
  return Object.freeze(runtime)
}

export const browserProjectRuntime = createBrowserProjectRuntime()
