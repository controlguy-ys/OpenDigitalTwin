import { StrictMode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
} from 'three'
import { computeSerialRobotPoseV4 } from '../../../core/robot-runtime/serial-kinematics'
import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support'
import type {
  RobotDefinitionV4,
  RobotInstanceV4,
} from '../../../core/project-v4/types'
import type { SceneRuntimeRobotEntityV4 } from '../../scene/v4/scene-runtime-selector'
import {
  createPreparedRobotDefinitionGeometryV4,
  createRobotDefinitionGeometryRepositoryV4,
} from './robot-definition-geometry-repository'
import {
  RobotInstanceModelV4,
  type RobotInstanceRegistrationV4,
} from './RobotInstanceModel'

vi.mock('@react-three/fiber', () => ({
  createPortal: (node: unknown) => node,
}))

vi.mock('@react-three/drei/web/Html.js', () => ({
  Html: ({ children }: { children: unknown }) => children,
}))

function fixture(): {
  readonly definition: RobotDefinitionV4
  readonly robot: RobotInstanceV4
} {
  const project = makeMinimalWorkcellProjectV4()
  return {
    definition: project.robotDefinitions[0]!,
    robot: {
      ...project.robots[0]!,
      numericStatus: {
        ...project.robots[0]!.numericStatus,
        overlay: { visible: true, frameId: null },
      },
    },
  }
}

function runtime(
  robot: RobotInstanceV4,
  definition: RobotDefinitionV4,
  x: number,
  jointValue: number,
  numericStatus: number,
): SceneRuntimeRobotEntityV4 {
  const worldBasePose = {
    positionM: [x, 0, 0] as const,
    quaternion: [0, 0, 0, 1] as const,
  }
  return {
    kind: 'robot',
    entityId: robot.id,
    definitionId: definition.id,
    worldBasePose,
    effectiveVisible: true,
    jointSource: 'simulation',
    numericStatus,
    selectedToolFrameId: robot.selectedToolFrameId,
    selectedTcpFrameId: robot.selectedTcpFrameId,
    serialPose: computeSerialRobotPoseV4(definition, { J1: jointValue }, worldBasePose),
  }
}

function preparedFor(definition: RobotDefinitionV4, disposeResources = vi.fn()) {
  const geometry = new BoxGeometry(0.1, 0.1, 0.1)
  const material = new MeshStandardMaterial()
  const templates = new Map(definition.links.map(({ id }) => {
    const root = new Group()
    root.add(new Mesh(geometry, material))
    return [id, root] as const
  }))
  return {
    geometry,
    disposeResources,
    resource: createPreparedRobotDefinitionGeometryV4({
      definitionId: definition.id,
      linkTemplates: templates,
      sharedGeometry: new Set([geometry]),
      triangleCount: 12,
      disposeResources,
    }),
  }
}

function firstMesh(root: Group): Mesh {
  let mesh: Mesh | null = null
  root.traverse((object) => {
    if (mesh === null && object instanceof Mesh) mesh = object
  })
  if (mesh === null) throw new Error('Expected a Mesh.')
  return mesh
}

function expectRuntimeReadonlyMap(map: ReadonlyMap<unknown, unknown>): void {
  expect('set' in map).toBe(false)
  expect('delete' in map).toBe(false)
  expect('clear' in map).toBe(false)
}

