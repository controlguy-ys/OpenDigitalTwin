import { expect, test, type Locator, type Page } from '@playwright/test'

import { createDefaultProjectV4 } from '../src/features/project/v4/default-project-v4.js'

const WORKSPACE_PREFERENCES_KEY = 'robotsim.workspace-preferences.v1'
const VIEWPORT_PREFERENCES_KEY = 'robotsim.viewport-preferences.v4'

type LayoutMode = 'wide' | 'compact' | 'narrow'

interface WorkspacePreferences {
  readonly version: 1
  readonly modes: Readonly<Record<LayoutMode, {
    readonly ribbonExpanded: boolean
    readonly dockVisible: Readonly<Record<'sidebar' | 'inspector' | 'bottom', boolean>>
  }>>
  readonly sidebar: { readonly widthPx: number; readonly sceneJobSplitPercent: number }
  readonly inspector: { readonly widthPx: number }
  readonly bottom: { readonly heightPx: number; readonly activeTab: string }
  readonly theme: string
}

const APPROVED_VIEWPORTS: readonly { readonly width: number; readonly height: number; readonly mode: LayoutMode }[] = [
  { width: 1440, height: 900, mode: 'wide' },
  { width: 1200, height: 900, mode: 'wide' },
  { width: 1199, height: 900, mode: 'compact' },
  { width: 960, height: 900, mode: 'compact' },
  { width: 959, height: 900, mode: 'narrow' },
  { width: 768, height: 1024, mode: 'narrow' },
]

function shell(page: Page): Locator {
  return page.locator('.app-shell')
}

function viewport(page: Page): Locator {
  return page.getByRole('main', { name: '3D viewport' })
}

function gatewayDisclosure(page: Page, mode: 'Off' | 'OPC UA Server'): Locator {
  return page.locator(`.studio-header-gateway-disclosure-v4[aria-controls="gateway-details-v4"][aria-label*="Gateway details: ${mode}"]:visible`)
}

async function gatewayDetails(page: Page): Promise<Readonly<Record<string, string>>> {
  return page.getByRole('dialog', { name: 'Gateway details' }).locator('dl').evaluate((list) => (
    Object.fromEntries(Array.from(list.querySelectorAll('div')).flatMap((row) => {
      const term = row.querySelector('dt')?.textContent?.trim()
      const value = row.querySelector('dd')?.textContent?.trim()
      return term === undefined || term === '' || value === undefined ? [] : [[term, value]]
    }))
  ))
}

async function expectTruncationRules(target: Locator): Promise<{
  readonly clientWidth: number
  readonly scrollWidth: number
}> {
  const metrics = await target.evaluate((element) => ({
    clientWidth: element.clientWidth,
    overflow: window.getComputedStyle(element).overflow,
    scrollWidth: element.scrollWidth,
    textOverflow: window.getComputedStyle(element).textOverflow,
    whiteSpace: window.getComputedStyle(element).whiteSpace,
  }))
  expect(metrics.clientWidth).toBeGreaterThan(0)
  expect(metrics.overflow).toBe('hidden')
  expect(metrics.textOverflow).toBe('ellipsis')
  expect(metrics.whiteSpace).toBe('nowrap')
  return metrics
}

async function openDefaultProject(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByTestId('scene-canvas-surface')).toBeVisible()
}

async function importProject(page: Page, project: object, fileName: string): Promise<void> {
  await openTopLevelMenu(page, 'Project')
  const chooser = page.waitForEvent('filechooser')
  await page.getByRole('menuitem', { name: 'Import Project', exact: true }).click()
  await (await chooser).setFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(project), 'utf8'),
  })
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
}

async function setViewport(page: Page, size: { readonly width: number; readonly height: number; readonly mode: LayoutMode }): Promise<void> {
  await page.setViewportSize(size)
  await expect(shell(page)).toHaveAttribute('data-layout-mode', size.mode)
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
}

async function workspacePreferences(page: Page): Promise<WorkspacePreferences> {
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_PREFERENCES_KEY)
  if (stored === null) throw new Error('Expected workspace preferences to be persisted.')
  return JSON.parse(stored) as WorkspacePreferences
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const root = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentHeight: document.documentElement.scrollHeight,
    documentClientHeight: document.documentElement.clientHeight,
    bodyWidth: document.body.scrollWidth,
    bodyClientWidth: document.body.clientWidth,
    bodyHeight: document.body.scrollHeight,
    bodyClientHeight: document.body.clientHeight,
  }))
  expect(root.documentWidth).toBe(root.documentClientWidth)
  expect(root.bodyWidth).toBe(root.bodyClientWidth)
  expect(root.documentHeight).toBe(root.documentClientHeight)
  expect(root.bodyHeight).toBe(root.bodyClientHeight)

  const viewportMetrics = await viewport(page).evaluate((element) => ({
    clientWidth: element.clientWidth,
    overflowX: window.getComputedStyle(element).overflowX,
  }))
  expect(viewportMetrics.clientWidth).toBeGreaterThan(0)
  expect(['hidden', 'clip']).toContain(viewportMetrics.overflowX)
}

