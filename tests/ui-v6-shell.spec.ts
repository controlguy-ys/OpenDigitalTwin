import { expect, test } from '@playwright/test'

test('V6 docks resize, collapse, reopen, and restore the same Main View Canvas with geometry intact', async ({ page }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await page.goto('/')
  const shell = page.getByTestId('v6-application-shell')
  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const canvasId = await canvas.evaluate((element) => {
    element.dataset.v6CanvasId ??= crypto.randomUUID()
    return element.dataset.v6CanvasId
  })
  const geometry = await page.getByTestId('v6-explorer').evaluate((element) => element.getBoundingClientRect().toJSON())
  await page.getByLabel('Resize Scene Explorer').hover({ position: { x: 16, y: 200 } })
  await page.mouse.down()
  await page.mouse.move(380, 200)
  await page.mouse.up()
  await expect(page.getByTestId('v6-explorer')).toBeVisible()
  for (const label of ['Scene Explorer', 'Inspector', 'Job Monitor']) {
    await page.getByRole('button', { name: `Hide ${label}` }).click()
    await page.getByRole('button', { name: `Show ${label}` }).click()
  }
  await page.getByRole('button', { name: 'Maximize Main View' }).click()
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'maximized')
  await expect(canvas).toHaveAttribute('data-v6-canvas-id', canvasId)
  await page.getByRole('button', { name: 'Restore Main View' }).click()
  await expect(page.getByTestId('v6-explorer')).toHaveJSProperty('offsetParent', expect.anything())
  expect(await page.getByTestId('v6-explorer').evaluate((element) => element.getBoundingClientRect().toJSON())).toEqual(geometry)
  await page.getByRole('button', { name: 'Maximize Main View' }).click()
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'workspace')
  await expect(canvas).toHaveAttribute('data-v6-canvas-id', canvasId)
})
