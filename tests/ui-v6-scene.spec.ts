import { expect, test } from '@playwright/test'

test('V6 Scene Explorer selection and context actions do not turn a right click into a camera pan', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const item = tree.getByRole('treeitem', { name: /MCP/u })
  await item.click()
  await expect(item).toHaveAttribute('aria-selected', 'true')
  const canvas = page.getByTestId('v6-canvas-host')
  const mapping = await canvas.getAttribute('data-camera-mapping')
  await item.click({ button: 'right' })
  const actions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(actions).toBeVisible()
  await actions.getByRole('menuitem', { name: 'Focus' }).click()
  expect(await canvas.getAttribute('data-camera-mapping')).toBe(mapping)
})
