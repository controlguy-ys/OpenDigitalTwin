import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createViewportPreferenceStore } from './viewport-preference-store'
import { CoordinateStatusBar } from './CoordinateStatusBar'

describe('CoordinateStatusBar', () => {
  it('keeps Pose and Gizmo frame concepts independent with only approved options', async () => {
    const user = userEvent.setup()
    const store = createViewportPreferenceStore(null)
    render(<CoordinateStatusBar activeTcpName="Gripper TCP" store={store} />)

    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('WorldMCPBase')
    expect(screen.getByLabelText('Gizmo Frame')).toHaveTextContent('WorldParent')
    expect(screen.getByText('Gripper TCP')).toBeVisible()
    expect(screen.getByText('mm/deg')).toBeVisible()
    expect(screen.getByText('ZYX RPY')).toBeVisible()

    await user.selectOptions(screen.getByLabelText('Pose Frame'), 'mcp')
    await user.selectOptions(screen.getByLabelText('Gizmo Frame'), 'parent')
    expect(store.getState().poseFrame).toBe('mcp')
    expect(store.getState().gizmoFrame).toBe('parent')
  })
})
