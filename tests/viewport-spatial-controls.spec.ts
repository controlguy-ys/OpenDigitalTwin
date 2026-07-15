import { expect, test } from '@playwright/test'

test('camera and coordinate overlays remain local while the scene state stays intact', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Home View' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Focus Selection' })).toBeDisabled()
  await expect(page.getByLabel('World view cube')).toHaveAttribute('data-reference', 'world')

  const selectedJoint = page.getByRole('spinbutton', { name: 'J1' })
  const before = await selectedJoint.inputValue()
  await page.getByRole('button', { name: 'Top view' }).click()
  await page.getByRole('button', { name: 'Home View' }).click()
  await expect(selectedJoint).toHaveValue(before)

  await page.getByRole('button', { name: 'Grid' }).click()
  await expect(page.getByRole('button', { name: 'Grid' })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('Pose Frame')).toHaveValue('world')
  await expect(page.getByLabel('Gizmo Frame')).toHaveValue('world')
  await expect(page.getByText('ZYX RPY')).toBeVisible()
})