describe('RobotInstanceModelV4', () => {
  it('registers independent Robot roots, Link poses, TCP anchors, and status over shared Geometry', async () => {
    const { definition, robot } = fixture()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const prepared = preparedFor(definition)
    const handle = repository.stage(definition, prepared.resource)
    repository.commitBatch([handle])
    const publication = repository.readCurrent(definition.id)!
    const registrations = new Map<string, RobotInstanceRegistrationV4>()
    const view = render(
      <StrictMode>
        <RobotInstanceModelV4
          definition={definition}
          geometryPublication={publication}
          geometryRepository={repository}
          onRegister={(registration) => {
            if (registration !== null) registrations.set('a', registration)
          }}
          robot={{ ...robot, id: 'robot-a', name: 'Robot A' }}
          runtime={runtime({ ...robot, id: 'robot-a' }, definition, 1, 30, 11)}
        />
        <RobotInstanceModelV4
          definition={definition}
          geometryPublication={publication}
          geometryRepository={repository}
          onRegister={(registration) => {
            if (registration !== null) registrations.set('b', registration)
          }}
          robot={{ ...robot, id: 'robot-b', name: 'Robot B' }}
          runtime={runtime({ ...robot, id: 'robot-b' }, definition, 2, -45, 22)}
        />
      </StrictMode>,
    )

    await waitFor(() => expect(registrations.size).toBe(2))
    const a = registrations.get('a')!
    const b = registrations.get('b')!
    expect(a.root).not.toBe(b.root)
    expect(a.root.position.toArray()).toEqual([1, 0, 0])
    expect(b.root.position.toArray()).toEqual([2, 0, 0])
    expect(a.frameObjects.get('TCP')).not.toBe(b.frameObjects.get('TCP'))
    expectRuntimeReadonlyMap(a.linkObjects)
    expectRuntimeReadonlyMap(a.frameObjects)
    expect(firstMesh(a.root).geometry).toBe(prepared.geometry)
    expect(firstMesh(b.root).geometry).toBe(prepared.geometry)
    expect(a.linkObjects.get('L1')!.quaternion.toArray())
      .not.toEqual(b.linkObjects.get('L1')!.quaternion.toArray())
    expect(a.collisionProxies).toHaveLength(0)
    expect(screen.getByRole('status', { name: 'Robot A numeric status' })).toHaveTextContent('11')
    expect(screen.getByRole('status', { name: 'Robot B numeric status' })).toHaveTextContent('22')

    view.unmount()
    repository.revoke(handle)
    expect(prepared.disposeResources).toHaveBeenCalledOnce()
  })

  it('pins the supplied publication handle and retains an unresolved Robot after revoke', async () => {
    const { definition, robot } = fixture()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const a = preparedFor(definition)
    const handleA = repository.stage(definition, a.resource)
    repository.commitBatch([handleA])
    const publicationA = repository.readCurrent(definition.id)!
    const b = preparedFor(definition)
    const handleB = repository.stage(definition, b.resource)
    repository.commitBatch([handleB])
    let registration: RobotInstanceRegistrationV4 | null = null
    const props = {
      definition,
      geometryPublication: publicationA,
      geometryRepository: repository,
      onRegister: (value: RobotInstanceRegistrationV4 | null) => {
        registration = value
      },
      robot,
      runtime: runtime(robot, definition, 0, 0, 7),
    }
    const view = render(<RobotInstanceModelV4 {...props} />)
    await waitFor(() => expect(registration).not.toBeNull())
    expect(registration!.geometryState).toBe('RESOLVED')
    expect(registration!.publicationHandle).toBe(handleA)
    expect(firstMesh(registration!.root).geometry).toBe(a.geometry)
    view.unmount()

    repository.revoke(handleA)
    registration = null
    const unresolved = render(<RobotInstanceModelV4 {...props} />)
    await waitFor(() => expect(registration).not.toBeNull())
    expect(registration!.geometryState).toBe('UNRESOLVED')
    expect(registration!.publicationHandle).toBeNull()
    expect(registration!.root.getObjectByName('robot-geometry-unresolved')).not.toBeNull()
    expect(registration!.frameObjects.get('TCP')).toBeDefined()

    unresolved.unmount()
    repository.revoke(handleB)
  })

  it('keeps one exact lease and mutable Object hierarchy across runtime-only rerenders', async () => {
    const { definition, robot } = fixture()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = preparedFor(definition)
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    const publication = repository.readCurrent(definition.id)!
    const acquire = vi.spyOn(repository, 'acquire')
    let registration: RobotInstanceRegistrationV4 | null = null
    const onRegister = (value: RobotInstanceRegistrationV4 | null) => {
      registration = value
    }
    const view = render(
      <RobotInstanceModelV4
        definition={definition}
        geometryPublication={publication}
        geometryRepository={repository}
        onRegister={onRegister}
        robot={robot}
        runtime={runtime(robot, definition, 1, 0, 10)}
      />,
    )
    await waitFor(() => expect(registration).not.toBeNull())
    const first = registration!
    const root = first.root
    const link = first.linkObjects.get('L1')
    const frame = first.frameObjects.get('TCP')
    const material = firstMesh(root).material
    const initialLinkQuaternion = link!.quaternion.toArray()
    const clonedDefinition = structuredClone(definition)

    view.rerender(
      <RobotInstanceModelV4
        definition={clonedDefinition}
        geometryPublication={publication}
        geometryRepository={repository}
        onRegister={onRegister}
        robot={robot}
        runtime={runtime(robot, definition, 9, 45, 77)}
      />,
    )
    await waitFor(() => {
      expect(registration?.root.position.x).toBe(9)
      expect(screen.getByRole('status', { name: 'Robot 1 numeric status' }))
        .toHaveTextContent('77')
    })
    expect(registration!.root).toBe(root)
    expect(registration!.linkObjects.get('L1')).toBe(link)
    expect(registration!.frameObjects.get('TCP')).toBe(frame)
    expect(firstMesh(registration!.root).material).toBe(material)
    expect(registration!.linkObjects.get('L1')!.quaternion.toArray())
      .not.toEqual(initialLinkQuaternion)
    expect(acquire).toHaveBeenCalledOnce()

    repository.revoke(handle)
    expect(source.disposeResources).not.toHaveBeenCalled()
    view.unmount()
    expect(source.disposeResources).toHaveBeenCalledOnce()
  })

  it('releases the acquired generation when non-null registration publication throws', () => {
    const { definition, robot } = fixture()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = preparedFor(definition)
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    const onRegister = vi.fn((value: RobotInstanceRegistrationV4 | null) => {
      if (value !== null) throw new Error('registration publish failed')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(
      <RobotInstanceModelV4
        definition={definition}
        geometryPublication={repository.readCurrent(definition.id)!}
        geometryRepository={repository}
        onRegister={onRegister}
        robot={robot}
        runtime={runtime(robot, definition, 0, 0, 0)}
      />,
    )).toThrow('registration publish failed')
    repository.revoke(handle)
    expect(source.disposeResources).toHaveBeenCalledOnce()
    expect(onRegister).toHaveBeenCalledWith(null)
    consoleError.mockRestore()
  })

  it('releases the acquired generation even when null cleanup publication throws', async () => {
    const { definition, robot } = fixture()
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = preparedFor(definition)
    const handle = repository.stage(definition, source.resource)
    repository.commitBatch([handle])
    let registration: RobotInstanceRegistrationV4 | null = null
    const onRegister = vi.fn((value: RobotInstanceRegistrationV4 | null) => {
      if (value === null) throw new Error('registration cleanup failed')
      registration = value
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const view = render(
      <RobotInstanceModelV4
        definition={definition}
        geometryPublication={repository.readCurrent(definition.id)!}
        geometryRepository={repository}
        onRegister={onRegister}
        robot={robot}
        runtime={runtime(robot, definition, 0, 0, 0)}
      />,
    )
    await waitFor(() => expect(registration).not.toBeNull())
    repository.revoke(handle)

    expect(() => view.unmount()).toThrow('registration cleanup failed')
    expect(source.disposeResources).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('releases an exact lease when render hierarchy setup fails after acquire', () => {
    const { definition, robot } = fixture()
    const brokenDefinition: RobotDefinitionV4 = {
      ...definition,
      frames: definition.frames.map((frame, index) => index === 0
        ? { ...frame, parentFrameId: 'missing-render-parent' }
        : frame),
    }
    const repository = createRobotDefinitionGeometryRepositoryV4()
    const source = preparedFor(brokenDefinition)
    const handle = repository.stage(brokenDefinition, source.resource)
    repository.commitBatch([handle])
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => render(
      <RobotInstanceModelV4
        definition={brokenDefinition}
        geometryPublication={repository.readCurrent(definition.id)!}
        geometryRepository={repository}
        onRegister={vi.fn()}
        robot={robot}
        runtime={runtime(robot, definition, 0, 0, 0)}
      />,
    )).toThrow('has no render parent')
    repository.revoke(handle)
    expect(source.disposeResources).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })
})
