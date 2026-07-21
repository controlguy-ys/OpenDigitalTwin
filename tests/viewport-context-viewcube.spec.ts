import { expect, test, type Locator, type Page } from '@playwright/test'

import { createDualRobotSampleV4 } from '../src/features/project/v4/dual-robot-sample-v4.js'

const ROBOT_LINK_LABEL = 'ABB CRB15000 / LINK00'

async function importProject(
  page: Page,
  project: object,
  fileName: string,
): Promise<void> {
  await page.getByRole('menuitem', { name: 'Project', exact: true }).click()
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Import Project', exact: true }).click()
  await (await chooser).setFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project), 'utf8'),
  })
}

async function ensureSceneAssetsVisible(page: Page): Promise<void> {
  const panel = page.getByRole('complementary', { name: 'Scene Assets' })
  if (await panel.isVisible()) return

  const drawer = page.getByRole('button', { name: 'Scene Assets drawer' })
  if (await drawer.getAttribute('aria-expanded') !== 'true') await drawer.click()
  await expect(panel).toBeVisible()
}

async function selectRobotLink(page: Page): Promise<Locator> {
  await ensureSceneAssetsVisible(page)
  const link = page
    .getByRole('tree', { name: 'Scene Objects' })
    .getByRole('treeitem', { name: ROBOT_LINK_LABEL, exact: true })
  await expect(link).toBeVisible()
  await link.getByRole('button', { name: ROBOT_LINK_LABEL, exact: true }).click()
  await expect(link).toHaveAttribute('aria-selected', 'true')
  return link
}

async function rightDrag(surface: Locator): Promise<void> {
  const box = await surface.boundingBox()
  if (box === null) throw new Error('Scene canvas surface has no bounding box.')

  const x = box.x + Math.min(240, box.width / 2)
  const y = box.y + Math.min(240, box.height / 2)
  await surface.page().mouse.move(x, y)
  await surface.page().mouse.down({ button: 'right' })
  await surface.page().mouse.move(x + 8, y + 1)
  await surface.page().mouse.up({ button: 'right' })
}

test('keeps stationary context, Pan selection, orientation fallback, and one canvas stable', async ({ page }) => {
  const project = createDualRobotSampleV4({
    projectId: 'project-e2e-viewport-context-v4',
    revisionId: 'revision-e2e-viewport-context-v4',
    nowIso: '2026-07-18T00:00:00.000Z',
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  const viewport = page.getByRole('main', { name: '3D viewport' })
  await expect(viewport).toHaveAttribute('aria-busy', 'false')
  await importProject(page, project, 'viewport-context-sample-v4.json')
  await expect(page.getByText(project.metadata.name, { exact: true })).toBeVisible()
  await expect(viewport).toHaveAttribute('aria-busy', 'false')

  const surface = page.getByTestId('scene-canvas-surface')
  await expect(surface).toBeVisible()
  await expect(page.locator('.scene-canvas canvas')).toHaveCount(1)
  await ensureSceneAssetsVisible(page)
  const sceneTree = page.getByRole('tree', { name: 'Scene Objects' })
  await expect(sceneTree).toBeVisible()

  const surfaceBox = await surface.boundingBox()
  if (surfaceBox === null) throw new Error('Scene canvas surface has no bounding box.')
  await page.mouse.click(surfaceBox.x + 20, surfaceBox.y + 120, { button: 'right' })
  await expect(sceneTree.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(0)
  const contextMenu = page.getByRole('menu')
  await expect(contextMenu).toHaveCount(1)
  await expect(contextMenu).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(contextMenu).toBeHidden()

  const link = await selectRobotLink(page)
  await rightDrag(surface)
  await expect(contextMenu).toHaveCount(0)
  await expect(link).toHaveAttribute('aria-selected', 'true')

  const orientation = page.getByRole('combobox', { name: 'View orientation' })
  const cameraControls = page.getByLabel('Camera controls')
  const cameraControlsBox = await cameraControls.boundingBox()
  const viewportBox = await viewport.boundingBox()
  expect(cameraControlsBox).not.toBeNull()
  expect(viewportBox).not.toBeNull()
  expect(cameraControlsBox!.y).toBeGreaterThanOrEqual(viewportBox!.y + 108)
  expect(cameraControlsBox!.x + cameraControlsBox!.width)
    .toBeLessThanOrEqual(viewportBox!.x + viewportBox!.width - 8)
  await orientation.selectOption('top')
  await expect(viewport).toHaveAttribute('aria-busy', 'false')
  await orientation.selectOption('front')
  await expect(viewport).toHaveAttribute('aria-busy', 'false')
  await expect(page.locator('.scene-canvas canvas')).toHaveCount(1)
})
