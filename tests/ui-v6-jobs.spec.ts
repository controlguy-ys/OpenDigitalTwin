import type { Page } from '@playwright/test'

import { expect, loadV6Demo, test } from './ui-v6-fixtures.js'

async function openJobMonitor(page: Page): Promise<void> {
  const toggle = page.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u })
  await expect(toggle).toBeVisible()
  if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
}

test('V6 Job monitor starts, follows, cancels, and opens its 17-step editor without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await loadV6Demo(page)
  await openJobMonitor(page)

  const monitor = page.getByTestId('v6-bottom')
  const start = monitor.getByRole('button', { name: 'Start' })
  const cancel = monitor.getByRole('button', { name: 'Cancel' })
  const edit = monitor.getByRole('button', { name: 'Edit Job' })
  await expect(monitor).toContainText('Logical I/O Pick and Place')
  await expect(start).toBeEnabled()
  await expect(cancel).toBeDisabled()

  await start.click()
  await expect(monitor).toContainText(/Current Step [1-9] \/ 17/u)
  await expect(cancel).toBeEnabled()
  await cancel.click()
  await expect(monitor).toContainText('CANCELLED')
  await expect(start).toBeEnabled()

  await edit.click()
  const dialog = page.getByRole('dialog', { name: /Edit Job: Logical I\/O Pick and Place/u })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('listitem')).toHaveCount(17)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
  await dialog.getByRole('button', { name: 'Close' }).click()
  await expect(edit).toBeFocused()
})

test('V6 exposes deterministic WaitDI recovery context in the live monitor, failed-step editor, and compact dock status', async ({ page }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await loadV6Demo(page)
  await openJobMonitor(page)
  const monitor = page.getByTestId('v6-bottom')
  await monitor.getByRole('button', { name: 'Start Job' }).click()
  await expect(monitor).toContainText('FAILED', { timeout: 15_000 })
  await expect(monitor).toContainText('WaitDI instruction wait-part-present timed out.')
  await expect(monitor.getByRole('status')).toContainText('FAILED Step')
  await expect(monitor.getByRole('button', { name: 'Retry Job' })).toBeEnabled()
  const inspect = monitor.getByRole('button', { name: 'Inspect failed step' })
  await expect(inspect).toBeVisible()
  await inspect.click()
  const editor = page.getByRole('dialog', { name: /Edit Job: Logical I\/O Pick and Place/u })
  await expect(editor).toBeVisible()
  await expect(editor.locator('[aria-current="step"]')).toBeVisible()
  await editor.getByRole('button', { name: 'Close' }).click()
  const compactToggle = page.getByRole('button', { name: /Job Monitor/u })
  await expect(compactToggle).toContainText('FAILED')
  await expect(compactToggle).toContainText('WaitDI instruction wait-part-present timed out.')
  expect(await compactToggle.locator('button').count()).toBe(0)
})
