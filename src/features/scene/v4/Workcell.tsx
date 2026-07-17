import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { Object3D } from 'three'
import { failProjectV4 } from '../../../core/project-v4/errors.js'
import {
  BOX_PRIMITIVE_TRIANGLES_V4,
  CYLINDER_PRIMITIVE_TRIANGLES_V4,
  MAX_VISIBLE_SCENE_TRIANGLES_V4,
} from '../../../core/project-v4/limits.js'
import type {
  RobotDefinitionIdV4,
  RobotDefinitionV4,
  RobotIdV4,
  SpatialEntityIdV4,
  WorkcellProjectV4,
} from '../../../core/project-v4/types.js'
import type { CollisionGeometryProxyV4 } from '../../collision/scene-entity-adapter.js'
import type { SceneIsolationTargetV4 } from '../../interaction/v4/scene-selection.js'
import {
  RobotFleetV4,
  type RobotFleetRegistrationV4,
} from '../../robot/v4/RobotFleet.js'
import type { RobotInstanceRegistrationV4 } from '../../robot/v4/RobotInstanceModel.js'
import type {
  RobotDefinitionGeometryPublicationSnapshotV4,
  RobotDefinitionGeometryRepositoryV4,
} from '../../robot/v4/robot-definition-geometry-repository.js'
import {
  SpatialEntitySceneV4,
  type SpatialEntitySceneRegistrationV4,
} from './SpatialEntityScene.js'
import type { WorkcellInteractionHandlersV4 } from './scene-context-request.js'
import type { SceneRuntimeProjectionV4 } from './scene-runtime-selector.js'

export interface WorkcellRegistrationV4 {
  readonly robots: ReadonlyMap<RobotIdV4, RobotInstanceRegistrationV4>
  readonly spatialEntities: ReadonlyMap<SpatialEntityIdV4, Object3D>
  readonly collisionProxies: readonly CollisionGeometryProxyV4[]
}

export interface WorkcellPropsV4 {
  readonly project: WorkcellProjectV4
  readonly sceneRuntime: SceneRuntimeProjectionV4
  readonly geometryRepository: RobotDefinitionGeometryRepositoryV4
  readonly onRegister: (registration: WorkcellRegistrationV4 | null) => void
  readonly interaction?: WorkcellInteractionHandlersV4
  readonly viewIsolation?: SceneIsolationTargetV4 | null
}

interface WorkcellChildRegistrationV4<T> {
  readonly projectRevisionId: string
  readonly value: T
}

function readonlyMapSnapshotWorkcellV4<K, V>(
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

function declaredDefinitionTriangleCountV4(
  definition: RobotDefinitionV4,
): number {
  const excluded = new Set(definition.excludedGeometryOccurrenceKeys)
  return definition.links.reduce((definitionTotal, link) => (
    definitionTotal + link.geometryOccurrences.reduce((linkTotal, occurrence) => (
      linkTotal + (excluded.has(occurrence.occurrenceKey)
        ? 0
        : occurrence.statistics.triangles)
    ), 0)
  ), 0)
}

export function assertPreparedVisibleSceneTriangleBudgetV4(
  project: WorkcellProjectV4,
  sceneRuntime: SceneRuntimeProjectionV4,
  geometryPublications: ReadonlyMap<
    RobotDefinitionIdV4,
    RobotDefinitionGeometryPublicationSnapshotV4
  >,
): number {
  const definitionsById = new Map(
    project.robotDefinitions.map((definition) => [definition.id, definition]),
  )
  const visibleRobotIds = new Set(sceneRuntime.visibleRobotIds)
  const visibleSpatialEntityIds = new Set(sceneRuntime.visibleSpatialEntityIds)
  let triangles = 0

  for (const robot of project.robots) {
    if (!visibleRobotIds.has(robot.id)) continue
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      throw new Error(`Robot ${robot.id} has no V4 Definition.`)
    }
    triangles += geometryPublications.get(definition.id)?.triangleCount
      ?? declaredDefinitionTriangleCountV4(definition)
  }
  for (const entity of project.spatialEntities) {
    if (!visibleSpatialEntityIds.has(entity.id)) continue
    triangles += entity.geometry.kind === 'asset'
      ? entity.geometry.statistics.triangles
      : entity.geometry.kind === 'box'
        ? BOX_PRIMITIVE_TRIANGLES_V4
        : CYLINDER_PRIMITIVE_TRIANGLES_V4
  }
  if (triangles > MAX_VISIBLE_SCENE_TRIANGLES_V4) {
    failProjectV4(
      'VISIBLE_SCENE_TRIANGLE_LIMIT_EXCEEDED',
      '$.scene',
      'Visible prepared Scene triangle budget is exceeded.',
    )
  }
  return triangles
}

