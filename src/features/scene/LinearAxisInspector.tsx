import { useEffect, useMemo, useState } from 'react'
import type { SceneEntityIdV1 } from '../../domain/project/scene-state-v1'
import { sceneCommandService } from '../project/project-store-browser'
import {
  ManualLinearAxisSource,
  type LinearAxisSourceV1,
} from './linear-axis-source'
import type { SceneCommandService } from './scene-command-service'
import {
  usePublishedSceneRuntime,
  type SceneRuntimeProjectionV1,
} from './scene-runtime-selector'

type LinearAxisCommands = Pick<
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
}

function displayMillimetres(positionM: number): string {
  return String(Math.round(positionM * 1_000_000_000) / 1_000_000)
}

export function LinearAxisInspector({
  runtime: runtimeOverride,
  commands = sceneCommandService,
  source: sourceOverride,
  disabled = false,
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
  const manualSource = useMemo(() => new ManualLinearAxisSource({
    initialPositionM: axis?.currentPositionM ?? 0,
    homePositionM: axis?.homePositionM ?? 0,
    commitPositionM: commands.setLinearAxisPosition,
    commitHome: commands.moveLinearAxisHome,
  }), [axis?.currentPositionM, axis?.homePositionM, commands])
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

  const minMm = axis.minPositionM * 1_000
  const maxMm = axis.maxPositionM * 1_000
  const run = async (command: () => Promise<void>) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await command()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Linear Axis command failed.')
    } finally {
      setPending(false)
    }
  }
  const applyPosition = () => {
    const parsedMm = Number(positionMm)
    if (!Number.isFinite(parsedMm) || parsedMm < minMm || parsedMm > maxMm) {
      setError(`Allowed range: ${minMm} to ${maxMm} mm.`)
      return
    }
    void run(() => source.setPositionM(parsedMm / 1_000))
  }
  const carriageCandidates = [...runtime.groups, ...runtime.objects]

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
              return (
                <option disabled={opcUaOwned} key={candidate.entityId} value={candidate.entityId}>
                  {candidate.name}
                </option>
              )
            })}
          </select>
        </label>
        <button
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
        onClick={() => void run(commands.deleteLinearAxis)}
        type="button"
      >
        Delete Linear Axis
      </button>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  )
}
