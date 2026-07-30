import { expect, test } from '@playwright/test'

test('V6 Scene Explorer selects items and opens a context action without camera navigation', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', { data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true } })
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  await expect(tree).toBeVisible()
  const item = tree.getByRole('treeitem', { name: /MCP/u })
  await item.click()
  await expect(item).toHaveAttribute('aria-selected', 'true')
  await item.click({ button: 'right' })
  await expect(page.getByRole('menu', { name: 'Scene actions' })).toBeVisible()
})
