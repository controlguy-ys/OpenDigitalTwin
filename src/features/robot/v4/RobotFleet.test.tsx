import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import type { WorkcellProjectV4 } from '../../../core/project-v4/types'
import { robotLinkCollisionIdV4 } from '../../../core/robot-runtime/collision-identity'
import { buildInitialRobotRuntimeStatesV4 } from './robot-runtime-registry'
import { selectSceneRuntimeV4 } from '../../scene/v4/scene-runtime-selector'
import {
  createPreparedRobotDefinitionGeometryV4,
  createRobotDefinitionGeometryRepositoryV4,
} from './robot-definition-geometry-repository'
import {
  RobotFleetV4,
  type RobotFleetRegistrationV4,
} from './RobotFleet'

vi.mock('@react-three/fiber', () => ({
  createPortal: (node: unknown) => node,
}))

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: unknown }) => children,
}))

function twoRobotProject(): WorkcellProjectV4 {
  const project = makeMinimalWorkcellProjectV4()
  const first = project.robots[0]!
  return {
    ...project,
    robots: [
      {
        ...first,
        id: 'robot-b',
        name: 'Robot B',
        localBasePose: { positionM: [2, 0, 0], quaternion: [0, 0, 0, 1] },
      },
      {
        ...first,
        id: 'robot-a',
        name: 'Robot A',
        localBasePose: { positionM: [1, 0, 0], quaternion: [0, 0, 0, 1] },
      },
    ],
  }
}

function projection(project: WorkcellProjectV4) {
  return selectSceneRuntimeV4(project, {
    projectRevisionId: project.revisionId,
    robots: buildInitialRobotRuntimeStatesV4(project),
  })
}

function prepared(project: WorkcellProjectV4) {
  const definition = project.robotDefinitions[0]!
  const geometry = new BoxGeometry(0.1, 0.1, 0.1)
  const templates = new Map(definition.links.map(({ id }) => {
    const root = new Group()
    root.add(new Mesh(geometry, new MeshStandardMaterial()))
    return [id, root] as const
  }))
  return {
    geometry,
    resource: createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates: templates,
      sharedGeometry: new Set([geometry]),
      triangleCount: 12,
      disposeResources: vi.fn(),
    }),
  }
}

function firstGeometry(root: Group) {
  let geometry: unknown = null
  root.traverse((object) => {
    if (geometry === null && object instanceof Mesh) geometry = object.geometry
  })
  return geometry
}

