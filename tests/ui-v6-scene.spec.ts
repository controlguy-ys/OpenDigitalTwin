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
  await expect(tree.getByRole('button', { name: 'Show NED2' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')

  await canvasHost.click({ button: 'right' })
  const viewportActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(viewportActions).toHaveAttribute('data-surface', 'viewport')
  await viewportActions.getByRole('menuitem', { name: 'Show/Hide' }).click()
  await expect(tree.getByRole('button', { name: 'Hide NED2' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')
})

test('V6 presents finite scene geometry and changes the real camera snapshot when Fit All is requested', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await loadV6Demo(page)

  const presentation = page.getByTestId('v5-scene-presentation')
  const visibleGeometryCount = async (): Promise<number> => Number((await presentation.textContent() ?? '').match(/^(\d+)/u)?.[1] ?? 0)
  const initialVisibleGeometryCount = await visibleGeometryCount()
  expect(initialVisibleGeometryCount).toBeGreaterThan(0)
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const initialTreeItemCount = await tree.getByRole('treeitem').count()
  const expandObjects = page.getByRole('button', { name: 'Expand Objects' })
  if (await expandObjects.isVisible()) await expandObjects.click()
  await expect(page.getByRole('treeitem', { name: /Part/u })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Model', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add Box', exact: true }).click()
  await expect.poll(async () => tree.getByRole('treeitem').count()).toBeGreaterThan(initialTreeItemCount)
  await expect.poll(visibleGeometryCount).toBeGreaterThan(0)

  const canvas = page.locator('.v5-scene-canvas')
  await page.getByRole('button', { name: 'Home view' }).click()
  const before = await canvas.getAttribute('data-camera-position')
  await page.getByRole('button', { name: 'Fit all visible geometry' }).click()
  await expect.poll(async () => canvas.getAttribute('data-camera-position')).not.toBe(before)
  expect(runtimeErrors).toEqual([])
})
