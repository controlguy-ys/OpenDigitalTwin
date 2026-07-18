import { useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react'
import {
  decodeRuntimeIdentitySegmentV4,
  parseRobotLinkCollisionIdV4,
  type CollisionEntityIdV4,
} from '../../../core/robot-runtime/collision-identity.js'
import type { CollisionPolicyV4 } from '../../../domain/collision/collision.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter-v4.js'
import {
  createCollisionValidationControllerV4,
  queryVisibleGeometryCollisionsV4,
  type CollisionQueryV4,
} from './collision-validation-controller.js'

export type { CollisionQueryV4 } from './collision-validation-controller.js'

export interface CollisionPanelPropsV4 {
  readonly projectRevisionId: string
  readonly policy: CollisionPolicyV4
  readonly proxies: readonly CollisionGeometryProxyV4[]
  readonly onFocus: (selection: SceneSelectionTargetV4) => void
  readonly jobRunning?: boolean
  readonly query?: CollisionQueryV4
}

function selectionForCollisionEntityV4(
  entityId: CollisionEntityIdV4,
): SceneSelectionTargetV4 | null {
  const link = parseRobotLinkCollisionIdV4(entityId)
  if (link !== null) {
    return {
      kind: 'robot-link',
      robotId: link.robotId,
      linkId: link.linkId,
    }
  }
  if (entityId.startsWith('spatial-entity:')) {
    const entityIdSegment = entityId.slice('spatial-entity:'.length)
    const decoded = decodeRuntimeIdentitySegmentV4(entityIdSegment)
    return decoded === null ? null : { kind: 'spatial-entity', entityId: decoded }
  }
  if (entityId.startsWith('tool:')) {
    const segments = entityId.slice('tool:'.length).split(':')
    if (segments.length !== 2) return null
    const robotId = decodeRuntimeIdentitySegmentV4(segments[0]!)
    const frameId = decodeRuntimeIdentitySegmentV4(segments[1]!)
    return robotId === null || frameId === null
      ? null
      : { kind: 'robot-frame', robotId, frameId }
  }
  return null
}

export function CollisionPanelV4({
  projectRevisionId,
  policy,
  proxies,
  onFocus,
  jobRunning = false,
  query = queryVisibleGeometryCollisionsV4,
}: CollisionPanelPropsV4): ReactNode {
  const controllerRef = useRef<ReturnType<typeof createCollisionValidationControllerV4> | null>(null)
  if (controllerRef.current === null) {
    controllerRef.current = createCollisionValidationControllerV4({
      initialInput: { projectRevisionId, policy, proxies, jobRunning, query },
    })
  }
  const controller = controllerRef.current
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const cleanupGenerationRef = useRef(0)

  useEffect(() => {
    cleanupGenerationRef.current += 1
    controller.replaceInput({ projectRevisionId, policy, proxies, jobRunning, query })
  }, [controller, jobRunning, policy, projectRevisionId, proxies, query])
  useEffect(() => () => {
    const cleanupGeneration = ++cleanupGenerationRef.current
    queueMicrotask(() => {
      if (cleanupGeneration === cleanupGenerationRef.current) controller.dispose()
    })
  }, [controller])

  const collisions = state.result?.findings.filter(({ kind }) => kind === 'collision').length ?? 0
  const nearMisses = state.result?.findings.filter(({ kind }) => kind === 'near-miss').length ?? 0

  return (
    <section aria-label="Geometry Collision" className="collision-panel-v4">
      <header>
        <h2>Geometry Collision</h2>
        <button
          disabled={!state.canValidate}
          onClick={() => { void controller.validate().catch(() => undefined) }}
          type="button"
        >
          {state.pending ? 'Validating...' : 'Validate Collision'}
        </button>
      </header>
      {proxies.length === 0
        ? <p role="status">No collision Geometry is registered.</p>
        : null}
      {jobRunning ? <p role="status">Stop the running Job before validation.</p> : null}
      {state.error === null ? null : <p role="alert">{state.error}</p>}
      {state.result === null ? null : (
        <>
          <div className="collision-summary-v4" aria-label="Collision totals">
            <span>Collisions {collisions}</span>
            <span>Near-misses {nearMisses}</span>
            <span>Entities {state.result.telemetry.entityCount}</span>
            <span>OBB tests {state.result.telemetry.narrowPhaseTestCount}</span>
          </div>
          {state.result.findings.length === 0 ? <p>No findings.</p> : (
            <ol className="collision-findings-v4">
              {state.result.findings.map((finding) => {
                const firstSelection = selectionForCollisionEntityV4(finding.firstEntityId)
                const secondSelection = selectionForCollisionEntityV4(finding.secondEntityId)
                return (
                  <li key={`${finding.pairKey}:${finding.firstBoxId}:${finding.secondBoxId}`}>
                    <span>
                      {finding.kind === 'collision' ? 'Collision' : 'Near-miss'}: {' '}
                      {finding.firstEntityId} / {finding.firstBoxId} ↔ {' '}
                      {finding.secondEntityId} / {finding.secondBoxId}
                    </span>
                    {firstSelection === null ? null : (
                      <button
                        aria-label={`Focus ${finding.firstEntityId}`}
                        onClick={() => onFocus(firstSelection)}
                        type="button"
                      >
                        Focus first
                      </button>
                    )}
                    {secondSelection === null ? null : (
                      <button
                        aria-label={`Focus ${finding.secondEntityId}`}
                        onClick={() => onFocus(secondSelection)}
                        type="button"
                      >
                        Focus second
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </>
      )}
    </section>
  )
}