async function dragResize(handle: Locator, deltaX: number, deltaY: number): Promise<void> {
  const box = await handle.boundingBox()
  if (box === null) throw new Error('Expected a visible resize handle.')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await handle.page().mouse.move(x, y)
  await handle.page().mouse.down()
  await handle.page().mouse.move(x + deltaX, y + deltaY, { steps: 4 })
  await handle.page().mouse.up()
}

async function pressMany(handle: Locator, key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', count: number): Promise<void> {
  await handle.focus()
  for (let index = 0; index < count; index += 1) await handle.press(key)
}

async function dispatchShortcut(page: Page, key: string, modifiers: { readonly ctrlKey?: boolean } = {}): Promise<boolean> {
  return page.evaluate(({ key: eventKey, ctrlKey }) => {
    const event = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      ctrlKey: ctrlKey === true,
      key: eventKey,
    })
    document.body.dispatchEvent(event)
    return event.defaultPrevented
  }, { key, ctrlKey: modifiers.ctrlKey })
}

async function currentViewportCamera(page: Page): Promise<unknown> {
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), VIEWPORT_PREFERENCES_KEY)
  if (stored === null) throw new Error('Expected viewport preferences to be persisted.')
  return JSON.parse(stored).cameraState
}

async function ribbonLabels(page: Page): Promise<readonly string[]> {
  return page.getByRole('toolbar', { name: 'Context commands' }).getByRole('button').evaluateAll((buttons) => (
    buttons
      .map((button) => button.getAttribute('aria-label') ?? '')
      .filter((label) => label !== 'More commands')
  ))
}

async function ensureDrawerVisible(page: Page, label: string, panelName: string): Promise<Locator> {
  const panel = page.getByRole('complementary', { name: panelName })
  if (!await panel.isVisible()) {
    const disclosure = page.getByRole('button', { name: label })
    if (await disclosure.getAttribute('aria-expanded') !== 'true') await disclosure.click()
  }
  await expect(panel).toBeVisible()
  return panel
}

async function openTopLevelMenu(page: Page, section: string): Promise<void> {
  const menubar = page.getByRole('menubar', { name: 'Application menu' })
  if (await menubar.isVisible()) {
    await menubar.getByRole('menuitem', { name: section, exact: true }).click()
    return
  }
  await page.getByRole('button', { name: 'Menu', exact: true }).click()
  await page.getByRole('menu', { name: 'Application menu' }).getByRole('menuitem', { name: section, exact: true }).click()
}

async function activateSubmenuCommand(page: Page, section: string, submenu: string, command: string): Promise<void> {
  await openTopLevelMenu(page, section)
  await page.getByRole('menuitem', { name: submenu, exact: true }).click()
  await page.getByRole('menuitem', { name: command, exact: true })
    .or(page.getByRole('menuitemradio', { name: command, exact: true }))
    .or(page.getByRole('menuitemcheckbox', { name: command, exact: true }))
    .click()
}

async function selectRobot(page: Page, robotName = 'CRB15000'): Promise<void> {
  await ensureDrawerVisible(page, 'Scene Assets drawer', 'Scene Assets')
  const robot = page.getByRole('tree', { name: 'Scene Objects' }).getByRole('treeitem', { name: robotName, exact: true })
  await robot.getByRole('button', { name: robotName, exact: true }).click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')
}

