import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type { CollisionPolicy } from '../../domain/collision/collision'
import { deriveMountContactPairKey } from '../../domain/collision/mount-contact'
import type { RobotMountContactV1 } from '../../domain/project/scene-state-v1'
import type { MountContactState } from '../../domain/collision/query-collision'
import {
  composePose3D,
  pose3DToSerializableTransform,
  rpyToQuaternion,
  serializableTransformToPose3D,
  type Pose3D,
} from '../../domain/frames/pose3d'
import type { SerializableTransform } from '../../domain/equipment/equipment'
import type { RobotLinkId } from '../../domain/robot/crb15000'
import { useEquipmentStore } from '../equipment/equipment-store'
import { useCoordinateFrameStore } from '../frames/coordinate-frame-store'
import { useInteractionStore } from '../interaction/interaction-store'
import { ROBOT_LINK_COLLISION_BOUNDS } from '../interaction/robot-collision-bounds'
import { useRobotStore } from '../joints/robot-store'
import { useObjectAssetStore } from '../objects/object-asset-store'
import {
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from '../robot/robot-configuration-store'
import { useRobotGeometryStore } from '../robot/robot-geometry-store'
import { useProjectStore } from '../project/project-store-browser'
import {
  CollisionValidationCancelledError,
  CollisionValidationClient,
  type CollisionValidationOptions,
} from './collision-validation-client'
import type {
  CollisionValidationMode,
} from './validate-pose-sequence'
import type {
  CollisionValidationRequest,
  CollisionValidationResult,
} from './collision-validation-protocol'
import {
  getGeometryEntityRegistryRevision,
  geometryEntityRegistry,
  snapshotGeometryEntities,
  subscribeGeometryEntityRegistry,
} from './geometry-entity-registry'
import {
  encodeCollisionReportCsv,
  encodeCollisionReportJson,
} from './collision-report'
import {
  selectCollisionNavigationFindings,
  useCollisionStore,
} from './collision-store'

const LINK_IDS = Object.freeze([
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
] as const satisfies readonly RobotLinkId[])
const IDENTITY_TRANSFORM: SerializableTransform = Object.freeze({
  position: Object.freeze([0, 0, 0]) as unknown as [number, number, number],
  quaternion: Object.freeze([0, 0, 0, 1]) as unknown as [number, number, number, number],
  scale: Object.freeze([1, 1, 1]) as unknown as [number, number, number],
})
const collisionValidationClient = new CollisionValidationClient()
let nextValidationRequestId = 1

type CollisionValidationGeometryLink = Pick<
  ReturnType<typeof useRobotGeometryStore.getState>['links'][number],
  'linkId' | 'visible' | 'localTransform' | 'collisionBoxes'
>

export function buildCollisionValidationRobotGeometry(
  geometryLinks: readonly CollisionValidationGeometryLink[],
  activeEntityIds: ReadonlySet<string>,
  robotCollisionActive = true,
): Pick<
  CollisionValidationRequest['robot'],
  'geometryTransforms' | 'linkEntities'
> {
  const geometryByLink = new Map(
    geometryLinks.map((link) => [link.linkId, link]),
  )
  const geometryTransforms = {} as Record<RobotLinkId, SerializableTransform>
  const linkEntities = LINK_IDS.map((linkId) => {
    const geometry = geometryByLink.get(linkId)
    geometryTransforms[linkId] = geometry?.localTransform ?? IDENTITY_TRANSFORM
    const fallback = ROBOT_LINK_COLLISION_BOUNDS[linkId]
    return Object.freeze({
      linkId,
      id: `robot-link:${linkId}` as const,
      name: linkId,
      collisionActive:
        robotCollisionActive &&
        (geometry?.visible ?? true) &&
        activeEntityIds.has(`robot-link:${linkId}`),
      boxes: geometry?.collisionBoxes ?? [{
        id: 'default',
        center: fallback.center,
        halfExtents: fallback.halfExtents,
        quaternion: [0, 0, 0, 1] as const,
      }],
    })
  })
  return Object.freeze({
    geometryTransforms: Object.freeze(geometryTransforms),
    linkEntities: Object.freeze(linkEntities),
  })
}

export interface CollisionPanelValidationClient {
  validate(
    request: CollisionValidationRequest,
    options?: CollisionValidationOptions,
  ): Promise<CollisionValidationResult>
  cancel(): void
}

export interface CollisionPanelValidationRuntime {
  readonly revision: string
  readonly canValidate: boolean
  readonly client: CollisionPanelValidationClient
  createRequest(mode: CollisionValidationMode): CollisionValidationRequest
}

export interface CollisionPanelProps {
  readonly validationRuntime?: CollisionPanelValidationRuntime
  readonly focusRequest?: number
  readonly mountContactConfiguration?: RobotMountContactV1 | null
  readonly mountContact?: MountContactState | null
}

function rootPose(
  mcp: SerializableTransform,
  basePosition: readonly [number, number, number],
  baseRotationDeg: readonly [number, number, number],
): SerializableTransform {
  const base: Pose3D = {
    position: basePosition,
    quaternion: rpyToQuaternion([
      baseRotationDeg[0] * Math.PI / 180,
      baseRotationDeg[1] * Math.PI / 180,
      baseRotationDeg[2] * Math.PI / 180,
    ]),
  }
  return pose3DToSerializableTransform(
    composePose3D(serializableTransformToPose3D(mcp), base),
  )
}

function serializableRevision(
  policy: CollisionPolicy,
  registryRevision: number,
  mountContactConfiguration: RobotMountContactV1 | null,
  inputs: {
    readonly keyframes: ReturnType<typeof useRobotStore.getState>['keyframes']
    readonly configuration: ReturnType<typeof useRobotConfigurationStore.getState>['configuration']
    readonly geometryLinks: ReturnType<typeof useRobotGeometryStore.getState>['links']
    readonly frames: ReturnType<typeof useCoordinateFrameStore.getState>['frames']
    readonly equipment: ReturnType<typeof useEquipmentStore.getState>['records']
    readonly objectAssets: ReturnType<typeof useObjectAssetStore.getState>['assets']
    readonly objectInstances: ReturnType<typeof useObjectAssetStore.getState>['instances']
    readonly heldEntityId: ReturnType<typeof useInteractionStore.getState>['heldEntityId']
    readonly gripOffset: ReturnType<typeof useInteractionStore.getState>['gripOffset']
    readonly hiddenEntityIds: ReturnType<typeof useInteractionStore.getState>['hiddenEntityIds']
  },
): string {
  return JSON.stringify({
    policy,
    registryRevision,
    mountContactConfiguration,
    keyframes: inputs.keyframes,
    configuration: inputs.configuration,
    frames: inputs.frames,
    geometryLinks: inputs.geometryLinks.map((link) => ({
      linkId: link.linkId,
      localTransform: link.localTransform,
      visible: link.visible,
      collisionBoxes: link.collisionBoxes,
    })),
    equipment: inputs.equipment.map((record) => ({
      id: record.id,
      transform: record.transform,
      collisionCenter: record.collisionCenter,
      collisionHalfExtents: record.collisionHalfExtents,
    })),
    objectAssets: inputs.objectAssets.map((asset) => ({
      id: asset.id,
      collisionBoxes: asset.collisionBoxes,
    })),
    objectInstances: inputs.objectInstances.map((instance) => ({
      id: instance.id,
      assetId: instance.assetId,
      transform: instance.transform,
      visible: instance.visible,
    })),
    heldEntityId: inputs.heldEntityId,
    gripOffset: inputs.gripOffset,
    hiddenEntityIds: inputs.hiddenEntityIds,
  })
}

function useDefaultValidationRuntime(
  policy: CollisionPolicy,
  mountContactConfiguration: RobotMountContactV1 | null,
): CollisionPanelValidationRuntime {
  const keyframes = useRobotStore((state) => state.keyframes)
  const configuration = useRobotConfigurationStore((state) => state.configuration)
  const geometryLinks = useRobotGeometryStore((state) => state.links)
  const frames = useCoordinateFrameStore((state) => state.frames)
  const equipment = useEquipmentStore((state) => state.records)
  const objectAssets = useObjectAssetStore((state) => state.assets)
  const objectInstances = useObjectAssetStore((state) => state.instances)
  const heldEntityId = useInteractionStore((state) => state.heldEntityId)
  const gripOffset = useInteractionStore((state) => state.gripOffset)
  const hiddenEntityIds = useInteractionStore((state) => state.hiddenEntityIds)
  const registryRevision = useSyncExternalStore(
    subscribeGeometryEntityRegistry,
    getGeometryEntityRegistryRevision,
    getGeometryEntityRegistryRevision,
  )
  const revisionInputs = useMemo(
    () => ({
      keyframes,
      configuration,
      geometryLinks,
      frames,
      equipment,
      objectAssets,
      objectInstances,
      heldEntityId,
      gripOffset,
      hiddenEntityIds,
    }),
    [
      configuration,
      equipment,
      frames,
      geometryLinks,
      gripOffset,
      heldEntityId,
      hiddenEntityIds,
      keyframes,
      objectAssets,
      objectInstances,
    ],
  )
  const revision = useMemo(
    () => serializableRevision(
      policy,
      registryRevision,
      mountContactConfiguration,
      revisionInputs,
    ),
    [mountContactConfiguration, policy, registryRevision, revisionInputs],
  )
  const createRequest = useCallback(
    (mode: CollisionValidationMode): CollisionValidationRequest => {
      const definition = robotConfigurationToDefinition(configuration)
      const registrySnapshot = snapshotGeometryEntities()
      const activeEntityIds = new Set(
        registrySnapshot.entities.map((entity) => entity.id),
      )
      const robotCollisionActive = !hiddenEntityIds.includes('robot')
      const {
        geometryTransforms,
        linkEntities,
      } = buildCollisionValidationRobotGeometry(
        geometryLinks,
        activeEntityIds,
        robotCollisionActive,
      )
      const staticEntities = registrySnapshot.entities.filter(
        (entity) =>
          entity.id !== heldEntityId &&
          (entity.category === 'environment' ||
            entity.category === 'equipment' ||
            entity.category === 'object'),
      )
      const toolRegistration = geometryEntityRegistry.get('tool:default')
      const heldRegistration = heldEntityId === null
        ? undefined
        : geometryEntityRegistry.get(heldEntityId)
      const halfToolRotation = definition.toolRotationYRad / 2
      const mountContactPairKey = deriveMountContactPairKey(
        mountContactConfiguration,
        [
          ...linkEntities
            .filter(({ collisionActive }) => collisionActive)
            .map(({ id }) => ({ id, category: 'robot-link' as const })),
          ...staticEntities,
        ],
      )

      return {
        requestId: `collision-validation-${nextValidationRequestId++}`,
        revision,
        mode,
        sequence: keyframes,
        robot: {
          definition,
          rootPose: rootPose(
            frames.mcp,
            configuration.basePosition,
            configuration.baseRotationDeg,
          ),
          geometryTransforms,
          toolFrames: {
            flange: IDENTITY_TRANSFORM,
            tool: {
              position: [0, 0, 0],
              quaternion: [0, Math.sin(halfToolRotation), 0, Math.cos(halfToolRotation)],
              scale: [1, 1, 1],
            },
            tcp: frames.tcp,
          },
          linkEntities,
          toolEntity: !robotCollisionActive || toolRegistration === undefined
            ? null
            : {
                id: 'tool:default',
                name: toolRegistration.name,
                boxes: toolRegistration.boxes,
              },
        },
        heldObject:
          !robotCollisionActive ||
          heldEntityId === null ||
          gripOffset === null ||
          heldRegistration === undefined
            ? null
            : {
                id: heldEntityId,
                name: heldRegistration.name,
                boxes: heldRegistration.boxes,
                tcpLocalTransform: gripOffset,
              },
        staticEntities,
        mountContactPairKey,
        policy,
      }
    }, [
      configuration,
      frames,
      geometryLinks,
      gripOffset,
      heldEntityId,
      hiddenEntityIds,
      keyframes,
      mountContactConfiguration,
      policy,
      revision,
    ],
  )
  return useMemo(
    () => ({
      revision,
      canValidate: keyframes.length >= 2,
      client: collisionValidationClient,
      createRequest,
    }),
    [createRequest, keyframes.length, revision],
  )
}

function downloadText(fileName: string, type: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const anchor = document.createElement('a')
  anchor.download = fileName
  anchor.href = url
  anchor.click()
  URL.revokeObjectURL(url)
}

function clearanceText(separationM: number): string {
  return `${(separationM * 1_000).toFixed(3)} mm`
}

export function CollisionPanel({
  validationRuntime,
  focusRequest = 0,
  mountContactConfiguration,
  mountContact,
}: CollisionPanelProps = {}) {
  const projectMountContact = useProjectStore(
    (state) => state.activeSnapshot?.scene.robotMountContact ?? null,
  )
  const activeMountContactConfiguration = mountContactConfiguration === undefined
    ? projectMountContact
    : mountContactConfiguration
  const policy = useCollisionStore((state) => state.policy)
  const heldEntityId = useInteractionStore((state) => state.heldEntityId)
  const currentFindings = useCollisionStore((state) => state.currentFindings)
  const latestTelemetry = useCollisionStore((state) => state.latestTelemetry)
  const diagnostics = useCollisionStore((state) => state.diagnostics)
  const currentMountContact = useCollisionStore((state) => state.mountContact)
  const registryRevision = useSyncExternalStore(
    subscribeGeometryEntityRegistry,
    getGeometryEntityRegistryRevision,
    getGeometryEntityRegistryRevision,
  )
  const configuredMountPairKey = useMemo(
    () => deriveMountContactPairKey(
      activeMountContactConfiguration,
      snapshotGeometryEntities().entities,
    ),
    [activeMountContactConfiguration, registryRevision],
  )
  const navigationFindings = useCollisionStore(
    selectCollisionNavigationFindings,
  )
  const selectedFindingIndex = useCollisionStore(
    (state) => state.selectedFindingIndex,
  )
  const validationReport = useCollisionStore((state) => state.validationReport)
  const pausePlaybackOnCollision = useCollisionStore(
    (state) => state.pausePlaybackOnCollision,
  )
  const reportStale = useCollisionStore(
    (state) => state.validationReportStale,
  )
  const reportError = useCollisionStore(
    (state) => state.validationReportError,
  )
  const setCollisionEnabled = useCollisionStore(
    (state) => state.setCollisionEnabled,
  )
  const setWarningDistanceM = useCollisionStore(
    (state) => state.setWarningDistanceM,
  )
  const ignorePair = useCollisionStore((state) => state.ignorePair)
  const restorePair = useCollisionStore((state) => state.restorePair)
  const setSelectedFindingIndex = useCollisionStore(
    (state) => state.setSelectedFindingIndex,
  )
  const setPausePlaybackOnCollision = useCollisionStore(
    (state) => state.setPausePlaybackOnCollision,
  )
  const setValidationReport = useCollisionStore(
    (state) => state.setValidationReport,
  )
  const markValidationReportStale = useCollisionStore(
    (state) => state.markValidationReportStale,
  )
  const liveMountContact = mountContact === undefined
    ? currentMountContact
    : mountContact
  const displayedMountContact = validationReport === null
    ? liveMountContact
    : validationReport.mountContact
  const evaluatedMountContact =
    displayedMountContact?.pairKey === configuredMountPairKey
      ? displayedMountContact
      : null
  const userIgnoredPairKeys = policy.ignoredPairKeys.filter(
    (pairKey) => pairKey !== configuredMountPairKey,
  )
  const defaultValidationRuntime = useDefaultValidationRuntime(
    policy,
    activeMountContactConfiguration,
  )
  const activeValidationRuntime = validationRuntime ?? defaultValidationRuntime
  const runtimeRef = useRef(activeValidationRuntime)
  runtimeRef.current = activeValidationRuntime
  const previousRevisionRef = useRef(activeValidationRuntime.revision)
  const runTokenRef = useRef(0)
  const [validationRunning, setValidationRunning] = useState(false)
  const [validationProgress, setValidationProgress] = useState<{
    readonly processedSamples: number
    readonly totalSamples: number
  } | null>(null)
  const [validationError, setValidationError] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    if (focusRequest > 0) headingRef.current?.focus()
  }, [focusRequest])

  useEffect(() => {
    if (previousRevisionRef.current === activeValidationRuntime.revision) return
    previousRevisionRef.current = activeValidationRuntime.revision
    runTokenRef.current += 1
    activeValidationRuntime.client.cancel()
    setValidationRunning(false)
    setValidationProgress(null)
    if (useCollisionStore.getState().validationReport !== null) {
      markValidationReportStale()
    }
  }, [activeValidationRuntime.client, activeValidationRuntime.revision, markValidationReportStale])

  const startValidation = useCallback(
    (mode: CollisionValidationMode) => {
      if (validationRunning || !activeValidationRuntime.canValidate) return
      const token = ++runTokenRef.current
      setValidationRunning(true)
      setValidationProgress(null)
      setValidationError(null)
      let request: CollisionValidationRequest
      try {
        request = activeValidationRuntime.createRequest(mode)
      } catch (error) {
        setValidationRunning(false)
        setValidationError(
          error instanceof Error ? error.message : 'Unable to prepare validation.',
        )
        return
      }
      void activeValidationRuntime.client.validate(request, {
        getCurrentRevision: () => runtimeRef.current.revision,
        onProgress: (progress) => {
          if (runTokenRef.current !== token) return
          setValidationProgress({
            processedSamples: progress.processedSamples,
            totalSamples: progress.totalSamples,
          })
        },
      }).then((result) => {
        if (runTokenRef.current !== token) return
        setValidationReport({
          revision: result.revision,
          sampleCount: result.sampleCount,
          findings: result.findings,
          mountContact: result.mountContact,
          truncated: result.truncated,
        })
      }).catch((error: unknown) => {
        if (
          runTokenRef.current !== token ||
          error instanceof CollisionValidationCancelledError
        ) {
          return
        }
        const message = error instanceof Error
          ? error.message
          : 'Collision validation failed.'
        setValidationError(message)
        if (useCollisionStore.getState().validationReport !== null) {
          markValidationReportStale(message)
        }
      }).finally(() => {
        if (runTokenRef.current !== token) return
        setValidationRunning(false)
      })
    }, [
      activeValidationRuntime,
      markValidationReportStale,
      setValidationReport,
      validationRunning,
    ],
  )

  const cancelValidation = useCallback(() => {
    runTokenRef.current += 1
    activeValidationRuntime.client.cancel()
    setValidationRunning(false)
    setValidationProgress(null)
  }, [activeValidationRuntime.client])

  const counts = useMemo(
    () => ({
      collisions: currentFindings.filter(({ kind }) => kind === 'collision')
        .length,
      nearMisses: currentFindings.filter(({ kind }) => kind === 'near-miss')
        .length,
    }),
    [currentFindings],
  )
  const normalizedIndex =
    navigationFindings.length === 0
      ? null
      : Math.min(selectedFindingIndex ?? 0, navigationFindings.length - 1)
  const selectedFinding =
    normalizedIndex === null ? null : navigationFindings[normalizedIndex] ?? null

  return (
    <section aria-labelledby="collision-panel-heading" className="collision-panel">
      <header className="collision-panel-header">
        <h2 id="collision-panel-heading" ref={headingRef} tabIndex={-1}>
          Geometry Proxy Collision
        </h2>
        <div aria-label="Live collision counts" className="collision-counts">
          <span data-kind="collision">Collision {counts.collisions}</span>
          <span data-kind="near-miss">Near-miss {counts.nearMisses}</span>
        </div>
        <output aria-label="Mount contact status" role="status">
          Mount Contact: {configuredMountPairKey === null
            ? 'Incomplete'
            : evaluatedMountContact === null
              ? 'Configured unavailable'
              : `Configured ${evaluatedMountContact.state} (${validationReport === null ? 'Live' : 'Job'})`}
        </output>
        {latestTelemetry === null ? null : (
          <output
            aria-label="Scene collision telemetry"
            aria-live="off"
            role="status"
          >
            Entities {latestTelemetry.entityCount} Boxes {latestTelemetry.boxCount}{' '}
            Candidates {latestTelemetry.broadPhaseCandidateCount} OBB tests{' '}
            {latestTelemetry.narrowPhaseTestCount} Findings{' '}
            {latestTelemetry.findingCount}
          </output>
        )}
      </header>

      <div className="collision-policy-controls">
        <label>
          <input
            checked={policy.enabled}
            onChange={(event) => setCollisionEnabled(event.currentTarget.checked)}
            type="checkbox"
          />
          Enable geometry collision validation
        </label>
        <label>
          Warning distance (mm)
          <input
            aria-label="Warning distance (mm)"
            min={0}
            onChange={(event) =>
              setWarningDistanceM(Number(event.currentTarget.value) / 1_000)
            }
            step="1"
            type="number"
            value={policy.warningDistanceM * 1_000}
          />
        </label>
        <label>
          <input
            checked={pausePlaybackOnCollision}
            onChange={(event) =>
              setPausePlaybackOnCollision(event.currentTarget.checked)
            }
            type="checkbox"
          />
          Pause Simulation playback on collision
        </label>
      </div>

      <div className="collision-validation-controls">
        <output aria-label="Held collision entity" role="status">
          Held Object: {heldEntityId ?? 'None'}
        </output>
        {validationRunning ? (
          <button
            aria-label="Cancel Validation"
            onClick={cancelValidation}
            type="button"
          >
            Cancel Validation
          </button>
        ) : (
          <>
            <button
              disabled={!policy.enabled || !activeValidationRuntime.canValidate}
              onClick={() => startValidation('preview')}
              type="button"
            >
              Preview Sequence
            </button>
            <button
              disabled={!policy.enabled || !activeValidationRuntime.canValidate}
              onClick={() => startValidation('validate')}
              type="button"
            >
              Validate Sequence
            </button>
          </>
        )}
        {validationProgress === null ? null : (
          <output
            aria-label="Sequence validation progress"
            role="status"
          >
            {validationProgress.processedSamples} / {validationProgress.totalSamples}
          </output>
        )}
        {validationError === null ? null : (
          <p role="alert">{validationError}</p>
        )}
        {validationReport?.truncated === true ? (
          <p role="alert">
            Validation result is incomplete: a sample or finding resource cap
            was reached after {validationReport.sampleCount} samples.
          </p>
        ) : null}
      </div>

      <div className="collision-finding-navigation">
        <div className="collision-navigation-buttons">
          <button
            aria-label="First finding"
            disabled={normalizedIndex === null || normalizedIndex === 0}
            onClick={() => setSelectedFindingIndex(0)}
            type="button"
          >
            First
          </button>
          <button
            aria-label="Previous finding"
            disabled={normalizedIndex === null || normalizedIndex === 0}
            onClick={() => setSelectedFindingIndex((normalizedIndex ?? 0) - 1)}
            type="button"
          >
            Previous
          </button>
          <output aria-live="polite">
            {normalizedIndex === null
              ? 'No findings'
              : `Finding ${normalizedIndex + 1} of ${navigationFindings.length}`}
          </output>
          <button
            aria-label="Next finding"
            disabled={
              normalizedIndex === null ||
              normalizedIndex >= navigationFindings.length - 1
            }
            onClick={() => setSelectedFindingIndex((normalizedIndex ?? 0) + 1)}
            type="button"
          >
            Next
          </button>
        </div>

        {selectedFinding === null ? null : (
          <article
            aria-label={`Finding ${normalizedIndex! + 1}`}
            className="collision-finding"
            data-kind={selectedFinding.kind}
          >
            <strong>{selectedFinding.kind === 'collision' ? 'Collision' : 'Near-miss'}</strong>
            <code>{selectedFinding.pairKey}</code>
            <span>Approximate Clearance</span>
            <output>{clearanceText(selectedFinding.separationM)}</output>
            {selectedFinding.pairKey === configuredMountPairKey ? null : (
              <button
                aria-label={`Ignore ${selectedFinding.firstEntityId} and ${selectedFinding.secondEntityId}`}
                disabled={userIgnoredPairKeys.includes(selectedFinding.pairKey)}
                onClick={() => ignorePair(selectedFinding.pairKey)}
                type="button"
              >
                Ignore Pair
              </button>
            )}
          </article>
        )}
      </div>

      {userIgnoredPairKeys.length === 0 ? null : (
        <div className="collision-ignored-pairs">
          <strong>Ignored pairs</strong>
          <ul aria-label="Ignored collision pairs">
            {userIgnoredPairKeys.map((ignoredPair) => (
              <li key={ignoredPair}>
                <code>{ignoredPair}</code>
                <button
                  aria-label={`Restore ${ignoredPair}`}
                  onClick={() => restorePair(ignoredPair)}
                  type="button"
                >
                  Restore Pair
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {diagnostics.length === 0 && !reportStale ? null : (
        <div className="collision-diagnostics" role="status">
          {reportStale ? (
            <p>
              Validation report is stale.
              {reportError === null ? '' : ` ${reportError}`}
            </p>
          ) : null}
          {diagnostics.length === 0 ? null : (
            <ul aria-label="Collision diagnostics">
              {diagnostics.map((diagnostic, index) => (
                <li key={`${diagnostic.entityId}-${index}`}>
                  {diagnostic.entityId}: {diagnostic.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <footer className="collision-panel-footer">
        <div>
          <button
            aria-label="Download JSON report"
            onClick={() =>
              downloadText(
                'geometry-proxy-collision.json',
                'application/json',
                encodeCollisionReportJson(navigationFindings, {
                  sourceTruncated: validationReport?.truncated ?? false,
                  sampleCount: validationReport?.sampleCount ?? null,
                  mountContact: evaluatedMountContact,
                  ignoredPairKeys: userIgnoredPairKeys,
                }),
              )
            }
            type="button"
          >
            JSON
          </button>
          <button
            aria-label="Download CSV report"
            onClick={() =>
              downloadText(
                'geometry-proxy-collision.csv',
                'text/csv;charset=utf-8',
                encodeCollisionReportCsv(navigationFindings),
              )
            }
            type="button"
          >
            CSV
          </button>
        </div>
        <p>
          Proxy results are not physics, RobotWare, SafeMove, or safety-rated
          validation.
        </p>
      </footer>
    </section>
  )
}
