import { act, render, screen } from '@testing-library/react'
import { Profiler } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RigidTransformV4 } from '../../../core/project-v4/index.js'
import { createHackathonHandoverSampleV4 } from '../../project/v4/hackathon-handover-sample-v4.js'
import { createHandoverDemoRuntimeStoreV4 } from './handover-demo-runtime-store.js'
import { HandoverDemoStatusStripV4 } from './HandoverDemoStatusStrip.js'

const IDENTITY_POSE: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

function runtime() {
  return createHandoverDemoRuntimeStoreV4(createHackathonHandoverSampleV4({
    projectId: 'project-status-strip',
    revisionId: 'revision-status-strip',
    nowIso: '2026-07-21T00:00:00.000Z',
  }))
}

describe('HandoverDemoStatusStripV4', () => {
  it('presents the current step and ownership without duplicating OPC UA status', () => {
    const store = runtime()
    const generation = store.getState().begin('run-status-strip')
    store.getState().attach(generation, 'NED2-A', IDENTITY_POSE, IDENTITY_POSE)
    store.getState().setStep(generation, 'HANDOVER_CONFIRM')

    render(<HandoverDemoStatusStripV4 store={store} />)

    const status = screen.getByRole('status', { name: 'Handover demo status' })
    expect(status).toHaveTextContent(
      'Step HANDOVER_CONFIRM | Part NED2-A | Shared Zone NED2-A',
    )
    expect(status).not.toHaveTextContent(/OPC UA|Gateway/i)
  })

  it('adds the failure code only when the Handover run faults', () => {
    const store = runtime()
    const generation = store.getState().begin('run-status-fault')
    store.getState().attach(generation, 'NED2-A', IDENTITY_POSE, IDENTITY_POSE)
    store.getState().setStep(generation, 'HANDOVER_CONFIRM')
    store.getState().failGripConfirm(generation)

    render(<HandoverDemoStatusStripV4 store={store} />)

    expect(screen.getByRole('status', { name: 'Handover demo status' }))
      .toHaveTextContent('Failure GRIP_CONFIRM_TIMEOUT')
  })

  it('does not re-render when only the attached Workpiece pose changes', () => {
    const store = runtime()
    const generation = store.getState().begin('run-status-pose-only')
    store.getState().attach(generation, 'NED2-A', IDENTITY_POSE, IDENTITY_POSE)
    store.getState().setStep(generation, 'HANDOVER_CONFIRM')
    const onRender = vi.fn()

    render(
      <Profiler id="handover-status" onRender={onRender}>
        <HandoverDemoStatusStripV4 store={store} />
      </Profiler>,
    )
    expect(onRender).toHaveBeenCalledTimes(1)

    act(() => {
      store.getState().updateAttachedPose(generation, 'NED2-A', {
        positionM: [0.3, -0.1, 0.2],
        quaternion: [0, 0, 0, 1],
      })
    })

    expect(onRender).toHaveBeenCalledTimes(1)
  })
})
