import AxeBuilder from '@axe-core/playwright'

import { expect, loadV6Demo, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

async function expectNoSeriousOrCritical(page: import('@playwright/test').Page, include?: string): Promise<void> {
  const builder = new AxeBuilder({ page })
  if (include !== undefined) builder.include(include)
  const results = await builder.analyze()
  expect(results.violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')).toEqual([])
}

test('V6 supports keyboard dialog flows, themed 200-percent layout, and axe-clean workspace, Settings, Binding, and Job surfaces', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await loadV6Demo(page)
  await expectNoSeriousOrCritical(page)

  const projectMenu = page.getByRole('menuitem', { name: 'Project' })
  await projectMenu.press('Enter')
  await expect(page.getByRole('menuitem', { name: 'Load Demo' })).toBeVisible()
  await page.keyboard.press('Escape')

  const viewMenu = page.getByRole('menuitem', { name: 'View' })
  await viewMenu.press('Enter')
  await page.getByRole('menuitemradio', { name: 'Dark Theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await viewMenu.click()
  await page.getByRole('menuitemradio', { name: 'Light Theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const connectivityTrigger = page.getByRole('menuitem', { name: 'Connectivity' })
  await connectivityTrigger.press('Enter')
  const settingsTrigger = page.getByRole('menu', { name: 'Connectivity menu' }).getByRole('menuitem', { name: 'OPC UA Settings' })
  await settingsTrigger.press('Enter')
  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await expect(settings).toBeVisible()
  await expectNoSeriousOrCritical(page, '[data-testid="opcua-settings-overlay"] [role="dialog"]')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(connectivityTrigger).toBeFocused()

  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const robot = await selectV6DemoRobot(page)
  await robot.press('Shift+F10')
  const sceneActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(sceneActions).toBeVisible()
  await sceneActions.getByRole('menuitem', { name: 'Show/Hide' }).press('Enter')
  await expect(tree.getByRole('button', { name: 'Show NED2' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')

  await page.getByRole('button', { name: 'Show Inspector' }).click()
  const bindingTrigger = page.getByTestId('v6-inspector').getByRole('button', { name: 'Open Binding' })
  await bindingTrigger.press('Enter')
  const bindingEditor = page.getByRole('dialog', { name: 'OPC UA Binding' })
  await expect(bindingEditor).toBeVisible()
  await expectNoSeriousOrCritical(page, '[data-testid="binding-editor-overlay"] [role="dialog"]')
  await page.keyboard.press('Escape')
  await expect(bindingEditor).toBeHidden()
  await expect(bindingTrigger).toBeFocused()

  await page.getByRole('button', { name: 'Show Job Monitor' }).click()
  const jobTrigger = page.getByTestId('v6-bottom').getByRole('button', { name: 'Edit Job' })
  await jobTrigger.press('Enter')
  const jobEditor = page.getByRole('dialog', { name: /Edit Job: Logical I\/O Pick and Place/u })
  await expect(jobEditor).toBeVisible()
  await expectNoSeriousOrCritical(page, '[role="dialog"].v6-job-editor-dialog')
  await page.keyboard.press('Escape')
  await expect(jobEditor).toBeHidden()
  await expect(jobTrigger).toBeFocused()

  await page.evaluate(() => { document.body.style.zoom = '2' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})

test('V6 keeps keyboard recovery, target semantics, live Job failure, and zoom overflow accessible at 200 percent', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 })
  await loadV6Demo(page)
  const project = page.getByRole('menuitem', { name: 'Project' })
  const connectivity = page.getByRole('menuitem', { name: 'Connectivity' })
  for (const control of [project, connectivity, page.getByRole('button', { name: /Show Job Monitor|Hide Job Monitor/u }).first()]) {
    const box = await control.boundingBox()
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(32)
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(32)
  }
  await connectivity.press('Enter')
  const menu = page.getByRole('menu', { name: 'Connectivity menu' })
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: 'Connection Monitor' }).press('Enter')
  const monitor = page.getByRole('complementary', { name: 'Connection Monitor' })
  await expect(monitor).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(connectivity).toBeFocused()
  await page.evaluate(() => { document.body.style.zoom = '2' })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expectNoSeriousOrCritical(page)
})
