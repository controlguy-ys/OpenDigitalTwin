import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { createViewportPreferenceStore } from './viewport-preference-store'
import { CoordinateStatusBar } from './CoordinateStatusBar'
import { Matrix4 } from 'three'

describe('CoordinateStatusBar', () => {
  it('keeps Pose and Gizmo frame concepts independent with only approved options', async () => {
    const user = userEvent.setup()
    const store = createViewportPreferenceStore(null)
    const frameMatrices = {
      world: new Matrix4().identity().elements,
      mcp: new Matrix4().makeTranslation(1, 0, 0).elements,
      base: new Matrix4().makeTranslation(1.5, 0, 0).elements,
      tcp: new Matrix4().makeTranslation(2, 0.25, 0.5).elements,
    }
    render(<CoordinateStatusBar activeTcpName="Gripper TCP" frameMatrices={frameMatrices} store={store} />)

    expect(screen.getByLabelText('Pose Frame')).toHaveTextContent('WorldMCPBase')
    expect(screen.getByLabelText('Gizmo Frame')).toHaveTextContent('WorldParent')
    expect(screen.getByText('Gripper TCP')).toBeVisible()
    expect(screen.getByText('mm/deg')).toBeVisible()
    expect(screen.getByText('ZYX RPY')).toBeVisible()
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 2000.0Y 250.0Z 500.0')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('Rx 0.0Ry 0.0Rz 0.0')

    await user.selectOptions(screen.getByLabelText('Pose Frame'), 'mcp')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 1000.0Y 250.0Z 500.0')
    await user.selectOptions(screen.getByLabelText('Pose Frame'), 'base')
    expect(screen.getByLabelText('Actual TCP pose')).toHaveTextContent('X 500.0Y 250.0Z 500.0')
    await user.selectOptions(screen.getByLabelText('Gizmo Frame'), 'parent')
    expect(store.getState().poseFrame).toBe('base')
    expect(store.getState().gizmoFrame).toBe('parent')
  })
})
