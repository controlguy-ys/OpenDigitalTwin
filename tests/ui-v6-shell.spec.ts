import { expect, loadV6Demo, readRuntimeGatewayStatusV6, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

async function bounds(locator: import('@playwright/test').Locator): Promise<DOMRect> {
  return locator.evaluate((element) => element.getBoundingClientRect())
}

test('V6 resizes and restores docks without remounting Main View or losing the active Project state', async ({ page, request }) => {
  await page.setViewportSize({ width: 1712, height: 1368 })
  await loadV6Demo(page)

  const shell = page.getByTestId('v6-application-shell')
  const header = page.locator('.v6-app-header')
  const explorer = page.getByTestId('v6-explorer')
  const inspector = page.getByTestId('v6-inspector')
  const monitor = page.getByTestId('v6-bottom')
  const canvasHost = page.getByTestId('v6-canvas-host')
  const canvas = canvasHost.locator('canvas')
  const projectBefore = await readRuntimeGatewayStatusV6(request)

  await expect(canvas).toBeAttached()
  expect((await bounds(header)).height).toBeLessThan(64)
  await page.getByRole('menuitem', { name: 'Connectivity' }).click()
  const connectivityMenu = page.getByRole('menu', { name: 'Connectivity menu' })
  await expect(connectivityMenu.getByRole('menuitem', { name: 'OPC UA Settings' })).toBeVisible()
  await expect(connectivityMenu.getByRole('menuitem', { name: 'Connection Monitor' })).toBeVisible()
  await expect(connectivityMenu.getByRole('menuitem', { name: 'Binding Overview' })).toBeVisible()
  await expect(connectivityMenu.getByRole('menuitem', { name: 'Docker Run Guide' })).toBeVisible()
  await page.keyboard.press('Escape')
  const selectedRobot = await selectV6DemoRobot(page)
  const selectedRobotKey = await selectedRobot.getAttribute('data-row-key')
  if (selectedRobotKey === null) throw new Error('Selected Robot did not expose its stable Scene Explorer row key.')
  const mountedSelectedRobot = explorer.locator(`[data-row-key="${selectedRobotKey}"]`)
  await expect(inspector).toContainText('Logical I/O Robot')
  await expect(monitor).toContainText('Logical I/O Pick and Place')
  const mainBefore = await bounds(page.getByTestId('v6-main-view-viewport'))
  expect(mainBefore.width).toBeGreaterThanOrEqual(480)
  const canvasId = await canvas.evaluate((element) => {
    element.dataset.v6CanvasIdentity ??= crypto.randomUUID()
    return element.dataset.v6CanvasIdentity
  })

  const explorerBefore = await bounds(explorer)
  const resizeHandle = page.getByLabel('Resize Scene Explorer')
  const handleBox = await resizeHandle.boundingBox()
  if (handleBox === null) throw new Error('Scene Explorer resize handle is unavailable.')
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(handleBox.x + 100, handleBox.y + handleBox.height / 2)
  await page.mouse.up()
  await expect.poll(async () => (await bounds(explorer)).width).not.toBe(explorerBefore.width)
  const resizedExplorer = await bounds(explorer)

  for (const label of ['Scene Explorer', 'Inspector', 'Job Monitor']) {
    await page.getByRole('button', { name: `Hide ${label}` }).click()
    await expect(page.getByTestId(label === 'Scene Explorer' ? 'v6-explorer' : label === 'Inspector' ? 'v6-inspector' : 'v6-bottom')).toHaveAttribute('data-visible', 'false')
    await page.getByRole('button', { name: `Show ${label}` }).click()
    await expect(page.getByTestId(label === 'Scene Explorer' ? 'v6-explorer' : label === 'Inspector' ? 'v6-inspector' : 'v6-bottom')).toHaveAttribute('data-visible', 'true')
  }

  await page.getByRole('button', { name: 'Set front view' }).click()
  await page.getByRole('button', { name: 'Maximize Main View' }).click()
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'maximized')
  await expect(canvas).toHaveAttribute('data-v6-canvas-identity', canvasId)
  await expect(page.getByTestId('v6-main-view-viewport')).toBeVisible()
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  await expect(mountedSelectedRobot).toHaveAttribute('aria-selected', 'true')
  await expect(monitor).toContainText('Logical I/O Pick and Place')

  await page.getByRole('button', { name: 'Restore Main View' }).click()
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'workspace')
  await expect(canvas).toHaveAttribute('data-v6-canvas-identity', canvasId)
  expect(await bounds(explorer)).toEqual(resizedExplorer)
  await expect(mountedSelectedRobot).toHaveAttribute('aria-selected', 'true')
  expect(await readRuntimeGatewayStatusV6(request)).toMatchObject({
    project: {
      projectId: projectBefore.project.projectId,
      revisionId: projectBefore.project.revisionId,
      configRevision: projectBefore.project.configRevision,
    },
  })

  await page.getByRole('button', { name: 'Maximize Main View' }).click()
  await page.keyboard.press('Escape')
  await expect(shell).toHaveAttribute('data-main-view-presentation', 'workspace')
  await expect(canvas).toHaveAttribute('data-v6-canvas-identity', canvasId)
  await expect(mountedSelectedRobot).toHaveAttribute('aria-selected', 'true')
})
