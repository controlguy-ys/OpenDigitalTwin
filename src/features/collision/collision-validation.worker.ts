/// <reference lib="webworker" />

import {
  computeSerialRobotPoseV4,
} from '../../core/robot-runtime/serial-kinematics'
import {
  validateGeometryCollisionEntity,
  type GeometryCollisionEntity,
} from '../../domain/collision/collision'
import {
  queryGeometryCollisionsWithTelemetry,
  queryGeometryCollisionsV4,
  type MountContactState,
} from '../../domain/collision/query-collision'
import type { JointAnglesDeg } from '../../domain/robot/joint-frame'
import {
  computeRobotWorldMatrices,
  multiplyMatrixElements,
  serializableTransformToMatrixElements,
} from '../../domain/robot/kinematics'
import {
  MAX_COLLISION_VALIDATION_FINDINGS,
  collisionPolicyFromWireV4,
  validateCollisionValidationRequest,
  validateCollisionValidationRequestV4,
  type CollisionValidationProgress,
  type CollisionValidationRequest,
  type CollisionValidationRequestV4,
  type CollisionValidationResult,
  type CollisionValidationResultV4,
  type CollisionValidationWorkerCommand,
  type CollisionValidationWorkerEvent,
} from './collision-validation-protocol'
import { sampleJointSequence } from './validate-pose-sequence'
import {
  robotLinkCollisionProxiesV4,
  visibleCollisionEntitiesV4,
  type CollisionGeometryProxyV4,
} from './scene-entity-adapter'

const PROGRESS_INTERVAL_SAMPLES = 250

export interface CollisionValidationRunControls {
  readonly isCancelled?: () => boolean
  readonly onProgress?: (progress: CollisionValidationProgress) => void
  readonly yieldControl?: () => Promise<void>
}

