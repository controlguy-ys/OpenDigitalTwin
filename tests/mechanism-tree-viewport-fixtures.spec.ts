import { expect, test } from '@playwright/test'

test('renders the humanoid fixture and moves only the left arm branch', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto('/?mechanismFixture=humanoid')
  await expect(page.locator('canvas')).toHaveCount(1)
  for (const bodyId of [
    'torso', 'head', 'left-upper-arm', 'left-lower-arm', 'right-upper-arm', 'right-lower-arm',
    'left-upper-leg', 'left-lower-leg', 'right-upper-leg', 'right-lower-leg',
  ]) {
    await expect(page.getByTestId(`mechanism-body-pose:${bodyId}`)).toBeVisible()
  }

  const leftBefore = await page.getByTestId('mechanism-frame-pose:left-hand').textContent()
  const rightBefore = await page.getByTestId('mechanism-frame-pose:right-hand').textContent()
  await page.getByRole('button', { name: 'Move left arm' }).click()

  await expect(page.getByTestId('mechanism-frame-pose:left-hand')).not.toHaveText(leftBefore ?? '')
  await expect(page.getByTestId('mechanism-frame-pose:right-hand')).toHaveText(rightBefore ?? '')
  await expect(page.getByText('3D renderer unavailable', { exact: false })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})

test('moves the CNC spindle to its exact commanded XYZ pose', async ({ page }) => {
  const pageErrors: Error[] = []
  page.on('pageerror', (error) => pageErrors.push(error))

  await page.goto('/?mechanismFixture=cnc')
  await expect(page.locator('canvas')).toHaveCount(1)
  for (const bodyId of ['base', 'x-carriage', 'y-carriage', 'z-carriage']) {
    await expect(page.getByTestId(`mechanism-body-pose:${bodyId}`)).toBeVisible()
  }
  await page.getByRole('button', { name: 'Move CNC' }).click()

  await expect(page.getByTestId('mechanism-frame-pose:spindle')).toHaveText('0.125,0.5,0.875|0,0,0,1')
  await expect(page.getByText('3D renderer unavailable', { exact: false })).toHaveCount(0)
  expect(pageErrors).toEqual([])
})
