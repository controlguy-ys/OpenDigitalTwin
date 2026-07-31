import type { Locator, Page } from '@playwright/test'

import {
  expect,
  loadV6Demo,
  selectV6DemoRobot,
  test,
} from './ui-v6-fixtures.js'

async function openConnectivityMenu(page: Page): Promise<Locator> {
  await page.getByRole('menuitem', { name: 'Connectivity' }).click()
  const menu = page.getByRole('menu', { name: 'Connectivity menu' })
  await expect(menu).toBeVisible()
  return menu
}

test('opens the active Project V5 Settings, modeless Monitor, Binding, and Docker surfaces from V6', async ({ page }) => {
  await page.route('**/runtime/status', async (route) => {
    const response = await route.fetch()
    const status = await response.json()
    status.gateway.runtimeKind = 'docker'
    await route.fulfill({ response, json: status })
  })
  await loadV6Demo(page)

  await (await openConnectivityMenu(page)).getByRole('menuitem', { name: 'OPC UA Settings' }).click()
  const settings = page.getByRole('dialog', { name: 'OPC UA Settings' })
  await settings.getByRole('button', { name: 'Add Endpoint' }).click()
  await expect(settings.getByRole('button', { name: 'Use host.docker.internal' })).toBeVisible()
  await settings.getByRole('button', { name: 'Use host.docker.internal' }).click()
  await expect(settings.getByLabel('Endpoint URL')).toHaveValue('opc.tcp://host.docker.internal:4840')
  await settings.getByRole('button', { name: 'Cancel' }).click()

  await (await openConnectivityMenu(page)).getByRole('menuitem', { name: 'Connection Monitor' }).click()
  const monitor = page.getByRole('complementary', { name: 'Connection Monitor' })
  await expect(monitor).toBeVisible()
  const robot = await selectV6DemoRobot(page)
  await expect(robot).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('v6-inspector')).toContainText('Logical I/O Robot')
  await expect(monitor).toBeVisible()
  await (await openConnectivityMenu(page)).getByRole('menuitem', { name: 'Binding Overview' }).click()
  await expect(page.getByRole('dialog', { name: 'Binding Overview' })).toBeVisible()
  await page.getByRole('dialog', { name: 'Binding Overview' })
    .getByRole('button', { name: 'Close' })
    .click()

  await (await openConnectivityMenu(page)).getByRole('menuitem', { name: 'Docker Run Guide' }).click()
  await expect(page.getByRole('dialog', { name: 'Docker Run Guide' })).toContainText('Docker')
})
