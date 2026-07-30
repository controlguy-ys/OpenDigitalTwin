import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

test('V6 default workspace has no serious or critical axe violations at 200 percent zoom', async ({ page, request }) => {
  await request.delete('http://127.0.0.1:8081/runtime/project', { data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true } })
  await page.setViewportSize({ width: 1024, height: 768 })
  await page.goto('/')
  await page.evaluate(() => { document.body.style.zoom = '2' })
  await expect(page.getByRole('menubar')).toBeVisible()
  const results = await new AxeBuilder({ page }).analyze()
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
})
