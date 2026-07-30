import { expect, loadV6Demo, test } from './ui-v6-fixtures.js'

test('V6 Job monitor starts, follows, cancels, and opens its 17-step editor without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await loadV6Demo(page)

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
