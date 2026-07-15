import { describe, expect, it } from 'vitest'
import { Group } from 'three'
import type { SceneRuntimeProjectionV1 } from './scene-runtime-selector'
import { workcellLinearAxisBindings, workcellRenderEntities } from './Workcell'
import type { LinearAxisSourceV1 } from './linear-axis-source'

describe('Workcell published render authority', () => {
  it('uses only effective-visible entities from the published runtime projection', () => {
    const visible = { entityId: 'object:visible', effectiveVisible: true }
    const hidden = { entityId: 'object:hidden', effectiveVisible: false }
    const runtime = {
      entities: [visible, hidden],
    } as unknown as SceneRuntimeProjectionV1

    expect(workcellRenderEntities(runtime)).toEqual([visible])
  })

  it('binds the published runtime, live Object roots, and computed Robot root to the axis updater', () => {
    const runtime = { linearAxis: { entityId: 'linear-axis:active' } } as unknown as SceneRuntimeProjectionV1
    const objectRoot = new Group()
    const robotRoot = new Group()
    const objectRoots = new Map([['object:carriage', objectRoot]])
    const source = {
      kind: 'manual', subscribe: () => () => undefined,
      setPositionM: async () => undefined, home: async () => undefined,
    } satisfies LinearAxisSourceV1

    expect(workcellLinearAxisBindings(runtime, objectRoots, robotRoot, source)).toEqual({
      runtime,
      objectRoots,
      robotRoot,
      source,
    })
  })
})