test('keeps dock defaults and bounded viewport geometry across the approved responsive matrix', async ({ page }) => {
  await openDefaultProject(page)

  for (const size of APPROVED_VIEWPORTS) {
    await setViewport(page, size)
    await expectNoHorizontalOverflow(page)

    if (size.mode === 'wide') {
      await expect(page.getByRole('menubar', { name: 'Application menu' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
      await expect(page.getByRole('toolbar', { name: 'Context commands' })).toBeVisible()
      await expect(page.getByRole('separator', { name: 'Resize Scene Assets' })).toBeVisible()
      await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toBeVisible()
    } else if (size.mode === 'compact') {
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
      await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toHaveCount(0)
      await expect(page.getByRole('toolbar', { name: 'Context commands' })).toBeHidden()
    } else {
      await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
      await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeHidden()
      await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
      await expect(page.getByRole('separator', { name: 'Resize Scene Assets' })).toHaveCount(0)
      await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toHaveCount(0)
      await expect(page.getByRole('separator', { name: 'Resize Bottom Workspace' })).toHaveCount(0)
      await expect(page.getByRole('toolbar', { name: 'Context commands' })).toBeHidden()
    }

    const viewportBox = await viewport(page).boundingBox()
    expect(viewportBox).not.toBeNull()
    expect(viewportBox!.width).toBeGreaterThanOrEqual(size.mode === 'narrow' ? 1 : 480)
  }
})

test('persists bounded dock preferences while breakpoint transitions clear transient overlays', async ({ page }) => {
  await openDefaultProject(page)

  const sceneHandle = page.getByRole('separator', { name: 'Resize Scene Assets' })
  await dragResize(sceneHandle, 32, 0)
  const resized = await workspacePreferences(page)
  expect(resized.sidebar.widthPx).toBeGreaterThan(248)
  expect(resized.sidebar.widthPx).toBeLessThanOrEqual(420)
  expect(resized.inspector.widthPx).toBe(320)
  await sceneHandle.dblclick()
  const resetSidebar = await workspacePreferences(page)
  expect(resetSidebar.sidebar.widthPx).toBe(248)
  expect(resetSidebar.inspector.widthPx).toBe(320)

  await dragResize(sceneHandle, 10_000, 0)
  expect((await workspacePreferences(page)).sidebar.widthPx).toBe(420)
  await dragResize(sceneHandle, -10_000, 0)
  expect((await workspacePreferences(page)).sidebar.widthPx).toBe(220)
  await pressMany(sceneHandle, 'ArrowRight', 10)
  expect((await workspacePreferences(page)).sidebar.widthPx).toBe(300)

  const inspectorHandle = page.getByRole('separator', { name: 'Resize Inspector' })
  await pressMany(inspectorHandle, 'ArrowLeft', 1)
  expect((await workspacePreferences(page)).inspector.widthPx).toBe(328)
  await dragResize(inspectorHandle, -10_000, 0)
  expect((await workspacePreferences(page)).inspector.widthPx).toBe(480)
  await dragResize(inspectorHandle, 10_000, 0)
  expect((await workspacePreferences(page)).inspector.widthPx).toBe(280)
  await pressMany(inspectorHandle, 'ArrowLeft', 6)
  expect((await workspacePreferences(page)).inspector.widthPx).toBe(328)

  const splitHandle = page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
  await expect(splitHandle).toBeVisible()
  await splitHandle.focus()
  await splitHandle.press('ArrowDown')
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(61)
  await splitHandle.dblclick()
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(60)

  const bottomDisclosure = page.getByRole('button', { name: 'Bottom Workspace sheet' })
  await bottomDisclosure.click()
  const bottom = page.getByRole('region', { name: 'Bottom Workspace' })
  await expect(bottom).toBeVisible()
  const centerBox = await viewport(page).boundingBox()
  const bottomBox = await bottom.boundingBox()
  expect(centerBox).not.toBeNull()
  expect(bottomBox).not.toBeNull()
  expect(bottomBox!.x).toBeCloseTo(centerBox!.x, 0)
  expect(bottomBox!.width).toBeCloseTo(centerBox!.width, 0)
  const bottomHandle = page.getByRole('separator', { name: 'Resize Bottom Workspace' })
  await dragResize(bottomHandle, 0, -24)
  const bottomPreference = (await workspacePreferences(page)).bottom.heightPx
  expect(bottomPreference).toBeGreaterThan(160)
  const sidebarBeforeBottomReset = (await workspacePreferences(page)).sidebar.widthPx
  await bottomHandle.dblclick()
  expect((await workspacePreferences(page)).bottom.heightPx).toBe(160)
  expect((await workspacePreferences(page)).sidebar.widthPx).toBe(sidebarBeforeBottomReset)
  await dragResize(bottomHandle, 0, -10_000)
  expect((await workspacePreferences(page)).bottom.heightPx).toBe(Number(await bottomHandle.getAttribute('aria-valuemax')))
  await dragResize(bottomHandle, 0, 10_000)
  expect((await workspacePreferences(page)).bottom.heightPx).toBe(120)
  await pressMany(bottomHandle, 'ArrowUp', 8)
  expect((await workspacePreferences(page)).bottom.heightPx).toBe(184)
  await expectNoHorizontalOverflow(page)

  await activateSubmenuCommand(page, 'View', 'Theme', 'Dark')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await activateSubmenuCommand(page, 'View', 'Theme', 'Light')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  const preferencesBeforeReload = await workspacePreferences(page)
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  expect(await workspacePreferences(page)).toEqual(preferencesBeforeReload)
  await expect(page.getByRole('region', { name: 'Bottom Workspace' })).toBeVisible()

  await setViewport(page, { width: 959, height: 900, mode: 'narrow' })
  await ensureDrawerVisible(page, 'Inspector drawer', 'Inspector')
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await setViewport(page, { width: 1200, height: 900, mode: 'wide' })
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await setViewport(page, { width: 1199, height: 900, mode: 'compact' })
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
  await setViewport(page, { width: 960, height: 900, mode: 'compact' })
  await setViewport(page, { width: 959, height: 900, mode: 'narrow' })
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()

  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()

  await page.evaluate(([workspaceKey, viewportKey]) => {
    window.localStorage.setItem(workspaceKey, '{not-json')
    window.localStorage.setItem(viewportKey, '{"camera":"unchanged"}')
  }, [WORKSPACE_PREFERENCES_KEY, VIEWPORT_PREFERENCES_KEY])
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  expect((await workspacePreferences(page)).sidebar.widthPx).toBe(248)
  await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), VIEWPORT_PREFERENCES_KEY)).toBe('{"camera":"unchanged"}')

  await page.evaluate((key) => {
    window.localStorage.setItem(key, JSON.stringify({
      version: 1,
      modes: { wide: { dockVisible: { sidebar: false } } },
      sidebar: { widthPx: 421, sceneJobSplitPercent: 34 },
      inspector: { widthPx: 481 },
      bottom: { heightPx: 119, activeTab: 'invalid' },
      theme: 'invalid',
    }))
  }, WORKSPACE_PREFERENCES_KEY)
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  const normalized = await workspacePreferences(page)
  expect(normalized.sidebar).toEqual({ widthPx: 248, sceneJobSplitPercent: 60 })
  expect(normalized.inspector.widthPx).toBe(320)
  expect(normalized.bottom).toEqual({ heightPx: 160, activeTab: 'timeline' })
  expect(normalized.theme).toBe('system')
})

