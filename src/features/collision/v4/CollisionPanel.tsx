import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  decodeRuntimeIdentitySegmentV4,
  parseRobotLinkCollisionIdV4,
  type CollisionEntityIdV4,
} from '../../../core/robot-runtime/collision-identity.js'
import type {
  CollisionPolicyV4,
} from '../../../domain/collision/collision.js'
import {
  queryGeometryCollisionsWithTelemetryV4,
  type CollisionQueryResultV4,
} from '../../../domain/collision/query-collision.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import {
  visibleCollisionEntitiesV4,
  type CollisionGeometryProxyV4,
} from './scene-entity-adapter-v4.js'

export type CollisionQueryV4 = (
  policy: CollisionPolicyV4,
  proxies: readonly CollisionGeometryProxyV4[],
) => CollisionQueryResultV4 | Promise<CollisionQueryResultV4>

export interface CollisionPanelPropsV4 {
  readonly projectRevisionId: string
  readonly policy: CollisionPolicyV4
  readonly proxies: readonly CollisionGeometryProxyV4[]
  readonly onFocus: (selection: SceneSelectionTargetV4) => void
  readonly jobRunning?: boolean
  readonly query?: CollisionQueryV4
}

function defaultQueryV4(
  policy: CollisionPolicyV4,
  proxies: readonly CollisionGeometryProxyV4[],
): CollisionQueryResultV4 {
  return queryGeometryCollisionsWithTelemetryV4(
    visibleCollisionEntitiesV4(proxies),
    policy,
  )
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

function errorMessageV4(error: unknown): string {
  return error instanceof Error ? error.message : 'Collision validation failed.'
}

export function CollisionPanelV4({
  projectRevisionId,
  policy,
  proxies,
  onFocus,
  jobRunning = false,
  query = defaultQueryV4,
}: CollisionPanelPropsV4): ReactNode {
  const [result, setResult] = useState<CollisionQueryResultV4 | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestTokenRef = useRef<symbol | null>(null)
  const revisionRef = useRef(projectRevisionId)
  revisionRef.current = projectRevisionId

  useEffect(() => {
    requestTokenRef.current = null
    setPending(false)
    setError(null)
    setResult(null)
  }, [policy, projectRevisionId, proxies])

  const validate = (): void => {
    if (pending || jobRunning || proxies.length === 0 || requestTokenRef.current !== null) return
    const token = Symbol(projectRevisionId)
    const revisionAtRequest = projectRevisionId
    requestTokenRef.current = token
    setPending(true)
    setError(null)
    void Promise.resolve(query(policy, proxies))
      .then((next) => {
        if (
          requestTokenRef.current === token
          && revisionRef.current === revisionAtRequest
        ) {
          setResult(next)
        }
      })
      .catch((caught: unknown) => {
        if (
          requestTokenRef.current === token
          && revisionRef.current === revisionAtRequest
        ) {
          setError(errorMessageV4(caught))
        }
      })
      .finally(() => {
        if (requestTokenRef.current !== token) return
        requestTokenRef.current = null
        setPending(false)
      })
  }

  const collisions = result?.findings.filter(({ kind }) => kind === 'collision').length ?? 0
  const nearMisses = result?.findings.filter(({ kind }) => kind === 'near-miss').length ?? 0

  return (
    <section aria-label="Geometry Collision" className="collision-panel-v4">
      <header>
        <h2>Geometry Collision</h2>
        <button
          disabled={pending || jobRunning || proxies.length === 0}
          onClick={validate}
          type="button"
        >
          {pending ? 'Validating...' : 'Validate Collision'}
        </button>
      </header>
      {proxies.length === 0
        ? <p role="status">No collision Geometry is registered.</p>
        : null}
      {jobRunning ? <p role="status">Stop the running Job before validation.</p> : null}
      {error === null ? null : <p role="alert">{error}</p>}
      {result === null ? null : (
        <>
          <div className="collision-summary-v4" aria-label="Collision totals">
            <span>Collisions {collisions}</span>
            <span>Near-misses {nearMisses}</span>
            <span>Entities {result.telemetry.entityCount}</span>
            <span>OBB tests {result.telemetry.narrowPhaseTestCount}</span>
          </div>
          {result.findings.length === 0 ? <p>No findings.</p> : (
            <ol className="collision-findings-v4">
              {result.findings.map((finding) => {
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