describe('RobotFleetV4', () => {
  it('aggregates visible independent Robots in Project order', async () => {
    const project = twoRobotProject()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = prepared(project)
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    const publication = repository.readCurrent(definition.id)!
    let registration: RobotFleetRegistrationV4 | null = null
    const view = render(
      <RobotFleetV4
        geometryPublications={new Map([[definition.id, publication]])}
        geometryRepository={repository}
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={projection(project)}
      />,
    )

    await waitFor(() => expect(registration?.robots.size).toBe(2))
    expect('set' in registration!.robots).toBe(false)
    expect('delete' in registration!.robots).toBe(false)
    expect('clear' in registration!.robots).toBe(false)
    expect([...registration!.robots.keys()]).toEqual(['robot-b', 'robot-a'])
    const robotB = registration!.robots.get('robot-b')!
    const robotA = registration!.robots.get('robot-a')!
    expect(robotB.root).not.toBe(robotA.root)
    expect(robotB.root.position.x).toBe(2)
    expect(robotA.root.position.x).toBe(1)
    expect(robotB.frameObjects.get('TCP')).not.toBe(robotA.frameObjects.get('TCP'))
    expect(firstGeometry(robotB.root)).toBe(source.geometry)
    expect(firstGeometry(robotA.root)).toBe(source.geometry)

    view.unmount()
    expect(registration).toBeNull()
    repository.revoke(handle)
  })

  it('retains unresolved visible Robots and excludes hidden Robots without inventing entities', async () => {
    const base = twoRobotProject()
    const project = {
      ...base,
      robots: [base.robots[0]!, { ...base.robots[1]!, visible: false }],
    }
    const repository = createRobotDefinitionGeometryRepositoryV4()
    let registration: RobotFleetRegistrationV4 | null = null
    const view = render(
      <RobotFleetV4
        geometryPublications={new Map()}
        geometryRepository={repository}
        onRegister={(value) => {
          registration = value
        }}
        project={project}
        sceneRuntime={projection(project)}
      />,
    )
    await waitFor(() => expect(registration?.robots.size).toBe(1))
    expect([...registration!.robots.keys()]).toEqual(['robot-b'])
    expect(registration!.robots.get('robot-b')?.geometryState).toBe('UNRESOLVED')
    expect(registration!.robots.has('environment')).toBe(false)
    expect(registration!.robots.has('linear-axis')).toBe(false)
    view.unmount()
  })

  it('keeps mounted roots while two Robots follow a changed Moving Frame and reports qualified proxies', async () => {
    const base = twoRobotProject()
    const sourceDefinition = base.robotDefinitions[0]!
    const definition = {
      ...sourceDefinition,
      links: sourceDefinition.links.map((link, index) => index !== 0 ? link : ({
        ...link,
        geometryOccurrences: link.geometryOccurrences.map((occurrence) => ({
          ...occurrence,
          collisionBoxes: [{
            id: 'body',
            centerM: [0, 0, 0] as const,
            halfExtentsM: [0.1, 0.1, 0.1] as const,
            quaternion: [0, 0, 0, 1] as const,
          }],
        })),
      })),
    }
    const track = {
      id: 'track',
      name: 'Track',
      geometry: { kind: 'box' as const, dimensionsM: [1, 1, 1] as const, color: '#808080' as const },
      parentFrameId: 'world',
      localPose: { positionM: [0, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
      visible: true,
      groupId: null,
      removable: true,
      transformOwner: 'manual' as const,
      numericStatus: {
        value: 0,
        sourceOwnership: 'manual' as const,
        overlay: { visible: false, frameId: null },
      },
      graspable: false,
      graspFrames: [],
      movingFrames: [{
        frameId: 'carriage',
        name: 'Carriage',
        parentFrameId: 'world',
        localPose: { positionM: [5, 0, 0] as const, quaternion: [0, 0, 0, 1] as const },
        sourceOwnership: 'simulation' as const,
      }],
    }
    const projectA: WorkcellProjectV4 = {
      ...base,
      robotDefinitions: [definition],
      spatialEntities: [track],
      robots: base.robots.map((robot) => ({
        ...robot,
        baseParentFrameId: 'carriage',
        intentionalMountEntityId: 'track',
      })),
    }
    const projectB: WorkcellProjectV4 = {
      ...projectA,
      revisionId: 'moving-frame-revision-2',
      spatialEntities: [{
        ...track,
        movingFrames: [{
          ...track.movingFrames[0]!,
          localPose: { positionM: [8, 0, 0], quaternion: [0, 0, 0, 1] },
        }],
      }],
    }
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = prepared(projectA)
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    const publications = new Map([[definition.id, repository.readCurrent(definition.id)!]])
    let registration: RobotFleetRegistrationV4 | null = null
    const onRegister = (value: RobotFleetRegistrationV4 | null) => {
      registration = value
    }
    const view = render(
      <RobotFleetV4
        geometryPublications={publications}
        geometryRepository={repository}
        onRegister={onRegister}
        project={projectA}
        sceneRuntime={projection(projectA)}
      />,
    )
    await waitFor(() => expect(registration?.robots.size).toBe(2))
    const rootB = registration!.robots.get('robot-b')!.root
    const rootA = registration!.robots.get('robot-a')!.root
    expect(rootB.position.x).toBe(7)
    expect(rootA.position.x).toBe(6)
    expect(registration!.robots.get('robot-b')!.collisionProxies.map(({ entity }) => entity.id))
      .toEqual([robotLinkCollisionIdV4('robot-b', 'L0')])
    expect(registration!.robots.get('robot-a')!.collisionProxies.map(({ entity }) => entity.id))
      .toEqual([robotLinkCollisionIdV4('robot-a', 'L0')])

    view.rerender(
      <RobotFleetV4
        geometryPublications={publications}
        geometryRepository={repository}
        onRegister={onRegister}
        project={projectB}
        sceneRuntime={projection(projectB)}
      />,
    )
    await waitFor(() => {
      expect(registration?.robots.get('robot-b')?.root.position.x).toBe(10)
      expect(registration?.robots.get('robot-a')?.root.position.x).toBe(9)
    })
    expect(registration!.robots.get('robot-b')!.root).toBe(rootB)
    expect(registration!.robots.get('robot-a')!.root).toBe(rootA)

    view.unmount()
    repository.revoke(handle)
  })

  it('does not retain child leases when Fleet registration publication throws', () => {
    const project = twoRobotProject()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = prepared(project)
    const definition = project.robotDefinitions[0]!
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(
      <RobotFleetV4
        geometryPublications={new Map([[
          definition.id,
          repository.readCurrent(definition.id)!,
        ]])}
        geometryRepository={repository}
        onRegister={(value) => {
          if (value !== null && value.robots.size > 0) {
            throw new Error('fleet registration failed')
          }
        }}
        project={project}
        sceneRuntime={projection(project)}
      />,
    )).toThrow()
    repository.revoke(handle)
    expect(source.resource.lifecycleState).toBe('DISPOSED')
    consoleError.mockRestore()
  })
})