test('keeps the scene-job split persisted at the narrow 360/359 availability boundary', async ({ page }) => {
  await openDefaultProject(page)

  const wideSplit = page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
  await dragResize(wideSplit, 0, 10_000)
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(75)
  await dragResize(wideSplit, 0, -10_000)
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(35)
  await pressMany(wideSplit, 'ArrowDown', 32)
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(67)
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toHaveAttribute('aria-valuenow', '67')

  await setViewport(page, { width: 959, height: 408, mode: 'narrow' })
  const assets = await ensureDrawerVisible(page, 'Scene Assets drawer', 'Scene Assets')
  await expect(assets).toHaveAttribute('data-scene-job-handle', 'visible')
  const savedSplit = (await workspacePreferences(page)).sidebar.sceneJobSplitPercent
  expect(savedSplit).toBe(67)
  await expect(page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toBeVisible()
  const narrowSplit = page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
  await pressMany(narrowSplit, 'ArrowDown', 1)
  const keyboardAdjustedSplit = (await workspacePreferences(page)).sidebar.sceneJobSplitPercent
  expect(keyboardAdjustedSplit).toBe(savedSplit + 1)
  await dragResize(narrowSplit, 0, 16)
  const dragAdjustedSplit = (await workspacePreferences(page)).sidebar.sceneJobSplitPercent
  expect(dragAdjustedSplit).toBeGreaterThan(keyboardAdjustedSplit)

  await setViewport(page, { width: 959, height: 407, mode: 'narrow' })
  await expect(assets).toHaveAttribute('data-scene-job-handle', 'hidden')
  await expect(page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toHaveCount(0)
  expect((await workspacePreferences(page)).sidebar.sceneJobSplitPercent).toBe(dragAdjustedSplit)
})

test('keeps preferred dock and ribbon sizes while reload closes compact and narrow overlays', async ({ page }) => {
  await openDefaultProject(page)

  const sidebar = page.getByRole('separator', { name: 'Resize Scene Assets' })
  const inspector = page.getByRole('separator', { name: 'Resize Inspector' })
  const split = page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })
  await pressMany(sidebar, 'ArrowRight', 7)
  await pressMany(inspector, 'ArrowLeft', 4)
  await pressMany(split, 'ArrowDown', 5)
  await page.getByRole('button', { name: 'Bottom Workspace sheet' }).click()
  const bottom = page.getByRole('region', { name: 'Bottom Workspace' })
  await expect(bottom).toBeVisible()
  await pressMany(page.getByRole('separator', { name: 'Resize Bottom Workspace' }), 'ArrowUp', 3)
  await page.getByRole('button', { name: 'Ribbon Lite' }).click()
  await expect(page.getByRole('button', { name: 'Ribbon Lite' })).toHaveAttribute('aria-pressed', 'false')
  const preferred = await workspacePreferences(page)
  expect(preferred.sidebar).toEqual({ widthPx: 304, sceneJobSplitPercent: 65 })
  expect(preferred.inspector.widthPx).toBe(352)
  expect(preferred.bottom.heightPx).toBe(184)
  expect(preferred.modes.wide.ribbonExpanded).toBe(false)

  await setViewport(page, { width: 1199, height: 900, mode: 'compact' })
  await ensureDrawerVisible(page, 'Inspector drawer', 'Inspector')
  await page.getByRole('button', { name: 'Bottom Workspace sheet' }).click()
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await expect(bottom).toBeVisible()
  const preferredWithCompactBottom = await workspacePreferences(page)
  expect(preferredWithCompactBottom.modes.compact.dockVisible.bottom).toBe(true)
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
  await expect(bottom).toBeVisible()
  expect(await workspacePreferences(page)).toEqual(preferredWithCompactBottom)

  await setViewport(page, { width: 959, height: 900, mode: 'narrow' })
  await ensureDrawerVisible(page, 'Scene Assets drawer', 'Scene Assets')
  await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeVisible()
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeHidden()

  await ensureDrawerVisible(page, 'Inspector drawer', 'Inspector')
  await page.getByRole('button', { name: 'Bottom Workspace sheet' }).click()
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeVisible()
  await expect(bottom).toBeVisible()
  await page.reload()
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')
  await expect(page.getByRole('complementary', { name: 'Scene Assets' })).toBeHidden()
  await expect(page.getByRole('complementary', { name: 'Inspector' })).toBeHidden()
  await expect(bottom).toBeHidden()
  expect(await workspacePreferences(page)).toEqual(preferredWithCompactBottom)

  await setViewport(page, { width: 1440, height: 900, mode: 'wide' })
  await expect(page.getByRole('separator', { name: 'Resize Scene Assets' })).toHaveAttribute('aria-valuenow', '304')
  await expect(page.getByRole('separator', { name: 'Resize Inspector' })).toHaveAttribute('aria-valuenow', '352')
  await expect(page.getByRole('separator', { name: 'Resize Scene Objects and Robot Jobs' })).toHaveAttribute('aria-valuenow', '65')
  await expect(page.getByRole('separator', { name: 'Resize Bottom Workspace' })).toHaveAttribute('aria-valuenow', '184')
  await expect(page.getByRole('toolbar', { name: 'Context commands' })).toBeHidden()
})

