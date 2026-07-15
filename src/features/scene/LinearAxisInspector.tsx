import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import { sceneCommandService } from '../project/project-store-browser'
import {
  ManualLinearAxisSource,
  type LinearAxisSourceV1,
} from './linear-axis-source'
import type { SceneCommandService } from './scene-command-service'
import { useInteractionStore } from '../interaction/interaction-store'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'

export type LinearAxisCommands = Pick<
  SceneCommandService,
  | 'setLinearAxisPosition'
  | 'moveLinearAxisHome'
  | 'setLinearAxisCarriage'
  | 'attachRobotToLinearAxis'
  | 'detachRobotFromLinearAxis'
  | 'deleteLinearAxis'
>

export interface LinearAxisInspectorProps {
  readonly runtime?: SceneRuntimeProjectionV1
  readonly commands?: LinearAxisCommands
  readonly source?: LinearAxisSourceV1
  readonly disabled?: boolean
  readonly onDeleted?: () => void
}

function displayMillimetres(positionM: number): string {
  return String(Math.round(positionM * 1_000_000_000) / 1_000_000)
}

export function LinearAxisInspector({
  runtime: runtimeOverride,
  commands = sceneCommandService,
  source: sourceOverride,
  disabled = false,
  onDeleted,
}: LinearAxisInspectorProps) {
  const publishedRuntime = usePublishedSceneRuntime()
  const runtime = runtimeOverride ?? publishedRuntime
  const axisRuntime = runtime.linearAxis
  const axis = axisRuntime?.source.kind === 'linear-axis' ? axisRuntime.source : null
  const [positionMm, setPositionMm] = useState(() => displayMillimetres(
    axis?.currentPositionM ?? 0,
  ))
  const [carriageId, setCarriageId] = useState<SceneEntityIdV1 | ''>(
    axis?.carriageEntityId ?? '',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const heldEntityId = useInteractionStore((state) => state.heldEntityId)
  const manualSource = useMemo(() => sourceOverride === undefined
    ? new ManualLinearAxisSource({
      initialPositionM: axis?.currentPositionM ?? 0,
      homePositionM: axis?.homePositionM ?? 0,
      commitPositionM: commands.setLinearAxisPosition,
      commitHome: commands.moveLinearAxisHome,
    })
    : null, [axisRuntime?.entityId, commands, sourceOverride])
  useLayoutEffect(() => {
    if (manualSource === null) return
    manualSource.synchronizeCommittedState(
      axis?.currentPositionM ?? 0,
      axis?.homePositionM ?? 0,
    )
  }, [axis?.currentPositionM, axis?.homePositionM, manualSource])
  const source = sourceOverride ?? manualSource

  useEffect(() => {
    if (axis === null) return
    setPositionMm(displayMillimetres(axis.currentPositionM))
    setCarriageId(axis.carriageEntityId ?? '')
    setError(null)
  }, [axis?.carriageEntityId, axis?.currentPositionM])

  if (axis === null) {
    return <section className="linear-axis-inspector"><h2>Linear Axis</h2><p>No Linear Axis exists.</p></section>
  }
  if (source === null) {
    throw new Error('LINEAR_AXIS_MANUAL_SOURCE_MISSING: Manual source is unavailable.')
  }

  const minMm = axis.minPositionM * 1_000
  const maxMm = axis.maxPositionM * 1_000
  const run = async (command: () => Promise<void>): Promise<boolean> => {
    if (pending) return false
    setPending(true)
    setError(null)
    try {
      await command()
      return true
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Linear Axis command failed.')
      return false
    } finally {
      setPending(false)
    }
  }
  const applyPosition = () => {
    if (positionMm.trim().length === 0) {
      setError('Enter a finite position in millimetres.')
      return
    }
    const parsedMm = Number(positionMm)
    if (!Number.isFinite(parsedMm)) {
      setError('Enter a finite position in millimetres.')
      return
    }
    if (parsedMm < minMm || parsedMm > maxMm) {
      setError(`Allowed range: ${minMm} to ${maxMm} mm.`)
      return
    }
    void run(() => source.setPositionM(parsedMm / 1_000))
  }
  const carriageCandidates = [...runtime.groups, ...runtime.objects]
  const candidateContainsHeldEntity = (candidateId: SceneEntityIdV1): boolean => {
    if (heldEntityId === null) return false
    let entity = runtime.byId.get(heldEntityId)
    while (entity !== undefined) {
      if (entity.entityId === candidateId) return true
      if (entity.parentId === null) return false
      entity = runtime.byId.get(entity.parentId)
    }
    return false
  }
  const selectedCarriageUnavailable = carriageId !== '' && (() => {
    const candidate = runtime.byId.get(carriageId)
    return candidate === undefined ||
      (candidate.source.kind === 'object' && candidate.source.transformSource === 'opcua') ||
      candidateContainsHeldEntity(carriageId)
  })()

  return (
    <section className="linear-axis-inspector">
      <h2>Linear Axis</h2>
      <p>Direction: {axis.direction.toUpperCase()}</p>
      <fieldset disabled={disabled || pending}>
        <legend>Manual motion</legend>
        <label>
          <span>Axis position (mm)</span>
          <input
            aria-label="Axis position (mm)"
            max={maxMm}
            min={minMm}
            onChange={(event) => setPositionMm(event.currentTarget.value)}
            step="any"
            type="number"
            value={positionMm}
          />
        </label>
        <input
          aria-label="Axis position slider (mm)"
          max={maxMm}
          min={minMm}
          onChange={(event) => setPositionMm(event.currentTarget.value)}
          step="1"
          type="range"
          value={Math.min(maxMm, Math.max(minMm, Number(positionMm) || 0))}
        />
        <button onClick={applyPosition} type="button">Apply position</button>
        <button onClick={() => void run(() => source.home())} type="button">Move Home</button>
      </fieldset>
      <fieldset disabled={disabled || pending}>
        <legend>Carriage</legend>
        <label>
          <span>Carriage</span>
          <select
            aria-label="Carriage"
            onChange={(event) => setCarriageId(event.currentTarget.value as SceneEntityIdV1 | '')}
            value={carriageId}
          >
            <option value="">No carriage</option>
            {carriageCandidates.map((candidate) => {
              const opcUaOwned = candidate.source.kind === 'object' &&
                candidate.source.transformSource === 'opcua'
              const held = candidateContainsHeldEntity(candidate.entityId)
              return (
                <option disabled={opcUaOwned || held} key={candidate.entityId} value={candidate.entityId}>
                  {candidate.name}
                </option>
              )
            })}
          </select>
        </label>
        <button
          disabled={selectedCarriageUnavailable}
          onClick={() => void run(() => commands.setLinearAxisCarriage(
            carriageId === '' ? null : carriageId,
          ))}
          type="button"
        >
          Set carriage
        </button>
      </fieldset>
      <fieldset disabled={disabled || pending}>
        <legend>Robot mounting</legend>
        {axis.robotEntityId === null ? (
          <button onClick={() => void run(commands.attachRobotToLinearAxis)} type="button">
            Attach Robot
          </button>
        ) : (
          <button onClick={() => void run(commands.detachRobotFromLinearAxis)} type="button">
            Detach Robot
          </button>
        )}
      </fieldset>
      <button
        disabled={disabled || pending || axis.carriageEntityId !== null || axis.robotEntityId !== null}
        onClick={() => void run(commands.deleteLinearAxis).then((deleted) => {
          if (deleted) onDeleted?.()
        })}
        type="button"
      >
        Delete Linear Axis
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  )
}
