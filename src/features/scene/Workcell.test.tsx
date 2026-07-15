import { describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
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
    visible.add(new Group())
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