test('keeps the canvas controls and Scene actions within compact and narrow safe areas', async ({ page }) => {
  await openDefaultProject(page)
  await expect(page.locator('.scene-canvas canvas')).toHaveCount(1)

  await setViewport(page, { width: 1199, height: 900, mode: 'compact' })
  const compactInspector = await ensureDrawerVisible(page, 'Inspector drawer', 'Inspector')
  const compactInspectorBox = await compactInspector.boundingBox()
  const orientation = page.getByRole('combobox', { name: 'View orientation' })
  const compactOrientationBox = await orientation.boundingBox()
  expect(compactInspectorBox).not.toBeNull()
  expect(compactOrientationBox).not.toBeNull()
  expect(compactOrientationBox!.x + compactOrientationBox!.width).toBeLessThanOrEqual(compactInspectorBox!.x)
  await page.mouse.click(compactInspectorBox!.x - 12, Math.max(80, compactInspectorBox!.y + 120), { button: 'right' })
  const context = page.getByRole('menu', { name: 'Scene actions' })
  await expect(context).toBeVisible()
  const compactContextBox = await context.boundingBox()
  expect(compactContextBox).not.toBeNull()
  expect(compactContextBox!.x + compactContextBox!.width).toBeLessThanOrEqual(compactInspectorBox!.x)
  await page.keyboard.press('Escape')
  await expect(context).toBeHidden()

  await setViewport(page, { width: 959, height: 900, mode: 'narrow' })
  const assets = await ensureDrawerVisible(page, 'Scene Assets drawer', 'Scene Assets')
  const grid = page.getByRole('button', { name: 'Grid', exact: true })
  const assetBox = await assets.boundingBox()
  const gridBox = await grid.boundingBox()
  expect(assetBox).not.toBeNull()
  expect(gridBox).not.toBeNull()
  expect(gridBox!.x).toBeGreaterThanOrEqual(assetBox!.x + assetBox!.width)

  const inspector = await ensureDrawerVisible(page, 'Inspector drawer', 'Inspector')
  const inspectorBox = await inspector.boundingBox()
  const orientationBox = await orientation.boundingBox()
  expect(inspectorBox).not.toBeNull()
  expect(orientationBox).not.toBeNull()
  expect(orientationBox!.x + orientationBox!.width).toBeLessThanOrEqual(inspectorBox!.x)

  const surface = page.getByTestId('scene-canvas-surface')
  await page.mouse.click(inspectorBox!.x - 12, Math.max(80, inspectorBox!.y + 120), { button: 'right' })
  await expect(context).toBeVisible()
  const contextBox = await context.boundingBox()
  expect(contextBox).not.toBeNull()
  expect(contextBox!.x + contextBox!.width).toBeLessThanOrEqual(inspectorBox!.x)
  await page.keyboard.press('Escape')
  await expect(context).toBeHidden()

  await page.getByRole('button', { name: 'Inspector drawer' }).click()
  await page.getByRole('button', { name: 'Bottom Workspace sheet' }).click()
  const bottom = page.getByRole('region', { name: 'Bottom Workspace' })
  await expect(bottom).toBeVisible()
  const bottomBox = await bottom.boundingBox()
  const bottomGridBox = await grid.boundingBox()
  expect(bottomBox).not.toBeNull()
  expect(bottomGridBox).not.toBeNull()
  expect(bottomGridBox!.y + bottomGridBox!.height).toBeLessThanOrEqual(bottomBox!.y)

  const surfaceBox = await surface.boundingBox()
  if (surfaceBox === null) throw new Error('Expected a canvas surface for the safe-area context-menu check.')
  await page.mouse.click(surfaceBox.x + surfaceBox.width / 2, bottomBox!.y - 12, { button: 'right' })
  await expect(context).toBeVisible()
  const bottomContextBox = await context.boundingBox()
  expect(bottomContextBox).not.toBeNull()
  expect(bottomContextBox!.y + bottomContextBox!.height).toBeLessThanOrEqual(bottomBox!.y)
})

