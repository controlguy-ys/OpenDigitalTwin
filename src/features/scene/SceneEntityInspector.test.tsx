import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SceneEntityInspector } from './SceneEntityInspector'
import { quaternionFromIntrinsicZyxDeg } from './rpy-editor'
import { testSceneRuntime } from './scene-ui-test-fixtures'

describe('SceneEntityInspector', () => {
  it('edits Local XYZ/RPY through the project command and displays read-only World pose', async () => {
    const user = userEvent.setup()
    const setLocalPose = vi.fn(async () => undefined)
    render(
      <SceneEntityInspector
        commands={{ setLocalPose }}
        disabled={false}
        entityId="object:cup-1"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Relative to: Fixture Group')).toBeVisible()
    expect(screen.getByLabelText('World X (mm)')).toHaveAttribute('readonly')
    expect(screen.getByLabelText('World X (mm)')).toHaveValue('1100')
    await user.clear(screen.getByLabelText('Local X (mm)'))
    await user.type(screen.getByLabelText('Local X (mm)'), '250')
    await user.clear(screen.getByLabelText('Roll (deg)'))
    await user.type(screen.getByLabelText('Roll (deg)'), '450')
    await user.click(screen.getByRole('button', { name: 'Apply transform' }))

    expect(setLocalPose).toHaveBeenCalledWith('object:cup-1', {
      positionM: [0.25, 0.2, 0.3],
      quaternion: quaternionFromIntrinsicZyxDeg(450, 0, 0),
    })
  })

  it('rejects an invalid draft without partially changing the Entity', async () => {
    const user = userEvent.setup()
    const setLocalPose = vi.fn(async () => undefined)
    render(
      <SceneEntityInspector
        commands={{ setLocalPose }}
        entityId="robot:active"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Relative to: MCP')).toBeVisible()
    await user.clear(screen.getByLabelText('Local Y (mm)'))
    await user.click(screen.getByRole('button', { name: 'Apply transform' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('finite')
    expect(setLocalPose).not.toHaveBeenCalled()
  })

  it('makes OPC UA transform ownership explicit and prevents Manual edits', () => {
    render(
      <SceneEntityInspector
        commands={{ setLocalPose: vi.fn(async () => undefined) }}
        entityId="object:live-part"
        runtime={testSceneRuntime()}
      />,
    )

    expect(screen.getByText('Transform source: OPC UA')).toBeVisible()
    expect(screen.getByLabelText('Local X (mm)')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Apply transform' })).toBeDisabled()
  })
})
