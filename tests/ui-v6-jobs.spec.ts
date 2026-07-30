import { expect, test } from '@playwright/test'

test('V6 Job monitor starts, follows, cancels, and opens the 17-step explicit Job editor without horizontal overflow', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('menuitem', { name: 'Project' }).click()
  await page.getByRole('menuitem', { name: 'Load Demo' }).click()
  const monitor = page.getByTestId('v6-bottom')
  await expect(monitor).toContainText('Logical I/O Pick and Place')
  await monitor.getByRole('button', { name: 'Start' }).click()
  await expect(monitor).toContainText(/Current Step [1-9]/u)
  await monitor.getByRole('button', { name: 'Cancel' }).click()
  await expect(monitor).toContainText('CANCELLED')
  await monitor.getByRole('button', { name: 'Edit Job' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Edit Job')
  await expect(dialog.getByRole('listitem')).toHaveCount(17)
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})
