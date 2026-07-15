import { describe, expect, it } from 'vitest'
import type { SceneRuntimeProjectionV1 } from './scene-runtime-selector'
import { workcellRenderEntities } from './Workcell'

describe('Workcell published render authority', () => {
  it('uses only effective-visible entities from the published runtime projection', () => {
    const visible = { entityId: 'object:visible', effectiveVisible: true }
    const hidden = { entityId: 'object:hidden', effectiveVisible: false }
    const runtime = {
      entities: [visible, hidden],
    } as unknown as SceneRuntimeProjectionV1

    expect(workcellRenderEntities(runtime)).toEqual([visible])
  })
})
