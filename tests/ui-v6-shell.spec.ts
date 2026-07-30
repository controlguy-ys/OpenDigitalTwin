import { expect, test } from '@playwright/test'

test('V6 shell preserves the viewport while docks and Main View presentation change', async ({ page }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await page.goto('/')
  const shell = page.getByTestId('v6-application-shell')
  await expect(shell).toBeVisible()
  await expect(page.getByRole('menubar')).toBeVisible()
  await expect(page.getByRole('main', { name: '3D viewport' })).toBeVisible()
  await expect(page.getByTestId('scene-canvas-surface')).toBeVisible()
  await page.getByRole('button', { name: 'Maximize Main View' }).click()
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'maximized')
  await expect(page.getByRole('button', { name: 'Restore Main View' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'workspace')
  await page.setViewportSize({ width: 768, height: 1024 })
  await expect(shell).toHaveAttribute('data-workspace-mode', 'narrow')
})