test('uses one measured More menu with stable priority order for a narrow Job ribbon', async ({ page }) => {
  await openDefaultProject(page)
  await setViewport(page, { width: 768, height: 900, mode: 'narrow' })
  await ensureDrawerVisible(page, 'Scene Assets drawer', 'Scene Assets')
  const job = page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job/ })
  await job.click()
  await expect(page.getByRole('button', { name: 'Ribbon Lite' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Ribbon Lite' }).click()
  const ribbon = page.getByRole('toolbar', { name: 'Context commands' })
  await expect(ribbon).toHaveAttribute('data-context-kind', 'job')
  const more = page.getByRole('button', { name: 'More commands' })
  await expect(more).toHaveCount(1)
  await expect(more).toBeVisible()
  const visible = await ribbonLabels(page)
  await more.click()
  const overflow = await page.getByRole('menu', { name: 'More commands' }).getByRole('menuitem').allTextContents()
  expect([...visible, ...overflow]).toEqual([
    'Save Current Pose',
    'Start Job',
    'Cancel Active Robot Job',
    'Rename Job',
    'Duplicate Job',
    'Delete Job',
    'Open Timeline',
  ])
})

test('runs and cancels a selected Job while checked OPC UA mode exposes gateway status', async ({ page }) => {
  await openDefaultProject(page)
  await selectRobot(page)
  const job = page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job/ })
  await job.click()
  const ribbon = page.getByRole('toolbar', { name: 'Context commands' })
  await expect(ribbon).toHaveAttribute('data-context-kind', 'job')
  await ribbon.getByRole('button', { name: 'Save Current Pose', exact: true }).click()
  await expect(page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job, 1 step/ })).toBeVisible()
  const joint = page.getByRole('spinbutton', { name: 'J1', exact: true })
  await joint.fill('120')
  await joint.press('Tab')
  await ribbon.getByRole('button', { name: 'Save Current Pose', exact: true }).click()
  await expect(page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job, 2 steps/ })).toBeVisible()
  await ribbon.getByRole('button', { name: 'Open Timeline', exact: true }).click()
  const firstStepSpeed = page.getByRole('spinbutton', { name: 'Step 1 speed to next Joint Pose' })
  await firstStepSpeed.fill('1')
  await expect(firstStepSpeed).toHaveValue('1')

  const jobs = page.getByRole('region', { name: 'Robot Jobs' })
  await expect(jobs.getByRole('button', { name: 'Start Job' })).toBeEnabled()
  await jobs.getByRole('button', { name: 'Start Job' }).click()
  const runtime = page.getByRole('status', { name: 'Robot Job state' })
  await expect(runtime).toContainText('RUNNING')
  await expect(jobs.getByRole('button', { name: 'Cancel Job' })).toBeEnabled()
  await jobs.getByRole('button', { name: 'Cancel Job' }).click()
  await expect(runtime).toContainText('CANCELLED')
  await expect(runtime).toContainText('Operator cancelled Job.')

  await activateSubmenuCommand(page, 'Connectivity', 'Runtime Mode', 'OPC UA Server')
  await openTopLevelMenu(page, 'Connectivity')
  await page.getByRole('menuitem', { name: 'Runtime Mode', exact: true }).click()
  const runtimeModeMenu = page.getByRole('menu', { name: 'Runtime Mode' })
  await expect(runtimeModeMenu.getByRole('menuitemradio').filter({ hasText: 'OPC UA Server' }))
    .toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  const serverDisclosure = gatewayDisclosure(page, 'OPC UA Server')
  await expect(serverDisclosure).toBeVisible()
  const serverLabel = await serverDisclosure.getAttribute('aria-label')
  const serverStatus = serverLabel?.split('·').at(-1)?.trim()
  expect(serverStatus).toBeTruthy()
  await serverDisclosure.click()
  await expect(page.getByRole('dialog', { name: 'Gateway details' })).toBeVisible()
  expect(await gatewayDetails(page)).toMatchObject({
    Mode: 'OPC UA Server',
    Status: serverStatus,
  })
  await page.keyboard.press('Escape')
  await activateSubmenuCommand(page, 'Connectivity', 'Runtime Mode', 'Off')
  await openTopLevelMenu(page, 'Connectivity')
  await page.getByRole('menuitem', { name: 'Runtime Mode', exact: true }).click()
  await expect(runtimeModeMenu.getByRole('menuitemradio').filter({ hasText: 'Off' }))
    .toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  const offDisclosure = gatewayDisclosure(page, 'Off')
  await expect(offDisclosure).toBeVisible()
  const offLabel = await offDisclosure.getAttribute('aria-label')
  const offStatus = offLabel?.split('·').at(-1)?.trim()
  expect(offStatus).toBeTruthy()
  await offDisclosure.click()
  expect(await gatewayDetails(page)).toMatchObject({ Mode: 'Off', Status: offStatus })
})

