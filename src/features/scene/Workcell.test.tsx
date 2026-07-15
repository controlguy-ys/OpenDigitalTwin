import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, Group, Mesh } from 'three'
import type { SceneRuntimeProjectionV1 } from './scene-runtime-selector'
import {
  createViewportBoundResolvers,
  workcellLinearAxisBindings,
  workcellRenderEntities,
} from './Workcell'
import type { CommittedLinearAxisSourceV1 } from './linear-axis-source'
import type { LinearAxisCommittedStateV1 } from './linear-axis-source'

describe('Workcell published render authority', () => {
  it('uses only effective-visible entities from the published runtime projection', () => {
    const visible = { entityId: 'object:visible', effectiveVisible: true }
    const hidden = { entityId: 'object:hidden', effectiveVisible: false }
    const runtime = {
      entities: [visible, hidden],
    } as unknown as SceneRuntimeProjectionV1

    expect(workcellRenderEntities(runtime)).toEqual([visible])
  })

  it('keeps bounds and world-matrix updates out of StrictMode render calculation', () => {
    const visible = new Group()
    visible.add(new Mesh(new BoxGeometry(1, 1, 1)))
    const update = vi.spyOn(visible, 'updateWorldMatrix')
    const runtime = {
      entities: [],
      objects: [{ entityId: 'object:visible', effectiveVisible: true }],
      byId: new Map([['object:visible', {
        entityId: 'object:visible', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1

    const firstRender = createViewportBoundResolvers(
      runtime, 'object:visible', new Map([['object:visible', visible]]), null, new Group(),
    )
    const strictModeSecondRender = createViewportBoundResolvers(
      runtime, 'object:visible', new Map([['object:visible', visible]]), null, new Group(),
    )
    expect(firstRender.canFocusSelection).toBe(true)
    expect(strictModeSecondRender.canFocusSelection).toBe(true)
    expect(update).not.toHaveBeenCalled()

    firstRender.focusSelectionBounds()
    expect(update).toHaveBeenCalled()
  })

  it('disables Focus until the selected committed Entity has registered renderable geometry', () => {
    const objectRuntime = {
      entities: [],
      objects: [{ entityId: 'object:visible', effectiveVisible: true }],
      byId: new Map([['object:visible', {
        entityId: 'object:visible', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1

    const missingRegistration = createViewportBoundResolvers(
      objectRuntime, 'object:visible', new Map(), null, new Group(),
    )
    const loadingStepRoot = new Group()
    const loadingStep = createViewportBoundResolvers(
      objectRuntime, 'object:visible', new Map([['object:visible', loadingStepRoot]]), null, new Group(),
    )

    expect(missingRegistration.canFocusSelection).toBe(false)
    expect(missingRegistration.focusSelectionBounds().isEmpty()).toBe(true)
    expect(loadingStep.canFocusSelection).toBe(false)
    expect(loadingStep.focusSelectionBounds().isEmpty()).toBe(true)
  })

  it('tracks async geometry added to and removed from the same registered Object root', () => {
    const root = new Group()
    const update = vi.spyOn(root, 'updateWorldMatrix')
    const runtime = {
      entities: [],
      objects: [{ entityId: 'object:async-step', effectiveVisible: true }],
      byId: new Map([['object:async-step', {
        entityId: 'object:async-step', kind: 'object', effectiveVisible: true, parentId: null,
      }]]),
      robot: null,
      linearAxis: null,
    } as unknown as SceneRuntimeProjectionV1
    const resolvers = createViewportBoundResolvers(
      runtime, 'object:async-step', new Map([['object:async-step', root]]), null, new Group(),
    )

    expect(resolvers.canFocusSelection).toBe(false)
    const geometry = new Mesh(new BoxGeometry(1, 1, 1))
    root.add(geometry)
    expect(resolvers.canFocusSelection).toBe(true)
    root.remove(geometry)
    expect(resolvers.canFocusSelection).toBe(false)
    expect(update).not.toHaveBeenCalled()
  })

  it('recognizes committed Robot, Axis, and Group-descendant render roots', () => {
    const renderable = () => {
      const root = new Group()
      root.add(new Mesh(new BoxGeometry(1, 1, 1)))
      return root
    }
    const robot = {
      entityId: 'robot:active', kind: 'robot', effectiveVisible: true, parentId: null,
    }
    const axis = {
      entityId: 'linear-axis:active', kind: 'linear-axis', effectiveVisible: true, parentId: null,
    }
    const group = {
      entityId: 'group:fixture', kind: 'group', effectiveVisible: true, parentId: null,
    }
    const child = {
      entityId: 'object:child', kind: 'object', effectiveVisible: true, parentId: 'group:fixture',
    }
    const runtime = {
      entities: [robot, axis, group, child], objects: [child], robot, linearAxis: axis,
      byId: new Map<string, typeof robot | typeof axis | typeof group | typeof child>([
        ['robot:active', robot], ['linear-axis:active', axis],
        ['group:fixture', group], ['object:child', child],
      ]),
    } as unknown as SceneRuntimeProjectionV1
    const scene = new Group()
    const axisRoot = renderable()
    axisRoot.name = 'linear-axis:active'
    scene.add(axisRoot)
    const roots = new Map([['object:child', renderable()]])
    const robotRoot = renderable()

    expect(createViewportBoundResolvers(
      runtime, 'robot:active', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
    expect(createViewportBoundResolvers(
      runtime, 'linear-axis:active', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
    expect(createViewportBoundResolvers(
      runtime, 'group:fixture', roots, robotRoot, scene,
    ).canFocusSelection).toBe(true)
  })

  it('binds the published runtime, live Object roots, and computed Robot root to the axis updater', () => {
    const runtime = { linearAxis: { entityId: 'linear-axis:active' } } as unknown as SceneRuntimeProjectionV1
    const objectRoot = new Group()
    const robotRoot = new Group()
    const objectRoots = new Map([['object:carriage', objectRoot]])
    const source = {
      kind: 'manual', subscribe: () => () => undefined,
      synchronizeCommittedState: () => undefined,
      setPositionM: async () => undefined, home: async () => undefined,
    } satisfies CommittedLinearAxisSourceV1
    const committedState: LinearAxisCommittedStateV1 = {
      axisEntityId: 'linear-axis:active', configurationIdentity: 'axis-config:A',
      positionM: 0.5, homePositionM: 0,
    }

    expect(workcellLinearAxisBindings(
      runtime,
      objectRoots,
      robotRoot,
      source,
      committedState,
    )).toEqual({
      runtime,
      objectRoots,
      robotRoot,
      source,
      committedState,
    })
  })
})
