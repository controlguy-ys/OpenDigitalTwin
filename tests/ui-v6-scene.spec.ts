import { inflateSync } from 'node:zlib'
import { expect, type Locator } from '@playwright/test'

import { loadV6Demo, selectV6DemoRobot, test } from './ui-v6-fixtures.js'

interface ViewCubePixelSample {
  readonly canvasWidth: number
  readonly canvasHeight: number
  readonly pixelCount: number
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

function decodePng(buffer: Buffer): { readonly width: number; readonly height: number; readonly channels: number; readonly pixels: Buffer } | null {
  if (buffer.length < 33 || buffer.readUInt32BE(0) !== 0x89504e47) return null
  let offset = 8
  let width = 0
  let height = 0
  let channels = 0
  const imageData: Buffer[] = []
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const data = buffer.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[10] !== 0 || data[11] !== 0) return null
      channels = data[9] === 2 ? 3 : data[9] === 6 ? 4 : 0
    } else if (type === 'IDAT') imageData.push(data)
    else if (type === 'IEND') break
    offset += length + 12
  }
  if (width === 0 || height === 0 || channels === 0) return null
  const rowBytes = width * channels
  const decoded = inflateSync(Buffer.concat(imageData))
  const pixels = Buffer.alloc(height * rowBytes)
  let decodedOffset = 0
  let previousRow = Buffer.alloc(rowBytes)
  for (let y = 0; y < height; y += 1) {
    const filter = decoded[decodedOffset++] ?? 0
    const row = Buffer.alloc(rowBytes)
    for (let index = 0; index < rowBytes; index += 1) {
      const left = index >= channels ? row[index - channels] ?? 0 : 0
      const above = previousRow[index] ?? 0
      const upperLeft = index >= channels ? previousRow[index - channels] ?? 0 : 0
      const value = decoded[decodedOffset++] ?? 0
      let predictor = 0
      if (filter === 1) predictor = left
      else if (filter === 2) predictor = above
      else if (filter === 3) predictor = Math.floor((left + above) / 2)
      else if (filter === 4) {
        const estimate = left + above - upperLeft
        const leftDistance = Math.abs(estimate - left)
        const aboveDistance = Math.abs(estimate - above)
        const upperLeftDistance = Math.abs(estimate - upperLeft)
        predictor = leftDistance <= aboveDistance && leftDistance <= upperLeftDistance
          ? left
          : aboveDistance <= upperLeftDistance ? above : upperLeft
      }
      row[index] = (value + predictor) & 0xff
    }
    row.copy(pixels, y * rowBytes)
    previousRow = row
  }
  return { width, height, channels, pixels }
}

async function readViewCubePixels(renderer: Locator): Promise<ViewCubePixelSample | null> {
  const decoded = decodePng(await renderer.screenshot())
  if (decoded === null) return null
  const { channels, height, pixels, width } = decoded
  let pixelCount = 0
  let minX = width
  let maxX = -1
  let minY = height
  let maxY = -1
  const regionLeft = Math.max(0, width - 220)
  const regionTop = Math.max(0, height - 220)
  for (let y = regionTop; y < height; y += 1) {
    for (let x = regionLeft; x < width; x += 1) {
      const offset = (y * width + x) * channels
      const red = pixels[offset] ?? 0
      const green = pixels[offset + 1] ?? 0
      const blue = pixels[offset + 2] ?? 0
      const neutralLight = red > 150
        && green > 160
        && blue > 165
        && Math.max(red, green, blue) - Math.min(red, green, blue) < 42
      if (!neutralLight) continue
      pixelCount += 1
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
    }
  }
  return { canvasWidth: width, canvasHeight: height, pixelCount, minX, maxX, minY, maxY }
}

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
    const cubePixels = await readViewCubePixels(renderer)
    expect(await renderer.getAttribute('data-view-cube-alignment')).toBe('bottom-right')
    expect(cubeSize).toBe(72)
    expect(cubePixels).not.toBeNull()
    if (cubePixels === null) continue
    expect(cubePixels.pixelCount).toBeGreaterThan(100)
    expect(cubePixels.maxX).toBeGreaterThan(cubePixels.minX)
    expect(cubePixels.maxY).toBeGreaterThan(cubePixels.minY)
    expect(cubePixels.minX).toBeGreaterThanOrEqual(0)
    expect(cubePixels.minY).toBeGreaterThanOrEqual(8)
    expect(cubePixels.canvasWidth - 1 - cubePixels.maxX).toBeGreaterThanOrEqual(8)
    expect(cubePixels.canvasHeight - 1 - cubePixels.maxY).toBeGreaterThanOrEqual(8)
    expect(cubePixels.maxX - cubePixels.minX).toBeGreaterThanOrEqual(cubeSize / 2)
    expect(cubePixels.maxY - cubePixels.minY).toBeGreaterThanOrEqual(cubeSize / 2)

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
