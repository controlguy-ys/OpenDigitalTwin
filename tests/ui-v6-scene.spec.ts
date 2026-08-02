import { expect, loadV6Demo, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

test('V6 keeps Scene Explorer selection keyboard-operable and routes right clicks to scene actions instead of camera input', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await loadV6Demo(page)
  const inspectorToggle = page.getByRole('button', { name: /Show Inspector|Hide Inspector/u })
  if (await inspectorToggle.getAttribute('aria-pressed') !== 'true') await inspectorToggle.click()

  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const canvasHost = page.getByTestId('v6-canvas-host')
  const robot = await selectV6DemoRobot(page)
  const inspector = page.getByTestId('v6-inspector')
  const inspectorBinding = inspector.getByRole('button', { name: 'Open Binding' })
  await inspectorBinding.click()
  const editor = page.getByRole('dialog', { name: 'OPC UA Binding' })
  await editor.getByRole('button', { name: 'Cancel' }).click()
  await expect(inspectorBinding).toBeFocused()

  await robot.press('Shift+F10')
  const explorerActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(explorerActions).toHaveAttribute('data-surface', 'explorer')
  await explorerActions.getByRole('menuitem', { name: 'Show/Hide' }).press('Enter')
  await expect(tree.getByRole('button', { name: 'Show NED2' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')

  await canvasHost.click({ button: 'right' })
  const viewportActions = page.getByRole('menu', { name: 'Scene actions' })
  await expect(viewportActions).toHaveAttribute('data-surface', 'viewport')
  await viewportActions.getByRole('menuitem', { name: 'Show/Hide' }).click()
  await expect(tree.getByRole('button', { name: 'Hide NED2' })).toBeVisible()
  await robot.click()
  await expect(robot).toHaveAttribute('aria-selected', 'true')
})

test('V6 presents finite scene geometry and changes the real camera snapshot when Fit All is requested', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  const runtimeErrors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') runtimeErrors.push(message.text())
  })
  page.on('pageerror', (error) => runtimeErrors.push(error.message))
  await loadV6Demo(page)

  const presentation = page.getByTestId('v5-scene-presentation')
  const visibleGeometryCount = async (): Promise<number> => Number((await presentation.textContent() ?? '').match(/^(\d+)/u)?.[1] ?? 0)
  const initialVisibleGeometryCount = await visibleGeometryCount()
  expect(initialVisibleGeometryCount).toBeGreaterThan(0)
  const tree = page.getByRole('tree', { name: 'Scene Explorer' })
  const initialTreeItemCount = await tree.getByRole('treeitem').count()
  const expandObjects = page.getByRole('button', { name: 'Expand Objects' })
  if (await expandObjects.isVisible()) await expandObjects.click()
  await expect(page.getByRole('treeitem', { name: /Part/u })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Model', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Add Box', exact: true }).click()
  await expect.poll(async () => tree.getByRole('treeitem').count()).toBeGreaterThan(initialTreeItemCount)
  await expect.poll(visibleGeometryCount).toBeGreaterThan(0)

  const canvas = page.locator('.v5-scene-canvas')
  await page.getByRole('button', { name: 'Home view' }).click()
  const before = await canvas.getAttribute('data-camera-position')
  await page.getByRole('button', { name: 'Fit all visible geometry' }).click()
  await expect.poll(async () => canvas.getAttribute('data-camera-position')).not.toBe(before)
  expect(runtimeErrors).toEqual([])
})

test('V6 keeps the narrow and compact camera toolbar in one row beside the reserved scene-status lane', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await loadV6Demo(page)

  const shell = page.getByTestId('v6-application-shell')
  const toolbar = page.getByTestId('v6-camera-toolbar')
  const presentation = page.getByTestId('v5-scene-presentation')
  await page.setViewportSize({ width: 959, height: 900 })
  await expect(shell).toHaveAttribute('data-workspace-mode', 'narrow')
  await expect(toolbar).toHaveCSS('flex-wrap', 'nowrap')
  const toolbarBox = await toolbar.boundingBox()
  const presentationBox = await presentation.boundingBox()
  expect(toolbarBox).not.toBeNull()
  expect(presentationBox).not.toBeNull()
  expect((presentationBox?.x ?? 0) + (presentationBox?.width ?? 0)).toBeLessThanOrEqual(toolbarBox?.x ?? 0)

  await page.setViewportSize({ width: 1199, height: 900 })
  await expect(shell).toHaveAttribute('data-workspace-mode', 'compact')
  await expect(toolbar).toHaveCSS('flex-wrap', 'nowrap')
  const compactToolbarBox = await toolbar.boundingBox()
  const compactPresentationBox = await presentation.boundingBox()
  expect(compactToolbarBox).not.toBeNull()
  expect(compactPresentationBox).not.toBeNull()
  expect((compactPresentationBox?.x ?? 0) + (compactPresentationBox?.width ?? 0)).toBeLessThanOrEqual(compactToolbarBox?.x ?? 0)
})

