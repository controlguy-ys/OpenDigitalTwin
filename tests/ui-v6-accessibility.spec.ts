import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

async function expectNoSeriousOrCritical(page: import('@playwright/test').Page): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
}

test('V6 supports light and dark themes, keyboard menus, and 200 percent zoom without body overflow', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', { data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true } })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await page.getByRole('menuitem', { name: 'View' }).press('Enter')
  await page.getByRole('menuitemradio', { name: 'Dark Theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('menuitem', { name: 'View' }).click()
  await page.getByRole('menuitemradio', { name: 'Light Theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.evaluate(() => { document.body.style.zoom = '2' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoSeriousOrCritical(page)
})
