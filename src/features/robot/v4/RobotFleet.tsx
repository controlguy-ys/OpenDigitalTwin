import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ComponentProps,
  type ReactNode,
} from 'react'
import type {
  RobotDefinitionIdV4,
  RobotIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/types'
import type {
  SceneRuntimeProjectionV4,
  SceneRuntimeRobotEntityV4,
} from '../../scene/v4/scene-runtime-selector'
import type {
  SceneIsolationTargetV4,
} from '../../interaction/v4/scene-selection.js'
import type { WorkcellInteractionHandlersV4 } from '../../scene/v4/scene-context-request.js'
import {
  RobotInstanceModelV4,
  type RobotInstanceRegistrationV4,
} from './RobotInstanceModel'
import type {
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from './robot-definition-geometry-repository'

export interface RobotFleetRegistrationV4 {
  readonly robots: ReadonlyMap<RobotIdV4, RobotInstanceRegistrationV4>
}

export interface RobotFleetPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly geometryPublications: ReadonlyMap<
    RobotDefinitionIdV4,
    RobotDefinitionGeometryPublicationSnapshotV4
  >
  readonly onRegister: (
    registration: RobotFleetRegistrationV4 | null,
  ) => void
  readonly interaction?: WorkcellInteractionHandlersV4
  readonly viewIsolation?: SceneIsolationTargetV4 | null
}

interface FleetEntryRegistrationV4 {
  readonly token: object
  readonly registration: RobotInstanceRegistrationV4
}

function readonlyMapSnapshotFleetV4<K, V>(
  entries: Iterable<readonly [K, V]>,
): ReadonlyMap<K, V> {
  const backing = new Map(entries)
  let facade: ReadonlyMap<K, V>
  facade = Object.freeze({
    get size(): number {
      return backing.size
    },
    has: (key: K): boolean => backing.has(key),
    get: (key: K): V | undefined => backing.get(key),
    entries: (): MapIterator<[K, V]> => backing.entries(),
    keys: (): MapIterator<K> => backing.keys(),
    values: (): MapIterator<V> => backing.values(),
    forEach: (
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void => {
      backing.forEach((value, key) => callback.call(thisArg, value, key, facade))
    },
    [Symbol.iterator]: (): MapIterator<[K, V]> => backing[Symbol.iterator](),
    [Symbol.toStringTag]: 'ReadonlyMap',
  })
  return facade
}

function RobotFleetEntryV4({
  robotId,
  onEntryRegistration,
  ...modelProps
}: Readonly<{
  robotId: RobotIdV4
  onEntryRegistration: (
    robotId: RobotIdV4,
    token: object,
    registration: RobotInstanceRegistrationV4 | null,
  ) => void
}> & Omit<ComponentProps<typeof RobotInstanceModelV4>, 'onRegister'>) {
  const token = useRef(Object.freeze({})).current
  const handleRegistration = useCallback((
    registration: RobotInstanceRegistrationV4 | null,
  ) => {
    onEntryRegistration(robotId, token, registration)
  }, [onEntryRegistration, robotId, token])

  return (
    <RobotInstanceModelV4
      {...modelProps}
      onRegister={handleRegistration}
    />
  )
}

export function RobotFleetV4({
  project,
  sceneRuntime,
  geometryRepository,
  geometryPublications,
  onRegister,
  interaction,
  viewIsolation = null,
}: RobotFleetPropsV4): ReactNode {
  const mounted = useRef(true)
  const registrations = useRef(new Map<RobotIdV4, FleetEntryRegistrationV4>())
  const onRegisterRef = useRef(onRegister)
  onRegisterRef.current = onRegister
  const definitionsById = useMemo(() => new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  ), [project.robotDefinitions])
  const visibleRobotIds = useMemo(
    () => new Set(sceneRuntime.visibleRobotIds),
    [sceneRuntime.visibleRobotIds],
  )
  const visibleRobots = useMemo(
    () => project.robots.filter(({ id }) => visibleRobotIds.has(id)),
    [project.robots, visibleRobotIds],
  )
  const visibleRobotsRef = useRef(visibleRobots)
  visibleRobotsRef.current = visibleRobots

  const publishRegistrations = useCallback(() => {
    if (!mounted.current) return
    const ordered = new Map<RobotIdV4, RobotInstanceRegistrationV4>()
    for (const robot of visibleRobotsRef.current) {
      const entry = registrations.current.get(robot.id)
      if (entry !== undefined) ordered.set(robot.id, entry.registration)
    }
    onRegisterRef.current(Object.freeze({
      robots: readonlyMapSnapshotFleetV4(ordered),
    }))
  }, [])

  const handleEntryRegistration = useCallback((
    robotId: RobotIdV4,
    token: object,
    registration: RobotInstanceRegistrationV4 | null,
  ) => {
    if (registration === null) {
      if (registrations.current.get(robotId)?.token === token) {
        registrations.current.delete(robotId)
      }
    } else {
      registrations.current.set(robotId, { token, registration })
    }
    publishRegistrations()
  }, [publishRegistrations])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      registrations.current.clear()
      onRegisterRef.current(null)
    }
  }, [])

  useEffect(publishRegistrations, [publishRegistrations, visibleRobots])

  return visibleRobots.map((robot) => {
    const definition = definitionsById.get(robot.definitionId)
    const runtime = sceneRuntime.entities.get(robot.id)
    if (definition === undefined || runtime?.kind !== 'robot') {
      throw new Error(`Robot ${robot.id} has no V4 Definition/runtime projection.`)
    }
    return (
      <Fragment key={robot.id}>
        <RobotFleetEntryV4
          definition={definition}
          geometryPublication={geometryPublications.get(definition.id) ?? null}
          geometryRepository={geometryRepository}
          onEntryRegistration={handleEntryRegistration}
          robot={robot}
          robotId={robot.id}
          runtime={runtime as SceneRuntimeRobotEntityV4}
          viewVisible={viewIsolation === null || (
            viewIsolation.kind === 'robot' && viewIsolation.robotId === robot.id
          )}
          {...(interaction === undefined ? {} : { interaction })}
        />
      </Fragment>
    )
  })
}