test('restores the active ribbon context after every top-level menu preview and keeps compact labels short', async ({ page }) => {
  await openDefaultProject(page)
  await selectRobot(page)
  const ribbon = page.getByRole('toolbar', { name: 'Context commands' })
  for (const [label, id] of [
    ['Project', 'project'], ['Home', 'home'], ['Model', 'model'], ['Job', 'job'],
    ['Simulation', 'simulation'], ['Connectivity', 'connectivity'], ['View', 'view'], ['Help', 'help'],
  ] as const) {
    await openTopLevelMenu(page, label)
    await expect(ribbon).toHaveAttribute('data-context-kind', 'menu')
    await expect(ribbon).toHaveAttribute('data-section', id)
    await page.keyboard.press('Escape')
    await expect(ribbon).toHaveAttribute('data-context-kind', 'robot')
  }

  for (const width of [1199, 960]) {
    await setViewport(page, { width, height: 900, mode: 'compact' })
    await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
    await expect(page.getByLabel('Application status')).toContainText('Jobs:')
    await expect(page.getByLabel('Application status')).not.toContainText('Running Jobs:')
    await expect(page.getByRole('button', { name: 'Save Project' })).toBeVisible()
    const quickActions = page.getByLabel('Quick Actions')
    await expect(quickActions.getByRole('button', { name: 'Start Job' })).toBeVisible()
    await expect(quickActions.getByRole('button', { name: 'Cancel Active Robot Job' })).toBeVisible()
    await openTopLevelMenu(page, 'Model')
    await expect(page.getByRole('menuitem', { name: 'Add Box', exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
  }
})

test('keeps Project, Robot, Object, and Job labels within their truncation surfaces', async ({ page }) => {
  await openDefaultProject(page)
  const longProjectName = 'Long Project Name For The Header Must Remain Readable Without Horizontal Overflow'
  const longRobotName = 'Long Robot Name For A Fixed Scene Assets Dock Must Remain Readable Without Overflow'
  const defaultProject = createDefaultProjectV4({
    projectId: 'project-e2e-long-labels-v4',
    revisionId: 'revision-e2e-long-labels-v4',
    nowIso: '2026-07-18T00:00:00.000Z',
  })
  const project = {
    ...defaultProject,
    metadata: { ...defaultProject.metadata, name: longProjectName },
    robots: defaultProject.robots.map((robot, index) => (
      index === 0 ? { ...robot, name: longRobotName } : robot
    )),
  }
  await importProject(page, project, 'long-labels-v4.json')
  await expect(page.getByText(longProjectName, { exact: true })).toBeVisible()
  await selectRobot(page, longRobotName)
  const sceneObjects = page.getByRole('tree', { name: 'Scene Objects' })
  const robot = sceneObjects.getByRole('treeitem', { name: longRobotName, exact: true })
  const projectMetrics = await expectTruncationRules(page.getByTestId('project-name'))
  expect(projectMetrics.scrollWidth).toBeGreaterThan(projectMetrics.clientWidth)
  const robotMetrics = await expectTruncationRules(
    robot.locator(':scope > .scene-tree-row > .scene-tree-label'),
  )
  expect(robotMetrics.scrollWidth).toBeGreaterThan(robotMetrics.clientWidth)

  await openTopLevelMenu(page, 'Model')
  await page.getByRole('menuitem', { name: 'Add Box', exact: true }).click()
  const longObjectName = 'Long Object Name For A Fixed Scene Assets Dock Must Remain Readable Without Overflow'
  const box = sceneObjects.getByRole('treeitem', { name: 'Box', exact: true })
  await box.getByRole('button', { name: 'Box', exact: true }).click()
  await openTopLevelMenu(page, 'Home')
  page.once('dialog', (dialog) => dialog.accept(longObjectName))
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click()
  const renamedBox = sceneObjects.getByRole('treeitem', { name: longObjectName, exact: true })
  await expect(renamedBox).toBeVisible()
  const objectMetrics = await expectTruncationRules(renamedBox.locator('.scene-tree-label'))
  expect(objectMetrics.scrollWidth).toBeGreaterThan(objectMetrics.clientWidth)

  const longName = 'Long Job Name For A Fixed Scene Assets Dock Must Remain Readable Without Overflow'
  const jobs = page.getByRole('tree', { name: 'Robot Jobs' })
  const defaultJob = jobs.getByRole('treeitem', { name: /Default Job/ })
  await defaultJob.click()
  await page.getByRole('button', { name: 'Default Job commands', exact: true }).click()
  page.once('dialog', (dialog) => dialog.accept(longName))
  await page.getByRole('menuitem', { name: 'Rename Job', exact: true }).click()
  const renamed = jobs.getByRole('treeitem', { name: new RegExp(longName) })
  await expect(renamed).toBeVisible()
  const label = renamed.getByText(longName, { exact: true })
  await expect(label).toHaveText(longName)
  const jobMetrics = await expectTruncationRules(label)
  expect(jobMetrics.scrollWidth).toBeGreaterThan(jobMetrics.clientWidth)
})

test('dispatches each global shortcut once while every editable joint field remains excluded', async ({ page }) => {
  await openDefaultProject(page)
  await openTopLevelMenu(page, 'Model')
  await page.getByRole('menuitem', { name: 'Add Box', exact: true }).click()
  await selectRobot(page)
  const phase = page.locator('.studio-header-project-phase-v4')
  const beforeSavePhase = await phase.getAttribute('data-phase')
  expect(await dispatchShortcut(page, 's', { ctrlKey: true })).toBe(true)
  await expect(phase).toHaveAttribute('data-phase', beforeSavePhase ?? 'ready')

  const orientation = page.getByRole('combobox', { name: 'View orientation' })
  await orientation.selectOption('front')
  const beforeHome = JSON.stringify(await currentViewportCamera(page))
  expect(await dispatchShortcut(page, 'h')).toBe(true)
  await expect.poll(async () => JSON.stringify(await currentViewportCamera(page))).not.toBe(beforeHome)

  await orientation.selectOption('right')
  const beforeFocus = JSON.stringify(await currentViewportCamera(page))
  expect(await dispatchShortcut(page, 'f')).toBe(true)
  await expect.poll(async () => JSON.stringify(await currentViewportCamera(page))).not.toBe(beforeFocus)

  const joint = page.getByRole('spinbutton', { name: 'J1', exact: true })
  await joint.fill('17')
  const editorCamera = JSON.stringify(await currentViewportCamera(page))
  const editorPhase = await phase.textContent()
  for (const [key, ctrlKey] of [['s', true], ['h', false], ['f', false]] as const) {
    const prevented = await joint.evaluate((input, shortcut) => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: shortcut.ctrlKey,
        key: shortcut.key,
      })
      input.dispatchEvent(event)
      return event.defaultPrevented
    }, { key, ctrlKey })
    expect(prevented).toBe(false)
    await expect(joint).toHaveValue('17')
  }
  expect(JSON.stringify(await currentViewportCamera(page))).toBe(editorCamera)
  await expect(phase).toHaveText(editorPhase ?? '')
})

