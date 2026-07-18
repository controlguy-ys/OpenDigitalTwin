import { useSyncExternalStore, type ReactNode } from 'react'
import {
  decodeRuntimeIdentitySegmentV4,
  parseRobotLinkCollisionIdV4,
  type CollisionEntityIdV4,
} from '../../../core/robot-runtime/collision-identity.js'
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import {
  type CollisionValidationControllerV4,
} from './collision-validation-controller.js'
import type { AppCommandBindingsV4 } from '../../commands/v4/app-command-runtime.js'
import { useAppCommandV4 } from '../../commands/v4/use-app-command.js'

export interface CollisionPanelPropsV4 {
  /** App owns input replacement and disposal for this controller. */
  readonly controller: CollisionValidationControllerV4
  readonly commandBindings: AppCommandBindingsV4
  readonly onFocus: (selection: SceneSelectionTargetV4) => void
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
  controller,
  commandBindings,
  onFocus,
}: CollisionPanelPropsV4): ReactNode {
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState)
  const validate = useAppCommandV4(commandBindings, 'collision.validate')
  const commandVisible = validate.command?.visible === true
  // The shared Command runtime is the sole owner of interactive command state.
  // Controller state describes collision data/availability only; otherwise the
  // panel could display an error one microtask before the menu sees the same
  // rejected command.
  const commandPending = validate.pending
  const commandDisabled = !commandVisible
    || validate.command?.enabled !== true
    || commandPending
  const commandError = validate.error

  const collisions = state.result?.findings.filter(({ kind }) => kind === 'collision').length ?? 0
  const nearMisses = state.result?.findings.filter(({ kind }) => kind === 'near-miss').length ?? 0

  return (
    <section aria-label="Geometry Collision" className="collision-panel-v4">
      <header>
        <h2>Geometry Collision</h2>
        <button
          disabled={commandDisabled}
          onClick={() => { if (!commandDisabled) void validate.invoke() }}
          type="button"
        >
          {commandPending ? 'Validating...' : 'Validate Collision'}
        </button>
      </header>
      {!state.canValidate && !state.pending
        ? <p role="status">Collision validation is unavailable for the current Scene.</p>
        : null}
      {commandError === null ? null : <p role="alert">{commandError}</p>}
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
