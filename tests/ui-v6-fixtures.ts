import { expect, test as base, type APIRequestContext, type Locator, type Page } from '@playwright/test'

import { validateRuntimeGatewayStatusV1, type RuntimeGatewayStatusV1 } from '../src/core/runtime-protocol/gateway-status-v1.js'

const GATEWAY_ORIGIN_V6 = 'http://127.0.0.1:8081'

function isCanonicalInactive(status: RuntimeGatewayStatusV1): boolean {
  return status.project.phase === 'not-applied'
    && status.project.authorityPhase === 'inactive'
    && status.project.projectId === null
    && status.project.revisionId === null
    && status.project.configRevision === null
    && status.project.activationAttemptId === null
    && status.project.readinessCode === 'NO_ACTIVE_REVISION'
}

export async function readRuntimeGatewayStatusV6(request: APIRequestContext): Promise<RuntimeGatewayStatusV1> {
  const response = await request.get(`${GATEWAY_ORIGIN_V6}/runtime/status`)
  expect(response.ok(), 'Runtime Gateway status endpoint must respond during V6 acceptance.').toBe(true)
  return validateRuntimeGatewayStatusV1(await response.json())
}

export async function resetRuntimeGatewayV6(request: APIRequestContext): Promise<void> {
  const response = await request.delete(`${GATEWAY_ORIGIN_V6}/runtime/project`, {
    data: { type: 'runtime-project-deactivate-v1', protocolVersion: 1, unconditional: true },
  })
  expect(response.ok(), 'Runtime Gateway unconditional Project deactivation must succeed.').toBe(true)
  await expect.poll(async () => isCanonicalInactive(await readRuntimeGatewayStatusV6(request)), {
    message: 'Runtime Gateway must finish deactivation in its canonical no-active-revision state.',
    timeout: 15_000,
  }).toBe(true)
}

async function clearBrowserProjectState(page: Page): Promise<void> {
  await page.context().clearCookies()
  await page.addInitScript(() => {
    localStorage.clear()
    sessionStorage.clear()
    void indexedDB.databases?.().then((databases) => {
      for (const database of databases) if (database.name !== undefined) indexedDB.deleteDatabase(database.name)
    })
  })
}

export const test = base.extend({
  page: async ({ page, request }, use) => {
    await resetRuntimeGatewayV6(request)
    await clearBrowserProjectState(page)
    try {
      await use(page)
    } finally {
      await resetRuntimeGatewayV6(request)
    }
  },
})

export { expect }

export async function loadV6Demo(page: Page): Promise<void> {
  await page.goto('/')
  await expect(page.getByRole('menuitem', { name: 'Project' })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Project' }).click()
  await page.getByRole('menuitem', { name: 'Load Demo' }).click()
  await expect(page.getByTestId('v6-main-view-viewport')).toBeVisible()
  await expect(page.getByTestId('v6-canvas-host')).toBeVisible()
  await expect(page.getByTestId('v6-canvas-host').locator('canvas')).toBeAttached()
}

export async function selectV6DemoRobot(page: Page): Promise<Locator> {
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const expandRobots = tree.getByRole('button', { name: 'Expand Robots' })
  if (await expandRobots.isVisible()) await expandRobots.click()
  const robot = tree.getByRole('treeitem', { name: /^NED2/u })
  await expect(robot).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')
  return robot
}
