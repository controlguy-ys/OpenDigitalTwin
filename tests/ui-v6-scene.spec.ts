import { expect, loadV6Demo, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

test('V6 keeps Scene Explorer selection keyboard-operable and routes right clicks to scene actions instead of camera input', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await loadV6Demo(page)

  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const canvasHost = page.getByTestId('v6-canvas-host')
  const robot = await selectV6DemoRobot(page)
  const inspector = page.getByTestId('v6-inspector')
  const inspectorBinding = inspector.getByRole('button', { name: 'Open Binding' })
  await inspectorBinding.click()
  const editor = page.getByRole('dialog', { name: 'OPC UA Binding' })
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(inspectorBinding).toBeFocused()

  await robot.press('Shift+F10')
  const explorerActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(explorerActions).toHaveAttribute('data-surface', 'explorer')
  await explorerActions.getByRole('menuitem', { name: 'Show/Hide' }).press('Enter')
  await expect(tree.getByRole('button', { name: 'Show Logical I/O Robot' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')

  await canvasHost.click({ button: 'right' })
  const viewportActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(viewportActions).toHaveAttribute('data-surface', 'viewport')
  await viewportActions.getByRole('menuitem', { name: 'Show/Hide' }).click()
  await expect(tree.getByRole('button', { name: 'Hide Logical I/O Robot' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')
})