function defaultYieldControl(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function dynamicEntities(
  request: CollisionValidationRequest,
  anglesDeg: JointAnglesDeg,
): readonly GeometryCollisionEntity[] {
  const matrices = computeRobotWorldMatrices(
    request.robot.definition,
    request.robot.geometryTransforms,
    request.robot.toolFrames,
    anglesDeg,
    request.robot.rootPose,
  )
  const entities: GeometryCollisionEntity[] = request.robot.linkEntities
    .filter((link) => link.collisionActive)
    .map((link) =>
      validateGeometryCollisionEntity({
        id: link.id,
        name: link.name,
        category: 'robot-link',
        boxes: link.boxes,
        worldMatrix: matrices.linkGeometry[link.linkId],
      }),
    )
  if (request.robot.toolEntity !== null) {
    entities.push(
      validateGeometryCollisionEntity({
        id: request.robot.toolEntity.id,
        name: request.robot.toolEntity.name,
        category: 'tool',
        boxes: request.robot.toolEntity.boxes,
        // The rendered gripper is a direct TCP child.
        worldMatrix: matrices.tcp,
      }),
    )
  }
  if (request.heldObject !== null) {
    entities.push(
      validateGeometryCollisionEntity({
        id: request.heldObject.id,
        name: request.heldObject.name,
        category: 'held-object',
        boxes: request.heldObject.boxes,
        worldMatrix: multiplyMatrixElements(
          matrices.tcp,
          serializableTransformToMatrixElements(
            request.heldObject.tcpLocalTransform,
            'Held Object TCP-local transform',
          ),
        ),
      }),
    )
  }
  return Object.freeze(entities)
}

export async function runCollisionValidation(
  candidate: CollisionValidationRequest,
  controls: CollisionValidationRunControls = {},
): Promise<CollisionValidationResult | null> {
  const request = validateCollisionValidationRequest(candidate)
  const sampled = sampleJointSequence(request.sequence, request.mode)
  const { samples } = sampled
  const findings = [] as CollisionValidationResult['findings'][number][]
  let mountContact: MountContactState | null = null
  let findingsTruncated = false
  const isCancelled = controls.isCancelled ?? (() => false)
  const yieldControl = controls.yieldControl ?? defaultYieldControl

  for (const sample of samples) {
    if (isCancelled()) return null
    const entities = [
      ...dynamicEntities(request, sample.anglesDeg),
      ...request.staticEntities,
    ]
    const sampleResult = queryGeometryCollisionsWithTelemetry(
      entities,
      request.policy,
      {
        mountContactPairKey: request.mountContactPairKey,
        metadata: { sampleIndex: sample.sampleIndex, timeMs: sample.timeMs },
      },
    )
    if (
      sampleResult.mountContact !== null &&
      (mountContact === null ||
        sampleResult.mountContact.state === 'contact' ||
        (sampleResult.mountContact.state === 'near' && mountContact.state === 'clear'))
    ) {
      mountContact = sampleResult.mountContact
    }
    for (const finding of sampleResult.findings) {
      if (findings.length < MAX_COLLISION_VALIDATION_FINDINGS) {
        findings.push(finding)
      } else {
        findingsTruncated = true
      }
    }

    const processedSamples = sample.sampleIndex + 1
    if (processedSamples % PROGRESS_INTERVAL_SAMPLES === 0) {
      controls.onProgress?.({
        requestId: request.requestId,
        revision: request.revision,
        processedSamples,
        totalSamples: samples.length,
      })
      await yieldControl()
      if (isCancelled()) return null
    }
  }

  if (samples.length % PROGRESS_INTERVAL_SAMPLES !== 0) {
    controls.onProgress?.({
      requestId: request.requestId,
      revision: request.revision,
      processedSamples: samples.length,
      totalSamples: samples.length,
    })
  }
  return Object.freeze({
    requestId: request.requestId,
    revision: request.revision,
    mode: request.mode,
    sampleCount: samples.length,
    durationMs: sampled.totalDurationMs,
    findings: Object.freeze(findings),
    mountContact,
    truncated: sampled.truncated || findingsTruncated,
  })
}

export async function runCollisionValidationV4(
  candidate: CollisionValidationRequestV4,
  controls: CollisionValidationRunControls = {},
): Promise<CollisionValidationResultV4 | null> {
  const request = validateCollisionValidationRequestV4(candidate)
  const definitionsById = new Map(
    request.definitions.map((definition) => [definition.id, definition]),
  )
  const placementsById = new Map(
    request.robotPlacements.map((placement) => [placement.robotId, placement]),
  )
  const policy = collisionPolicyFromWireV4(request.policy)
  const staticProxies = request.staticProxies
  const findings: CollisionValidationResultV4['findings'][number][] = []
  let findingsTruncated = false
  const isCancelled = controls.isCancelled ?? (() => false)
  const yieldControl = controls.yieldControl ?? (() => Promise.resolve())

  for (const sample of request.sequence) {
    if (isCancelled()) return null
    const dynamicProxies: CollisionGeometryProxyV4[] = []
    for (const state of sample.robots) {
      const definition = definitionsById.get(state.definitionId)!
      const placement = placementsById.get(state.robotId)!
      const pose = computeSerialRobotPoseV4(
        definition,
        state.jointValues,
        placement.worldBasePose,
      )
      dynamicProxies.push(...robotLinkCollisionProxiesV4({
        robotId: state.robotId,
        definition,
        linkWorldPoses: pose.linkWorldPoses,
        effectiveVisible: placement.effectiveVisible,
      }))
    }
    const entities = visibleCollisionEntitiesV4([
      ...dynamicProxies,
      ...staticProxies,
    ])
    const sampleFindings = queryGeometryCollisionsV4(
      entities,
      policy,
      { sampleIndex: sample.sampleIndex, timeMs: sample.timeMs },
    )
    for (const finding of sampleFindings) {
      if (findings.length < MAX_COLLISION_VALIDATION_FINDINGS) {
        findings.push(finding)
      } else {
        findingsTruncated = true
      }
    }

    const processedSamples = sample.sampleIndex + 1
    if (processedSamples % PROGRESS_INTERVAL_SAMPLES === 0) {
      controls.onProgress?.({
        requestId: request.requestId,
        revision: request.revision,
        processedSamples,
        totalSamples: request.sequence.length,
      })
      await yieldControl()
      if (isCancelled()) return null
    }
  }

  if (request.sequence.length % PROGRESS_INTERVAL_SAMPLES !== 0) {
    controls.onProgress?.({
      requestId: request.requestId,
      revision: request.revision,
      processedSamples: request.sequence.length,
      totalSamples: request.sequence.length,
    })
  }
  return Object.freeze({
    requestId: request.requestId,
    revision: request.revision,
    mode: request.mode,
    sampleCount: request.sequence.length,
    durationMs: request.sequence.at(-1)?.timeMs ?? 0,
    findings: Object.freeze(findings),
    truncated: findingsTruncated,
  })
}

export function createCollisionValidationWorkerHandler(
  postEvent: (event: CollisionValidationWorkerEvent) => void,
): (command: CollisionValidationWorkerCommand) => Promise<void> {
  const cancelledRequestIds = new Set<string>()
  return async (command) => {
    if (command.type === 'cancel') {
      if (command.requestId.trim().length > 0) {
        cancelledRequestIds.add(command.requestId)
      }
      return
    }
    const requestId = command.request?.requestId || 'invalid-request'
    const revision = command.request?.revision || 'invalid-revision'
    try {
      const request = validateCollisionValidationRequest(command.request)
      cancelledRequestIds.delete(request.requestId)
      const result = await runCollisionValidation(request, {
        isCancelled: () => cancelledRequestIds.has(request.requestId),
        onProgress: (progress) => postEvent({ type: 'progress', progress }),
      })
      if (result === null) {
        postEvent({
          type: 'cancelled',
          requestId: request.requestId,
          revision: request.revision,
        })
      } else {
        postEvent({ type: 'result', result })
      }
    } catch (error) {
      postEvent({
        type: 'error',
        requestId,
        revision,
        message: error instanceof Error
          ? error.message
          : 'Collision validation failed.',
      })
    } finally {
      cancelledRequestIds.delete(requestId)
    }
  }
}

if (
  typeof WorkerGlobalScope !== 'undefined' &&
  globalThis instanceof WorkerGlobalScope
) {
  const workerScope = globalThis as unknown as DedicatedWorkerGlobalScope
  const handleCommand = createCollisionValidationWorkerHandler((event) =>
    workerScope.postMessage(event),
  )
  workerScope.onmessage = (
    event: MessageEvent<CollisionValidationWorkerCommand>,
  ) => {
    void handleCommand(event.data)
  }
}
