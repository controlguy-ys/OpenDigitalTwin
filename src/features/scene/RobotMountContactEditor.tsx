import { useEffect, useState, useSyncExternalStore } from 'react'
import { LINK_WORLD_ORIGINS, type RobotLinkId } from '../../domain/robot/crb15000'
import type { RobotMountContactV1 } from '../../domain/project/scene-state-v1'
import {
  geometryEntityRegistry,
  getGeometryEntityRegistryRevision,
  subscribeGeometryEntityRegistry,
} from '../collision/geometry-entity-registry'
import { sceneCommandService } from '../project/project-store-browser'
import type { SceneCommandService } from './scene-command-service'

const ROBOT_LINK_IDS = Object.keys(LINK_WORLD_ORIGINS) as RobotLinkId[]

export interface MountCollisionSurfaceOptionV1 {
  readonly id: string
  readonly name: string
}

export interface RobotMountContactEditorProps {
  readonly commands?: Pick<SceneCommandService, 'setRobotMountContact'>
  readonly configuration: RobotMountContactV1 | null
  readonly disabled?: boolean
  readonly surfaces?: readonly MountCollisionSurfaceOptionV1[]
}

function useLiveMountSurfaces(): readonly MountCollisionSurfaceOptionV1[] {
  useSyncExternalStore(
    subscribeGeometryEntityRegistry,
    getGeometryEntityRegistryRevision,
    getGeometryEntityRegistryRevision,
  )
  return [...geometryEntityRegistry.values()]
    .filter(({ id, boxes, object }) =>
      !id.startsWith('robot-link:') && boxes.length > 0 && object !== null)
    .sort((first, second) => first.name.localeCompare(second.name))
    .map(({ id, name }) => ({ id, name }))
}

export function RobotMountContactEditor({
  commands = sceneCommandService,
  configuration,
  disabled = false,
  surfaces: surfacesOverride,
}: RobotMountContactEditorProps) {
  const liveSurfaces = useLiveMountSurfaces()
  const surfaces = surfacesOverride ?? liveSurfaces
  const [baseLinkId, setBaseLinkId] = useState<RobotLinkId>(
    configuration?.baseLinkId ?? 'LINK00',
  )
  const [surfaceId, setSurfaceId] = useState(
    configuration?.mountSurfaceCollisionEntityId ?? '',
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBaseLinkId(configuration?.baseLinkId ?? 'LINK00')
    setSurfaceId(configuration?.mountSurfaceCollisionEntityId ?? '')
    setError(null)
  }, [configuration])

  const run = async (next: RobotMountContactV1 | null) => {
    if (pending) return
    setPending(true)
    setError(null)
    try {
      await commands.setRobotMountContact(next)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Mount contact update failed.')
    } finally {
      setPending(false)
    }
  }

  const status = configuration === null
    ? 'Not configured'
    : configuration.mountSurfaceCollisionEntityId === null
      ? 'Incomplete'
      : 'Configured'

  return (
    <section className="robot-mount-contact-editor">
      <h3>Mount Contact</h3>
      <output aria-label="Mount contact configuration status" role="status">{status}</output>
      <fieldset disabled={disabled || pending}>
        <label>
          <span>Robot base Link</span>
          <select
            aria-label="Robot base Link"
            onChange={(event) => setBaseLinkId(event.currentTarget.value as RobotLinkId)}
            value={baseLinkId}
          >
            {ROBOT_LINK_IDS.map((linkId) => <option key={linkId} value={linkId}>{linkId}</option>)}
          </select>
        </label>
        <label>
          <span>Mount collision surface</span>
          <select
            aria-label="Mount collision surface"
            onChange={(event) => setSurfaceId(event.currentTarget.value)}
            value={surfaceId}
          >
            <option value="">No active surface (incomplete)</option>
            {surfaces.map((surface) => (
              <option key={surface.id} value={surface.id}>{surface.name} ({surface.id})</option>
            ))}
          </select>
        </label>
        <button onClick={() => void run({
          baseLinkId,
          mountSurfaceCollisionEntityId: surfaceId === '' ? null : surfaceId,
        })} type="button">Save mount contact</button>
        <button onClick={() => void run(null)} type="button">Clear mount contact</button>
      </fieldset>
      {error === null ? null : <p role="alert">{error}</p>}
    </section>
  )
}