test('keeps selection context, menus, commands, and OPC UA mode available on the live default project', async ({ page }) => {
  await openDefaultProject(page)
  const ribbon = page.getByRole('toolbar', { name: 'Context commands' })
  await expect(ribbon).toHaveAttribute('data-context-kind', 'empty')
  expect(await ribbonLabels(page)).toEqual(['Add Box', 'Add Cylinder', 'Add Group', 'Fit All'])
  await expect(page.getByRole('button', { name: 'More commands' })).toHaveCount(0)

  await selectRobot(page)
  await expect(ribbon).toHaveAttribute('data-context-kind', 'robot')
  expect(await ribbonLabels(page)).toEqual(['Joint Jog', 'Robot Home', 'Edit Robot Base', 'Hide'])

  await openTopLevelMenu(page, 'Model')
  await expect(page.getByRole('menuitem', { name: 'Import Robot STEP', exact: true })).toBeVisible()
  for (const label of ['Robot Geometry', 'Robot Kinematics', 'Import STEP', 'Add Object', 'STEP Add Object']) {
    await expect(page.getByRole('menuitem', { name: label, exact: true })).toHaveCount(0)
  }
  await page.keyboard.press('Escape')
  await openTopLevelMenu(page, 'Connectivity')
  await expect(page.getByRole('menuitem', { name: 'OPC UA Mapping', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')

  const joint = page.getByRole('spinbutton', { name: 'J1', exact: true })
  await joint.fill('15')
  await joint.press('Tab')
  await expect(joint).toHaveValue('15')
  await joint.focus()
  await page.keyboard.press('H')
  await expect(joint).toHaveValue('15')

  await openTopLevelMenu(page, 'Model')
  await page.getByRole('menuitem', { name: 'Add Box', exact: true }).click()
  const box = page.getByRole('tree', { name: 'Scene Objects' }).getByRole('treeitem', { name: 'Box', exact: true })
  await expect(box).toBeVisible()
  await box.getByRole('button', { name: 'Box', exact: true }).click()
  await expect(ribbon).toHaveAttribute('data-context-kind', 'object')
  expect(await ribbonLabels(page)).toEqual(['XYZRPY', 'Move to Group', 'Numeric Status', 'Hide', 'Delete'])
  await expect(ribbon.getByRole('button', { name: 'Parent', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Application status')).toContainText('CRB15000')

  const job = page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job/ })
  await job.click()
  await expect(ribbon).toHaveAttribute('data-context-kind', 'job')
  expect(await ribbonLabels(page)).toEqual(['Save Current Pose', 'Start Job', 'Cancel Active Robot Job', 'Rename Job', 'Duplicate Job', 'Delete Job', 'Open Timeline'])
  await ribbon.getByRole('button', { name: 'Save Current Pose', exact: true }).click()
  await expect(page.getByRole('tree', { name: 'Robot Jobs' }).getByRole('treeitem', { name: /Default Job, 1 step/ })).toBeVisible()

  await selectRobot(page)
  await openTopLevelMenu(page, 'Project')
  await expect(ribbon).toHaveAttribute('data-context-kind', 'menu')
  expect(await ribbonLabels(page)).toEqual(['Save Project', 'New Project', 'Import Project'])
  await page.keyboard.press('Escape')
  await expect(ribbon).toHaveAttribute('data-context-kind', 'robot')

  await page.keyboard.press('Control+S')
  await page.keyboard.press('H')
  await page.keyboard.press('F')
  await expect(viewport(page)).toHaveAttribute('aria-busy', 'false')

  await activateSubmenuCommand(page, 'Connectivity', 'Runtime Mode', 'OPC UA Server')
  const serverDisclosure = gatewayDisclosure(page, 'OPC UA Server')
  await expect(serverDisclosure).toHaveCount(1)
  await expect(serverDisclosure).toBeVisible()
  await serverDisclosure.click()
  await expect(page.getByRole('dialog', { name: 'Gateway details' })).toContainText('OPC UA Server')
  await page.keyboard.press('Escape')
  await activateSubmenuCommand(page, 'Connectivity', 'Runtime Mode', 'Off')
  const offDisclosure = gatewayDisclosure(page, 'Off')
  await expect(offDisclosure).toHaveCount(1)
  await expect(offDisclosure).toBeVisible()
  await offDisclosure.click()
  await expect(page.getByRole('dialog', { name: 'Gateway details' })).toContainText('Off')
})
