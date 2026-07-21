import { StrictMode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BoxGeometry, MeshBasicMaterial } from 'three'

import { createHackathonHandoverSampleV4 } from '../../project/v4/hackathon-handover-sample-v4.js'
import {
  createHandoverDemoSceneLayerResourcesV4,
  HandoverDemoSceneLayerV4,
  HANDOVER_SHARED_ZONE_COLORS_V4,
} from './HandoverDemoSceneLayer.js'

const project = createHackathonHandoverSampleV4({
  projectId: 'project-handover-scene-layer',
  revisionId: '8'.repeat(64),
  nowIso: '2026-07-21T00:00:00.000Z',
})

describe('HandoverDemoSceneLayerV4', () => {
  it('creates one visual-only Shared Zone with ownership metadata and no collision proxy', () => {
    const view = createHandoverDemoSceneLayerResourcesV4(project, 'NED2-A')

    expect(view.sharedZone.geometry).toBeInstanceOf(BoxGeometry)
    expect(view.sharedZone.material).toBeInstanceOf(MeshBasicMaterial)
    expect(view.sharedZone.material).toMatchObject({
      transparent: true,
      wireframe: true,
    })
    expect(view.sharedZone.userData.sharedZoneOwner).toBe('NED2-A')
    expect(view.sharedZone.material.color.getStyle()).toBe(
      HANDOVER_SHARED_ZONE_COLORS_V4['NED2-A'],
    )
    expect(view.collisionProxies).toHaveLength(0)

    view.dispose()
  })

  it('changes only ownership presentation and disposes its own resources once', () => {
    const view = createHandoverDemoSceneLayerResourcesV4(project, 'NONE')
    const position = view.sharedZone.position.clone()
    const quaternion = view.sharedZone.quaternion.clone()
    const geometry = view.sharedZone.geometry
    const material = view.sharedZone.material
    const disposeGeometry = vi.spyOn(geometry, 'dispose')
    const disposeMaterial = vi.spyOn(material, 'dispose')

    view.setOwner('NED2-B')

    expect(view.sharedZone.position).toEqual(position)
    expect(view.sharedZone.quaternion.toArray()).toEqual(quaternion.toArray())
    expect(view.sharedZone.geometry).toBe(geometry)
    expect(view.sharedZone.material).toBe(material)
    expect(view.sharedZone.userData.sharedZoneOwner).toBe('NED2-B')
    expect(material.color.getStyle()).toBe(
      HANDOVER_SHARED_ZONE_COLORS_V4['NED2-B'],
    )

    view.dispose()
    view.dispose()
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(disposeMaterial).toHaveBeenCalledOnce()
  })

  it('allocates and disposes a fresh Three resource set for each StrictMode effect lifetime', async () => {
    const disposeGeometry = vi.spyOn(BoxGeometry.prototype, 'dispose')
    const disposeMaterial = vi.spyOn(MeshBasicMaterial.prototype, 'dispose')
    const view = render(
      <StrictMode>
        <HandoverDemoSceneLayerV4 owner="NED2-A" project={project} />
      </StrictMode>,
    )
    await waitFor(() => {
      expect(view.container.querySelectorAll('primitive')).toHaveLength(1)
    })

    view.unmount()

    expect(disposeGeometry).toHaveBeenCalledTimes(2)
    expect(disposeMaterial).toHaveBeenCalledTimes(2)
  })
})