export function WorkcellV4({
  project,
  sceneRuntime,
  geometryRepository,
  onRegister,
  interaction,
  viewIsolation = null,
}: WorkcellPropsV4): ReactNode {
  const repositoryVersion = useSyncExternalStore(
    geometryRepository.subscribe,
    geometryRepository.getSnapshot,
    geometryRepository.getSnapshot,
  )
  const geometryPublications = useMemo(() => readonlyMapSnapshotWorkcellV4(
    project.robotDefinitions.flatMap((definition) => {
      const publication = geometryRepository.readCurrent(definition.id)
      return publication === null
        ? []
        : [[definition.id, publication] as const]
    }),
  ), [geometryRepository, project.robotDefinitions, repositoryVersion])
  assertPreparedVisibleSceneTriangleBudgetV4(
    project,
    sceneRuntime,
    geometryPublications,
  )

  const [fleetRegistration, setFleetRegistration] = useState<
    WorkcellChildRegistrationV4<RobotFleetRegistrationV4> | null
  >(null)
  const [spatialRegistration, setSpatialRegistration] = useState<
    WorkcellChildRegistrationV4<SpatialEntitySceneRegistrationV4> | null
  >(null)
  const activeRegistration = useRef<WorkcellRegistrationV4 | null>(null)
  const onRegisterRef = useRef(onRegister)
  onRegisterRef.current = onRegister
  const projectRevisionRef = useRef(sceneRuntime.projectRevisionId)
  projectRevisionRef.current = sceneRuntime.projectRevisionId
  const visibleRobotIdSignature = JSON.stringify(sceneRuntime.visibleRobotIds)
  const visibleSpatialIdSignature = JSON.stringify(sceneRuntime.visibleSpatialEntityIds)
  const handleFleetRegistration = useCallback((value: RobotFleetRegistrationV4 | null) => {
    setFleetRegistration(value === null ? null : {
      projectRevisionId: projectRevisionRef.current,
      value,
    })
  }, [])
  const handleSpatialRegistration = useCallback((
    value: SpatialEntitySceneRegistrationV4 | null,
  ) => {
    setSpatialRegistration(value === null ? null : {
      projectRevisionId: projectRevisionRef.current,
      value,
    })
  }, [])

  useEffect(() => {
    const ready = (
      fleetRegistration === null
      || spatialRegistration === null
      || fleetRegistration.projectRevisionId !== sceneRuntime.projectRevisionId
      || spatialRegistration.projectRevisionId !== sceneRuntime.projectRevisionId
      || [...fleetRegistration.value.robots.keys()].some((id, index) => (
        sceneRuntime.visibleRobotIds[index] !== id
      ))
      || fleetRegistration.value.robots.size !== sceneRuntime.visibleRobotIds.length
      || [...spatialRegistration.value.roots.keys()].some((id, index) => (
        sceneRuntime.visibleSpatialEntityIds[index] !== id
      ))
      || spatialRegistration.value.roots.size !== sceneRuntime.visibleSpatialEntityIds.length
    ) === false
    if (!ready) {
      if (activeRegistration.current !== null) {
        activeRegistration.current = null
        onRegisterRef.current(null)
      }
      return
    }
    const robots = readonlyMapSnapshotWorkcellV4(fleetRegistration.value.robots)
    const spatialEntities = readonlyMapSnapshotWorkcellV4(spatialRegistration.value.roots)
    const collisionProxies = Object.freeze([
      ...[...robots.values()].flatMap((registeredRobot) => registeredRobot.collisionProxies),
      ...spatialRegistration.value.collisionProxies,
    ])
    const registration = Object.freeze({ robots, spatialEntities, collisionProxies })
    activeRegistration.current = registration
    try {
      onRegisterRef.current(registration)
    } catch (error) {
      activeRegistration.current = null
      try {
        onRegisterRef.current(null)
      } catch {
        // Preserve the primary publication failure.
      }
      throw error
    }
  }, [
    fleetRegistration,
    sceneRuntime.projectRevisionId,
    spatialRegistration,
    visibleRobotIdSignature,
    visibleSpatialIdSignature,
  ])

  useEffect(() => () => {
    if (activeRegistration.current === null) return
    activeRegistration.current = null
    onRegisterRef.current(null)
  }, [])

  return (
    <>
      <RobotFleetV4
        geometryPublications={geometryPublications}
        geometryRepository={geometryRepository}
        onRegister={handleFleetRegistration}
        project={project}
        sceneRuntime={sceneRuntime}
        viewIsolation={viewIsolation}
        {...(interaction === undefined ? {} : { interaction })}
      />
      <SpatialEntitySceneV4
        onRegister={handleSpatialRegistration}
        project={project}
        sceneRuntime={sceneRuntime}
        viewIsolation={viewIsolation}
        {...(interaction === undefined ? {} : { interaction })}
      />
    </>
  )
}