test('V6 keeps the ViewCube, status chip, toolbar, and Camera views inside short and wide viewport bounds', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await loadV6Demo(page)

  const viewports = [
    { width: 1440, height: 900 },
    { width: 512, height: 384 },
  ] as const
  const canvasHost = page.getByTestId('v6-canvas-host')
  const renderer = page.locator('.v5-scene-renderer')
  const presentation = page.getByTestId('v5-scene-presentation')
  const toolbar = page.getByTestId('v6-camera-toolbar')
  const cameraViewsTrigger = page.getByRole('button', { name: 'Camera views' })

  for (const viewport of viewports) {
    await page.setViewportSize(viewport)
    await expect(canvasHost).toBeVisible()
    await expect(renderer).toBeVisible()
    await expect(presentation).toBeVisible()
    await expect(toolbar).toBeVisible()

    const hostBox = await canvasHost.boundingBox()
    const rendererBox = await renderer.boundingBox()
    const presentationBox = await presentation.boundingBox()
    const toolbarBox = await toolbar.boundingBox()
    expect(hostBox).not.toBeNull()
    expect(rendererBox).not.toBeNull()
    expect(presentationBox).not.toBeNull()
    expect(toolbarBox).not.toBeNull()
    if (hostBox === null || rendererBox === null || presentationBox === null || toolbarBox === null) continue

    expect(rendererBox.x).toBeGreaterThanOrEqual(hostBox.x)
    expect(rendererBox.y).toBeGreaterThanOrEqual(hostBox.y)
    expect(rendererBox.x + rendererBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width)
    expect(rendererBox.y + rendererBox.height).toBeLessThanOrEqual(hostBox.y + hostBox.height)

    expect(presentationBox.x).toBeGreaterThanOrEqual(rendererBox.x)
    expect(presentationBox.y).toBeGreaterThanOrEqual(rendererBox.y)
    expect(presentationBox.x + presentationBox.width).toBeLessThanOrEqual(rendererBox.x + rendererBox.width)
    expect(presentationBox.y + presentationBox.height).toBeLessThanOrEqual(rendererBox.y + rendererBox.height)
    expect(presentationBox.width).toBeLessThan(rendererBox.width)
    expect(presentationBox.height).toBeLessThan(rendererBox.height)

    expect(toolbarBox.x).toBeGreaterThanOrEqual(hostBox.x)
    expect(toolbarBox.y).toBeGreaterThanOrEqual(hostBox.y)
    expect(toolbarBox.x + toolbarBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width)
    expect(toolbarBox.y + toolbarBox.height).toBeLessThanOrEqual(hostBox.y + hostBox.height)

    const cubeSize = Number(await renderer.getAttribute('data-view-cube-size'))
    const cubeSafeMargin = Number(await renderer.getAttribute('data-view-cube-safe-margin'))
    expect(await renderer.getAttribute('data-view-cube-alignment')).toBe('bottom-right')
    expect(cubeSize).toBe(72)
    expect(cubeSafeMargin).toBe(48)
    expect(rendererBox.width).toBeGreaterThanOrEqual(cubeSize + cubeSafeMargin * 2)
    expect(rendererBox.height).toBeGreaterThanOrEqual(cubeSize + cubeSafeMargin * 2)

    await cameraViewsTrigger.click()
    const menu = page.getByRole('menu', { name: 'Camera views' })
    await expect(menu).toBeVisible()
    const menuBox = await menu.boundingBox()
    expect(menuBox).not.toBeNull()
    if (menuBox === null) continue
    expect(menuBox.x).toBeGreaterThanOrEqual(hostBox.x)
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(hostBox.x + hostBox.width)
    expect(menuBox.y).toBeGreaterThanOrEqual(hostBox.y)
    expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(viewport.height)
    expect(await menu.getByRole('menuitem')).toHaveCount(7)

    const menuScroll = await menu.evaluate((element) => {
      const scrollable = element as HTMLElement
      scrollable.scrollTop = scrollable.scrollHeight
      return { clientHeight: scrollable.clientHeight, scrollHeight: scrollable.scrollHeight, scrollTop: scrollable.scrollTop }
    })
    expect(menuScroll.scrollHeight).toBeGreaterThanOrEqual(menuScroll.clientHeight)
    if (viewport.height <= 384) {
      expect(menuScroll.scrollHeight).toBeGreaterThan(menuScroll.clientHeight)
      expect(menuScroll.scrollTop).toBeGreaterThan(0)
    }
    await page.keyboard.press('Escape')
    await expect(menu).toBeHidden()
  }
})
